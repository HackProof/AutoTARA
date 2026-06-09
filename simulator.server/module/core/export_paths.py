#!/usr/bin/env python3
import argparse
import json
import shutil
import subprocess
import tempfile
import time
from collections import defaultdict
from pathlib import Path

import yaml
import simulator_core
from simulator_core import AttackGraphSimulator


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
    return item


def build_reachable_adjacency(simulator):
    adjacency = defaultdict(list)
    for src_id, tgt_id in simulator.path_edges:
        adjacency[src_id].append(tgt_id)

    for src_id in adjacency:
        adjacency[src_id].sort(
            key=lambda node_id: (
                simulator.attack_steps[node_id].asset,
                simulator.attack_steps[node_id].name,
                node_id,
            )
        )
    return dict(adjacency)


def enumerate_paths_from_adjacency(adjacency, entry_id, target_id, max_paths=None):
    paths = []
    stack = [(entry_id, [entry_id], {entry_id})]

    while stack:
        current_id, path, visited = stack.pop()
        if current_id == target_id:
            paths.append(path)
            if max_paths is not None and len(paths) >= max_paths:
                break
            continue

        for child_id in reversed(adjacency.get(current_id, [])):
            if child_id in visited:
                continue
            stack.append((child_id, path + [child_id], visited | {child_id}))

    return paths


def enumerate_reachable_paths(simulator, entry_id, target_id, max_paths=None):
    adjacency = build_reachable_adjacency(simulator)
    return enumerate_paths_from_adjacency(adjacency, entry_id, target_id, max_paths=max_paths)


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


def select_critical_paths(simulator, entry_id, target_id, hide_hidden, iterations, max_paths=None):
    results = simulator.run_simulation_only(iterations)
    if not results['shortest_paths']:
        return []

    path_counts = defaultdict(int)
    ordered_paths = []

    for path_graph in results['shortest_paths']:
        adjacency = path_graph_to_adjacency(path_graph)
        simulation_paths = enumerate_paths_from_adjacency(adjacency, entry_id, target_id)
        for raw_path in simulation_paths:
            processed = collapse_hidden_nodes(raw_path, simulator, hide_hidden)
            key = tuple(processed)
            if not key:
                continue
            if key not in path_counts:
                ordered_paths.append(processed)
            path_counts[key] += 1

    if not path_counts:
        return []

    highest_frequency = max(path_counts.values())
    selected = []
    for path in ordered_paths:
        key = tuple(path)
        if path_counts[key] == highest_frequency:
            selected.append(path)
            if max_paths is not None and len(selected) >= max_paths:
                break
    return deduplicate_paths(selected)


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
            step = simulator.attack_steps[node_id]
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
            step = simulator.attack_steps[node_id]
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
        str(node_id): node_payload(simulator.attack_steps[node_id], asset_types)
        for node_id in sorted(
            node_ids,
            key=lambda nid: (
                simulator.attack_steps[nid].asset,
                simulator.attack_steps[nid].name,
                nid,
            )
        )
    }

    return {
        'nodes': nodes,
        'edges': edges,
    }


def graphviz_quote(value):
    text = str(value)
    return '"' + text.replace('\\', '\\\\').replace('"', '\\"').replace('\r', '').replace('\n', '\\n') + '"'


def graphviz_node_label(step, asset_types):
    item = split_attack_step(step)
    label_parts = [
        item['assetName'],
        item['attackStep'],
    ]
    asset_type = asset_types.get(step.asset, '')
    if asset_type:
        label_parts.append(f'[{asset_type}]')
    label_parts.append(f'id={step.id}')
    return '\n'.join(label_parts)


def graphviz_defense_node_id(defense_id):
    return f'defense:{defense_id}'


def graphviz_defense_node_label(step):
    item = split_attack_step(step)
    return '\n'.join([
        item['assetName'],
        f"#{item['attackStep']}",
        f'id={step.id}',
    ])


