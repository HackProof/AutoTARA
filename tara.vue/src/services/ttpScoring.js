export const TTP_FACTORS = [
  { key: 'proximity', label: 'Proximity' },
  { key: 'locality', label: 'Locality' },
  { key: 'recoveryTime', label: 'Recovery Time' },
  { key: 'restorationCosts', label: 'Restoration Costs' },
  { key: 'Impact_C', label: 'Impact: Confidentiality' },
  { key: 'Impact_I', label: 'Impact: Integrity' },
  { key: 'Impact_A', label: 'Impact: Availability' },
  { key: 'Prior Use', label: 'Prior Use' },
  { key: 'Required Skills', label: 'Required Skills' },
  { key: 'Required Resources', label: 'Required Resources' },
  { key: 'Stealth', label: 'Stealth' },
  { key: 'Attribution', label: 'Attribution' },
]

export const TTP_VALUES = [
  { value: 1, label: 'Very Low' },
  { value: 2, label: 'Low' },
  { value: 3, label: 'Medium' },
  { value: 4, label: 'High' },
  { value: 5, label: 'Very High' },
]

const CTSA_FACTOR_COLUMNS = {
  proximity: 'proximity',
  locality: 'locality',
  recoveryTime: 'recovery_time',
  restorationCosts: 'restoration_costs',
  Impact_C: 'impact_confidentiality',
  Impact_I: 'impact_integrity',
  Impact_A: 'impact_availability',
  'Prior Use': 'prior_use',
  'Required Skills': 'required_skills',
  'Required Resources': 'required_resources',
  Stealth: 'stealth',
  Attribution: 'attribution',
}

const validValue = (value) =>
  value === null || (Number.isInteger(value) && value >= 1 && value <= 5)
const validWeight = (weight) => Number.isFinite(weight) && weight >= 0

export function createTtpFactors(saved) {
  const entries = new Map(
    (Array.isArray(saved) ? saved : [])
      .filter((item) => item && typeof item === 'object')
      .map((item) => [item.key, item]),
  )
  return TTP_FACTORS.map(({ key }) => {
    const factor = entries.get(key)
    return {
      key,
      value: validValue(factor?.value) ? factor.value : null,
    }
  })
}

export function createTtpFactorsFromCtsa(ctsa) {
  return createTtpFactors(
    TTP_FACTORS.map(({ key }) => ({ key, value: ctsa?.[CTSA_FACTOR_COLUMNS[key]] })),
  )
}

// The catalog score has no associated asset weights. Keep it as a reference;
// project Risk Scores are calculated from the imported ratings and asset weights.
export function databaseCtsaScore(ctsa) {
  const score = ctsa?.ctsa_score
  return Number.isFinite(score) && score >= 1 && score <= 5 ? score : null
}

export function validTtpFactors(factors) {
  return (
    Array.isArray(factors) &&
    factors.length === TTP_FACTORS.length &&
    TTP_FACTORS.every(
      ({ key }, index) => factors[index]?.key === key && validValue(factors[index].value),
    )
  )
}

export function createTtpWeights(saved = {}) {
  return Object.fromEntries(
    TTP_FACTORS.map(({ key }) => [key, validWeight(saved?.[key]) ? saved[key] : 0.1]),
  )
}

export function validTtpWeights(weights) {
  return (
    weights !== null &&
    typeof weights === 'object' &&
    !Array.isArray(weights) &&
    TTP_FACTORS.every(({ key }) => validWeight(weights[key])) &&
    TTP_FACTORS.some(({ key }) => weights[key] > 0)
  )
}

export function normalizeCtsaAssessment(saved = {}) {
  const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value)
  const source = isObject(saved) ? saved : {}
  const rawSteps = source.version === 2 ? source.steps : source
  const entries = Object.entries(isObject(rawSteps) ? rawSteps : {}).filter(([, factors]) =>
    Array.isArray(factors),
  )
  const weightConflicts = []
  let weights
  if (source.version === 2) {
    weights = createTtpWeights(source.weights)
  } else {
    // Older files stored weights on every attack step. Preserve uniform values;
    // expose differing values for review rather than choosing an arbitrary step.
    weights = Object.fromEntries(
      TTP_FACTORS.map(({ key }) => {
        const values = new Set(
          entries.flatMap(([, factors]) =>
            factors
              .filter((factor) => factor?.key === key && validWeight(factor.weight))
              .map((factor) => factor.weight),
          ),
        )
        if (values.size > 1) weightConflicts.push(key)
        return [key, values.size === 1 ? [...values][0] : 0.1]
      }),
    )
  }
  return {
    weights,
    steps: Object.fromEntries(entries.map(([id, factors]) => [id, createTtpFactors(factors)])),
    weightConflicts,
  }
}

