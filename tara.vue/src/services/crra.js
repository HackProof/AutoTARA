// CRRA uses Technique rows produced by susceptibilityMatrix.js. All scoring
// inputs come from the catalog or a saved assessment override; P/R weights default to one.
export const CRRA_RISK_BANDS = [
  { id: 'high', label: 'High', range: '≥ 4.0' },
  { id: 'moderate', label: 'Moderate', range: '2.5 – < 4.0' },
  { id: 'low', label: 'Low', range: '< 2.5' },
]
export const riskBand = (score) => (score >= 4 ? 'high' : score >= 2.5 ? 'moderate' : 'low')
const object = (value) => value && typeof value === 'object' && !Array.isArray(value)
const number = (value) => (Number.isFinite(value) ? value : null)
const text = (value) => (typeof value === 'string' ? value : '')
const ids = (value) => [
  ...new Set((Array.isArray(value) ? value : []).filter((id) => typeof id === 'string')),
]
export const validWeight = (value) => Number.isFinite(value) && value >= 0
export const validCost = (value) => Number.isFinite(value) && value > 0
// CRRA inputs are not constrained to the TTP score's one-decimal scale.
export const crraScoreLabel = (value) =>
  Number.isFinite(value) ? String(Number(value.toPrecision(12))) : '-'

export function createCrraDraft(saved = {}) {
  if (!object(saved)) saved = {}
  return {
    version: 1,
    selectedAvIds: ids(saved.selectedAvIds),
    selectedCmIds: ids(saved.selectedCmIds),
    weights: { P: number(saved.weights?.P) ?? 1, R: number(saved.weights?.R) ?? 1 },
    weightBasis: text(saved.weightBasis),
    sort: ['ratio', 'utility', 'cost'].includes(saved.sort) ? saved.sort : 'ratio',
    strategy: Object.fromEntries(
      CRRA_RISK_BANDS.map(({ id }) => [
        id,
        {
          total: number(saved.strategy?.[id]?.total),
          P: number(saved.strategy?.[id]?.P),
          R: number(saved.strategy?.[id]?.R),
        },
      ]),
    ),
    strategyBasis: text(saved.strategyBasis),
    overrides: object(saved.overrides) ? JSON.parse(JSON.stringify(saved.overrides)) : {},
  }
}

