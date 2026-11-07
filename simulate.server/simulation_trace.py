"""Reconstruct prerequisite-complete witnesses using the running MAL simulator.

These are dependency witnesses over recorded compromises, not shortest graph
paths or a claim about the internal order of effects in one iteration. AutoTARA
currently runs a single attacker with static defenses (no defender actions).
"""


def prerequisite_snapshot(simulator, node):
    parents = sorted(node.parents, key=lambda parent: parent.id)
    return {
        "parentIds": [str(parent.id) for parent in parents],
        "necessaryParentIds": [
            str(parent.id) for parent in parents if simulator.node_is_necessary(parent)
        ],
        "blocked": simulator.node_is_blocked(node),
    }


def build_report_traces(simulator, performed, entry_ids, goals, performed_at):
    # Only recorded compromises can contribute. An eventual compromise cannot
    # satisfy an AND condition in an earlier iteration.
    groups = {}
    for node_id, node in performed.items():
        iteration = performed_at.get(node_id)
        if isinstance(iteration, int) and not isinstance(iteration, bool) and iteration >= 0:
            groups.setdefault(iteration, []).append(node)

    accepted = set()
    order = []
    support = {}
    for iteration in sorted(groups):
        pending = sorted(groups[iteration], key=lambda node: node.id)
        while pending:
            remaining = []
            for node in pending:
                entry = node.id in entry_ids
                if not entry and not simulator.node_is_traversable(accepted, node):
                    remaining.append(node)
                    continue
                # Preserve ALL already justified performed inputs, including
                # every necessary AND parent. OR inputs are observed alternatives.
                support[node.id] = [] if entry else sorted(
                    (parent.id for parent in node.parents if parent in accepted)
                )
                accepted.add(node)
                order.append(node.id)
            if len(remaining) == len(pending):
                break  # A cycle cannot justify itself; never borrow later steps.
            pending = remaining

    traces = []
    for target in goals:
        if target.id not in support:
            traces.append({
                "targetId": str(target.id),
                "status": "unavailable",
                "reason": (
                    "The Target was not reached in this simulation."
                    if target.id not in performed else
                    "Recorded iterations and MAL prerequisites do not establish a complete "
                    "execution for this Target. Rerun the simulation with the updated server."
                ),
            })
            continue
        included = set()
        pending_ids = [target.id]
        while pending_ids:
            node_id = pending_ids.pop()
            if node_id in included:
                continue
            included.add(node_id)
            pending_ids.extend(support[node_id])
        steps = [node_id for node_id in order if node_id in included]
        traces.append({
            "targetId": str(target.id),
            "status": "validated",
            "stepIds": [str(node_id) for node_id in steps],
            "entryIds": [str(node_id) for node_id in steps if node_id in entry_ids],
            "edges": [
                {"source": str(parent_id), "target": str(node_id)}
                for node_id in steps for parent_id in support[node_id]
            ],
        })
    return traces
