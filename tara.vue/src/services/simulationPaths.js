import { findStructuralAttackPaths } from './attackPaths.js'

// Each candidate is a simple main route. AND support and OR alternatives have
// individual scores but are excluded from this explicitly route-scoped mean.
export function summarizeSimulationPathRisks(nodes, paths) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return paths.map((path) => {
    const stepIds = [...new Set(path)].filter(
      (id) => !byId.has(id) || ['and', 'or'].includes(byId.get(id).type),
    )
    const missingStepIds = stepIds.filter(
      (id) => byId.get(id)?.riskAssessed === false || !Number.isFinite(byId.get(id)?.riskScore),
    )
    const scoredSteps = stepIds.length - missingStepIds.length
    const unassessed = new Set(missingStepIds)
    const complete = stepIds.length > 0 && !missingStepIds.length
    return {
      riskScope: 'route',
      stepIds,
      totalSteps: stepIds.length,
      scoredSteps,
      missingStepIds,
      riskCoverage: stepIds.length ? scoredSteps / stepIds.length : 0,
      riskStatus: complete ? 'complete' : scoredSteps ? 'incomplete' : 'unavailable',
      defaultedSteps: missingStepIds.length,
      averageRiskScore: scoredSteps
        ? stepIds.reduce((sum, id) => sum + (unassessed.has(id) ? 0 : byId.get(id).riskScore), 0) /
          scoredSteps
        : null,
    }
  })
}

export function findSimulationPaths(tree, targetId, options = {}) {
  const performed = new Set((tree.performedNodes || tree.nodes).map((node) => node.id))
  const nodes = tree.nodes.filter(
    (node) => performed.has(node.id) && ['and', 'or'].includes(node.type),
  )
  const ids = new Set(nodes.map((node) => node.id))
  const entries = [...new Set(tree.entryIds.filter((id) => ids.has(id)))]
  const target = tree.targets.find((node) => node.id === targetId)
  if (!target?.reached || !ids.has(targetId) || !entries.length)
    return {
      targetId,
      paths: [],
      riskSummaries: [],
      targetResults: [],
      candidateSearchComplete: true,
      noPathReason: !target?.reached ? 'targetNotReached' : 'noEntry',
    }
  const graph = {
    nodes,
    edges: tree.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
    entryIds: entries,
    targetIds: [targetId],
  }
  const result = findStructuralAttackPaths(graph, options)
  return { ...result, targetId, riskSummaries: summarizeSimulationPathRisks(nodes, result.paths) }
}
