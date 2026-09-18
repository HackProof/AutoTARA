#!/usr/bin/env python3
import argparse
import json
import time
from collections import defaultdict
from pathlib import Path

import yaml
from simulator_core import AttackGraphSimulator
from path_search import find_paths


def load_yaml_file(yaml_file):
    with Path(yaml_file).open(encoding='utf-8') as f:
        return yaml.safe_load(f) or {}


def load_asset_types(model_file):
    data = load_yaml_file(model_file)

    mapping = {}
    for _, asset in (data.get('assets', {}) or {}).items():
        name = asset.get('name')
        asset_type = asset.get('type', '')
        if name:
            mapping[name] = asset_type
    return mapping


def unique_output_path(path):
    output_path = Path(path)
    if not output_path.exists():
        return output_path

    parent = output_path.parent
    stem = output_path.stem
    suffix = output_path.suffix
    counter = 2
    while True:
        candidate = parent / f'{stem}({counter}){suffix}'
        if not candidate.exists():
            return candidate
        counter += 1


def resolve_relative_to(base_file, configured_path):
    path = Path(configured_path)
    if path.is_absolute():
        return path
    return Path(base_file).resolve().parent / path


def infer_lang_name(scenario_file, scenario_data):
    lang_file = scenario_data.get('lang_file')
    if lang_file:
        return Path(lang_file).stem

    stem = Path(scenario_file).stem
    suffix = '_scenario'
    if stem.endswith(suffix):
        return stem[:-len(suffix)]
    return stem


def select_scenario_agent(scenario_data):
    agents = scenario_data.get('agents') or {}
    if not isinstance(agents, dict):
        raise ValueError('Scenario "agents" must be a mapping')

    for _, agent in agents.items():
        if not isinstance(agent, dict):
            continue
        entry_points = agent.get('entry_points') or []
        goals = agent.get('goals') or []
        if entry_points and goals:
            return str(entry_points[0]), str(goals[0])

    raise ValueError('Scenario must contain an agent with entry_points and goals')


