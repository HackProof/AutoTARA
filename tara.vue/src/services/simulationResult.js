import { databaseCtsaScore } from './ttpScoring.js'
import { calculateAttackFeasibilityRating } from './attackFeasibilityRating.js'

// The simulator supplies performed connections, not a unique causal trace.
// Report each Target's performed predecessor subgraph explicitly; do not mix
// different Targets or let a display filter change the rating. This preserves
// AND support and all performed OR alternatives, with the same time filtering
// and Entry boundary as the Target-only result diagram.
export function summarizeSimulationAfr(tree) {
  const graph = buildSimulationResultGraph(tree, { targetPathsOnly: true })
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]))
  const parents = new Map(graph.nodes.map((node) => [node.id, []]))
  for (const edge of graph.edges) parents.get(edge.target).push(edge.source)
  const entries = new Set(tree.entryIds)
  return tree.targets.map((target) => {
    const included = new Set(),
      pending = target.reached ? [target.id] : []
    while (pending.length) {
      const id = pending.pop()
      if (included.has(id) || !nodes.has(id)) continue
      included.add(id)
      if (!entries.has(id)) for (const parent of parents.get(id)) pending.push(parent)
    }
    const entryIds = [...included].filter((id) => entries.has(id))
    const summary = calculateAttackFeasibilityRating(
      entryIds.length ? [...included].map((id) => nodes.get(id)) : [],
    )
    return {
      ...summary,
      target,
      entryIds,
      scope: 'target-predecessors',
      status: !target.reached ? 'not-reached' : !entryIds.length ? 'no-entry' : summary.status,
    }
  })
}

const compareIterations = (a, b, direction = 1) => {
  const aKnown = Number.isFinite(a),
    bKnown = Number.isFinite(b)
  if (aKnown !== bKnown) return aKnown ? -1 : 1
  return aKnown ? (a - b) * direction : 0
}
const compareSteps = (a, b) =>
  compareIterations(a.performedAt, b.performedAt) ||
  String(a.id).localeCompare(String(b.id), 'en', { numeric: true })

// Unlike the Target-rooted Attack Tree, this view includes every compromised
// attack step, including initial Entries and branches that never reached a goal.
export function buildSimulationResultGraph(tree, { targetPathsOnly = false } = {}) {
  const entries = new Set(tree.entryIds)
  const targets = new Set(tree.targetIds)
  const nodesById = new Map()
  for (const node of tree.performedNodes ?? tree.nodes) {
    if (node.type !== 'and' && node.type !== 'or') continue
    nodesById.set(node.id, {
      ...node,
      assetKey: JSON.stringify([node.assetId ?? null, node.asset]),
      isEntry: entries.has(node.id),
      isTarget: targets.has(node.id),
    })
  }
  const edgeKeys = new Set()
  let edges = (tree.performedEdges ?? tree.edges).filter(({ source, target }) => {
    const key = JSON.stringify([source, target])
    if (
      !nodesById.has(source) ||
      !nodesById.has(target) ||
      entries.has(target) ||
      edgeKeys.has(key)
    )
      return false
    edgeKeys.add(key)
    return true
  })
  let nodes = [...nodesById.values()].sort(compareSteps)
  const totalSteps = nodes.length
  // Preserve the actual first compromise even if the Target filter hides that
  // asset's earliest step. Sorting must describe the simulation's chronology.
  const firstCompromises = new Map()
  for (const node of nodes)
    if (Number.isFinite(node.performedAt)) {
      firstCompromises.set(
        node.assetKey,
        Math.min(firstCompromises.get(node.assetKey) ?? Infinity, node.performedAt),
      )
    }
  if (targetPathsOnly) {
    // A parent compromised after its child cannot have helped compromise that
    // child. Equal iterations can contain simulator effects and remain valid.
    edges = edges.filter(({ source, target }) => {
      const sourceAt = nodesById.get(source).performedAt
      const targetAt = nodesById.get(target).performedAt
      return !Number.isFinite(sourceAt) || !Number.isFinite(targetAt) || sourceAt <= targetAt
    })
    const parents = new Map(nodes.map((node) => [node.id, []]))
    for (const edge of edges) parents.get(edge.target).push(edge.source)
    const relevant = new Set()
    const pending = tree.targets.filter((node) => node.reached).map((node) => node.id)
    while (pending.length) {
      const id = pending.pop()
      if (relevant.has(id) || !nodesById.has(id)) continue
      relevant.add(id)
      // Keep every performed prerequisite, including AND support and shared
      // branches. Entry prerequisites were granted, not used to reach the goal.
      if (!entries.has(id)) for (const parent of parents.get(id)) pending.push(parent)
    }
    nodes = nodes.filter((node) => relevant.has(node.id))
    edges = edges.filter((edge) => relevant.has(edge.source) && relevant.has(edge.target))
  }
  const assetsById = new Map()
  for (const node of nodes) {
    // Exact exported names distinguish duplicate diagram labels. Do not merge
    // instances by asset type or by the display name before export.
    const id = node.assetKey
    if (!assetsById.has(id))
      assetsById.set(id, {
        id,
        name: node.asset,
        type: node.assetType,
        cellId: node.cellId,
        firstCompromisedAt: firstCompromises.get(id) ?? null,
        nodes: [],
      })
    assetsById.get(id).nodes.push(node)
  }
  return {
    nodes,
    assets: [...assetsById.values()],
    edges,
    completeConnections: Array.isArray(tree.performedEdges),
    hiddenStepCount: totalSteps - nodes.length,
  }
}

