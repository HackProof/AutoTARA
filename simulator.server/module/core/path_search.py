"""Bounded, shortest-first simple paths (Yen with unweighted BFS)."""

from collections import deque
import heapq
from itertools import count
import time


def find_paths(adjacency, source, target, *, max_paths=30, max_hops=20,
               shortest_only=False, max_expansions=2_000_000, time_limit=3.0):
    for name, value, minimum in (('max_paths', max_paths, 1), ('max_hops', max_hops, 0),
                                  ('max_expansions', max_expansions, 1)):
        if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
            raise ValueError(f'{name} must be an integer >= {minimum}')
    if not 0 < time_limit < float('inf'):
        raise ValueError('time_limit must be positive and finite')
    started, expansions, reason = time.monotonic(), 0, None
    paths, candidates, known = [], [], set()
    sequence = count()

    class SearchLimit(Exception):
        pass

    def tick():
        nonlocal expansions, reason
        expansions += 1
        if expansions > max_expansions:
            reason = 'workLimit'
            raise SearchLimit
        if time.monotonic() - started >= time_limit:
            reason = 'timeLimit'
            raise SearchLimit

    def shortest(start, excluded_nodes=frozenset(), excluded_edges=frozenset(), hops=max_hops):
        if start in excluded_nodes or target in excluded_nodes:
            return None
        queue = deque([start])
        previous, depth = {start: None}, {start: 0}
        while queue:
            tick()
            current = queue.popleft()
            if current == target:
                result = []
                while current is not None:
                    result.append(current)
                    current = previous[current]
                return result[::-1]
            if depth[current] >= hops:
                continue
            for child in adjacency.get(current, []):
                tick()
                if child in previous or child in excluded_nodes or (current, child) in excluded_edges:
                    continue
                previous[child], depth[child] = current, depth[current] + 1
                queue.append(child)
        return None

    try:
        first = shortest(source)
        if first:
            paths.append(first)
            known.add(tuple(first))
        while paths and len(paths) < max_paths:
            previous = paths[-1]
            for index in range(len(previous) - 1):
                tick()
                root = previous[:index + 1]
                excluded_edges = set()
                for path in paths:
                    tick()
                    if len(path) > index + 1 and path[:index + 1] == root:
                        excluded_edges.add((path[index], path[index + 1]))
                hop_limit = (len(first) - 1 if shortest_only else max_hops) - index
                spur = shortest(root[-1], set(root[:-1]), excluded_edges, hop_limit)
                if spur:
                    candidate = root[:-1] + spur
                    key = tuple(candidate)
                    if key not in known:
                        known.add(key)
                        heapq.heappush(candidates, (len(candidate), next(sequence), candidate))
            if not candidates:
                break
            paths.append(heapq.heappop(candidates)[2])
        if paths and len(paths) == max_paths:
            reason = 'pathLimit'
    except SearchLimit:
        pass
    return paths, {
        'truncated': reason is not None,
        'stopReason': reason,
        'maxPaths': max_paths,
        'maxHops': max_hops,
        'expansions': expansions,
        'scope': 'pathsWithinHopLimit',
    }
