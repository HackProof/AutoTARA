import { AttackPathLimitError, createAttackPathBudget } from './attackPathLimits.js'
import {
  analyzeAttackFeasibility,
  explainAttackFeasibility,
  indexAttackGraph,
  isAttackStep,
} from './attackFeasibility.js'

// One deterministic, earliest-reachable support witness, not a minimum union or
// maximum-Risk support plan. Forced OR inputs preserve the selected main route.
export function summarizeAttackPaths(data, paths, options = {}) {
  const index = options.index || indexAttackGraph(data)
  const { nodes, incoming } = index
  const entries = new Set(data.entryIds)
  const budget = createAttackPathBudget(options.maxWork, options.timeLimitMs)
  function tick() {
    options.tick?.()
    budget.tick()
  }
  return paths.map((path) => {
    const routeHops = Math.max(0, path.length - 1)
    const empty = {
      routeHops,
      hops: routeHops,
      requiredStepCount: null,
      additionalStepCount: null,
      criticalPathHops: null,
      stepIds: [],
      executionOrder: [],
      prerequisites: {},
      conditionIds: [],
      scoredSteps: 0,
      riskCoverage: null,
      averageRisk: null,
      riskStatus: 'unavailable',
      supportPlanPolicy: 'earliest-reachable-witness',
      supportPlanOptimal: false,
      status: 'empty',
      limitReason: null,
      nodeStatuses: {},
      blockedPrerequisites: [],
      unknownConditions: [],
      prerequisiteMode: 'unavailable',
    }
    if (!path.length) return empty
    if (
      !entries.has(path[0]) ||
      new Set(path).size !== path.length ||
      path.some((id) => !isAttackStep(nodes.get(id))) ||
      path.slice(1).some((id, i) => !incoming.get(id).includes(path[i]))
    )
      return { ...empty, status: 'infeasible' }
    try {
      const forcedParents = new Map(path.slice(1).map((id, i) => [id, path[i]]))
      const analysis = analyzeAttackFeasibility(data, { index, forcedParents, tick })
      const details = explainAttackFeasibility(analysis, path, tick)
      const nodeStatuses = {}
      for (const [id, status] of analysis.statuses) {
        tick()
        Object.defineProperty(nodeStatuses, id, { value: status, enumerable: true })
      }
      const explained = { ...empty, ...details, nodeStatuses, prerequisiteMode: 'alternatives' }
      const unavailable = path.filter((id) => !analysis.reached.has(id))
      if (unavailable.length)
        return {
          ...explained,
          status: unavailable.some((id) => analysis.statuses.get(id) === 'infeasible')
            ? 'infeasible'
            : 'unresolved',
        }
      const included = new Set(),
        pending = [...path]
      for (let head = 0; head < pending.length; head++) {
        tick()
        const id = pending[head]
        if (included.has(id)) continue
        included.add(id)
        for (const parent of analysis.evidence.get(id)) {
          tick()
          pending.push(parent)
        }
      }
      const executionOrder = analysis.order.filter(
        (id) => included.has(id) && isAttackStep(nodes.get(id)),
      )
      const stepIds = [...executionOrder].sort(),
        main = new Set(path),
        depths = new Map()
      const prerequisites = new Map()
      let criticalPathHops = 0
      for (const id of executionOrder) {
        tick()
        const parents = analysis.evidence.get(id)
        prerequisites.set(id, [...parents])
        let depth = 0
        if (!entries.has(id)) {
          for (const parent of parents) {
            tick()
            depth = Math.max(depth, depths.get(parent) || 0)
          }
          depth++
        }
        depths.set(id, depth)
        criticalPathHops = Math.max(criticalPathHops, depth)
      }
      const scores = stepIds.map((id) => nodes.get(id).riskScore).filter(Number.isFinite)
      const completeRisk = scores.length === stepIds.length
      return {
        ...explained,
        status: 'feasible',
        prerequisiteMode: 'witness',
        stepIds,
        executionOrder,
        prerequisites: Object.fromEntries(prerequisites),
        conditionIds: [...included].filter((id) => !isAttackStep(nodes.get(id))).sort(),
        requiredStepCount: stepIds.length,
        additionalStepCount: stepIds.filter((id) => !main.has(id)).length,
        criticalPathHops,
        scoredSteps: scores.length,
        riskCoverage: scores.length / stepIds.length,
        riskStatus: completeRisk ? 'complete' : 'incomplete',
        averageRisk: completeRisk
          ? scores.reduce((sum, value) => sum + value, 0) / scores.length
          : null,
      }
    } catch (error) {
      if (!(error instanceof AttackPathLimitError)) throw error
      return { ...empty, status: 'limited', limitReason: error.reason }
    }
  })
}

// Rankings apply only to returned candidates and their selected support witness.
// Incomplete assessments cannot outrank complete assessments in Risk ordering.
export function sortAttackPathIndexes(result, sortBy = 'hops') {
  return result.paths
    .map((_, index) => index)
    .sort((a, b) => {
      const left = result.metrics[a],
        right = result.metrics[b]
      if (sortBy === 'risk') {
        const risk = (metric) =>
          metric?.status === 'feasible' &&
          metric.riskStatus === 'complete' &&
          Number.isFinite(metric.averageRisk)
            ? metric.averageRisk
            : -Infinity
        const difference = risk(right) - risk(left)
        if (difference) return difference
      }
      return (left?.routeHops ?? Infinity) - (right?.routeHops ?? Infinity) || a - b
    })
}
