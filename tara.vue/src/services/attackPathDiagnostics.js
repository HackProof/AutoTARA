import {
  analyzeAttackFeasibility,
  explainAttackFeasibility,
  indexAttackGraph,
  isAttackStep,
} from './attackFeasibility.js'
import { AttackPathLimitError, createAttackPathBudget } from './attackPathLimits.js'

// Public input is exactly buildAttackGraph() output: nodes, edges, entryIds,
// targetIds. searchResult is optional metadata, never a substitute for graph.
export function diagnoseAttackPaths(data, options = {}) {
  const index = options.index || indexAttackGraph(data)
  const { nodes, outgoing } = index
  const budget = createAttackPathBudget(options.maxWork, options.timeLimitMs)
  const tick = () => {
    options.tick?.()
    budget.tick()
  }
  const maxHops = options.maxHops ?? 40
  if (!Number.isInteger(maxHops) || maxHops < 0) throw new Error('Invalid diagnostic maxHops.')
  const entries = [...new Set(data.entryIds)].sort()
  const results = new Map(
    (options.searchResult?.targetResults || []).map((item) => [item.target, item]),
  )
  const report = {
    status: 'complete',
    stopReason: null,
    nodeCount: nodes.size,
    edgeCount: data.edges.length,
    attackStepCount: [...nodes.values()].filter(isAttackStep).length,
    entries: entries.map((id) => ({ id, fullName: nodes.get(id).fullName || id })),
    structuralReachableCount: null,
    feasibleAttackStepCount: null,
    reachableAfterFeasibilityFilterCount: null,
    targets: [...new Set(data.targetIds)].map((target) => {
      const searched = results.get(target)
      const structuralPath = searched?.structuralPath ?? null
      const shortestHops = searched?.shortestHops ?? null
      return {
        target,
        fullName: nodes.get(target).fullName || target,
        structuralPath,
        structuralRoute: [],
        shortestHops,
        withinMaxHops:
          structuralPath === false ? false : shortestHops === null ? null : shortestHops <= maxHops,
        targetFeasibility: 'limited',
        blockedPrerequisites: [],
        unknownConditions: [],
        rejectedPathCount: 0,
        stopReason: searched?.stopReason ?? null,
        noPathReason: searched?.noPathReason ?? null,
      }
    }),
  }
  function reachable(allowed = () => true) {
    const queue = [],
      previous = new Map()
    for (const id of entries) {
      tick()
      if (!isAttackStep(nodes.get(id))) throw new Error('An Entry attack step is missing.')
      if (allowed(id)) {
        queue.push(id)
        previous.set(id, null)
      }
    }
    for (let head = 0; head < queue.length; head++) {
      tick()
      for (const child of outgoing.get(queue[head])) {
        tick()
        if (isAttackStep(nodes.get(child)) && allowed(child) && !previous.has(child)) {
          previous.set(child, queue[head])
          queue.push(child)
        }
      }
    }
    return previous
  }
  try {
    const previous = reachable()
    report.structuralReachableCount = previous.size
    for (const target of report.targets) {
      tick()
      target.structuralPath = previous.has(target.target)
      if (target.structuralPath) {
        let cursor = target.target
        while (cursor !== null) {
          tick()
          target.structuralRoute.push(cursor)
          cursor = previous.get(cursor)
        }
        target.structuralRoute.reverse()
        target.shortestHops = target.structuralRoute.length - 1
      }
      target.withinMaxHops = target.structuralPath && target.shortestHops <= maxHops
      target.noPathReason = !target.structuralPath
        ? 'noStructuralPath'
        : !target.withinMaxHops
          ? 'hopLimit'
          : null
    }
    const analysis = analyzeAttackFeasibility(data, { index, tick })
    report.feasibleAttackStepCount = 0
    for (const id of analysis.reached) {
      tick()
      if (isAttackStep(nodes.get(id))) report.feasibleAttackStepCount++
    }
    report.reachableAfterFeasibilityFilterCount = reachable((id) => analysis.reached.has(id)).size
    for (const target of report.targets) {
      tick()
      target.targetFeasibility = analysis.statuses.get(target.target)
      const details = explainAttackFeasibility(analysis, [target.target], tick)
      target.blockedPrerequisites = details.blockedPrerequisites
      target.unknownConditions = details.unknownConditions
    }
  } catch (error) {
    if (!(error instanceof AttackPathLimitError)) throw error
    report.status = 'limited'
    report.stopReason = error.reason
  }
  return report
}

// Shared text for the list, Diagram panel and Attack Tree. Missing diagnostics
// never imply absence of a path; a limited search leaves that question open.
export function describeAttackPathTarget(target, maxHops) {
  if (!target.pathCount) {
    if (target.structuralPath === false) return 'No structural directed Entry → Target path exists.'
    if (target.structuralPath === true && target.shortestHops > maxHops)
      return `A structural path exists (${target.shortestHops} hops), beyond maxHops=${maxHops}.`
    if (target.stopReason) return 'Search limit reached before a candidate could be returned.'
    return 'Structural reachability has not been established; inspect search diagnostics.'
  }
  if (!target.statusCounts?.feasible) {
    if (target.statusCounts?.limited === target.pathCount)
      return 'Structural candidates found; feasibility validation reached its calculation limit.'
    return 'Structural candidates found, but none is proven feasible under the current Entries and conditions.'
  }
  return `${target.statusCounts.feasible} of ${target.pathCount} structural candidates are feasible.`
}