export function sortSimulationAssets(assets, sortBy = 'iteration-asc') {
  const direction = sortBy === 'iteration-desc' ? -1 : 1
  const compareNames = (a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'en', { numeric: true }) ||
    String(a.id).localeCompare(String(b.id), 'en', { numeric: true })
  return assets
    .map((asset) => ({
      ...asset,
      nodes: [...asset.nodes].sort(
        (a, b) =>
          compareIterations(a.performedAt, b.performedAt, direction) ||
          String(a.id).localeCompare(String(b.id), 'en', { numeric: true }),
      ),
    }))
    .sort(
      (a, b) =>
        (sortBy === 'name'
          ? 0
          : compareIterations(a.firstCompromisedAt, b.firstCompromisedAt, direction)) ||
        compareNames(a, b),
    )
}

// Group all visible compromises by their recorded iteration, across assets.
// Shared timestamps have no recorded internal order and stay in one group.
export function buildSimulationTimeline(nodes, sortBy = 'iteration-asc') {
  const direction = sortBy === 'iteration-desc' ? -1 : 1
  const sorted = [...nodes].sort(
    (a, b) =>
      compareIterations(a.performedAt, b.performedAt, direction) ||
      String(a.id).localeCompare(String(b.id), 'en', { numeric: true }),
  )
  const groups = []
  for (const node of sorted) {
    const iteration = Number.isFinite(node.performedAt) ? node.performedAt : null
    if (!groups.length || groups.at(-1).iteration !== iteration)
      groups.push({
        id: iteration === null ? 'unknown' : `iteration-${iteration}`,
        iteration,
        nodes: [],
      })
    groups.at(-1).nodes.push(node)
  }
  return groups.map((group) => ({
    ...group,
    assetCount: new Set(
      group.nodes.map(
        (node) => node.assetKey ?? JSON.stringify([node.assetId ?? null, node.asset]),
      ),
    ).size,
  }))
}

// Combine consecutive single-asset iterations into one timeline card. A shared
// iteration remains a boundary: its assets have no recorded internal order.
export function groupSimulationTimelineByAsset(timeline) {
  const groups = []
  for (const iteration of timeline) {
    const assets = new Map()
    for (const node of iteration.nodes) {
      const assetKey = node.assetKey ?? JSON.stringify([node.assetId ?? null, node.asset])
      if (!assets.has(assetKey))
        assets.set(assetKey, {
          assetKey,
          name: node.asset,
          type: node.assetType,
          nodes: [],
        })
      assets.get(assetKey).nodes.push(node)
    }
    const cards = [...assets.values()]
    const previous = groups.at(-1)
    if (
      previous &&
      iteration.iteration !== null &&
      previous.lastIteration !== null &&
      cards.length === 1 &&
      previous.assets.length === 1 &&
      previous.assets[0].assetKey === cards[0].assetKey
    ) {
      previous.lastIteration = iteration.iteration
      for (const node of iteration.nodes) {
        previous.nodes.push(node)
        previous.assets[0].nodes.push(node)
      }
    } else
      groups.push({
        id: iteration.id,
        firstIteration: iteration.iteration,
        lastIteration: iteration.iteration,
        nodes: [...iteration.nodes],
        assetCount: cards.length,
        assets: cards,
      })
  }
  return groups
}

