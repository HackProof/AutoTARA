"""Run with: python -m unittest discover -s simulator.server/tests -v"""

import asyncio
import importlib.util
import json
import os
from pathlib import Path
import random
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

import yaml

SERVER = Path(__file__).resolve().parents[1]
ROOT = SERVER.parent
sys.path.insert(0, str(SERVER / 'module' / 'core'))
sys.path.insert(0, str(SERVER))

from attack_step import AttackStep
from export_paths import export_requested_format
from graph_loader import load_graph
from path_search import find_paths
from simulator_core import AttackGraphSimulator
import api_server


def document(kinds, edges, extra=None):
    records = {
        f'Asset:step{ident}': {'id': ident, 'asset': 'Asset', 'type': kind, 'parents': {}, 'children': {}}
        for ident, kind in kinds.items()
    }
    for source, target in edges:
        records[f'Asset:step{source}']['children'][target] = f'Asset:step{target}'
        records[f'Asset:step{target}']['parents'][source] = f'Asset:step{source}'
    for ident, fields in (extra or {}).items():
        records[f'Asset:step{ident}'].update(fields)
    return {'attack_steps': records}


class GraphTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.graph = Path(self.temp.name) / 'graph.yml'
        self.model = Path(self.temp.name) / 'model.yml'
        self.model.write_text('assets: {}\n')

    def load(self, data, entries=(0,), target=2):
        self.graph.write_text(yaml.safe_dump(data), encoding='utf-8')
        simulator = AttackGraphSimulator(random_tie_breaking=False)
        simulator.load_yaml(self.graph)
        simulator.set_entry_points(list(entries))
        simulator.set_target(target)
        return simulator

    def export(self, entry=0, target=2, **options):
        defaults = dict(output_format='linear', hide_hidden=False, path_mode='all',
                        critical_iterations=2, max_paths=30)
        defaults.update(options)
        return export_requested_format(self.graph, self.model, entry, target, **defaults)['AttackPath']

    def test_unmet_and_is_not_a_path_even_if_parent_marked_unnecessary(self):
        self.load(document({0: 'or', 1: 'and', 2: 'or', 3: 'or'}, [(0, 1), (3, 1), (1, 2)],
                           {3: {'is_necessary': False}}))
        result = self.export()
        self.assertFalse(result['stats']['targetReachable'])
        self.assertEqual(result['stats']['status'], 'unreachable')
        self.assertEqual(result['pathDetails'], {})
        self.assertEqual(api_server.normalize_linear_attack_paths({'AttackPath': result}), [])

    def test_joint_entries_and_dependency_branches(self):
        sim = self.load(document({0: 'or', 1: 'and', 2: 'or', 3: 'or'},
                                 [(0, 1), (3, 1), (1, 2)]), entries=(0, 3))
        self.assertTrue(sim.find_entry_to_target_paths())
        nodes, edges = sim.build_attack_plan([0, 1, 2])
        self.assertIn(3, nodes)
        self.assertIn((3, 1), edges)
        final_graph, ttc = sim.simulate_iteration()
        self.assertEqual(ttc, 0)
        self.assertEqual(final_graph[3], [1])

    def test_side_branch_preserved_in_json_and_dag(self):
        sim = self.load(document({0: 'or', 1: 'and', 2: 'or', 3: 'or'},
                                 [(0, 1), (0, 3), (3, 1), (1, 2)]))
        sim.find_entry_to_target_paths()
        result = self.export(max_paths=1)
        plan = result['pathDetails']['path1']
        self.assertEqual(plan['primaryPath'], [0, 1, 2])
        self.assertEqual(plan['supportNodeIds'], [3])
        self.assertIn({'from': 0, 'to': 3}, plan['supportEdges'])
        self.assertIn({'from': 3, 'to': 1}, plan['supportEdges'])
        dag = self.export(max_paths=1, output_format='dag')['dag']
        self.assertIn({'from': 3, 'to': 1}, dag['edges'])
        normalized = api_server.normalize_linear_attack_paths({'AttackPath': result})
        self.assertEqual(len(normalized), 1)
        compat = api_server.build_shortest_paths_compat('Asset:step0', 'Asset:step2', normalized)
        path = compat['agents']['Attacker']['goals']['Asset:step2']['full_path']
        self.assertEqual([step['id'] for step in path], [0, 1, 2])
        self.assertEqual(path[1]['type'], 'and')

    def test_existing_primary_route_does_not_gain_an_unneeded_or_alternative(self):
        sim = self.load(document({0: 'or', 1: 'or', 2: 'and', 3: 'or', 4: 'or', 5: 'or'},
                                 [(0, 1), (1, 4), (4, 5), (0, 3), (3, 5), (5, 2), (0, 2)]))
        sim.find_entry_to_target_paths()
        nodes, edges = sim.build_attack_plan([0, 1, 4, 5, 2])
        self.assertNotIn(3, nodes)
        self.assertNotIn((3, 5), edges)

    def test_exist_and_notexist_boolean_and_legacy_strings(self):
        for kind in ('exist', 'notExist', 'notExists'):
            for status in (True, False, 'True', 'False'):
                with self.subTest(kind=kind, status=status):
                    sim = self.load(document({0: 'or', 1: 'and', 2: 'or', 3: kind},
                                             [(0, 1), (3, 1), (1, 2)], {3: {'existence_status': status}}))
                    value = str(status).lower() == 'true'
                    expected = value if kind == 'exist' else not value
                    self.assertEqual(sim.find_entry_to_target_paths(), expected)
                    self.assertIn(1, sim.attack_steps)  # Keep original graph nodes.
                    if expected:
                        result = self.export()
                        self.assertTrue(result['pathDetails']['path1']['nodes']['3']['conditionSatisfied'])

    def test_false_condition_does_not_delete_or_alternative(self):
        sim = self.load(document({0: 'or', 1: 'or', 2: 'or', 3: 'exist'},
                                 [(0, 1), (3, 1), (1, 2)], {3: {'existence_status': False}}))
        self.assertTrue(sim.find_entry_to_target_paths())

    def test_defense_blocks_entry_target_and_and_support(self):
        for protected in (0, 2, 3):
            for defense in ({'defense_status': 1}, {'ttc': {'name': 'Enabled'}},
                            {'ttc': {'name': 'Bernoulli', 'arguments': [1]}}):
                with self.subTest(protected=protected, defense=defense):
                    sim = self.load(document({0: 'or', 1: 'and', 2: 'or', 3: 'or', 4: 'defense'},
                        [(0, 1), (0, 3), (3, 1), (1, 2), (4, protected)], {4: defense}))
                    self.assertFalse(sim.find_entry_to_target_paths())

    def test_fractional_defenses_do_not_sum_to_certain_block(self):
        sim = self.load(document({0: 'or', 1: 'or', 2: 'or', 3: 'defense', 4: 'defense'},
            [(0, 1), (1, 2), (3, 1), (4, 1)], {3: {'defense_status': .6}, 4: {'defense_status': .6}}))
        self.assertTrue(sim.find_entry_to_target_paths())
        with patch('numpy.random.random', return_value=.9):
            self.assertEqual(sim.simulate_iteration()[1], 0)

    def test_parent_only_edge_and_string_ids_match_summary(self):
        data = document({'e': 'or', 't': 'or'}, [('e', 't')])
        data['attack_steps']['Asset:stepe']['children'] = {}
        sim = self.load(data, entries=('e',), target='t')
        self.assertTrue(sim.find_entry_to_target_paths())
        self.assertEqual(sim.path_edges, {('e', 't')})
        summary = api_server.summarize_attack_graph(self.graph)
        self.assertEqual(summary['edges'], [{'from': 'e', 'to': 't'}])
        self.assertTrue(summary['warnings'])

    def test_invalid_ids_references_and_endpoints_are_errors(self):
        data = document({0: 'or', 2: 'or'}, [(0, 2)])
        data['attack_steps']['Asset:step2']['id'] = '0'
        self.graph.write_text(yaml.safe_dump(data))
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            load_graph(self.graph)
        data = document({0: 'or', 2: 'or'}, [(0, 2)])
        data['attack_steps']['Asset:step0']['children'][99] = 'missing'
        self.graph.write_text(yaml.safe_dump(data))
        with self.assertRaisesRegex(ValueError, 'Unknown node ID'):
            load_graph(self.graph)
        sim = self.load(document({0: 'or', 2: 'or'}, [(0, 2)]))
        with self.assertRaisesRegex(ValueError, 'Unknown attack endpoint'):
            sim.set_entry_points([0, 'missing'])

    def test_reload_clears_defenses_entries_and_paths(self):
        sim = self.load(document({0: 'or', 2: 'or', 3: 'defense'}, [(0, 2), (3, 2)]))
        sim.find_entry_to_target_paths()
        self.graph.write_text(yaml.safe_dump(document({4: 'or'}, [])))
        sim.load_yaml(self.graph)
        self.assertEqual(sim.defense_nodes, {})
        self.assertEqual(sim.entry_points, [])
        self.assertEqual(sim.path_nodes, set())
        self.assertIsNone(sim.target)

    def test_hidden_steps_do_not_change_shortest_path_ranking(self):
        self.load(document({0: 'or', 1: 'or', 2: 'or', 3: 'or', 4: 'or'},
                           [(0, 1), (1, 2), (0, 3), (3, 4), (4, 2)],
                           {3: {'tags': ['hidden']}, 4: {'tags': ['hidden']}}))
        result = self.export(path_mode='shortest', hide_hidden=True, max_paths=1)
        self.assertEqual(result['pathDetails']['path1']['primaryPath'], [0, 1, 2])

    def test_hop_limit_is_not_global_unreachability(self):
        self.load(document({0: 'or', 1: 'or', 2: 'or'}, [(0, 1), (1, 2)]))
        result = self.export(max_hops=1)
        self.assertTrue(result['stats']['targetReachable'])
        self.assertEqual(result['stats']['status'], 'noPathWithinHopLimit')

    def test_entry_equals_target(self):
        self.load(document({0: 'or'}, []), target=0)
        for mode in ('all', 'shortest', 'critical'):
            result = self.export(target=0, max_hops=0, path_mode=mode)
            self.assertEqual(result['pathDetails']['path1']['primaryPath'], [0])

    def test_critical_output_includes_all_and_parents(self):
        self.load(document({0: 'or', 1: 'and', 2: 'or', 3: 'or'},
                           [(0, 1), (0, 3), (3, 1), (1, 2)]))
        result = self.export(path_mode='critical')
        for plan in result['pathDetails'].values():
            self.assertIn({'from': 3, 'to': 1}, plan['edges'])
            self.assertIn({'from': 0, 'to': 1}, plan['edges'])

    def test_simulation_waits_for_all_and_parents_and_chooses_earliest_or(self):
        sim = self.load(document({0: 'or', 1: 'or', 2: 'and', 3: 'or', 4: 'or'},
                                 [(0, 1), (0, 3), (1, 4), (3, 4), (1, 2), (4, 2)]))
        sim.find_entry_to_target_paths()
        with patch.object(AttackStep, 'sample_ttc', lambda step: {1: 10, 3: 1, 4: 1, 2: 2}[step.id]):
            graph, ttc = sim.simulate_iteration()
        self.assertEqual(ttc, 12)
        self.assertIn(4, graph[3])
        self.assertIn(2, graph[1])
        self.assertNotIn(4, graph[1])

    def test_api_path_numbering_is_numeric_and_metadata_is_not_a_path(self):
        paths = {f'path{i}': {'1': {'assetName': str(i), 'attackStep': 'step'}} for i in range(12, 0, -1)}
        paths['pathDetails'] = {'path1': {'primaryPath': [1]}}
        result = api_server.normalize_linear_attack_paths({'AttackPath': paths})
        self.assertEqual([path['key'] for path in result], [f'path{i}' for i in range(1, 13)])

    def test_upload_api_validates_and_forwards_search_limits(self):
        import httpx

        async def check():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api_server.app),
                                         base_url='http://test') as client:
                for endpoint in ('/simulation/run-file', '/simulation/shortest_path'):
                    with patch.object(api_server, 'WORK_DIR', Path(self.temp.name)), \
                         patch.object(api_server, 'run_attack_path_task', new_callable=AsyncMock) as worker:
                        response = await client.post(endpoint,
                            data={'entryPoint': 'A:entry', 'goal': 'A:target', 'maxPaths': '5', 'maxHops': '40'},
                            files={'model_file': ('model.json', b'{}'), 'langGraph': ('langGraph.json', b'{}')})
                        self.assertEqual(response.status_code, 200, response.text)
                        self.addCleanup(api_server.simulation_results.pop, response.json()['session_id'], None)
                        self.assertEqual(worker.call_args.kwargs, {'max_paths': 5, 'max_hops': 40})
                        response = await client.post(endpoint, data={'maxPaths': '0', 'maxHops': '-1'},
                                                     files={'model_file': ('model.json', b'{}')})
                        self.assertEqual(response.status_code, 422)
        asyncio.run(check())

    def test_deep_graph_avoids_recursive_dfs(self):
        sim = self.load(document({i: 'or' for i in range(1200)}, [(i, i + 1) for i in range(1199)]), target=1199)
        self.assertTrue(sim.find_entry_to_target_paths())
        self.assertEqual(len(sim.path_nodes), 1200)
        summary = api_server.summarize_attack_graph(self.graph)
        visible = {node['id'] for node in summary['nodes']}
        self.assertTrue(summary['truncated'])
        self.assertTrue(all(edge['from'] in visible and edge['to'] in visible for edge in summary['edges']))

    def test_scenario_export_without_graphviz_creates_only_json(self):
        self.load(document({0: 'or', 1: 'or', 2: 'or'}, [(0, 1), (1, 2)]))
        scenario = Path(self.temp.name) / 'vehicle_scenario.yml'
        scenario.write_text(yaml.safe_dump({
            'model_file': self.model.name,
            'lang_file': 'vehicle.json',
            'agents': {'Attacker': {
                'entry_points': ['Asset:step0'], 'goals': ['Asset:step2'],
            }},
        }))
        files_before = set(Path(self.temp.name).iterdir())
        subprocess.run(
            [sys.executable, str(api_server.EXPORT_PATHS_SCRIPT), str(scenario),
             '--attackgraph-file', str(self.graph)],
            cwd=self.temp.name,
            env={**os.environ, 'PATH': '', 'PYTHONDONTWRITEBYTECODE': '1'},
            check=True, capture_output=True, text=True, timeout=10,
        )
        output = Path(self.temp.name) / 'vehicle_path_result.json'
        self.assertEqual(set(Path(self.temp.name).iterdir()) - files_before, {output})
        result = json.loads(output.read_text())['AttackPath']
        self.assertEqual(result['pathDetails']['path1']['primaryPath'], [0, 1, 2])

    def test_simulation_cli_prints_statistics_without_images(self):
        self.load(document({0: 'or', 1: 'or', 2: 'or'}, [(0, 1), (1, 2)]))
        files_before = set(Path(self.temp.name).iterdir())
        result = subprocess.run(
            [sys.executable, str(SERVER / 'module/core/cli.py'), str(self.graph),
             '1', 'Asset:step0', 'Asset:step2', '2'],
            cwd=self.temp.name,
            env={**os.environ, 'PATH': '', 'PYTHONDONTWRITEBYTECODE': '1'},
            check=True, capture_output=True, text=True, timeout=10,
        )
        self.assertIn('Global TTC statistics', result.stdout)
        self.assertIn('Ending simulator', result.stdout)
        self.assertEqual(set(Path(self.temp.name).iterdir()), files_before)

    def test_api_worker_exports_results_without_graphviz(self):
        real_run_command = api_server.run_command
        for reachable in (True, False):
            session_id = f'worker-{reachable}'
            session_dir = Path(self.temp.name) / session_id
            session_dir.mkdir()
            lang = session_dir / 'langGraph.json'
            lang.write_text('{}')
            data = document({0: 'or', 1: 'and', 2: 'or', 3: 'or'},
                            [(0, 1), (3, 1), (1, 2)] + ([(0, 3)] if reachable else []))

            def generate_fixture(command, cwd, log_file):
                if command[1:3] == ['-m', 'maltoolbox']:
                    (cwd / 'logs').mkdir()
                    (cwd / 'logs/attackgraph.yml').write_text(yaml.safe_dump(data))
                else:
                    real_run_command(command, cwd, log_file)

            api_server.simulation_results[session_id] = {'created_at': api_server.now_iso()}
            self.addCleanup(api_server.simulation_results.pop, session_id, None)
            with patch.object(api_server, 'WORK_DIR', Path(self.temp.name)), \
                 patch.object(api_server, 'sanitize_model_associations'), \
                 patch.object(api_server, 'run_command', side_effect=generate_fixture), \
                 patch.dict(os.environ, {'PATH': '', 'PYTHONDONTWRITEBYTECODE': '1'}):
                api_server.run_attack_path_task(session_id, self.model, lang, 'Asset:step0', 'Asset:step2')
            result = api_server.simulation_results[session_id]
            self.assertEqual(result['status'], api_server.SimulationStatus.COMPLETED, result.get('error'))
            self.assertEqual(result['result']['attack_path_found'], reachable)
            self.assertEqual(result['result']['attack_path']['stats']['targetReachable'], reachable)
            self.assertEqual(json.loads((session_dir / 'attack_paths.json').read_text()),
                             result['result']['attack_path']['raw'])
            self.assertEqual(result['result']['artifacts'], {
                'attackGraph': 'attackgraph.yml', 'attackPathJson': 'attack_paths.json',
            })
            self.assertNotIn('pdfArtifact', result['result']['attack_path'])
            self.assertFalse((session_dir / 'attack_paths.pdf').exists())
            status = asyncio.run(api_server.get_simulation_status(session_id))
            self.assertEqual(status['status'], api_server.SimulationStatus.COMPLETED)
            self.assertIsNone(status['error'])


