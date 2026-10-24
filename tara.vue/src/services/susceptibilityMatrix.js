import { riskScoreLabel } from './ttpScoring.js'
import { collectCrraAssessments } from './crraAssessments.js'

// Carts supply already assessed scores. Group by AV identity, keep the maximum
// per cart, and then take the maximum across carts without recalculating risk.
export function buildSusceptibilityMatrix(carts) {
  const columnsById = new Map()
  const vectorsById = new Map()
  for (const cart of carts) {
    if (!columnsById.has(cart.id)) columnsById.set(cart.id, { id: cart.id, name: cart.name })
    for (const vector of cart.attackVectors) {
      if (!vector.avId || !Number.isFinite(vector.riskScore)) continue
      if (!vectorsById.has(vector.avId)) {
        vectorsById.set(vector.avId, {
          avId: vector.avId,
          attackVector: vector.attackVector,
          scores: new Map(),
          sources: new Map(),
        })
      }
      const row = vectorsById.get(vector.avId)
      const previous = row.scores.get(cart.id)
      row.scores.set(
        cart.id,
        previous === undefined ? vector.riskScore : Math.max(previous, vector.riskScore),
      )
      if (!row.sources.has(cart.id)) row.sources.set(cart.id, new Map())
      const sources = row.sources.get(cart.id)
      for (const step of vector.sourceSteps || []) {
        if (
          !sources.has(step.attackStepId) ||
          sources.get(step.attackStepId).riskScore < step.riskScore
        )
          sources.set(step.attackStepId, { ...step })
      }
    }
  }
  const columns = [...columnsById.values()]
  const rows = [...vectorsById.values()].map(({ avId, attackVector, scores, sources }) => {
    const riskScore = Math.max(...scores.values())
    return {
      avId,
      attackVector,
      riskScore,
      cells: columns.map(({ id }) => {
        const score = scores.get(id)
        return {
          cartId: id,
          riskScore: score ?? null,
          label: score === undefined ? '' : `X (${riskScoreLabel(score)})`,
          sourceSteps: [...(sources.get(id)?.values() || [])].sort(
            (a, b) => b.riskScore - a.riskScore || a.attackStepId.localeCompare(b.attackStepId),
          ),
        }
      }),
    }
  })
  rows.sort((a, b) => b.riskScore - a.riskScore || a.avId.localeCompare(b.avId))
  return { columns, rows }
}

// Keep Step IDs as the evaluation keys, and project their explicit catalog
// mappings into Technique rows. An asset's Technique score is the maximum of its
// mapped, completed TTP assessments; the row then takes the maximum over assets.
export function createSusceptibilityMatrix(snapshot, schema, threatsByAsset) {
  const { rows } = collectCrraAssessments(snapshot, schema, threatsByAsset)
  const vectorsByAsset = new Map()
  const unmappedSteps = []
  for (const row of rows) {
    const techniques = row.techniques.filter(
      (technique) => typeof technique.id === 'string' && technique.id.trim(),
    )
    if (!techniques.length) {
      unmappedSteps.push(row)
      continue
    }
    if (!vectorsByAsset.has(row.assetId)) vectorsByAsset.set(row.assetId, [])
    for (const technique of techniques) {
      vectorsByAsset.get(row.assetId).push({
        avId: technique.id.trim(),
        attackVector: technique.name || technique.id.trim(),
        riskScore: row.riskScore,
        sourceSteps: [
          {
            attackStepId: row.attackStepId,
            name: row.attackVector,
            definition: row.definition,
            declaredAsset: row.declaredAsset,
            riskScore: row.riskScore,
          },
        ],
      })
    }
  }
  const matrix = buildSusceptibilityMatrix(
    (snapshot?.vertices || [])
      .filter((asset) => asset.assetType && (!asset.kind || asset.kind === 'asset'))
      .map((asset) => ({
        id: asset.id,
        name: asset.label || asset.assetType,
        attackVectors: vectorsByAsset.get(asset.id) || [],
      })),
  )
  unmappedSteps.sort(
    (a, b) =>
      b.riskScore - a.riskScore ||
      a.assetName.localeCompare(b.assetName) ||
      a.assetId.localeCompare(b.assetId) ||
      a.attackStepId.localeCompare(b.attackStepId),
  )
  return { ...matrix, unmappedSteps }
}
