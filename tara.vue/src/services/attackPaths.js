import { AttackPathLimitError, createAttackPathBudget } from './attackPathLimits.js'
import { diagnoseAttackPaths } from './attackPathDiagnostics.js'
import { indexAttackGraph, isAttackStep, conditionStatus } from './attackFeasibility.js'
import { summarizeAttackPaths } from './attackPathMetrics.js'
export { indexAttackGraph } from './attackFeasibility.js'

// Adapted from attackpath_toyproject/attackgraph_viewer/path-engine.js:
// shortest simple paths (Yen), reverse-distance pruning, and separate AND support.
const edgeKey = (a, b) => JSON.stringify([a, b])
const pathKey = (path) => JSON.stringify(path)
const comparePaths = (a, b) => a.length - b.length || pathKey(a).localeCompare(pathKey(b))

export function findAttackPaths(data, options = {}) {
  return searchAttackPaths(data, options, false)
}

// Observed simulation subgraphs already contain performed steps. Their route
// candidates do not need hypothetical feasibility/Risk reclassification.
export function findStructuralAttackPaths(data, options = {}) {
  return searchAttackPaths(data, options, true)
}

function searchAttackPaths(data, options, structuralOnly) {
  const maxPaths = options.maxPaths ?? 30,
    maxHops = options.maxHops ?? 40
  const maxExpansions = options.maxExpansions ?? 2000000,
    timeLimitMs = options.timeLimitMs ?? 5000
  for (const [name, value, min, max] of [
    ['maxPaths', maxPaths, 1, 100],
    ['maxHops', maxHops, 0, 200],
    ['maxExpansions', maxExpansions, 1, 10000000],
    ['timeLimitMs', timeLimitMs, 1, 30000],
  ])
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`${name} must be an integer from ${min} to ${max}.`)
  const budget = createAttackPathBudget(maxExpansions, timeLimitMs)
  const tick = () => budget.tick()
  const graphIndex = indexAttackGraph(data)
  const { nodes } = graphIndex
  // Yen sees only attack-to-attack edges; all conditions remain in graphIndex.
  const incoming = new Map(),
    outgoing = new Map()
  for (const [id, node] of nodes)
    if (isAttackStep(node)) {
      incoming.set(
        id,
        graphIndex.incoming.get(id).filter((parent) => isAttackStep(nodes.get(parent))),
      )
      outgoing.set(
        id,
        graphIndex.outgoing.get(id).filter((child) => isAttackStep(nodes.get(child))),
      )
    }
  const entries = [...new Set(data.entryIds)],
    targets = [...new Set(data.targetIds)]
  if (!entries.length || !targets.length)
    throw new Error('Select at least one Entry and one Target.')
  for (const id of [...entries, ...targets])
    if (!['and', 'or'].includes(nodes.get(id)?.type))
      throw new Error('An Entry or Target attack step is missing.')
  // One virtual source selects the global shortest routes across Entries.
  // The per-Target cap does not guarantee a quota for each Entry.
  const source = '\u0000entries'
  if (nodes.has(source)) throw new Error('Reserved graph node ID.')
  outgoing.set(source, entries.slice().sort())
  for (const entry of entries) incoming.get(entry).push(source)
  incoming.set(source, [])
  const targetResults = [],
    paths = []
  for (const target of targets) {
    const found = [],
      distances = new Map([[target, 0]])
    let stopReason = budget.stopReason,
      reverseComplete = false
    function shortest(
      start,
      blockedNodes = new Set(),
      blockedEdges = new Set(),
      limit = maxHops + 1,
    ) {
      if (blockedNodes.has(start) || blockedNodes.has(target)) return null
      if (start === target) return [start]
      if (!distances.has(start) || distances.get(start) > limit) return null
      const queue = [start],
        previous = new Map([[start, null]]),
        depths = new Map([[start, 0]])
      for (let head = 0; head < queue.length; head++) {
        const current = queue[head]
        tick()
        if (depths.get(current) >= limit) continue
        for (const next of outgoing.get(current)) {
          tick()
          if (
            blockedNodes.has(next) ||
            blockedEdges.has(edgeKey(current, next)) ||
            previous.has(next)
          )
            continue
          const depth = depths.get(current) + 1
          if (!distances.has(next) || depth + distances.get(next) > limit) continue
          previous.set(next, current)
          depths.set(next, depth)
          if (next === target) {
            const path = [target]
            let cursor = current
            while (cursor !== null) {
              path.push(cursor)
              cursor = previous.get(cursor)
            }
            return path.reverse()
          }
          queue.push(next)
        }
      }
      return null
    }
    try {
      tick()
      const queue = [target]
      for (let head = 0; head < queue.length; head++) {
        tick()
        for (const parent of incoming.get(queue[head])) {
          tick()
          if (!distances.has(parent)) {
            distances.set(parent, distances.get(queue[head]) + 1)
            queue.push(parent)
          }
        }
      }
      reverseComplete = true
      const first = shortest(source)
      if (first) {
        found.push(first)
      }
      const candidates = [],
        known = new Set(first ? [pathKey(first)] : [])
      while (found.length && found.length < maxPaths) {
        const previous = found.at(-1)
        for (let index = 0; index < previous.length - 1; index++) {
          tick()
          const root = previous.slice(0, index + 1),
            blockedEdges = new Set()
          for (const path of found) {
            tick()
            if (path.length > index + 1 && root.every((id, i) => path[i] === id))
              blockedEdges.add(edgeKey(path[index], path[index + 1]))
          }
          const spur = shortest(
            root.at(-1),
            new Set(root.slice(0, -1)),
            blockedEdges,
            maxHops + 1 - index,
          )
          if (spur) {
            const candidate = root.slice(0, -1).concat(spur),
              key = pathKey(candidate)
            if (!known.has(key)) {
              known.add(key)
              candidates.push(candidate)
            }
          }
        }
        if (!candidates.length) break
        candidates.sort(comparePaths)
        const candidate = candidates.shift()
        found.push(candidate)
      }
      // This cap is conservative: more paths may exist, so never claim exhaustive results.
      if (found.length === maxPaths) stopReason = 'pathLimit'
    } catch (error) {
      if (!(error instanceof AttackPathLimitError)) throw error
      stopReason = error.reason
    }
    const structuralPath = distances.has(source) ? true : reverseComplete ? false : null
    const shortestHops = distances.has(source) ? distances.get(source) - 1 : null
    paths.push(...found.map((path) => path.slice(1)))
    targetResults.push({
      target,
      pathCount: found.length,
      stopReason,
      shortestHops,
      structuralPath,
      noPathReason: found.length
        ? null
        : structuralPath === false
          ? 'noStructuralPath'
          : shortestHops > maxHops
            ? 'hopLimit'
            : stopReason,
      rejectedPathCount: 0,
      candidateSearchComplete: stopReason === null,
    })
  }
  // Discovery has finished before any logical validation. Even when validation
  // exhausts the remaining budget, every discovered path gets a limited metric.
  paths.sort(comparePaths)
  const searchExpansions = budget.work
  const structural = {
    paths,
    targetResults,
    maxPaths,
    maxHops,
    searchExpansions,
    expansions: budget.work,
    elapsedMs: budget.elapsedMs,
    candidateSearchComplete: targetResults.every((item) => item.candidateSearchComplete),
    candidateStrategy: 'hop-shortest-structural',
    hopRankingScope: 'per-target-across-entries',
  }
  if (structuralOnly) return structural
  const diagnostics = diagnoseAttackPaths(data, {
    index: graphIndex,
    tick,
    maxWork: maxExpansions,
    timeLimitMs,
    maxHops,
    searchResult: { targetResults },
  })
  const metrics = summarizeAttackPaths(data, paths, {
    index: graphIndex,
    tick,
    maxWork: maxExpansions,
    timeLimitMs,
  })
  for (const target of targetResults) {
    const diagnostic = diagnostics.targets.find((item) => item.target === target.target)
    target.feasibility = diagnostic.targetFeasibility
    target.targetFeasibility = diagnostic.targetFeasibility
    target.blockedPrerequisites = diagnostic.blockedPrerequisites
    target.unknownConditions = diagnostic.unknownConditions
    target.validationStopReason = budget.stopReason
    target.statusCounts = { feasible: 0, unresolved: 0, infeasible: 0, limited: 0 }
    for (let i = 0; i < paths.length; i++)
      if (paths[i].at(-1) === target.target) target.statusCounts[metrics[i].status]++
  }
  return {
    paths,
    metrics,
    targetResults,
    diagnostics,
    maxPaths,
    maxHops,
    expansions: budget.work,
    searchExpansions,
    elapsedMs: budget.elapsedMs,
    validationStopReason: budget.stopReason,
    candidateSearchComplete: targetResults.every((item) => item.candidateSearchComplete),
    candidateStrategy: 'hop-shortest-structural',
    hopRankingScope: 'per-target-across-entries',
    riskRankingScope: 'returned-candidates',
    globalRiskTopK: false,
    supportPlanPolicy: 'earliest-reachable-witness',
    unknownConditionIds: [
      ...new Set(diagnostics.targets.flatMap((target) => target.unknownConditions)),
    ],
  }
}