def default_attackgraph_path(scenario_file):
    scenario_path = Path(scenario_file).resolve()
    candidates = [
        scenario_path.parent / 'logs' / 'attackgraph.yml',
        Path.cwd() / 'logs' / 'attackgraph.yml',
        Path(__file__).resolve().parent / 'logs' / 'attackgraph.yml',
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def load_scenario_config(scenario_file, attackgraph_file=None):
    scenario_data = load_yaml_file(scenario_file)
    if 'model_file' not in scenario_data:
        raise ValueError('Scenario must contain model_file')

    entry_name, target_name = select_scenario_agent(scenario_data)
    lang_name = infer_lang_name(scenario_file, scenario_data)

    return {
        'attackgraph_file': Path(attackgraph_file) if attackgraph_file else default_attackgraph_path(scenario_file),
        'model_file': resolve_relative_to(scenario_file, scenario_data['model_file']),
        'entry': entry_name,
        'target': target_name,
        'lang_name': lang_name,
    }


def split_attack_step(step):
    prefix = f"{step.asset}:"
    attack_step = step.name[len(prefix):] if step.name.startswith(prefix) else step.name
    return {
        'assetType': '',
        'assetName': step.asset,
        'attackStep': attack_step,
    }


def node_payload(step, asset_types):
    item = split_attack_step(step)
    item['assetType'] = asset_types.get(step.asset, '')
    item['nodeId'] = step.id
    item['hidden'] = 'hidden' in (step.tags or [])
    item['logicalType'] = step.type
    item['fullName'] = step.name
    if step.type in {'exist', 'notexist'}:
        item['existenceStatus'] = step.existence_status
        item['conditionSatisfied'] = step.existence_status if step.type == 'exist' else not step.existence_status
    return item


def build_plan_payload(primary, simulator, asset_types):
    critical_graph = getattr(simulator, 'critical_path_graphs', {}).get(tuple(primary))
    if critical_graph is None:
        nodes, edges = simulator.build_attack_plan(primary)
    else:
        edges = {(source, target) for source, targets in critical_graph.items() for target in targets}
        nodes = set(primary) | {ident for edge in edges for ident in edge}
        for ident in list(nodes):
            if simulator.attack_steps[ident].type == 'and' and ident not in simulator.entry_points:
                for parent in simulator.attack_steps[ident].parents:
                    if parent in simulator.exist_nodes:
                        nodes.add(parent)
                        edges.add((parent, ident))
    primary_edges = set(zip(primary, primary[1:]))
    ordered_edges = sorted(edges, key=lambda edge: tuple(map(str, edge)))
    return {
        'primaryPath': list(primary),
        'nodes': {str(ident): node_payload(simulator.all_nodes[ident], asset_types)
                  for ident in sorted(nodes, key=str)},
        'edges': [{'from': source, 'to': target} for source, target in ordered_edges],
        'supportNodeIds': sorted(nodes - set(primary), key=str),
        'supportEdges': [{'from': source, 'to': target} for source, target in ordered_edges
                         if (source, target) not in primary_edges],
    }


def plan_graph_paths(plans, simulator, hide_hidden):
    """Project the union of dependency graphs for DAG output only."""
    nodes, adjacency = set(), defaultdict(set)
    for plan in plans.values():
        nodes.update(item['nodeId'] for item in plan['nodes'].values())
        for edge in plan['edges']:
            adjacency[edge['from']].add(edge['to'])
    visible = {ident for ident in nodes if not hide_hidden or not simulator.is_hidden_for_visualization(ident)}
    graph_paths = [[ident] for ident in sorted(visible, key=str)]
    for source in sorted(visible, key=str):
        pending, visited = sorted(adjacency[source], key=str, reverse=True), set()
        while pending:
            target = pending.pop()
            if target in visited:
                continue
            visited.add(target)
            if target in visible:
                if source != target:
                    graph_paths.append([source, target])
            else:
                pending.extend(sorted(adjacency[target], key=str, reverse=True))
    return graph_paths


def build_reachable_adjacency(simulator):
    adjacency = defaultdict(list)
    for src_id, tgt_id in simulator.path_edges:
        adjacency[src_id].append(tgt_id)

    for src_id in adjacency:
        adjacency[src_id].sort(
            key=lambda node_id: (
                simulator.all_nodes[node_id].asset,
                simulator.all_nodes[node_id].name,
                str(node_id),
            )
        )
    return dict(adjacency)


def enumerate_paths_from_adjacency(adjacency, entry_id, target_id, max_paths=None):
    paths, _ = find_paths(adjacency, entry_id, target_id, max_paths=30 if max_paths is None else max_paths)
    return paths


def enumerate_reachable_paths(simulator, entry_id, target_id, max_paths=None):
    return enumerate_paths_from_adjacency(
        build_reachable_adjacency(simulator), entry_id, target_id, max_paths=max_paths,
    )


def collapse_hidden_nodes(path, simulator, hide_hidden):
    if not hide_hidden:
        return list(path)

    collapsed = []
    for index, node_id in enumerate(path):
        keep = (
            node_id in simulator.entry_points or
            node_id == simulator.target or
            not simulator.is_hidden_for_visualization(node_id)
        )
        if keep and (not collapsed or collapsed[-1] != node_id):
            collapsed.append(node_id)

    return collapsed


def deduplicate_paths(paths):
    seen = set()
    unique = []
    for path in paths:
        key = tuple(path)
        if key in seen:
            continue
        seen.add(key)
        unique.append(path)
    return unique


def select_shortest_paths(paths):
    if not paths:
        return []
    min_length = min(len(path) for path in paths)
    return [path for path in paths if len(path) == min_length]


def path_graph_to_adjacency(path_graph):
    adjacency = defaultdict(list)
    for src_id, targets in path_graph.items():
        for tgt_id in targets:
            adjacency[src_id].append(tgt_id)
    return dict(adjacency)


def select_critical_paths(simulator, entry_id, target_id, hide_hidden, iterations,
                          max_paths=None, max_hops=20):
    results = simulator.run_simulation_only(iterations)
    path_counts = defaultdict(int)
    simulator.critical_path_graphs = {}
    simulator.search_stats = {'truncated': False, 'stopReason': None,
                              'scope': 'sampledCriticalPaths', 'maxHops': max_hops,
                              'maxPaths': max_paths or 30}
    deadline = time.monotonic() + 3.0
    for path_graph in results['shortest_paths']:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            simulator.search_stats.update(truncated=True, stopReason='timeLimit')
            break
        paths, search = find_paths(path_graph_to_adjacency(path_graph), entry_id, target_id,
                                   max_paths=max_paths or 30, max_hops=max_hops,
                                   time_limit=remaining)
        if search['truncated']:
            simulator.search_stats.update(truncated=True, stopReason=search['stopReason'])
        for path in paths:
            key = tuple(path)
            path_counts[key] += 1
            simulator.critical_path_graphs.setdefault(key, path_graph)
    if not path_counts:
        return []
    highest_frequency = max(path_counts.values())
    paths = [list(path) for path, frequency in path_counts.items() if frequency == highest_frequency]
    paths.sort(key=lambda path: (len(path), tuple(map(str, path))))
    if len(paths) > (max_paths or 30):
        simulator.search_stats.update(truncated=True, stopReason='pathLimit')
    return paths[:max_paths or 30]


def materialize_paths(simulator, paths, hide_hidden):
    processed = [collapse_hidden_nodes(path, simulator, hide_hidden) for path in paths]
    processed = [path for path in processed if path]
    return deduplicate_paths(processed)


def build_linear_payload(paths, simulator, asset_types):
    target_block = {}
    for path_index, path in enumerate(paths, start=1):
        path_key = f'path{path_index}'
        path_payload = {}
        for step_index, node_id in enumerate(path, start=1):
            step = simulator.all_nodes[node_id]
            item = split_attack_step(step)
            item['assetType'] = asset_types.get(step.asset, '')
            path_payload[str(step_index)] = item
        target_block[path_key] = path_payload
    return target_block


def build_grouped_linear_payload(paths, simulator, asset_types):
    target_block = {}
    for path_index, path in enumerate(paths, start=1):
        path_key = f'path{path_index}'
        path_payload = {}
        grouped_steps = []

        for node_id in path:
            step = simulator.all_nodes[node_id]
            item = split_attack_step(step)
            item['assetType'] = asset_types.get(step.asset, '')

            if (
                grouped_steps and
                grouped_steps[-1]['assetType'] == item['assetType'] and
                grouped_steps[-1]['assetName'] == item['assetName']
            ):
                grouped_steps[-1]['attackSteps'].append(item['attackStep'])
                continue

            grouped_steps.append({
                'assetType': item['assetType'],
                'assetName': item['assetName'],
                'attackSteps': [item['attackStep']],
            })

        for step_index, item in enumerate(grouped_steps, start=1):
            path_payload[str(step_index)] = {
                'assetType': item['assetType'],
                'assetName': item['assetName'],
                'attackStep': ' -> '.join(item['attackSteps']),
            }

        target_block[path_key] = path_payload
    return target_block


def build_dag_payload(paths, simulator, asset_types):
    node_ids = []
    seen_nodes = set()
    edge_keys = set()
    edges = []

    for path in paths:
        for node_id in path:
            if node_id not in seen_nodes:
                seen_nodes.add(node_id)
                node_ids.append(node_id)
        for src_id, tgt_id in zip(path[:-1], path[1:]):
            if (src_id, tgt_id) in edge_keys:
                continue
            edge_keys.add((src_id, tgt_id))
            edges.append({'from': src_id, 'to': tgt_id})

    nodes = {
        str(node_id): node_payload(simulator.all_nodes[node_id], asset_types)
        for node_id in sorted(
            node_ids,
            key=lambda nid: (
                simulator.all_nodes[nid].asset,
                simulator.all_nodes[nid].name,
                str(nid),
            )
        )
    }

    return {
        'nodes': nodes,
        'edges': edges,
    }


def export_requested_format(
    attackgraph_file, model_file, entry_name, target_name, output_format,
    hide_hidden, path_mode, critical_iterations, max_paths,
    max_hops=20,
):
    export_started_at = time.perf_counter()
    max_paths = 30 if max_paths is None else max_paths
    if output_format not in {'linear', 'dag'} or path_mode not in {'all', 'shortest', 'critical'}:
        raise ValueError('Invalid output format or path mode')
    # Validate limits even when the target is unreachable.
    find_paths({}, 0, 1, max_paths=max_paths, max_hops=max_hops)
    if critical_iterations <= 0:
        raise ValueError('critical_iterations must be positive')
    simulator = AttackGraphSimulator(random_tie_breaking=True)
    simulator.load_yaml(str(attackgraph_file))
    simulator.set_entry_points([entry_name])
    simulator.set_target(target_name)
    target_reachable = simulator.find_entry_to_target_paths()
    entry_id, target_id = simulator.entry_points[0], simulator.target
    asset_types = load_asset_types(model_file)

    if not target_reachable:
        raw_paths, search = [], {
            'truncated': False, 'stopReason': None, 'maxPaths': max_paths,
            'maxHops': max_hops, 'scope': 'pathsWithinHopLimit',
        }
    elif path_mode == 'critical':
        raw_paths = select_critical_paths(simulator, entry_id, target_id, hide_hidden,
                                          critical_iterations, max_paths, max_hops)
        search = simulator.search_stats
    else:
        raw_paths, search = find_paths(
            build_reachable_adjacency(simulator), entry_id, target_id,
            max_paths=max_paths, max_hops=max_hops, shortest_only=path_mode == 'shortest',
        )

    # Search/rank original steps first. Hiding/grouping is display-only and cannot
    # turn a longer attack into the shortest path or erase AND prerequisites.
    selected_paths, plans, seen = [], {}, set()
    for raw_path in raw_paths:
        displayed = collapse_hidden_nodes(raw_path, simulator, hide_hidden)
        key = tuple(displayed)
        if key in seen:
            continue
        seen.add(key)
        selected_paths.append(displayed)
        plans[f'path{len(selected_paths)}'] = build_plan_payload(raw_path, simulator, asset_types)
    if not target_reachable:
        status = 'unreachable'
    elif selected_paths:
        status = 'found'
    elif search['truncated']:
        status = 'incomplete'
    elif path_mode == 'critical':
        status = 'noSampledPathWithinLimits'
    else:
        status = 'noPathWithinHopLimit'
    target_block = {
        'entry': simulator.attack_steps[entry_id].name,
        'target': simulator.attack_steps[target_id].name,
        'options': {
            'outputFormat': output_format, 'hideHidden': hide_hidden,
            'pathMode': path_mode,
            'criticalIterations': critical_iterations if path_mode == 'critical' else None,
            'maxPaths': max_paths, 'maxHops': max_hops,
        },
        'stats': {
            'reachableNodeCount': len(simulator.path_nodes),
            'reachableEdgeCount': len(simulator.path_edges),
            'returnedPathCount': len(selected_paths),
            'rawEnumeratedPathCount': len(raw_paths),
            'targetReachable': target_reachable, 'status': status,
            'search': search,
        },
        'warnings': simulator.warnings,
        'pathDetails': plans,
    }
    target_block['stats']['exportElapsedSeconds'] = round(time.perf_counter() - export_started_at, 3)
    if output_format == 'dag':
        graph_paths = plan_graph_paths(plans, simulator, hide_hidden)
        target_block['dag'] = build_dag_payload(graph_paths, simulator, asset_types)
    else:
        target_block.update(build_grouped_linear_payload(selected_paths, simulator, asset_types))
    return {'AttackPath': target_block}


def main():
    tool_started_at = time.perf_counter()
    parser = argparse.ArgumentParser(
        usage=(
            '%(prog)s SCENARIO_FILE [options]\n'
            '       %(prog)s ATTACKGRAPH_FILE MODEL_FILE --entry ENTRY --target TARGET --output OUTPUT [options]'
        ),
        description=(
            'Export Entry->Target paths. In scenario mode, entry, target, model_file, '
            'and JSON output are derived automatically.'
        ),
        epilog=(
            'Scenario mode defaults:\n'
            '  entry: first agents.*.entry_points item from SCENARIO_FILE\n'
            '  target: first agents.*.goals item from SCENARIO_FILE\n'
            '  model: model_file from SCENARIO_FILE\n'
            '  output: <lang>_path_result.json, or <lang>_path_result(2).json if it exists\n'
            'Examples:\n'
            '  %(prog)s AI_Lang-0.0.1_scenario.yml\n'
            '  %(prog)s AI_Lang-0.0.1_scenario.yml --path-mode shortest\n'
            '  %(prog)s logs/attackgraph.yml AI_Lang_v0.0.1_model.yml --entry AIUser:validAccount --target llamaCPP:externalHarms --output result.json'
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('scenario_or_attackgraph_file', metavar='SCENARIO_FILE_OR_ATTACKGRAPH_FILE')
    parser.add_argument('model_file', nargs='?', metavar='MODEL_FILE', help='Legacy mode: model file when the first argument is an attack graph YAML')
    parser.add_argument('--attackgraph-file', help='Attack graph YAML path for scenario mode; defaults to logs/attackgraph.yml')
    parser.add_argument('--entry', help='Legacy mode: entry attack step. Scenario mode reads the first entry point from the scenario')
    parser.add_argument('--target', help='Legacy mode: target attack step. Scenario mode reads the first goal from the scenario')
    parser.add_argument('--output', help='Output JSON path. Defaults to <lang>_path_result.json in scenario mode')
    parser.add_argument('--output-format', choices=['linear', 'dag'], default='linear')
    parser.add_argument('--hide-hidden', action='store_true')
    parser.add_argument('--path-mode', choices=['all', 'shortest', 'critical'], default='all')
    parser.add_argument('--critical-iterations', type=int, default=1000)
    parser.add_argument('--max-paths', type=int, default=30, help='Maximum primary paths (default: 30)')
    parser.add_argument('--max-hops', type=int, default=20, help='Maximum primary edges before hiding/grouping (default: 20)')
    args = parser.parse_args()

    if args.model_file is None:
        config = load_scenario_config(
            args.scenario_or_attackgraph_file,
            attackgraph_file=args.attackgraph_file,
        )
        attackgraph_file = config['attackgraph_file']
        model_file = config['model_file']
        entry = config['entry']
        target = config['target']
        output_path = unique_output_path(args.output or f"{config['lang_name']}_path_result.json")
    else:
        missing = [
            name for name, value in (
                ('--entry', args.entry),
                ('--target', args.target),
                ('--output', args.output),
            )
            if value is None
        ]
        if missing:
            parser.error(f"legacy mode requires {' '.join(missing)}")
        if args.attackgraph_file:
            parser.error('--attackgraph-file is only valid when the first argument is a scenario file')

        attackgraph_file = Path(args.scenario_or_attackgraph_file)
        model_file = Path(args.model_file)
        entry = args.entry
        target = args.target
        output_path = unique_output_path(args.output)

    payload = export_requested_format(
        attackgraph_file,
        model_file,
        entry,
        target,
        args.output_format,
        args.hide_hidden,
        args.path_mode,
        args.critical_iterations,
        args.max_paths,
        max_hops=args.max_hops,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open('x', encoding='utf-8') as output_file:
        output_file.write(json.dumps(payload, indent=2, ensure_ascii=False))
    tool_elapsed = time.perf_counter() - tool_started_at
    print(f'Wrote {output_path} (elapsed: {tool_elapsed:.3f}s)')


if __name__ == '__main__':
    main()
