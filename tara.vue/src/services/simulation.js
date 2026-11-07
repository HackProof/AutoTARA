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
  const attackSteps = new Map(
    mergeLanguageAttackSteps(catalogRows, languageGraph, [
      ...new Set(plan.assets.map((asset) => asset.type)),
    ]).map((row) => [
      JSON.stringify([row.asset, row.name]),
      {
        ctsaScore: databaseCtsaScore(row.ctsa),
        description: row.definition?.trim() || null,
      },
    ]),
  )
  const attackStep = (node) =>
    attackSteps.get(JSON.stringify([assetsByName.get(node.asset)?.type, node.name]))
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
    ctsaScore: (node) => attackStep(node)?.ctsaScore ?? null,
    stepDescription: (node) => attackStep(node)?.description ?? null,
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
  if (
    !Array.isArray(data?.graph?.performedNodes) ||
    !Array.isArray(data.graph.performedEdges) ||
    !Array.isArray(data.graph.entryIds) ||
    !Array.isArray(data.graph.targetIds) ||
    !Array.isArray(data.graph.targets)
  )
    throw new Error(
      'The simulation server returned an invalid result. Restart the simulation server and rerun the simulation.',
    )
  return data
}

export function attachSimulationCells(
  result,
  cellIds,
  riskScore = () => null,
  ctsaScore = () => null,
  ttpAssessment = () => null,
  stepDescription = () => null,
) {
  const attach = (nodes) =>
    nodes.map((node) => {
      const score = riskScore(node)
      const assessedCtsaScore = databaseCtsaScore({ ctsa_score: score })
      const catalogCtsaScore = databaseCtsaScore({ ctsa_score: ctsaScore(node) })
      const ttp = ttpAssessment(node)
      return {
        ...node,
        description: stepDescription(node),
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
    graph: {
      ...result.graph,
      targets: attach(result.graph.targets),
      performedNodes: attach(result.graph.performedNodes || []),
    },
  }
}
