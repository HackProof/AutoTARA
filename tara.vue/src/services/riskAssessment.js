export const IMPACT_LEVELS = [
  { label: 'Negligible', score: 0 },
  { label: 'Moderate', score: 1 },
  { label: 'Major', score: 1.5 },
  { label: 'Severe', score: 2 },
]

export const FEASIBILITY_LEVELS = [
  { label: 'Very Low', score: 0 },
  { label: 'Low', score: 1 },
  { label: 'Medium', score: 1.5 },
  { label: 'High', score: 2 },
]

export const IMPACT_CATEGORIES = [
  { name: 'Safety', description: 'Harm to drivers, passengers and other road users.' },
  { name: 'Financial', description: 'Financial loss, repair costs and other monetary damage.' },
  { name: 'Operational', description: 'Loss or degradation of vehicle functions and services.' },
  {
    name: 'Privacy',
    description: 'Exposure or misuse of personal data and effects on individuals.',
  },
]

const validScore = (score) => IMPACT_LEVELS.some((level) => level.score === score)

// All four dimensions must be assessed, including explicit Negligible ratings.
// The maximum keeps the final impact on the same 0–2 scale as each dimension.
export function calculateImpactRating(impacts) {
  const scores = IMPACT_CATEGORIES.map(({ name }) => impacts?.[name])
  if (!scores.every(validScore)) return null
  const score = Math.max(...scores)
  return { score, label: IMPACT_LEVELS.find((level) => level.score === score).label }
}

export function classifyRiskValue(value) {
  if (!Number.isFinite(value) || value < 1 || value > 5) return null
  if (value < 2.5) return 'Low'
  if (value < 3.25) return 'Medium'
  if (value < 5) return 'High'
  return 'Critical'
}

export function calculateRiskValue(feasibility, impact) {
  if (!validScore(feasibility) || !validScore(impact)) return null
  const value = 1 + feasibility * impact
  return { value, label: classifyRiskValue(value) }
}

export function resolveReportFeasibility(selection, simulationAfr) {
  if (selection === 'simulation') {
    const level = FEASIBILITY_LEVELS.find((item) => item.score === simulationAfr?.rating)
    if (simulationAfr?.status !== 'complete' || !level) return null
    return { ...level, source: 'simulation', scope: simulationAfr.scope }
  }
  const level = FEASIBILITY_LEVELS.find((item) => item.label === selection)
  return level ? { ...level, source: 'manual' } : null
}

export function createRiskAssessment() {
  return {
    impacts: Object.fromEntries(IMPACT_CATEGORIES.map(({ name }) => [name, null])),
    impactNotes: Object.fromEntries(IMPACT_CATEGORIES.map(({ name }) => [name, ''])),
    feasibility: 'simulation',
    feasibilityNote: '',
    finalizedAt: null,
  }
}

export function evaluateRiskAssessment(assessment, simulationAfr) {
  const impact = calculateImpactRating(assessment.impacts)
  const feasibility = resolveReportFeasibility(assessment.feasibility, simulationAfr)
  return {
    impact,
    feasibility,
    risk: calculateRiskValue(feasibility?.score, impact?.score),
  }
}
