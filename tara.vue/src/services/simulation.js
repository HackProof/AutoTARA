import { parse } from 'yaml'
import { prepareMalExport, serializeMalModel } from './malModel.js'
import { createAttackStepRiskResolver, createAttackStepTtpResolver } from './attackStepRisk.js'
import { mergeLanguageAttackSteps } from './languageAttackSteps.js'
import { databaseCtsaScore } from './ttpScoring.js'

export function prepareSimulation({
  snapshot,
  languageGraph,
  schema,
  modelInfo,
  attackerType,
  catalogRows = [],
}) {
  if (!['BreadthFirstAttacker', 'DepthFirstAttacker'].includes(attackerType))
    throw new Error('Choose a BFS or DFS attacker.')
  const plan = prepareMalExport(snapshot, languageGraph, modelInfo)
  const model = parse(serializeMalModel(plan))
  const assetsByName = new Map(plan.assets.map((asset) => [asset.name, asset]))
  const resolveRisk = createAttackStepRiskResolver(
    languageGraph,
    schema,
    plan.assets.map((asset) => asset.type),
    catalogRows,
  )
  const resolveTtp = createAttackStepTtpResolver(
    languageGraph,
    schema,
    plan.assets.map((asset) => asset.type),
    catalogRows,
  )
  const ctsaScores = new Map(
    mergeLanguageAttackSteps(catalogRows, languageGraph, [
      ...new Set(plan.assets.map((asset) => asset.type)),
    ]).map((row) => [JSON.stringify([row.asset, row.name]), databaseCtsaScore(row.ctsa)]),
  )
  const endpoints = (kind) => [
    ...new Set(
      plan.assets.flatMap((asset) =>
        (asset.extras.attackEndpoints?.[schema]?.[kind] || []).map(
          (step) => `${asset.name}:${step.name}`,
        ),
      ),
    ),
  ]
  const entryPoints = endpoints('entry')
  const goals = endpoints('target')
  if (!entryPoints.length || !goals.length)
    throw new Error('Select at least one Entry and one Target attack step in the diagram.')
  // The editor normalizes assets to an array. maltoolbox expects its native
  // serialized LangGraph, keyed by asset name, with the complete step expressions.
  const language = Object.fromEntries([
    ['metadata', languageGraph.metadata],
    ...languageGraph.assets.map((asset) => [asset.name, asset]),
  ])
  return {
    request: {
      language_graph: language,
      model,
      entry_points: entryPoints,
      goals,
      attacker_type: attackerType,
    },
    // Export may disambiguate duplicate names. Use the exact exported names for
    // endpoints and the reverse mapping, rather than looking up diagram labels.
    cellIds: new Map(plan.assets.map((asset) => [asset.name, String(asset.cellId)])),
    riskScore: (node) => resolveRisk(assetsByName.get(node.asset), node.name),
    ttpAssessment: (node) => resolveTtp(assetsByName.get(node.asset), node.name),
    ctsaScore: (node) =>
      ctsaScores.get(JSON.stringify([assetsByName.get(node.asset)?.type, node.name])) ?? null,
  }
}

