#!/usr/bin/env python3
"""MAL reachability and time-to-compromise simulation."""

import heapq
import random
import time
from collections import defaultdict, deque
from itertools import count

import numpy as np

from attack_step import AttackStep
from graph_loader import load_graph, node_id
from utils import print_progress_bar


class AttackGraphSimulator:
    def __init__(self, random_tie_breaking=True):
        self.random_tie_breaking = random_tie_breaking
        self.attack_steps = {}
        self.defense_nodes = {}
        self.exist_nodes = {}
        self.all_nodes = {}
        self.entry_points = []
        self.target = None
        self.path_nodes = set()
        self.path_edges = set()
        self.reachable_nodes = set()
        self.witness = {}
        self.warnings = []
        self.critical_path_graphs = {}
        self.search_stats = {}

    def load_yaml(self, yaml_file):
        records, _, warnings = load_graph(yaml_file)
        self.__init__(self.random_tie_breaking)
        self.warnings = warnings
        for ident, record in records.items():
            step = AttackStep(
                node_id=ident, name=record['full_name'], asset=record['asset'],
                step_type=record['type'], ttc_dist=record.get('ttc'),
                parents=record['parents'], children=record['children'],
                tags=record.get('tags', []), is_necessary=record['is_necessary'],
                existence_status=record.get('existence_status'),
            )
            self.all_nodes[ident] = step
            if step.type in {'and', 'or'}:
                self.attack_steps[ident] = step
            elif step.type == 'defense':
                step.defend_success = record['defense_status']
                self.defense_nodes[ident] = step
            else:
                self.exist_nodes[ident] = step
        for ident, defense in self.defense_nodes.items():
            for child_id in defense.children:
                if child_id in self.attack_steps:
                    child = self.attack_steps[child_id]
                    if child.defended_by is None:
                        child.defended_by = []
                    child.defended_by.append(ident)

    def resolve_endpoint(self, value):
        exact = [ident for ident, step in self.attack_steps.items() if step.name == value]
        if exact:
            return exact[0]
        ident = node_id(value)
        if ident not in self.attack_steps:
            raise ValueError(f'Unknown attack endpoint: {value!r}. Use a full Asset:step name or ID')
        return ident

    def set_entry_points(self, entry_point_names):
        if not entry_point_names:
            raise ValueError('At least one entry point is required')
        self.entry_points = list(dict.fromkeys(self.resolve_endpoint(name) for name in entry_point_names))

    def set_target(self, target_name):
        self.target = self.resolve_endpoint(target_name)

    def condition_satisfied(self, ident):
        step = self.exist_nodes[ident]
        return step.existence_status if step.type == 'exist' else not step.existence_status

    def analyze_reachability(self):
        """Least fixed point, matching the viewer's AND/OR prerequisite rules.

        Entries are already acquired. Defense nodes never seed attacker actions;
        a certain defense blocks even an Entry. Fractional defenses are sampled
        only in critical mode, so static paths mean potentially reachable paths.
        """
        blocked = {
            child for defense in self.defense_nodes.values()
            if defense.defend_success == 1.0 for child in defense.children
        }
        reachable = set(self.entry_points) - blocked
        queue = deque(ident for ident in self.entry_points if ident in reachable)
        witness = {ident: [] for ident in queue}
        attack_parents = {
            ident: [parent for parent in step.parents if parent in self.attack_steps]
            for ident, step in self.attack_steps.items()
        }
        remaining = {ident: len(parents) for ident, parents in attack_parents.items()}
        conditions_met = {
            ident: all(self.condition_satisfied(parent) for parent in step.parents if parent in self.exist_nodes)
            for ident, step in self.attack_steps.items()
        }
        while queue:
            current = queue.popleft()
            for child in self.attack_steps[current].children:
                if child not in self.attack_steps:
                    continue
                remaining[child] -= 1
                if child in reachable or child in blocked:
                    continue
                if self.attack_steps[child].type == 'and':
                    if remaining[child] or not conditions_met[child]:
                        continue
                    parents = attack_parents[child]
                else:
                    parents = [current]
                reachable.add(child)
                witness[child] = parents
                queue.append(child)
        self.reachable_nodes, self.witness = reachable, witness
        return reachable

    def find_entry_to_target_paths(self):
        """Prune to reachable ancestors of Target without enumerating all paths."""
        self.path_nodes, self.path_edges = set(), set()
        if not self.entry_points or self.target is None:
            raise ValueError('Set Entry and Target before finding paths')
        reachable = self.analyze_reachability()
        if self.target not in reachable:
            return False
        pending = [self.target]
        while pending:
            ident = pending.pop()
            if ident in self.path_nodes:
                continue
            self.path_nodes.add(ident)
            pending.extend(
                parent for parent in self.attack_steps[ident].parents
                if parent in reachable and parent != self.target
            )
        self.path_edges = {
            (ident, child) for ident in self.path_nodes if ident != self.target
            for child in self.attack_steps[ident].children if child in self.path_nodes
        }
        return True

    def build_attack_plan(self, primary):
        """Expand AND prerequisites using finite Entry-rooted witness branches.

        The primary chain remains separate: a dependency branch is not another
        independent way to satisfy an AND node. Conditions are retained as nodes.
        """
        nodes = set(primary)
        edges = set(zip(primary, primary[1:]))
        entries = set(self.entry_points)
        primary_index = {ident: index for index, ident in enumerate(primary)}
        pending = [(ident, False) for ident in primary if self.attack_steps[ident].type == 'and']
        expanded = set()
        while pending:
            ident, support = pending.pop()
            if ident in expanded or ident in entries:
                continue
            expanded.add(ident)
            step = self.all_nodes[ident]
            if step.type == 'and':
                for parent in step.parents:
                    if parent in self.defense_nodes:
                        continue
                    nodes.add(parent)
                    edges.add((parent, ident))
                    # Earlier primary steps already have their selected route.
                    # Only missing/later prerequisites need a witness branch.
                    if parent in self.attack_steps and (
                        parent not in primary_index or
                        primary_index[parent] >= primary_index.get(ident, float('inf'))
                    ):
                        pending.append((parent, True))
            if support:
                for parent in self.witness.get(ident, []):
                    nodes.add(parent)
                    edges.add((parent, ident))
                    if parent not in primary_index:
                        pending.append((parent, True))
        return nodes, edges

    def simulate_iteration(self):
        # Sample each defense once, sharing its state across all protected steps.
        blocked = {
            child for defense in self.defense_nodes.values()
            if np.random.random() < defense.defend_success for child in defense.children
        }
        valid_nodes = {}
        for ident in self.path_nodes:
            step = self.attack_steps[ident]
            step.local_ttc = 0.0 if ident in self.entry_points else step.sample_ttc()
            if ident not in blocked and np.isfinite(step.local_ttc):
                valid_nodes[ident] = step
        return self._event_simulation(valid_nodes) if self.target in valid_nodes else (None, np.inf)

    def _event_simulation(self, valid_nodes):
        events, completed, selected_parents = [], {}, {}
        scheduled = set()
        sequence = count()

        def schedule(ident, when, parents):
            tie = random.random() if self.random_tie_breaking else 0.0
            heapq.heappush(events, (when, tie, next(sequence), ident))
            scheduled.add(ident)
            selected_parents[ident] = parents

        for ident in self.entry_points:
            if ident in valid_nodes:
                schedule(ident, 0.0, [])
        while events:
            current_time, _, _, ident = heapq.heappop(events)
            # A scheduled event is not completed until it is popped. Otherwise a
            # slow OR parent can incorrectly win over an earlier unfinished route.
            completed[ident] = current_time
            if ident == self.target:
                return self._build_final_path(selected_parents), current_time
            for child in self.attack_steps[ident].children:
                if (ident, child) not in self.path_edges or child not in valid_nodes or child in scheduled:
                    continue
                step = valid_nodes[child]
                parents = [parent for parent in step.parents if parent in self.attack_steps]
                done = [parent for parent in parents if parent in completed]
                if step.type == 'and':
                    if len(done) != len(parents) or not all(
                        self.condition_satisfied(parent) for parent in step.parents if parent in self.exist_nodes
                    ):
                        continue
                    start, chosen = max(completed[parent] for parent in done), done
                else:
                    start = min(completed[parent] for parent in done)
                    candidates = [parent for parent in done if completed[parent] == start]
                    chosen = [random.choice(candidates) if self.random_tie_breaking else candidates[0]]
                schedule(child, start + step.local_ttc, chosen)
        return None, np.inf

    def _build_final_path(self, selected_parents):
        graph, visited, pending = defaultdict(list), set(), [self.target]
        while pending:
            ident = pending.pop()
            if ident in visited:
                continue
            visited.add(ident)
            for parent in selected_parents.get(ident, []):
                graph[parent].append(ident)
                pending.append(parent)
        return dict(graph)

    def run_simulation_only(self, iterations):
        if iterations <= 0:
            raise ValueError('iterations must be positive')
        shortest_paths, global_ttcs, edge_counts = [], [], defaultdict(int)
        started = time.monotonic()
        for index in range(iterations):
            if index % max(1, min(100, iterations // 100)) == 0 or index == iterations - 1:
                print_progress_bar(index + 1, iterations, prefix='  Progress:',
                                   suffix=f'elapsed: {time.monotonic() - started:.1f}s')
            path_graph, global_ttc = self.simulate_iteration()
            if path_graph is not None and np.isfinite(global_ttc):
                shortest_paths.append(path_graph)
                global_ttcs.append(global_ttc)
                for source, targets in path_graph.items():
                    for target in targets:
                        edge_counts[source, target] += 1
        return {'shortest_paths': shortest_paths, 'global_ttcs': global_ttcs,
                'edge_counts': edge_counts, 'success_rate': len(shortest_paths) / iterations * 100}

    def is_hidden_for_visualization(self, ident):
        if ident in self.entry_points or ident == self.target:
            return False
        return ident in self.all_nodes and 'hidden' in self.all_nodes[ident].tags
