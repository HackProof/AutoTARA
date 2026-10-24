import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  TTP_FACTORS,
  assessAssetThreats,
  calculateTtpScore,
  createCtsaDraft,
  createCtsaMetadata,
  createTtpFactors,
  createTtpFactorsFromCtsa,
  createTtpWeights,
  databaseCtsaScore,
  normalizeCtsaAssessment,
  riskScoreClass,
  riskScoreLabel,
  serializeCtsaDraft,
  validTtpFactors,
  validTtpWeights,
} from '../src/services/ttpScoring.js'

const threats = [
  {
    attack_step_id: 'VehicleLang:ECU.changeOperationMode',
    name: 'changeOperationMode',
    techniques: [{ id: 'T0858' }],
  },
  { attack_step_id: 'VehicleLang:ECU.connect', name: 'connect', techniques: [] },
]

test('DB CTSA columns map to all twelve TTP ratings without changing catalog data', () => {
  const ctsa = {
    proximity: 1,
    locality: 2,
    recovery_time: 3,
    restoration_costs: 4,
    impact_confidentiality: 5,
    impact_integrity: 1,
    impact_availability: 2,
    prior_use: 3,
    required_skills: 4,
    required_resources: 5,
    stealth: 1,
    attribution: 2,
    ctsa_score: 4.7,
  }
  const original = structuredClone(ctsa)
  const factors = createTtpFactorsFromCtsa(ctsa)
  assert.equal(validTtpFactors(factors), true)
  assert.deepEqual(
    factors.map(({ key, value }) => [key, value]),
    [
      ['proximity', 1],
      ['locality', 2],
      ['recoveryTime', 3],
      ['restorationCosts', 4],
      ['Impact_C', 5],
      ['Impact_I', 1],
      ['Impact_A', 2],
      ['Prior Use', 3],
      ['Required Skills', 4],
      ['Required Resources', 5],
      ['Stealth', 1],
      ['Attribution', 2],
    ],
  )
  assert.equal(databaseCtsaScore(ctsa), 4.7)
  assert.equal(calculateTtpScore(factors), 2.8)
  factors[0].value = 5
  assert.deepEqual(ctsa, original)
})

test('missing, partial and invalid DB CTSA inputs stay blank without inferring ratings from the score', () => {
  for (const ctsa of [undefined, null, {}, { ctsa_score: 4 }]) {
    const factors = createTtpFactorsFromCtsa(ctsa)
    assert.ok(factors.every(({ value }) => value === null))
    assert.equal(calculateTtpScore(factors), null)
  }
  const partial = createTtpFactorsFromCtsa({ proximity: 4, recovery_time: 2 })
  assert.equal(partial[0].value, 4)
  assert.equal(partial[2].value, 2)
  assert.equal(calculateTtpScore(partial), null)
  for (const value of [undefined, null, '', '3', 0, 6, 2.5, NaN, Infinity, true]) {
    assert.equal(createTtpFactorsFromCtsa({ proximity: value })[0].value, null)
  }
  for (const value of [undefined, null, '', '3', 0, 6, NaN, Infinity, true]) {
    assert.equal(databaseCtsaScore({ ctsa_score: value }), null)
  }
  for (const value of [1, 2.6, 5]) {
    assert.equal(databaseCtsaScore({ ctsa_score: value }), value)
  }
})

test('TTP scores include Recovery Time between Locality and Restoration Costs and require all twelve values', () => {
  const factors = createTtpFactors()
  assert.equal(factors.length, 12)
  assert.deepEqual(
    TTP_FACTORS.slice(0, 4).map((factor) => factor.label),
    ['Proximity', 'Locality', 'Recovery Time', 'Restoration Costs'],
  )
  assert.equal(validTtpFactors(factors), true)
  assert.equal(calculateTtpScore(factors), null)
  assert.equal(riskScoreLabel(null), '-')
  for (let index = 0; index < factors.length - 1; index++) factors[index].value = 3
  assert.equal(calculateTtpScore(factors), null)
  factors.at(-1).value = 3
  assert.equal(calculateTtpScore(factors), 3)
  assert.equal(riskScoreLabel(3), '3.0')
})

