const FACTORS = ['proximity', 'Required Skills', 'Required Resources']

export function classifyAttackFeasibility(score) {
  if (!Number.isFinite(score) || score < 1 || score > 5) return null
  if (score < 2) return { value: 0, label: 'Very Low' }
  if (score < 3) return { value: 1, label: 'Low' }
  if (score < 4) return { value: 1.5, label: 'Medium' }
  return { value: 2, label: 'High' }
}

// Only unique compromised attack steps with all three raw 1–5 ratings are
// eligible. Other CTSA factors, weights and aggregate scores do not affect AFR.
export function calculateAttackFeasibilityRating(nodes) {
  const steps = new Map(
    nodes.filter((node) => ['and', 'or'].includes(node.type)).map((node) => [node.id, node]),
  )
  const maxima = Object.fromEntries(FACTORS.map((key) => [key, null]))
  const assessedStepIds = [],
    missingStepIds = []
  for (const [id, node] of steps) {
    const factors = new Map((node.ttpFactors || []).map((factor) => [factor.key, factor.value]))
    if (
      !FACTORS.every(
        (key) =>
          Number.isInteger(factors.get(key)) && factors.get(key) >= 1 && factors.get(key) <= 5,
      )
    ) {
      missingStepIds.push(id)
      continue
    }
    assessedStepIds.push(id)
    for (const key of FACTORS) maxima[key] = Math.max(maxima[key] ?? 1, factors.get(key))
  }
  const score = assessedStepIds.length
    ? FACTORS.reduce((sum, key) => sum + maxima[key], 0) / FACTORS.length
    : null
  const classification = classifyAttackFeasibility(score)
  return {
    score,
    rating: classification?.value ?? null,
    label: classification?.label ?? null,
    maxima,
    stepIds: [...steps.keys()],
    assessedStepIds,
    missingStepIds,
    totalSteps: steps.size,
    assessedSteps: assessedStepIds.length,
    status: !assessedStepIds.length
      ? 'unavailable'
      : missingStepIds.length
        ? 'partial'
        : 'complete',
  }
}