// Arrange assets by attack flow, with separate rows for branches and enough
// space for expanded containers. Cycles and disconnected components stay finite.
export function arrangeSimulationAssets(assets, edges) {
  const owners = new Map(assets.flatMap((asset) => asset.nodes.map((node) => [node.id, asset.id])))
  const children = new Map(assets.map((asset) => [asset.id, new Set()]))
  const parents = new Map(assets.map((asset) => [asset.id, new Set()]))
  for (const { source, target } of edges) {
    const from = owners.get(source),
      to = owners.get(target)
    if (from === undefined || to === undefined || from === to) continue
    children.get(from).add(to)
    parents.get(to).add(from)
  }
  const ranks = new Map()
  const roots = assets.filter(
    (asset) => asset.nodes.some((node) => node.isEntry) || !parents.get(asset.id).size,
  )
  const queue = roots.map((asset) => asset.id)
  for (const id of queue) ranks.set(id, 0)
  let cursor = 0
  function visit() {
    while (cursor < queue.length) {
      const id = queue[cursor++]
      for (const next of children.get(id))
        if (!ranks.has(next)) {
          ranks.set(next, ranks.get(id) + 1)
          queue.push(next)
        }
    }
  }
  visit()
  for (const asset of assets)
    if (!ranks.has(asset.id)) {
      ranks.set(asset.id, 0)
      queue.push(asset.id)
      visit()
    }
  const layers = new Map()
  for (const asset of assets) {
    const rank = ranks.get(asset.id)
    if (!layers.has(rank)) layers.set(rank, [])
    layers.get(rank).push(asset)
  }
  const order = new Map(),
    positions = new Map()
  let x = 24
  for (const [, layer] of [...layers].sort(([a], [b]) => a - b)) {
    const parentOrder = (asset) => {
      const rows = [...parents.get(asset.id)]
        .filter((id) => order.has(id))
        .map((id) => order.get(id))
      return rows.length ? rows.reduce((sum, row) => sum + row, 0) / rows.length : 0
    }
    layer.sort((a, b) => parentOrder(a) - parentOrder(b))
    let y = 24
    layer.forEach((asset, index) => {
      positions.set(asset.id, { x, y })
      order.set(asset.id, index)
      y += asset.height + 100
    })
    x += Math.max(...layer.map((asset) => asset.width)) + 180
  }
  return assets.map((asset) => ({ ...asset, ...positions.get(asset.id) }))
}

export function layoutSimulationResult(graph, expandedAssets = new Set()) {
  const assets = graph.assets.map((asset) => {
    const expanded = expandedAssets.has(asset.id)
    return {
      ...asset,
      expanded,
      width: 320,
      height: expanded
        ? 80 + asset.nodes.reduce((height, node) => height + simulationStepHeight(node) + 16, 0)
        : 120,
    }
  })
  return { assets: arrangeSimulationAssets(assets, graph.edges), edges: graph.edges }
}
// Project CTSA assessments are instance-specific and recalculated from saved
// factors/weights before simulation. A catalog score is only a reference.
export function getSimulationCtsaScore(node) {
  const assessment =
    node?.riskAssessed === true ? databaseCtsaScore({ ctsa_score: node.riskScore }) : null
  if (assessment !== null) return { value: assessment, source: 'assessment' }
  const score = databaseCtsaScore({ ctsa_score: node?.ctsaScore })
  return score === null
    ? null
    : { value: score, source: node.ctsaScoreSource === 'assessment' ? 'assessment' : 'catalog' }
}

export function simulationCtsaScoreTitle(node) {
  return getSimulationCtsaScore(node)?.source === 'assessment'
    ? 'Saved CTSA assessment for this asset and attack step.'
    : 'Reference CTSA score from the language catalog.'
}

export const simulationStepHeight = (node) => (getSimulationCtsaScore(node) ? 88 : 68)