class SearchTests(unittest.TestCase):
    def test_shortest_first_despite_depth_first_neighbor_order(self):
        paths, stats = find_paths({0: [1, 2], 1: [3], 3: [4], 2: [4]}, 0, 4, max_paths=1)
        self.assertEqual(paths, [[0, 2, 4]])
        self.assertEqual(stats['stopReason'], 'pathLimit')

    def test_work_time_and_input_limits(self):
        paths, stats = find_paths({0: [1], 1: [2]}, 0, 2, max_expansions=1)
        self.assertEqual(paths, [])
        self.assertEqual(stats['stopReason'], 'workLimit')
        with patch('path_search.time.monotonic', side_effect=[0, 4]):
            self.assertEqual(find_paths({0: [1]}, 0, 1)[1]['stopReason'], 'timeLimit')
        for value in (0, -1):
            with self.assertRaises(ValueError):
                find_paths({}, 0, 1, max_paths=value)

    def test_yen_matches_exhaustive_paths_on_small_cyclic_graphs(self):
        rng = random.Random(1709)
        for _ in range(50):
            adjacency = {i: [j for j in range(6) if i != j and rng.random() < .35] for i in range(6)}
            expected = []
            def visit(path):
                if path[-1] == 5:
                    expected.append(path)
                elif len(path) <= 4:
                    for child in adjacency[path[-1]]:
                        if child not in path:
                            visit(path + [child])
            visit([0])
            actual, stats = find_paths(adjacency, 0, 5, max_paths=1000, max_hops=4)
            self.assertEqual({tuple(p) for p in actual}, {tuple(p) for p in expected})
            self.assertEqual(list(map(len, actual)), sorted(map(len, actual)))
            self.assertFalse(stats['truncated'])
            shortest, _ = find_paths(adjacency, 0, 5, shortest_only=True, max_paths=1000, max_hops=4)
            expected_shortest = [p for p in expected if len(p) == min(map(len, expected))]
            self.assertEqual({tuple(p) for p in shortest}, {tuple(p) for p in expected_shortest})