test('TTP weighted averages use entered values directly and allow zero-weight factors', () => {
  const factors = createTtpFactors()
  const weights = createTtpWeights()
  const values = [1, 2, 4, 3, 4, 5, 1, 2, 5, 4, 3, 2]
  factors.forEach((factor, index) => {
    factor.value = values[index]
  })
  assert.equal(calculateTtpScore(factors, weights), 3)
  weights.proximity = 0
  weights['Required Skills'] = 0.5
  assert.equal(calculateTtpScore(factors, weights), 3.7)
  for (const factor of TTP_FACTORS) weights[factor.key] = 0
  assert.equal(validTtpWeights(weights), false)
  assert.equal(calculateTtpScore(factors, weights), null)
  assert.equal(riskScoreLabel(null), '-')
  assert.equal(riskScoreClass(null), 'bg-light text-secondary border')
})

test('weighted averages stay in the 1–5 range with default, adjusted and very large weights', () => {
  const defaults = createTtpWeights()
  assert.equal(
    Math.round(Object.values(defaults).reduce((sum, weight) => sum + weight, 0) * 10) / 10,
    1.2,
  )
  const configurations = [
    defaults,
    Object.fromEntries(TTP_FACTORS.map(({ key }) => [key, 2])),
    Object.fromEntries(TTP_FACTORS.map(({ key }) => [key, key === 'recoveryTime' ? 10 : 0])),
    Object.fromEntries(TTP_FACTORS.map(({ key }) => [key, Number.MAX_VALUE])),
    Object.fromEntries(TTP_FACTORS.map(({ key }) => [key, Number.MIN_VALUE])),
  ]
  for (const weights of configurations) {
    assert.equal(validTtpWeights(weights), true)
    for (const value of [1, 3, 5]) {
      const factors = createTtpFactors().map((factor) => ({ ...factor, value }))
      assert.equal(calculateTtpScore(factors, weights), value)
    }
    const mixed = createTtpFactors().map((factor, index) => ({ ...factor, value: (index % 5) + 1 }))
    const score = calculateTtpScore(mixed, weights)
    assert.ok(Number.isFinite(score) && score >= 1 && score <= 5)
  }
})

test('multiplying every weight by a common scale preserves the risk score and weights over one persist', () => {
  const draft = createCtsaDraft(threats)
  for (const threat of draft.threats) for (const factor of threat.factors) factor.value = 1
  draft.threats[0].factors[0].value = 5
  draft.weights.proximity = 2
  const expected = calculateTtpScore(draft.threats[0].factors, draft.weights)
  assert.equal(expected, 3.6)
  for (const scale of [1e-300, 0.1, 1, 10, 1e100]) {
    const scaled = Object.fromEntries(
      TTP_FACTORS.map(({ key }) => [key, draft.weights[key] * scale]),
    )
    assert.equal(calculateTtpScore(draft.threats[0].factors, scaled), expected)
  }
  const saved = serializeCtsaDraft(draft)
  assert.equal(saved.weights.proximity, 2)
  assert.equal(createCtsaDraft(assessAssetThreats(threats, saved), saved).weights.proximity, 2)
  assert.equal(assessAssetThreats(threats, saved)[0].riskScore, expected)
})

test('all-zero asset weights cannot be calculated or saved, including previously saved evaluations', () => {
  const draft = createCtsaDraft(threats)
  for (const threat of draft.threats) for (const factor of threat.factors) factor.value = 3
  const saved = serializeCtsaDraft(draft)
  for (const { key } of TTP_FACTORS) {
    draft.weights[key] = 0
    saved.weights[key] = 0
  }
  assert.equal(validTtpWeights(draft.weights), false)
  assert.equal(calculateTtpScore(draft.threats[0].factors, draft.weights), null)
  assert.throws(() => serializeCtsaDraft(draft), /total greater than 0/)
  assert.ok(assessAssetThreats(threats, saved).every((threat) => threat.riskScore === null))
  const restored = createCtsaDraft(assessAssetThreats(threats, saved), saved)
  assert.ok(Object.values(restored.weights).every((weight) => weight === 0))
  assert.throws(() => serializeCtsaDraft(restored), /total greater than 0/)
})

