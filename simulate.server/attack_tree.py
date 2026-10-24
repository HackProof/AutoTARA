"""Extract the Target tree and the complete compromised attack-step subgraph."""


def extract_attack_tree(attack_graph, attacker_state):
    # Use instance nodes, not asset names: several attack steps can belong to one asset.
    performed = {
        node.id: node for node in attacker_state.performed_nodes
        if node.type in ("and", "or") and node.id in attack_graph.nodes
    }
    entry_ids = {node.id for node in attacker_state.entry_points}
    goals = sorted(attacker_state.goals, key=lambda node: node.id)
    reached = [node for node in goals if node.id in performed]
    relevant = set()
    pending = list(reached)
    while pending:
        node = pending.pop()
        if node.id in relevant:
            continue
        relevant.add(node.id)
        # Entry points are granted at reset; their preconditions were not required.
        if node.id not in entry_ids:
            pending.extend(parent for parent in node.parents if parent.id in performed)

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
        }

    nodes = [serialize(performed[node_id]) for node_id in sorted(relevant)]

    def edges_for(node_ids):
        return [
            {"source": str(parent.id), "target": str(node_id)}
            for node_id in sorted(node_ids - entry_ids)
            for parent in sorted(performed[node_id].parents, key=lambda node: node.id)
            if parent.id in node_ids
        ]

    return {
        "nodes": nodes,
        "edges": edges_for(relevant),
        "entryIds": [str(node_id) for node_id in sorted(entry_ids)],
        "targetIds": [str(node.id) for node in goals],
        "targets": [{**serialize(node), "reached": node.id in performed} for node in goals],
        "compromisedAssets": sorted({node["asset"] for node in nodes}),
        "performedNodes": [serialize(performed[node_id]) for node_id in sorted(performed)],
        # Preserve off-Target branches even when no goal was reached. These are
        # graph connections between performed steps, not a causal action trace.
        "performedEdges": edges_for(set(performed)),
    }