def collect_graph_elements(paths, entry_id, target_id):
    node_ids = []
    seen_nodes = set()
    edge_keys = set()
    edges = []

    for path in paths:
        for node_id in path:
            if node_id in seen_nodes:
                continue
            seen_nodes.add(node_id)
            node_ids.append(node_id)

        for src_id, tgt_id in zip(path[:-1], path[1:]):
            edge_key = (src_id, tgt_id)
            if edge_key in edge_keys:
                continue
            edge_keys.add(edge_key)
            edges.append(edge_key)

    if not node_ids:
        for node_id in (entry_id, target_id):
            if node_id not in seen_nodes:
                seen_nodes.add(node_id)
                node_ids.append(node_id)

    return node_ids, edges


def collect_defense_elements(node_ids, simulator):
    defense_pairs = []
    seen_pairs = set()

    for node_id in node_ids:
        step = simulator.attack_steps[node_id]
        defense_ids = sorted(
            [defense_id for defense_id in (step.defended_by or []) if defense_id in simulator.defense_nodes],
            key=lambda defense_id: (
                simulator.defense_nodes[defense_id].asset,
                simulator.defense_nodes[defense_id].name,
                defense_id,
            )
        )
        for defense_id in defense_ids:
            pair = (defense_id, node_id)
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            defense_pairs.append(pair)

    return defense_pairs


def build_graphviz_dot(paths, simulator, asset_types, entry_id, target_id, show_defenses=False):
    node_ids, edges = collect_graph_elements(paths, entry_id, target_id)
    defense_pairs = collect_defense_elements(node_ids, simulator) if show_defenses else []
    lines = [
        'digraph AttackPath {',
        '  graph [rankdir=LR, bgcolor="white", pad="0.3", nodesep="0.5", ranksep="0.8"];',
        '  node [shape=box, style="rounded,filled", fontname="Arial", fontsize=10, margin="0.09,0.06"];',
        '  edge [color="#475569", arrowsize=0.8, penwidth=1.4];',
    ]

    for node_id in node_ids:
        step = simulator.attack_steps[node_id]
        if node_id == entry_id:
            fillcolor = '#dcfce7'
            color = '#16a34a'
            penwidth = '2.2'
        elif node_id == target_id:
            fillcolor = '#fee2e2'
            color = '#dc2626'
            penwidth = '2.2'
        elif simulator.is_hidden_for_visualization(node_id):
            fillcolor = '#f3f4f6'
            color = '#6b7280'
            penwidth = '1.0'
        else:
            fillcolor = '#dbeafe'
            color = '#2563eb'
            penwidth = '1.2'

        attrs = {
            'label': graphviz_node_label(step, asset_types),
            'fillcolor': fillcolor,
            'color': color,
            'penwidth': penwidth,
        }
        attr_text = ', '.join(f'{key}={graphviz_quote(value)}' for key, value in attrs.items())
        lines.append(f'  {graphviz_quote(node_id)} [{attr_text}];')

    seen_defense_nodes = set()
    for defense_id, _ in defense_pairs:
        if defense_id in seen_defense_nodes:
            continue
        seen_defense_nodes.add(defense_id)
        defense_step = simulator.defense_nodes[defense_id]
        attrs = {
            'label': graphviz_defense_node_label(defense_step),
            'shape': 'diamond',
            'style': 'filled',
            'fillcolor': '#fef3c7',
            'color': '#d97706',
            'penwidth': '1.2',
            'margin': '0.06,0.04',
        }
        attr_text = ', '.join(f'{key}={graphviz_quote(value)}' for key, value in attrs.items())
        lines.append(f'  {graphviz_quote(graphviz_defense_node_id(defense_id))} [{attr_text}];')

    for src_id, tgt_id in edges:
        lines.append(f'  {graphviz_quote(src_id)} -> {graphviz_quote(tgt_id)};')

    for defense_id, node_id in defense_pairs:
        attrs = {
            'style': 'dashed',
            'color': '#d97706',
            'arrowhead': 'none',
            'penwidth': '1.1',
        }
        attr_text = ', '.join(f'{key}={graphviz_quote(value)}' for key, value in attrs.items())
        lines.append(
            f'  {graphviz_quote(graphviz_defense_node_id(defense_id))} -> '
            f'{graphviz_quote(node_id)} [{attr_text}];'
        )

    lines.append('}')
    return '\n'.join(lines) + '\n'