test('raising any TTP factor never lowers the rounded average, including saved evaluations', () => {
  const weights = createTtpWeights()
  for (const { key } of TTP_FACTORS) {
    const factors = createTtpFactors().map((factor) => ({ ...factor, value: 1 }))
    const target = factors.find((factor) => factor.key === key)
    let previous = calculateTtpScore(factors, weights)
    const baseline = previous
    for (let value = 2; value <= 5; value++) {
      target.value = value
      const next = calculateTtpScore(factors, weights)
      assert.ok(next >= previous, `${key} must not lower the score when its value increases`)
      const draft = createCtsaDraft(threats)
      draft.threats[0].factors = factors
      const restored = assessAssetThreats(threats, serializeCtsaDraft(draft))
      assert.equal(restored[0].riskScore, next)
      previous = next
    }
    assert.ok(previous > baseline, `${key} must contribute positively to the score`)
  }
})

test('draft edits and cancellation cannot mutate saved values or other asset instances', () => {
  const original = assessAssetThreats(threats)
  const firstDraft = createCtsaDraft(original)
  firstDraft.threats.forEach((threat) =>
    threat.factors.forEach((factor) => {
      factor.value = 3
    }),
  )
  firstDraft.threats[1].factors[0].value = 5
  assert.equal(original[0].riskScore, null)
  assert.ok(original[0].ttp_score.every((factor) => factor.value === null))
  const saved = serializeCtsaDraft(firstDraft)
  const restored = assessAssetThreats(threats, saved)
  assert.equal(restored[0].riskScore, 3)
  assert.equal(restored[1].riskScore, 3.2)
  const secondInstance = assessAssetThreats(threats)
  assert.ok(secondInstance.every((threat) => threat.riskScore === null))
  const cancelled = createCtsaDraft(restored, saved)
  cancelled.threats[0].factors[0].value = 1
  cancelled.weights.proximity = 0.8
  assert.equal(assessAssetThreats(threats, saved)[0].riskScore, 3)
  assert.equal(createCtsaDraft(restored, saved).threats[0].factors[0].value, 3)
  assert.equal(saved.weights.proximity, 0.1)
})

test('invalid factors are rejected atomically while partial assessments remain editable', () => {
  for (const [property, value] of [
    ['value', 0],
    ['value', 6],
    ['value', 1.5],
    ['value', '3'],
  ]) {
    const draft = createCtsaDraft(threats)
    draft.threats[1].factors[2][property] = value
    assert.equal(calculateTtpScore(draft.threats[1].factors, draft.weights), null)
    assert.throws(() => serializeCtsaDraft(draft), /unique attack step/)
  }
  const partial = createCtsaDraft(threats)
  partial.threats[0].factors[0].value = 4
  const saved = serializeCtsaDraft(partial)
  const reopened = assessAssetThreats(threats, saved)
  assert.equal(reopened[0].ttp_score[0].value, 4)
  assert.equal(reopened[0].riskScore, null)
  assert.throws(
    () => serializeCtsaDraft({ ...partial, threats: [partial.threats[0], partial.threats[0]] }),
    /unique attack step/,
  )
})

test('malformed imported factors cannot become risk scores', () => {
  const factors = createTtpFactors([null, false, { key: 'proximity', value: 99, weight: -1 }])
  assert.equal(factors[0].value, null)
  assert.ok(!Object.hasOwn(factors[0], 'weight'))
  assert.equal(calculateTtpScore(factors), null)
  assert.equal(calculateTtpScore([]), null)
  assert.equal(calculateTtpScore(null), null)
})