@unittest.skipUnless(shutil.which('node') and (ROOT / 'attackpath_web_visual_260917/logs/attackgraph.yml').exists(),
                     'Optional viewer reference and Node.js required')
class ViewerParityTests(unittest.TestCase):
    def test_real_yaml_reachability_and_shortest_distance_match_viewer(self):
        reference = ROOT / 'attackpath_web_visual_260917'
        spec = importlib.util.spec_from_file_location('reference_viewer', reference / 'attackgraph_viewer.py')
        viewer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(viewer)
        graph = viewer.normalize_graph(yaml.safe_load((reference / 'logs/attackgraph.yml').read_text()))
        sim = AttackGraphSimulator()
        sim.load_yaml(reference / 'logs/attackgraph.yml')
        script = '''const fs=require('fs'), e=require(process.argv[1]);
const {graph, entries, target}=JSON.parse(fs.readFileSync(0,'utf8'));
const reach=e.analyzeReachability(graph, entries);
const result=e.findPaths(graph, entries[0], target, {entryIds: entries, respectPreconditions: true, maxPaths: 1, maxHops: 20});
console.log(JSON.stringify({reachable:[...reach.reachable], paths:result.paths}));'''
        for entries in (['IVI:connect'], ['OBD-II:connect'], ['IVI:fullAccess'], ['IVI:connect', 'IVIUser:assume']):
            with self.subTest(entries=entries):
                sim.set_entry_points(entries)
                sim.set_target('Brake:manipulate')
                found = sim.find_entry_to_target_paths()
                expected = json.loads(subprocess.check_output(
                    ['node', '-e', script, str(reference / 'attackgraph_viewer/path-engine.js')],
                    input=json.dumps({'graph': graph, 'entries': list(map(str, sim.entry_points)), 'target': str(sim.target)}),
                    text=True, timeout=15))
                self.assertEqual(set(map(str, sim.reachable_nodes)), set(expected['reachable']))
                if found:
                    from export_paths import build_reachable_adjacency
                    paths, _ = find_paths(build_reachable_adjacency(sim), sim.entry_points[0], sim.target, max_paths=1)
                    self.assertEqual(len(paths[0]), len(expected['paths'][0]))
                else:
                    self.assertEqual(expected['paths'], [])


if __name__ == '__main__':
    unittest.main()