export async function requestSimulation(payload, signal, fetcher = globalThis.fetch) {
  let response
  try {
    response = await fetcher('/api/simulations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (error) {
    if (signal?.aborted || error.name === 'AbortError') throw error
    throw new Error('Cannot reach the simulation server. Start simulate.server and try again.', {
      cause: error,
    })
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = Array.isArray(data?.detail)
      ? data.detail.map((item) => item.msg).join('\n')
      : data?.detail
    throw new Error(
      detail || 'The simulation server is unavailable. Check simulate.server and try again.',
    )
  }
  if (!data?.tree?.nodes || !data.tree.targets)
    throw new Error('The simulation server returned an invalid result.')
  return data
}

export function attachSimulationCells(
  result,
  cellIds,
  riskScore = () => null,
  ctsaScore = () => null,
  ttpAssessment = () => null,
) {
  const attach = (nodes) =>
    nodes.map((node) => {
      const score = riskScore(node)
      const assessedCtsaScore = databaseCtsaScore({ ctsa_score: score })
      const catalogCtsaScore = databaseCtsaScore({ ctsa_score: ctsaScore(node) })
      const ttp = ttpAssessment(node)
      return {
        ...node,
        cellId: cellIds.get(node.asset) || null,
        riskScore: Number.isFinite(score) ? score : 0,
        riskAssessed: Number.isFinite(score),
        ctsaScore: assessedCtsaScore ?? catalogCtsaScore,
        ctsaScoreSource:
          assessedCtsaScore !== null ? 'assessment' : catalogCtsaScore !== null ? 'catalog' : null,
        catalogCtsaScore,
        ttpFactors: ttp?.factors ?? null,
        ttpFactorsSource: ttp?.source ?? null,
      }
    })
  return {
    ...result,
    tree: {
      ...result.tree,
      nodes: attach(result.tree.nodes),
      targets: attach(result.tree.targets),
      performedNodes: attach(result.tree.performedNodes || []),
    },
  }
}

// Turn the performed subgraph into a finite, Target-rooted display tree. Shared
// nodes have reference leaves; full graph edges remain in the server artifacts.
export function buildSimulationTree(
  graph,
  targetId,
  { maxNodes = 1500, maxDepth = 80, path = null } = {},
) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]))
  const parents = new Map(graph.nodes.map((node) => [node.id, []]))
  const entries = new Set(graph.entryIds)
  const route = new Set(path || [])
  if (path) {
    const edges = new Set(graph.edges.map((edge) => JSON.stringify([edge.source, edge.target])))
    if (
      !path.length ||
      route.size !== path.length ||
      path.some((id) => !nodes.has(id)) ||
      !entries.has(path[0]) ||
      path.at(-1) !== targetId ||
      path.slice(1).some((id, index) => !edges.has(JSON.stringify([path[index], id])))
    )
      throw new Error('Select a valid performed Entry-to-Target path.')
  }
  for (const edge of graph.edges)
    if (nodes.has(edge.source) && nodes.has(edge.target)) parents.get(edge.target).push(edge.source)
  const occurrences = []
  const expanded = new Set()
  function add(id, role, terminal, routeStep = false) {
    const item = {
      id: `simulation-${occurrences.length}`,
      node: nodes.get(id),
      simulated: true,
      role,
      terminal,
      routeStep,
      isTarget: false,
      children: [],
      omitted: 0,
    }
    occurrences.push(item)
    return item
  }
  function visit(id, ancestors, depth) {
    const terminal = entries.has(id)
      ? 'entry'
      : route.has(id)
        ? 'route-reference'
        : ancestors.has(id)
          ? 'cycle'
          : expanded.has(id)
            ? 'reference'
            : null
    const item = add(id, path ? 'support' : 'primary', terminal)
    if (terminal) return item
    expanded.add(id)
    const next = new Set(ancestors).add(id)
    for (const parent of parents.get(id)) {
      if (occurrences.length >= maxNodes || depth >= maxDepth) item.omitted += 1
      else item.children.push(visit(parent, next, depth + 1))
    }
    return item
  }
  const target = graph.targets.find((item) => item.id === targetId)
  let root = null
  if (target?.reached && nodes.has(targetId)) {
    if (path) {
      // Reserve the whole selected route before applying support display limits.
      const primary = path.map((id, index) =>
        add(id, 'primary', index === 0 ? 'entry' : null, true),
      )
      for (let index = 1; index < primary.length; index++) {
        const item = primary[index]
        item.children.push(primary[index - 1])
        // An OR route uses its selected input; AND requires its other performed inputs too.
        if (item.node.type !== 'and') continue
        for (const parent of parents.get(item.node.id)) {
          if (parent === path[index - 1]) continue
          if (occurrences.length >= maxNodes) item.omitted += 1
          else item.children.push(visit(parent, new Set(), 1))
        }
      }
      root = primary.at(-1)
    } else root = visit(targetId, new Set(), 0)
    root.isTarget = true
  }
  return { root, occurrences, truncated: occurrences.some((item) => item.omitted > 0) }
}