// To interpret this as Risk, callers must supply risk-oriented ratings
// (higher means higher assessed risk), rather than raw effort measurements. Do not invert skills/resources without a
// validated rubric. Missing factors remain unknown even with zero weights.
export function calculateTtpScore(factors, weights = createTtpWeights()) {
  if (
    !validTtpFactors(factors) ||
    !validTtpWeights(weights) ||
    factors.some((factor) => factor.value === null)
  )
    return null
  // Scaling both sums by the largest weight preserves the weighted average
  // while avoiding overflow for large, otherwise valid weight values.
  const largestWeight = Math.max(...TTP_FACTORS.map(({ key }) => weights[key]))
  const totalWeight = factors.reduce((sum, factor) => sum + weights[factor.key] / largestWeight, 0)
  const weightedTotal = factors.reduce(
    (sum, factor) => sum + factor.value * (weights[factor.key] / largestWeight),
    0,
  )
  return Math.round((weightedTotal / totalWeight) * 10) / 10
}

// Scores are an export snapshot. Input values and shared weights remain the
// authoritative data when reopening or recalculating an assessment.
export function createCtsaMetadata(saved) {
  const { weights, steps } = normalizeCtsaAssessment(saved)
  return {
    version: 2,
    scoringMethod: 'weighted-average',
    scoreRange: [1, 5],
    scorePrecision: 1,
    weights,
    steps,
    riskScores: Object.fromEntries(
      Object.entries(steps).map(([id, factors]) => [id, calculateTtpScore(factors, weights)]),
    ),
  }
}

export function createAssetCtsaMetadata(assessments = {}) {
  if (!assessments || typeof assessments !== 'object' || Array.isArray(assessments)) return {}
  return Object.fromEntries(
    Object.entries(assessments).map(([schema, saved]) => [schema, createCtsaMetadata(saved)]),
  )
}

export function riskScoreLabel(score) {
  return Number.isFinite(score) ? score.toFixed(1) : '-'
}

export function riskScoreClass(score) {
  if (!Number.isFinite(score)) return 'bg-light text-secondary border'
  if (score >= 4) return 'text-bg-danger'
  if (score >= 2.5) return 'text-bg-warning'
  if (score >= 1) return 'text-bg-info'
  return 'text-bg-secondary'
}

export function assessAssetThreats(threats, saved = {}) {
  const { steps, weights } = normalizeCtsaAssessment(saved)
  return threats.map((threat) => {
    const factors = createTtpFactors(steps[threat.attack_step_id])
    return { ...threat, ttp_score: factors, riskScore: calculateTtpScore(factors, weights) }
  })
}

export function createCtsaDraft(threats, saved = {}) {
  const { steps, weights, weightConflicts } = normalizeCtsaAssessment(saved)
  return {
    weights,
    weightConflicts,
    threats: threats.map((threat) => ({
      ...threat,
      factors: createTtpFactors(steps[threat.attack_step_id] || threat.ttp_score),
    })),
  }
}

export function fillBlankCtsaValues(draft) {
  let stepCount = 0
  let valueCount = 0
  for (const threat of draft.threats) {
    let loaded = 0
    for (const [index, factor] of createTtpFactorsFromCtsa(threat.ctsa).entries()) {
      if (factor.value !== null && threat.factors[index].value === null) {
        threat.factors[index].value = factor.value
        loaded++
      }
    }
    if (loaded) stepCount++
    valueCount += loaded
  }
  return { stepCount, valueCount }
}

export function serializeCtsaDraft(draft) {
  const entries = new Map()
  if (!Array.isArray(draft?.threats) || !draft.threats.length)
    throw new Error('No threats are available to assess.')
  if (!validTtpWeights(draft.weights))
    throw new Error(
      'Asset weights must be finite non-negative numbers with a total greater than 0.',
    )
  for (const threat of draft.threats) {
    if (
      typeof threat.attack_step_id !== 'string' ||
      !threat.attack_step_id ||
      entries.has(threat.attack_step_id) ||
      !validTtpFactors(threat.factors)
    ) {
      throw new Error('Each threat needs a unique attack step and values from 1 to 5 or blank.')
    }
    entries.set(threat.attack_step_id, createTtpFactors(threat.factors))
  }
  return createCtsaMetadata({
    version: 2,
    weights: createTtpWeights(draft.weights),
    steps: Object.fromEntries(entries),
  })
}