test('one asset weight change recalculates all threats and is stored once per asset', () => {
  const draft = createCtsaDraft(threats)
  for (const threat of draft.threats) for (const factor of threat.factors) factor.value = 3
  draft.threats[1].factors[0].value = 5
  draft.weights.proximity = 0.4
  const saved = serializeCtsaDraft(draft)
  assert.deepEqual(
    assessAssetThreats(threats, saved).map((threat) => threat.riskScore),
    [3, 3.5],
  )
  assert.equal(saved.weights.proximity, 0.4)
  assert.equal(saved.scoringMethod, 'weighted-average')
  assert.deepEqual(saved.scoreRange, [1, 5])
  assert.equal(saved.scorePrecision, 1)
  assert.deepEqual(saved.riskScores, {
    [threats[0].attack_step_id]: 3,
    [threats[1].attack_step_id]: 3.5,
  })
  assert.equal(Object.keys(saved.weights).length, 12)
  assert.ok(
    Object.values(saved.steps).every((factors) =>
      factors.every((factor) => !Object.hasOwn(factor, 'weight')),
    ),
  )
  const reopened = createCtsaDraft(assessAssetThreats(threats, saved), saved)
  assert.deepEqual(reopened.weights, draft.weights)
  assert.deepEqual(
    assessAssetThreats(threats).map((threat) => threat.riskScore),
    [null, null],
  )
})

test('invalid shared weights cannot be saved or used to calculate risk scores', () => {
  for (const value of [-1, '', NaN, Infinity, null, undefined]) {
    const draft = createCtsaDraft(threats)
    for (const threat of draft.threats) for (const factor of threat.factors) factor.value = 3
    draft.weights.recoveryTime = value
    assert.equal(validTtpWeights(draft.weights), false)
    assert.equal(calculateTtpScore(draft.threats[0].factors, draft.weights), null)
    assert.throws(() => serializeCtsaDraft(draft), /Asset weights/)
  }
})

test('old per-step evaluations keep their values and uniform weights with Recovery Time unassessed', () => {
  const legacyFactors = createTtpFactors()
    .filter((factor) => factor.key !== 'recoveryTime')
    .map((factor) => ({ ...factor, value: 3, weight: factor.key === 'proximity' ? 0.2 : 0.1 }))
  const legacy = Object.fromEntries(
    threats.map((threat) => [threat.attack_step_id, structuredClone(legacyFactors)]),
  )
  const normalized = normalizeCtsaAssessment(legacy)
  assert.equal(normalized.weights.proximity, 0.2)
  assert.equal(normalized.weights.recoveryTime, 0.1)
  assert.deepEqual(normalized.weightConflicts, [])
  const draft = createCtsaDraft(assessAssetThreats(threats, legacy), legacy)
  assert.ok(
    draft.threats.every(
      (threat) => threat.factors[2].key === 'recoveryTime' && threat.factors[2].value === null,
    ),
  )
  assert.ok(assessAssetThreats(threats, legacy).every((threat) => threat.riskScore === null))
  for (const threat of draft.threats) threat.factors[2].value = 3
  assert.deepEqual(
    assessAssetThreats(threats, serializeCtsaDraft(draft)).map((threat) => threat.riskScore),
    [3, 3],
  )
  legacy[threats[1].attack_step_id][0].weight = 0.7
  const conflicting = normalizeCtsaAssessment(legacy)
  assert.equal(conflicting.weights.proximity, 0.1)
  assert.deepEqual(conflicting.weightConflicts, ['proximity'])
  assert.equal(legacy[threats[1].attack_step_id][0].weight, 0.7)
})

test('CTSA metadata snapshots calculated scores and null partial scores without trusting cached results', () => {
  const draft = createCtsaDraft(threats)
  for (const factor of draft.threats[0].factors) factor.value = 4
  draft.threats[1].factors[0].value = 2
  const saved = serializeCtsaDraft(draft)
  assert.equal(saved.riskScores[threats[0].attack_step_id], 4)
  assert.equal(saved.riskScores[threats[1].attack_step_id], null)
  saved.riskScores[threats[0].attack_step_id] = 99
  saved.riskScores[threats[1].attack_step_id] = 5
  const refreshed = createCtsaMetadata(saved)
  assert.equal(refreshed.riskScores[threats[0].attack_step_id], 4)
  assert.equal(refreshed.riskScores[threats[1].attack_step_id], null)
  assert.deepEqual(refreshed.steps, saved.steps)
  assert.deepEqual(refreshed.weights, saved.weights)
  assert.deepEqual(
    assessAssetThreats(threats, saved).map((threat) => threat.riskScore),
    [4, null],
  )
})
