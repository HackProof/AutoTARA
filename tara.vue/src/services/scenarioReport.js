// Report paths come from the simulator's prerequisite replay, never from a
// shortest-path search through the performed graph.
const rerun =
  'This result has no complete MAL prerequisite evidence. Restart the simulation server and rerun the simulation.'

export function getReportPaths(result, targetId) {
  const simulationGraph = result.graph
  const target = simulationGraph.targets.find((node) => node.id === targetId)
  if (!target?.reached) return { paths: [], reason: 'The selected Target was not reached.' }
  if (simulationGraph.reportTraceVersion !== 1) return { paths: [], reason: rerun }
  const trace = simulationGraph.reportTraces?.find((item) => item.targetId === targetId)
  if (trace?.status !== 'validated') return { paths: [], reason: trace?.reason || rerun }
  try {
    const graph = reportTraceGraph(simulationGraph, trace)
    return { paths: [trace.stepIds], graph, reason: '' }
  } catch {
    return { paths: [], reason: rerun }
  }
}

function reportTraceGraph(simulationGraph, trace) {
  const fail = () => {
    throw new Error(rerun)
  }
  const performed = new Map((simulationGraph.performedNodes || []).map((node) => [node.id, node]))
  const path = trace.stepIds
  if (
    !Array.isArray(path) ||
    !path.length ||
    new Set(path).size !== path.length ||
    path.at(-1) !== trace.targetId ||
    !Array.isArray(trace.entryIds) ||
    !trace.entryIds.length ||
    trace.entryIds.some((id) => !path.includes(id) || !simulationGraph.entryIds.includes(id)) ||
    !Array.isArray(trace.edges)
  )
    fail()
  const nodes = path.map((id) => {
    const node = performed.get(id)
    if (
      !node ||
      !['and', 'or'].includes(node.type) ||
      !Number.isInteger(node.performedAt) ||
      node.performedAt < 0
    )
      fail()
    return {
      id,
      label: node.fullName || `${node.asset}:${node.name}`,
      asset: node.asset,
      assetType: node.assetType,
      description: node.description ?? null,
      type: node.type,
      performedAt: node.performedAt,
      prerequisites: node.prerequisites,
    }
  })
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const incoming = new Map(path.map((id) => [id, []]))
  for (const edge of trace.edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) fail()
    incoming.get(edge.target).push(edge.source)
  }
  const reached = new Set(),
    entries = new Set(trace.entryIds)
  let iteration = -1
  for (const node of nodes) {
    const rule = node.prerequisites
    const parents = incoming.get(node.id)
    if (
      !rule ||
      !Array.isArray(rule.parentIds) ||
      !Array.isArray(rule.necessaryParentIds) ||
      typeof rule.blocked !== 'boolean' ||
      node.performedAt < iteration ||
      rule.necessaryParentIds.some((id) => !rule.parentIds.includes(id))
    )
      fail()
    if (entries.has(node.id)) {
      if (parents.length) fail()
    } else if (
      rule.blocked ||
      !parents.length ||
      parents.some((id) => !reached.has(id) || !rule.parentIds.includes(id)) ||
      (node.type === 'and' && rule.necessaryParentIds.some((id) => !parents.includes(id)))
    )
      fail()
    reached.add(node.id)
    iteration = node.performedAt
  }
  const relevant = new Set(),
    pending = [trace.targetId]
  while (pending.length) {
    const id = pending.pop()
    if (relevant.has(id)) continue
    relevant.add(id)
    pending.push(...incoming.get(id))
  }
  if (relevant.size !== path.length) fail()
  return {
    nodes,
    edges: trace.edges.map(({ source, target }) => ({ source, target })),
    entryIds: [...trace.entryIds],
    targetId: trace.targetId,
  }
}

export function buildReportInput(result, targetId, path, ciaAttribute, context = '') {
  const found = getReportPaths(result, targetId)
  if (!found.paths.length || JSON.stringify(path) !== JSON.stringify(found.paths[0]))
    throw new Error(found.reason || 'Select the complete simulation prerequisite trace.')
  return {
    pathKind: 'simulation-prerequisite-trace',
    ciaAttribute,
    context,
    path: [...path],
    graph: found.graph,
    simulation: {
      attackerType: result.attackerType,
      partial: Boolean(result.partial),
      stopReason: result.stopReason || 'unknown',
    },
  }
}