// Explain the selected chain without asserting that its additional conditions
// have already been met. OR branches are alternatives, AND branches all apply.
// Occurrences are separate from graph IDs so shared dependencies stay accurate.
export function buildPathPrerequisites(data, path, options = {}) {
  const { nodes, incoming } = indexAttackGraph(data)
  const entries = new Set(data.entryIds),
    indexes = new Map(path.map((id, i) => [id, i]))
  const maxNodes = options.maxNodes ?? 500,
    maxDepth = options.maxDepth ?? 24
  if (!Number.isInteger(maxNodes) || maxNodes < 1 || !Number.isInteger(maxDepth) || maxDepth < 0)
    throw new Error('Invalid prerequisite display limits.')
  let count = 0,
    truncated = false
  const pending = []
  function occurrence(id, requiredBy, ancestors, depth) {
    const node = nodes.get(id)
    const item = {
      node,
      children: [],
      terminal: null,
      omitted: 0,
      feasibility: options.metric?.nodeStatuses?.[id] ?? (options.metric ? 'limited' : null),
    }
    count++
    if (indexes.has(id) && indexes.get(id) < requiredBy) item.terminal = 'earlier'
    else if (entries.has(id)) item.terminal = 'entry'
    else if (ancestors.has(id)) item.terminal = 'cycle'
    else if (!isAttackStep(node)) {
      item.terminal = 'condition'
      item.conditionStatus = conditionStatus(node)
    } else if (!incoming.get(id).length) item.terminal = 'external'
    else pending.push({ item, requiredBy, ancestors: new Set([...ancestors, id]), depth })
    return item
  }
  const requirements = []
  for (let index = 1; index < path.length; index++) {
    const node = nodes.get(path[index])
    if (entries.has(node.id)) continue
    if (node.type !== 'and' && !incoming.get(node.id).some((id) => !isAttackStep(nodes.get(id))))
      continue
    const item = {
      node,
      children: [],
      terminal: null,
      omitted: 0,
      feasibility: options.metric?.nodeStatuses?.[node.id] ?? (options.metric ? 'limited' : null),
    }
    requirements.push(item)
    pending.push({ item, requiredBy: index, ancestors: new Set([node.id]), depth: 0 })
  }
  // Breadth first expansion keeps every main AND and its immediate inputs visible
  // before spending the display budget on deep or cyclic support branches.
  for (let head = 0; head < pending.length; head++) {
    const { item, requiredBy, ancestors, depth } = pending[head]
    for (const id of incoming.get(item.node.id)) {
      if (count >= maxNodes || depth >= maxDepth) {
        item.omitted++
        truncated = true
      } else item.children.push(occurrence(id, requiredBy, ancestors, depth + 1))
    }
  }
  return { requirements, truncated }
}