def infer_graphviz_format(output_path, graphviz_format):
    if graphviz_format:
        return graphviz_format

    extension = output_path.suffix.lower().lstrip('.')
    if extension in {'png', 'svg', 'pdf', 'jpg', 'jpeg'}:
        return 'jpg' if extension == 'jpeg' else extension
    return 'png'


def render_graphviz_image(
    paths,
    simulator,
    asset_types,
    entry_id,
    target_id,
    output_file,
    graphviz_format=None,
    show_defenses=False,
):
    dot_executable = shutil.which('dot')
    if dot_executable is None:
        raise RuntimeError(
            'Graphviz "dot" executable not found. Install Graphviz and make sure dot is on PATH.'
        )

    output_path = Path(output_file)
    if output_path.exists():
        raise FileExistsError(f'Graphviz output already exists: {output_path}')

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_format = infer_graphviz_format(output_path, graphviz_format)
    dot_text = build_graphviz_dot(
        paths,
        simulator,
        asset_types,
        entry_id,
        target_id,
        show_defenses=show_defenses,
    )

    temp_dot_path = None
    try:
        with tempfile.NamedTemporaryFile('w', suffix='.dot', delete=False, encoding='utf-8') as dot_file:
            dot_file.write(dot_text)
            temp_dot_path = Path(dot_file.name)

        subprocess.run(
            [dot_executable, f'-T{output_format}', str(temp_dot_path), '-o', str(output_path)],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.strip()
        detail = f': {stderr}' if stderr else ''
        raise RuntimeError(f'Graphviz failed to render {output_path}{detail}') from exc
    finally:
        if temp_dot_path is not None:
            temp_dot_path.unlink(missing_ok=True)

    node_ids, edges = collect_graph_elements(paths, entry_id, target_id)
    defense_pairs = collect_defense_elements(node_ids, simulator) if show_defenses else []
    return {
        'output': str(output_path),
        'format': output_format,
        'showDefenses': show_defenses,
        'nodeCount': len(node_ids),
        'defenseNodeCount': len({defense_id for defense_id, _ in defense_pairs}),
        'edgeCount': len(edges),
        'defenseEdgeCount': len(defense_pairs),
    }


def export_requested_format(
    attackgraph_file,
    model_file,
    entry_name,
    target_name,
    output_format,
    hide_hidden,
    path_mode,
    critical_iterations,
    max_paths,
    graphviz_output=None,
    graphviz_format=None,
    show_defenses=False,
):
    export_started_at = time.perf_counter()
    simulator_core.print_progress_bar = lambda *args, **kwargs: None

    simulator = AttackGraphSimulator(random_tie_breaking=True)
    simulator.load_yaml(str(attackgraph_file))
    simulator.set_entry_points([entry_name])
    simulator.set_target(target_name)

    if not simulator.entry_points:
        raise ValueError(f"Entry point '{entry_name}' not found")
    if simulator.target is None:
        raise ValueError(f"Target '{target_name}' not found")
    if not simulator.find_entry_to_target_paths():
        raise RuntimeError('No valid paths found from entry point to target')

    entry_id = simulator.entry_points[0]
    target_id = simulator.target
    asset_types = load_asset_types(model_file)

    if path_mode == 'critical':
        selected_paths = select_critical_paths(
            simulator,
            entry_id,
            target_id,
            hide_hidden,
            critical_iterations,
            max_paths=max_paths,
        )
        raw_path_count = len(selected_paths)
    else:
        raw_paths = enumerate_reachable_paths(simulator, entry_id, target_id, max_paths=max_paths)
        raw_path_count = len(raw_paths)
        processed_paths = materialize_paths(simulator, raw_paths, hide_hidden)
        if path_mode == 'shortest':
            selected_paths = select_shortest_paths(processed_paths)
        else:
            selected_paths = processed_paths

    target_block = {
        'entry': entry_name,
        'target': target_name,
        'options': {
            'outputFormat': output_format,
            'hideHidden': hide_hidden,
            'pathMode': path_mode,
            'criticalIterations': critical_iterations if path_mode == 'critical' else None,
            'maxPaths': max_paths,
            'graphvizOutput': str(graphviz_output) if graphviz_output else None,
            'graphvizFormat': graphviz_format,
            'graphvizShowDefenses': show_defenses,
        },
        'stats': {
            'reachableNodeCount': len(simulator.path_nodes),
            'reachableEdgeCount': len(simulator.path_edges),
            'returnedPathCount': len(selected_paths),
            'rawEnumeratedPathCount': raw_path_count,
        },
    }
    target_block['stats']['exportElapsedSeconds'] = round(time.perf_counter() - export_started_at, 3)

    if output_format == 'dag':
        target_block['dag'] = build_dag_payload(selected_paths, simulator, asset_types)
    else:
        target_block.update(build_grouped_linear_payload(selected_paths, simulator, asset_types))

    if graphviz_output:
        target_block['graphviz'] = render_graphviz_image(
            selected_paths,
            simulator,
            asset_types,
            entry_id,
            target_id,
            graphviz_output,
            graphviz_format=graphviz_format,
            show_defenses=show_defenses,
        )

    return {'AttackPath': target_block}


def main():
    tool_started_at = time.perf_counter()
    parser = argparse.ArgumentParser(
        usage=(
            '%(prog)s SCENARIO_FILE [--show-defenses] [options]\n'
            '       %(prog)s ATTACKGRAPH_FILE MODEL_FILE --entry ENTRY --target TARGET --output OUTPUT [--show-defenses] [options]'
        ),
        description=(
            'Export Entry->Target paths. In scenario mode, entry, target, model_file, '
            'JSON output, and Graphviz PDF output are derived automatically.'
        ),
        epilog=(
            'Scenario mode defaults:\n'
            '  entry: first agents.*.entry_points item from SCENARIO_FILE\n'
            '  target: first agents.*.goals item from SCENARIO_FILE\n'
            '  model: model_file from SCENARIO_FILE\n'
            '  output: <lang>_path_result.json, or <lang>_path_result(2).json if it exists\n'
            '  graphviz: <lang>_graph.pdf, or <lang>_graph(2).pdf if it exists\n'
            '  defenses: hidden by default; use --show-defenses to include them in Graphviz output\n\n'
            'Examples:\n'
            '  %(prog)s AI_Lang-0.0.1_scenario.yml\n'
            '  %(prog)s AI_Lang-0.0.1_scenario.yml --show-defenses\n'
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
    parser.add_argument('--max-paths', type=int)
    parser.add_argument('--graphviz-output', help='Image path to render selected Entry->Target paths with Graphviz')
    parser.add_argument('--no-graphviz-output', action='store_true', help='Disable Graphviz rendering')
    parser.add_argument('--graphviz-format', choices=['png', 'svg', 'pdf', 'jpg'], help='Graphviz render format; defaults to output extension or pdf in scenario mode')
    defense_group = parser.add_mutually_exclusive_group()
    defense_group.add_argument('--show-defenses', dest='show_defenses', action='store_true', help='Show defense nodes in Graphviz output')
    defense_group.add_argument('--show-defneses', dest='show_defenses', action='store_true', help=argparse.SUPPRESS)
    defense_group.add_argument('--no-show-defenses', dest='show_defenses', action='store_false', help=argparse.SUPPRESS)
    parser.set_defaults(show_defenses=False)
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
        graphviz_format = args.graphviz_format or 'pdf'
        graphviz_output = None
        if not args.no_graphviz_output:
            graphviz_output = unique_output_path(args.graphviz_output or f"{config['lang_name']}_graph.pdf")
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
        graphviz_format = args.graphviz_format
        graphviz_output = None
        if not args.no_graphviz_output:
            if args.graphviz_output:
                graphviz_output = unique_output_path(args.graphviz_output)
            else:
                graphviz_output = unique_output_path(output_path.with_name(f'{output_path.stem}_graph.pdf'))
                graphviz_format = graphviz_format or 'pdf'

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
        graphviz_output=graphviz_output,
        graphviz_format=graphviz_format,
        show_defenses=args.show_defenses,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open('x', encoding='utf-8') as output_file:
        output_file.write(json.dumps(payload, indent=2, ensure_ascii=False))
    tool_elapsed = time.perf_counter() - tool_started_at
    print(f'Wrote {output_path} (elapsed: {tool_elapsed:.3f}s)')
    if graphviz_output:
        print(f'Wrote {Path(graphviz_output)}')


if __name__ == '__main__':
    main()