function normalizedEffects(effects) {
  if (!Array.isArray(effects) || effects.some((effect) => !['P', 'R', 'D'].includes(effect?.type)))
    return null
  const seen = new Set()
  return effects
    .filter((effect) => {
      const key = `${effect.type}:${effect.level || ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((effect) => ({ type: effect.type, level: text(effect.level) }))
}

export function effectLabel(mapping) {
  if (!mapping) return ''
  if (mapping.effects === null) return '?'
  if (!mapping.effects.length) return 'None'
  return mapping.effects
    .map((effect) => `${effect.type}${effect.level ? ` (${effect.level})` : ''}`)
    .join(' / ')
}

export function evaluateCountermeasures(vectors, catalog, draft) {
  const selected = new Set(vectors.map((vector) => vector.avId))
  const weights = Object.fromEntries(
    ['P', 'R'].map((type) => [
      type,
      (draft.weights[type] === '' ? null : draft.weights[type]) ?? catalog.weights?.[type] ?? 1,
    ]),
  )
  return (catalog.countermeasures || [])
    .map((cm) => {
      const override = draft.overrides[cm.id] || {}
      const mappings = new Map()
      for (const mapping of cm.mappings || []) {
        if (!selected.has(mapping.avId) || mappings.has(mapping.avId)) continue
        const local = override.mappings?.[mapping.avId]
        const hasOverride = local && Object.hasOwn(local, 'effects')
        mappings.set(mapping.avId, {
          ...mapping,
          effects: normalizedEffects(hasOverride ? local.effects : mapping.effects),
          basis: hasOverride
            ? text(local.basis)
            : text(mapping.basis || mapping.evidence?.description),
          source: hasOverride ? 'Assessment override' : mapping.source || 'Catalog',
          effectScope: hasOverride ? 'assessment' : mapping.effectScope,
        })
      }
      const list = [...mappings.values()]
      const counts = { P: 0, R: 0 }
      for (const mapping of list) {
        for (const type of ['P', 'R'])
          if (mapping.effects?.some((effect) => effect.type === type)) counts[type]++
      }
      const missing = []
      for (const type of ['P', 'R'])
        if (!validWeight(weights[type])) missing.push(`${type} weight missing or invalid`)
      const unknown = list.filter((mapping) => mapping.effects === null)
      if (unknown.length)
        missing.push(`P/R classification missing: ${unknown.map((m) => m.avId).join(', ')}`)
      const utility = missing.length ? null : counts.P * weights.P + counts.R * weights.R
      const cost = Object.hasOwn(override, 'cost') ? number(override.cost) : number(cm.cost)
      if (!validCost(cost)) missing.push('Cost missing or invalid (must be > 0)')
      const ratio = utility !== null && validCost(cost) ? (utility / cost) * 100 : null
      // Explicitly reject arithmetic overflow rather than display an invented score.
      if (utility !== null && !Number.isFinite(utility))
        missing.push('Utility exceeds the supported numeric range')
      if (ratio !== null && !Number.isFinite(ratio))
        missing.push('U/C exceeds the supported numeric range')
      return {
        ...cm,
        mappings: list,
        counts,
        weights,
        cost,
        costBasis: Object.hasOwn(override, 'cost') ? text(override.costBasis) : text(cm.costBasis),
        costSource: Object.hasOwn(override, 'cost') ? 'Assessment override' : 'Catalog',
        utility: number(utility),
        ratio: number(ratio),
        missing,
        excluded: override.excluded === true,
        exclusionBasis: text(override.exclusionBasis),
        eligible: missing.length === 0 && override.excluded !== true,
      }
    })
    .filter((cm) => cm.mappings.length)
}

export function sortCountermeasures(candidates, sort = 'ratio') {
  const field = ['utility', 'cost'].includes(sort) ? sort : 'ratio'
  return [...candidates].sort((a, b) => {
    const left = a[field],
      right = b[field]
    if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : a.id.localeCompare(b.id)
    if (!Number.isFinite(right)) return -1
    return (field === 'cost' ? left - right : right - left) || a.id.localeCompare(b.id)
  })
}

function requirement(vector, strategy) {
  const band = riskBand(vector.riskScore)
  const row = strategy[band] || {}
  const values = {
    total: row.total,
    P: row.P === '' ? 0 : (row.P ?? 0),
    R: row.R === '' ? 0 : (row.R ?? 0),
  }
  const valid = Object.values(values).every((value) => Number.isSafeInteger(value) && value >= 0)
  return { band, ...values, valid }
}

export function createSolutionTable(vectors, candidates, selectedCmIds, strategy) {
  const selected = new Set(selectedCmIds)
  const rows = candidates.filter((cm) => selected.has(cm.id) && !cm.excluded)
  const coverage = vectors.map((vector) => {
    const required = requirement(vector, strategy)
    const counts = { total: 0, P: 0, R: 0 }
    const unknownCmIds = []
    for (const cm of rows) {
      const mapping = cm.mappings.find((mapping) => mapping.avId === vector.avId)
      if (!mapping) continue
      if (mapping.effects === null) unknownCmIds.push(cm.id)
      const types = new Set(mapping.effects?.map((effect) => effect.type))
      if (types.has('P') || types.has('R')) counts.total++
      for (const type of ['P', 'R']) if (types.has(type)) counts[type]++
    }
    const gaps = required.valid
      ? Object.fromEntries(
          ['total', 'P', 'R'].map((key) => [key, Math.max(0, required[key] - counts[key])]),
        )
      : null
    const satisfied = Boolean(gaps && Object.values(gaps).every((gap) => gap === 0))
    return { ...vector, required, counts, gaps, satisfied, unknownCmIds }
  })
  const totalCost = rows.every((cm) => validCost(cm.cost))
    ? rows.reduce((sum, cm) => sum + cm.cost, 0)
    : null
  const totalUtility = rows.every((cm) => cm.utility !== null)
    ? rows.reduce((sum, cm) => sum + cm.utility, 0)
    : null
  return {
    rows,
    coverage,
    totalCost: number(totalCost),
    totalUtility: number(totalUtility),
    strategySatisfied: vectors.length > 0 && coverage.every((vector) => vector.satisfied),
    incompleteCmIds: rows.filter((cm) => cm.missing.length).map((cm) => cm.id),
  }
}

// A ranked, risk-first solution is the upper bound. A bounded branch-and-bound
// search then proves minimum cardinality when it completes. Costs/ratios order
// candidates, not the primary objective; an interrupted search is never labelled
// optimal. This runs in a Worker in the UI.
export function selectCountermeasures(
  vectors,
  candidates,
  strategy,
  sort = 'ratio',
  { maxNodes = 200000 } = {},
) {
  const orderedVectors = [...vectors].sort(
    (a, b) => b.riskScore - a.riskScore || a.avId.localeCompare(b.avId),
  )
  const required = orderedVectors.map((vector) => requirement(vector, strategy))
  if (!vectors.length || required.some((row) => !row.valid)) {
    return {
      status: 'invalid',
      selectedCmIds: [],
      provenMinimum: false,
      visited: 0,
      reason:
        'Select AVs and enter a non-negative integer requirement for each selected risk band.',
    }
  }
  const eligible = sortCountermeasures(
    candidates.filter((cm) => cm.eligible),
    sort,
  )
  const dimensions = []
  required.forEach((row, index) => {
    for (const type of ['total', 'P', 'R'])
      if (row[type] > 0) dimensions.push({ index, type, count: row[type] })
  })
  const contributions = eligible.map((cm) =>
    dimensions.map(({ index, type }) => {
      const effects =
        cm.mappings.find((mapping) => mapping.avId === orderedVectors[index].avId)?.effects || []
      return Number(
        effects.some((effect) =>
          type === 'total' ? ['P', 'R'].includes(effect.type) : effect.type === type,
        ),
      )
    }),
  )
  const target = dimensions.map((dimension) => dimension.count)
  const countsFor = (indices) =>
    target.map((_, d) => indices.reduce((sum, index) => sum + contributions[index][d], 0))
  const meets = (counts) => target.every((count, d) => counts[d] >= count)
  let greedy = []
  // Risk-first, top-ranked-first traversal, sharing each CM across every AV.
  for (let d = 0; d < target.length; d++) {
    for (let c = 0; c < eligible.length && countsFor(greedy)[d] < target[d]; c++) {
      if (contributions[c][d] && !greedy.includes(c)) greedy.push(c)
    }
  }
  const feasible = meets(countsFor(greedy))
  // Remove from the bottom without degrading achievable coverage even if gaps remain.
  const achieved = countsFor(greedy).map((count, d) => Math.min(count, target[d]))
  for (const index of [...greedy].sort((a, b) => b - a)) {
    const reduced = greedy.filter((c) => c !== index)
    if (countsFor(reduced).every((count, d) => count >= achieved[d])) greedy = reduced
  }
  if (!feasible)
    return {
      status: 'infeasible',
      selectedCmIds: greedy.map((i) => eligible[i].id),
      provenMinimum: false,
      visited: 0,
      reason:
        'The scored, applicable candidates cannot satisfy every requirement. Review coverage gaps and missing assessments.',
    }
  let best = greedy
  let visited = 0
  let limited = false
  const suffix = Array.from({ length: eligible.length + 1 }, () => target.map(() => 0))
  for (let i = eligible.length - 1; i >= 0; i--)
    suffix[i] = suffix[i + 1].map((count, d) => count + contributions[i][d])
  function visit(index, chosen, counts) {
    if (++visited > maxNodes) {
      limited = true
      return
    }
    if (meets(counts)) {
      if (chosen.length < best.length) best = [...chosen]
      return
    }
    const lowerBound = Math.max(0, ...target.map((count, d) => count - counts[d]))
    if (chosen.length + lowerBound >= best.length || index >= eligible.length) return
    if (target.some((count, d) => counts[d] + suffix[index][d] < count)) return
    if (contributions[index].some((value, d) => value && counts[d] < target[d])) {
      visit(
        index + 1,
        [...chosen, index],
        counts.map((count, d) => count + contributions[index][d]),
      )
    }
    if (!limited) visit(index + 1, chosen, counts)
  }
  visit(
    0,
    [],
    target.map(() => 0),
  )
  return {
    status: limited ? 'limited' : 'optimal',
    selectedCmIds: best.map((i) => eligible[i].id),
    provenMinimum: !limited,
    visited,
    reason: limited
      ? 'Search limit reached. A feasible reduced set is shown; minimum count is not proven.'
      : 'Minimum CM count verified among the scored, applicable candidates. Ranking guides the search; equal-size solutions are not optimized for total cost.',
  }
}
