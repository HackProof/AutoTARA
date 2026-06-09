#!/usr/bin/env python3
"""
Core simulation logic for Meta Attack Language Attack Graph Simulator
"""

import yaml
import numpy as np
import random
import heapq
import time
from collections import defaultdict
from typing import Dict, List, Set, Tuple

from attack_step import AttackStep
from utils import print_progress_bar


class AttackGraphSimulator:
    """Core attack graph simulator"""
    
    def __init__(self, random_tie_breaking=True):
        # Core data structures
        self.attack_steps: Dict[int, AttackStep] = {}
        self.entry_points: List[int] = []
        self.target: int = None
        self.path_nodes: Set[int] = set()
        self.path_edges: Set[Tuple[int, int]] = set()
        
        # Additional data structures
        self.defense_nodes: Dict[int, AttackStep] = {}
        self.exist_nodes: Dict[int, AttackStep] = {}
        
        # Random tie-breaking option
        self.random_tie_breaking = random_tie_breaking
        
    def load_yaml(self, yaml_file: str):
        """Load attack graph from YAML file"""
        with open(yaml_file, 'r', encoding='utf-8') as file:
            data = yaml.safe_load(file)
        
        attack_steps_data = data.get('attack_steps', {})
        self.attack_steps = {}
        
        # Create all attack step nodes
        for step_name, step_data in attack_steps_data.items():
            node_id = step_data.get('id')
            if node_id is None:
                continue
            
            step_type = step_data.get('type')
            
            # Parse relationships efficiently
            parents = {}
            children = {}
            
            for k, v in step_data.get('parents', {}).items():
                try:
                    parents[int(k)] = v
                except (ValueError, TypeError):
                    continue
                    
            for k, v in step_data.get('children', {}).items():
                try:
                    children[int(k)] = v
                except (ValueError, TypeError):
                    continue
            
            # Parse is_necessary field
            is_necessary = step_data.get('is_necessary', 'True') == 'True'
            
            attack_step = AttackStep(
                node_id=node_id,
                name=step_name,
                asset=step_data.get('asset', ''),
                step_type=step_type,
                ttc_dist=step_data.get('ttc'),
                parents=parents,
                children=children,
                tags=step_data.get('tags', []),
                is_necessary=is_necessary
            )
            
            # Categorize nodes
            if step_type in {'and', 'or'}:
                self.attack_steps[node_id] = attack_step
            elif step_type == 'defense':
                attack_step.defend_success = float(step_data.get('defense_status', '0.0'))
                self.defense_nodes[node_id] = attack_step
            elif step_type in {'exist', 'notExist', 'notExists'}:
                attack_step.defend_success = step_data.get('existence_status', 'False') == 'True'
                self.exist_nodes[node_id] = attack_step
        
        # Process defense and exist information
        self._process_defense_and_exist_nodes()

    def _process_defense_and_exist_nodes(self):
        """Process defense and exist nodes to set attack step properties"""
        # Process defense nodes
        for def_id, def_step in self.defense_nodes.items():
            defense_prob = def_step.defend_success
            for child_id in def_step.children:
                if child_id in self.attack_steps:
                    step = self.attack_steps[child_id]
                    if step.defended_by is None:
                        step.defended_by = []
                        step.defend_success = 0.0
                    step.defended_by.append(def_id)
                    step.defend_success = min(step.defend_success + defense_prob, 1.0)
        
        # Process exist nodes - remove attack steps if existence condition is False
        for exist_id, exist_step in self.exist_nodes.items():
            if not exist_step.defend_success:  # existence_status is False
                children_to_remove = []
                for child_id in exist_step.children:
                    if child_id in self.attack_steps:
                        children_to_remove.append(child_id)
                
                for child_id in children_to_remove:
                    del self.attack_steps[child_id]

    def set_entry_points(self, entry_point_names: List[str]):
        """Set entry points"""
        name_to_id = {step.name: step_id for step_id, step in self.attack_steps.items()}
        self.entry_points = [name_to_id[name] for name in entry_point_names if name in name_to_id]

    def set_target(self, target_name: str):
        """Set target node"""
        for step_id, step in self.attack_steps.items():
            if step.name == target_name:
                self.target = step_id
                return
        raise ValueError(f"Target '{target_name}' not found")

    def find_entry_to_target_paths(self):
        """Find all paths from entry points to target"""
        print("Building all paths")
        
        all_path_nodes = set()
        total_entries = len(self.entry_points)
        
        for idx, entry_id in enumerate(self.entry_points):
            print_progress_bar(idx, total_entries, prefix='  Progress:', 
                             suffix=f'Processing entry {entry_id}')
            entry_nodes = self._dfs_forward_to_target(entry_id, set(), 0)
            all_path_nodes.update(entry_nodes)
        
        # Complete the progress bar
        print_progress_bar(total_entries, total_entries, prefix='  Progress:', 
                         suffix='Complete')
        print()  # New line after progress bar
        
        if self.target not in all_path_nodes:
            print("  Target not reachable from entry points!")
            return False
        
        # Build edges only between path nodes
        self.path_nodes = all_path_nodes
        self._build_path_edges()
        
        return True

    def _dfs_forward_to_target(self, current_id: int, visited: Set[int], depth: int) -> Set[int]:
        """Forward-only DFS to find nodes on paths to target"""
        if current_id in visited or current_id not in self.attack_steps:
            return set()
        
        # TARGET REACHED - STOP HERE, DO NOT EXPLORE FURTHER
        if current_id == self.target:
            return {current_id}  # Return ONLY target, no further exploration
        
        visited.add(current_id)
        result_nodes = set()
        step = self.attack_steps[current_id]
        
        # Get valid children
        valid_children = [cid for cid in step.children if cid in self.attack_steps]
        
        # DFS to children
        for child_id in valid_children:
            child_result = self._dfs_forward_to_target(child_id, visited.copy(), depth + 1)
            if child_result:  # Child can reach target
                result_nodes.add(current_id)  # Include current node
                result_nodes.update(child_result)  # Include child path
        
        return result_nodes

    def _build_path_edges(self):
        """Build edges between path nodes - NO EDGES FROM TARGET"""
        self.path_edges = set()
        for node_id in self.path_nodes:
            # CRITICAL: Skip target completely - target has NO outgoing edges
            if node_id == self.target:
                continue
                
            if node_id in self.attack_steps:
                step = self.attack_steps[node_id]
                for child_id in step.children:
                    if child_id in self.path_nodes and child_id not in self.entry_points:
                        self.path_edges.add((node_id, child_id))

    def simulate_iteration(self):
        """Single simulation iteration"""
        # Sample TTC for path nodes
        valid_nodes = {}
        for node_id in self.path_nodes:
            step = self.attack_steps[node_id]
            
            if node_id in self.entry_points:
                step.local_ttc = 0.0
            else:
                step.local_ttc = step.sample_ttc()
                # Apply defense
                if (step.defended_by is not None and step.defend_success is not None and
                    np.random.random() < step.defend_success):
                    step.local_ttc = np.inf
            
            if step.local_ttc != np.inf:
                valid_nodes[node_id] = step
        
        return self._event_simulation(valid_nodes) if self.target in valid_nodes else (None, np.inf)

    def _event_simulation(self, valid_nodes: Dict[int, AttackStep]):
        """Event-driven simulation with optional random tie-breaking"""
        events = []
        completion_times = {}
        selected_parents = {}
        
        # Initialize entry points
        for entry_id in self.entry_points:
            if entry_id in valid_nodes:
                if self.random_tie_breaking:
                    # Add random component for tie-breaking
                    random_component = random.random()
                    heapq.heappush(events, (0.0, random_component, entry_id))
                else:
                    # Original deterministic behavior
                    heapq.heappush(events, (0.0, entry_id))
                completion_times[entry_id] = 0.0
                selected_parents[entry_id] = []
        
        # Pre-compute attack parents with is_necessary information
        attack_parents = {}
        necessary_parents = {}
        for nid in self.path_nodes:
            if nid in self.attack_steps:
                all_parents = [pid for pid in self.attack_steps[nid].parents 
                              if pid in self.attack_steps]
                necessary_only = [pid for pid in all_parents 
                                 if self.attack_steps[pid].is_necessary]
                attack_parents[nid] = all_parents
                necessary_parents[nid] = necessary_only
        
        # Process events
        while events:
            if self.random_tie_breaking:
                current_time, _, node_id = heapq.heappop(events)
            else:
                current_time, node_id = heapq.heappop(events)
            
            if node_id == self.target:
                return self._build_final_path(selected_parents), current_time
            
            # Process children
            step = self.attack_steps[node_id]
            for child_id in step.children:
                if ((node_id, child_id) not in self.path_edges or 
                    child_id not in valid_nodes or child_id in completion_times):
                    continue
                
                child_step = valid_nodes[child_id]
                can_start, start_time, parents = self._check_start_condition(
                    child_id, completion_times, attack_parents[child_id], 
                    necessary_parents[child_id], child_step.type)
                
                if can_start:
                    completion_time = start_time + child_step.local_ttc
                    if self.random_tie_breaking:
                        # Add random component for tie-breaking
                        random_component = random.random()
                        heapq.heappush(events, (completion_time, random_component, child_id))
                    else:
                        # Original deterministic behavior
                        heapq.heappush(events, (completion_time, child_id))
                    completion_times[child_id] = completion_time
                    selected_parents[child_id] = parents
        
        return None, np.inf

    def _check_start_condition(self, node_id: int, completion_times: Dict[int, float], 
                              all_parents: List[int], necessary_parents: List[int], node_type: str):
        """Check if node can start based on AND/OR logic with is_necessary consideration"""
        completed_parents = [(completion_times[pid], pid) for pid in all_parents 
                           if pid in completion_times]
        completed_necessary = [(completion_times[pid], pid) for pid in necessary_parents 
                             if pid in completion_times]
        
        if not completed_parents:
            return False, 0, []
        
        if node_type == 'and':
            # For AND nodes: all necessary parents must be completed
            if len(completed_necessary) < len(necessary_parents):
                return False, 0, []
            
            # Start time is the maximum completion time among all completed parents
            start_time = max(time for time, _ in completed_parents)
            
            # Return all completed parents (both necessary and non-necessary)
            return True, start_time, [pid for _, pid in completed_parents]
        else:  # OR
            if self.random_tie_breaking:
                # OR 노드에서도 동일한 시간의 부모들 중 랜덤 선택
                earliest_time = min(time for time, _ in completed_parents)
                earliest_parents = [pid for time, pid in completed_parents if time == earliest_time]
                if len(earliest_parents) > 1:
                    # 동일한 시간의 부모가 여러 개면 랜덤 선택
                    earliest_parent = random.choice(earliest_parents)
                else:
                    earliest_parent = earliest_parents[0]
                return True, earliest_time, [earliest_parent]
            else:
                # Original deterministic behavior
                earliest_time, earliest_parent = min(completed_parents)
                return True, earliest_time, [earliest_parent]

    def _build_final_path(self, selected_parents: Dict[int, List[int]]) -> Dict[int, List[int]]:
        """Build final path graph"""
        final_graph = defaultdict(list)
        stack = [self.target]
        visited = set()
        
        while stack:
            node_id = stack.pop()
            if node_id in visited:
                continue
            visited.add(node_id)
            
            if node_id in selected_parents:
                for parent_id in selected_parents[node_id]:
                    final_graph[parent_id].append(node_id)
                    stack.append(parent_id)
        
        return dict(final_graph)

    def run_simulation_only(self, iterations: int):
        """Run only the simulation part (path finding already done)"""
        print("Starting simulation")
        
        # Run simulation
        shortest_paths = []
        global_ttcs = []
        edge_counts = defaultdict(int)
        
        start_time = time.time()
        for i in range(iterations):
            # Update progress bar every 1% or every 100 iterations, whichever is more frequent
            update_frequency = max(1, min(100, iterations // 100))
            if i % update_frequency == 0 or i == iterations - 1:
                elapsed = time.time() - start_time
                if elapsed > 0:
                    rate = (i + 1) / elapsed
                    eta = (iterations - i - 1) / rate if rate > 0 else 0
                    suffix = f'({i+1}/{iterations}) ETA: {eta:.0f}s'
                else:
                    suffix = f'({i+1}/{iterations})'
                print_progress_bar(i + 1, iterations, prefix='  Progress:', suffix=suffix)
                
            path_graph, global_ttc = self.simulate_iteration()
            
            if path_graph is not None and global_ttc != np.inf:
                shortest_paths.append(path_graph)
                global_ttcs.append(global_ttc)
                
                for src, targets in path_graph.items():
                    for tgt in targets:
                        edge_counts[(src, tgt)] += 1
        
        print()  # New line after progress bar
        
        success_rate = len(shortest_paths) / iterations * 100
        print(f"  Success: {len(shortest_paths)}/{iterations} ({success_rate:.1f}%)")
        
        return {
            'shortest_paths': shortest_paths,
            'global_ttcs': global_ttcs,
            'edge_counts': edge_counts,
            'success_rate': success_rate
        }
        """Run the simulation and return results"""
        if not self.find_entry_to_target_paths():
            raise RuntimeError("No valid paths found from entry points to target")
        
        print("Starting simulation")
        
        # Run simulation
        shortest_paths = []
        global_ttcs = []
        edge_counts = defaultdict(int)
        
        start_time = time.time()
        for i in range(iterations):
            # Update progress bar every 1% or every 100 iterations, whichever is more frequent
            update_frequency = max(1, min(100, iterations // 100))
            if i % update_frequency == 0 or i == iterations - 1:
                elapsed = time.time() - start_time
                if elapsed > 0:
                    rate = (i + 1) / elapsed
                    eta = (iterations - i - 1) / rate if rate > 0 else 0
                    suffix = f'({i+1}/{iterations}) ETA: {eta:.0f}s'
                else:
                    suffix = f'({i+1}/{iterations})'
                print_progress_bar(i + 1, iterations, prefix='  Progress:', suffix=suffix)
                
            path_graph, global_ttc = self.simulate_iteration()
            
            if path_graph is not None and global_ttc != np.inf:
                shortest_paths.append(path_graph)
                global_ttcs.append(global_ttc)
                
                for src, targets in path_graph.items():
                    for tgt in targets:
                        edge_counts[(src, tgt)] += 1
        
        print()  # New line after progress bar
        
        success_rate = len(shortest_paths) / iterations * 100
        print(f"  Success: {len(shortest_paths)}/{iterations} ({success_rate:.1f}%)")
        
        return {
            'shortest_paths': shortest_paths,
            'global_ttcs': global_ttcs,
            'edge_counts': edge_counts,
            'success_rate': success_rate
        }

    def is_hidden_for_visualization(self, node_id: int) -> bool:
        """Check if a node should be hidden in visualization"""
        # Entry points and target are never hidden
        if node_id in self.entry_points or node_id == self.target:
            return False
        # Other nodes are hidden if they have the 'hidden' tag
        if node_id in self.attack_steps:
            return 'hidden' in self.attack_steps[node_id].tags
        return False