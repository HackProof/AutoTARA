"""Serialize performed attack steps and their original graph connections."""

from simulation_trace import build_report_traces, prerequisite_snapshot


def collect_simulation_graph(attack_graph, attacker_state, simulator=None):
    # Use instance nodes, not asset names: several attack steps can belong to one asset.
    performed = {
        node.id: node for node in attacker_state.performed_nodes
        if node.type in ("and", "or") and node.id in attack_graph.nodes
    }
    entry_ids = {node.id for node in attacker_state.entry_points}
    goals = sorted(attacker_state.goals, key=lambda node: node.id)
    performed_at = {
        node.id: iteration
        for iteration, nodes in sorted(attacker_state.performed_nodes_order.items(), reverse=True)
        for node in nodes
    }

    def serialize(node):
        asset = node.model_asset
        return {
            "id": str(node.id),
            "fullName": node.full_name,
            "name": node.name,
            "type": node.type,
            "asset": asset.name if asset else "",
            "assetId": str(asset.id) if asset else None,
            "assetType": asset.type if asset else "",
            "performedAt": performed_at.get(node.id),
            **({"prerequisites": prerequisite_snapshot(simulator, node)} if simulator else {}),
        }

    return {
        "entryIds": [str(node_id) for node_id in sorted(entry_ids)],
        "targetIds": [str(node.id) for node in goals],
        "targets": [{**serialize(node), "reached": node.id in performed} for node in goals],
        "performedNodes": [serialize(performed[node_id]) for node_id in sorted(performed)],
        # Preserve shared nodes, cycles and off-Target steps without unfolding
        # them into a hierarchy. Entries are granted without incoming attacks.
        "performedEdges": [
            {"source": str(parent.id), "target": str(node_id)}
            for node_id in sorted(performed.keys() - entry_ids)
            for parent in sorted(performed[node_id].parents, key=lambda node: node.id)
            if parent.id in performed
        ],
        **({
            "reportTraceVersion": 1,
            "reportTraces": build_report_traces(
                simulator, performed, entry_ids, goals, performed_at,
            ),
        } if simulator else {}),
    }
