import assert from 'node:assert/strict'
import test from 'node:test'
import { DOMParser } from '@xmldom/xmldom'
import {
  createCrraDraft,
  evaluateCountermeasures,
  createSolutionTable,
  selectCountermeasures,
  sortCountermeasures,
  effectLabel,
  riskBand,
} from '../src/services/crra.js'
import { readCrraAssessments, updateCrraAssessment } from '../src/services/drawio/crraMetadata.js'
import { prepareMalExport, serializeMalModel } from '../src/services/malModel.js'
import { parseMalModel } from '../src/services/malModelImport.js'
const vector = (avId, riskScore = 4) => ({ avId, riskScore, attackVector: avId, cells: [] })
const mapping = (avId, ...types) => ({
  avId,
  effects: types.map((type) => ({ type, level: 'High' })),
})
const cm = (id, cost, ...mappings) => ({ id, name: id, cost, mappings })
const all = [vector('T0001'), vector('T0002', 3), vector('T0003', 2)]
const configured = () =>
  createCrraDraft({
    weights: { P: 2, R: 1 },
    strategy: { high: { total: 1 }, moderate: { total: 1 }, low: { total: 1 } },
  })
const evaluate = (countermeasures, vectors = all, draft = configured()) =>
  evaluateCountermeasures(vectors, { countermeasures }, draft)

test('new and legacy drafts use unit P/R weights and preserve explicit weights including zero', () => {
  for (const saved of [undefined, null, {}, { weights: { P: null, R: '' } }]) {
    const draft = createCrraDraft(saved)
    assert.deepEqual(draft.weights, { P: 1, R: 1 })
    const [row] = evaluate([cm('M0001', 2, mapping('T0001', 'P', 'R'))], all, draft)
    assert.equal(row.utility, 2)
    assert.equal(row.ratio, 100)
    assert.equal(row.eligible, true)
  }
  assert.deepEqual(createCrraDraft({ weights: { P: 0, R: 2 } }).weights, { P: 0, R: 2 })
  assert.deepEqual(createCrraDraft({ weights: { P: 3 } }).weights, { P: 3, R: 1 })
  const draft = createCrraDraft()
  draft.weights = { P: '', R: null }
  assert.deepEqual(evaluate([cm('M0001', 2, mapping('T0001', 'P', 'R'))], all, draft)[0].weights, {
    P: 1,
    R: 1,
  })
})

test('utility counts unique selected AV/type pairs, keeps confidence, excludes D and double coverage', () => {
  const catalog = [
    cm(
      'M0001',
      4,
      mapping('T0001', 'P', 'P', 'R'),
      mapping('T0002', 'P', 'D'),
      mapping('T0003', 'R'),
      mapping('T9999', 'P'),
      mapping('T0001', 'P', 'R'),
    ),
  ]
  const before = structuredClone(catalog)
  const [row] = evaluate(catalog)
  assert.deepEqual(row.counts, { P: 2, R: 2 })
  assert.equal(row.utility, 6)
  assert.equal(row.ratio, 150)
  assert.equal(row.mappings.length, 3)
  assert.equal(effectLabel(row.mappings[0]), 'P (High) / R (High)')
  assert.equal(row.eligible, true)
  assert.deepEqual(catalog, before)
  assert.equal(evaluate(catalog, [all[1]])[0].utility, 2)
  assert.deepEqual(
    createSolutionTable(all, [row], ['M0001'], configured().strategy).coverage[0].counts,
    { total: 1, P: 1, R: 1 },
  )
})

test('unknown classification/cost stay missing, invalid weights/cost are rejected, no-effect is zero utility', () => {
  for (const cost of [null, undefined, 0, -1, Infinity, NaN, '2']) {
    const [row] = evaluate([cm('M0001', cost, mapping('T0001', 'P'))])
    assert.equal(row.utility, 2)
    assert.equal(row.ratio, null)
    assert.equal(row.eligible, false)
  }
  const [unknown] = evaluate([cm('M0001', 2, { avId: 'T0001', effects: null })])
  assert.equal(unknown.utility, null)
  assert.equal(unknown.ratio, null)
  assert.equal(effectLabel(unknown.mappings[0]), '?')
  assert.match(unknown.missing.join(' '), /classification/)
  const invalidWeights = createCrraDraft({ weights: { P: -1, R: -1 } })
  const [invalid] = evaluate([cm('M0001', 2, mapping('T0001', 'P'))], all, invalidWeights)
  assert.equal(invalid.utility, null)
  assert.match(invalid.missing.join(' '), /P weight.*R weight/)
  const [none] = evaluate([cm('M0001', 2, mapping('T0001'))])
  assert.equal(none.utility, 0)
  assert.equal(none.ratio, 0)
  assert.equal(effectLabel(none.mappings[0]), 'None')
})

test('saved overrides take precedence over catalog settings and retain assessment provenance', () => {
  const catalog = {
    weights: { P: 3, R: 2 },
    countermeasures: [cm('M0001', 5, mapping('T0001', 'P'))],
  }
  const draft = createCrraDraft()
  draft.weights = { P: null, R: null }
  assert.equal(evaluateCountermeasures(all, catalog, draft)[0].utility, 3)
  draft.weights.P = 0
  draft.overrides.M0001 = {
    cost: 2,
    costBasis: 'Lifecycle estimate',
    mappings: {
      T0001: { effects: [{ type: 'R', level: 'Medium' }], basis: 'Reviewed by assessor' },
    },
  }
  const [row] = evaluateCountermeasures(all, catalog, draft)
  assert.equal(row.utility, 2)
  assert.equal(row.ratio, 100)
  assert.equal(row.costBasis, 'Lifecycle estimate')
  assert.equal(row.mappings[0].basis, 'Reviewed by assessor')
  assert.equal(row.mappings[0].source, 'Assessment override')
  draft.overrides.M0001.cost = null
  assert.equal(evaluateCountermeasures(all, catalog, draft)[0].cost, null)
  draft.overrides.M0001.excluded = true
  assert.equal(evaluateCountermeasures(all, catalog, draft)[0].eligible, false)
})

test('numeric ratio/utility descending and cost ascending place missing values last', () => {
  const rows = [
    { id: 'A', ratio: 9, utility: 3, cost: 10 },
    { id: 'B', ratio: 100, utility: 2, cost: 2 },
    { id: 'C', ratio: null, utility: null, cost: null },
  ]
  assert.deepEqual(
    sortCountermeasures(rows).map((row) => row.id),
    ['B', 'A', 'C'],
  )
  assert.deepEqual(
    sortCountermeasures(rows, 'utility').map((row) => row.id),
    ['A', 'B', 'C'],
  )
  assert.deepEqual(
    sortCountermeasures(rows, 'cost').map((row) => row.id),
    ['B', 'A', 'C'],
  )
  assert.equal(rows[0].id, 'A')
})

test('minimum search improves greedy set, reusing CMs across AVs', () => {
  const vectors = ['1', '2', '3', '4', '5', '6'].map((n) => vector(`T000${n}`))
  const rows = evaluate(
    [
      cm('A', 1, ...vectors.slice(0, 4).map((av) => mapping(av.avId, 'P'))),
      cm('B', 3, ...[0, 1, 4].map((i) => mapping(vectors[i].avId, 'P'))),
      cm('C', 3, ...[2, 3, 5].map((i) => mapping(vectors[i].avId, 'P'))),
      cm('D', 1, mapping('T0005', 'P')),
      cm('E', 1, mapping('T0006', 'P')),
    ],
    vectors,
  )
  const result = selectCountermeasures(vectors, rows, configured().strategy)
  assert.equal(result.status, 'optimal')
  assert.equal(result.provenMinimum, true)
  assert.deepEqual(new Set(result.selectedCmIds), new Set(['B', 'C']))
  const solution = createSolutionTable(vectors, rows, result.selectedCmIds, configured().strategy)
  assert.equal(solution.strategySatisfied, true)
  assert.equal(solution.totalCost, 6)
})

test('P/R and total constraints count distinct CMs; incomplete candidates are excluded from auto selection', () => {
  const vectors = [all[0]],
    draft = configured()
  draft.strategy.high = { total: 2, P: 1, R: 1 }
  const rows = evaluate(
    [
      cm('A', 1, mapping('T0001', 'P', 'R')),
      cm('B', 2, mapping('T0001', 'P')),
      cm('C', 3, mapping('T0001', 'D')),
    ],
    vectors,
    draft,
  )
  const result = selectCountermeasures(vectors, rows, draft.strategy)
  assert.deepEqual(new Set(result.selectedCmIds), new Set(['A', 'B']))
  const impossible = selectCountermeasures(vectors, rows.slice(0, 1), draft.strategy)
  assert.equal(impossible.status, 'infeasible')
  assert.equal(impossible.provenMinimum, false)
  assert.deepEqual(
    createSolutionTable(vectors, rows, impossible.selectedCmIds, draft.strategy).coverage[0].gaps,
    { total: 1, P: 0, R: 0 },
  )
  rows[1].eligible = false
  assert.equal(selectCountermeasures(vectors, rows, draft.strategy).status, 'infeasible')
})

test('solution reports unmapped gaps, unknown effects and missing aggregate cost', () => {
  const rows = evaluate([cm('A', null, { avId: 'T0001', effects: null })])
  const table = createSolutionTable(all, rows, ['A', 'A'], configured().strategy)
  assert.equal(table.rows.length, 1)
  assert.equal(table.totalCost, null)
  assert.equal(table.strategySatisfied, false)
  assert.deepEqual(table.coverage[0].unknownCmIds, ['A'])
  assert.deepEqual(table.coverage[2].gaps, { total: 1, P: 0, R: 0 })
  assert.deepEqual(table.incompleteCmIds, ['A'])
})

test('strategy validation, risk thresholds, no-op requirements and search limits are explicit', () => {
  assert.deepEqual([1, 2.4, 2.5, 3.9, 4, 5].map(riskBand), [
    'low',
    'low',
    'moderate',
    'moderate',
    'high',
    'high',
  ])
  const rows = evaluate([cm('A', 1, mapping('T0001', 'P'))])
  for (const total of [null, undefined, -1, 1.2, '2', Infinity])
    assert.equal(selectCountermeasures([all[0]], rows, { high: { total } }).status, 'invalid')
  assert.equal(selectCountermeasures([], [], {}).status, 'invalid')
  assert.deepEqual(
    selectCountermeasures([all[0]], [], { high: { total: 0, P: '', R: '' } }).selectedCmIds,
    [],
  )
  const limited = selectCountermeasures([all[0]], rows, configured().strategy, 'ratio', {
    maxNodes: 0,
  })
  assert.equal(limited.status, 'limited')
  assert.equal(limited.provenMinimum, false)
  assert.equal(
    createSolutionTable([all[0]], rows, limited.selectedCmIds, configured().strategy)
      .strategySatisfied,
    true,
  )
})

test('exact solver agrees with exhaustive enumeration on 60 deterministic multi-cover fixtures', () => {
  let seed = 12
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  for (let trial = 0; trial < 60; trial++) {
    const draft = configured()
    draft.strategy.high = {
      total: 1 + Math.floor(random() * 2),
      P: Math.floor(random() * 2),
      R: Math.floor(random() * 2),
    }
    const vectors = [vector('T0001'), vector('T0002'), vector('T0003')]
    const rows = evaluate(
      Array.from({ length: 7 }, (_, i) =>
        cm(
          `M${i}`,
          1 + Math.floor(random() * 5),
          ...vectors
            .filter(() => random() > 0.3)
            .map((av) => mapping(av.avId, random() > 0.5 ? 'P' : 'R')),
        ),
      ),
      vectors,
      draft,
    )
    let minimum = Infinity
    for (let mask = 0; mask < 2 ** rows.length; mask++) {
      const selected = rows.filter((_, i) => mask & (1 << i)).map((row) => row.id)
      if (
        selected.length < minimum &&
        createSolutionTable(vectors, rows, selected, draft.strategy).strategySatisfied
      )
        minimum = selected.length
    }
    const result = selectCountermeasures(vectors, rows, draft.strategy)
    if (minimum === Infinity) assert.equal(result.status, 'infeasible')
    else {
      assert.equal(result.status, 'optimal')
      assert.equal(result.selectedCmIds.length, minimum)
    }
  }
})

test('metadata isolates schemas, clones inputs and rejects stale-schema writes', () => {
  let value = new DOMParser().parseFromString(
    '<object taraCatalogSchema="active"/>',
    'text/xml',
  ).documentElement
  const model = {
    getRoot: () => ({}),
    getValue: () => value,
    setValue: (_, next) => {
      value = next
    },
  }
  const draft = configured()
  draft.selectedAvIds = ['T0001']
  updateCrraAssessment(model, {}, 'active', draft)
  draft.weights.P = 999
  assert.equal(readCrraAssessments(model).active.weights.P, 2)
  assert.throws(() => updateCrraAssessment(model, {}, 'other', draft), /changed/)
  assert.equal(readCrraAssessments(model).other, undefined)
  value.setAttribute('taraCrraAssessments', 'bad json')
  assert.deepEqual(readCrraAssessments(model), {})
})

test('MAL YAML preserves CRRA inputs/selections without cached scores', () => {
  const draft = configured()
  draft.selectedAvIds = ['T0001']
  draft.selectedCmIds = ['M0001']
  const snapshot = {
    vertices: [{ id: 'a', label: 'ECU', assetType: 'ECU', kind: 'asset' }],
    edges: [],
    metadata: { threatCatalogSchema: 'active', crra: { active: draft } },
  }
  const language = {
    metadata: { id: 'test', version: '1' },
    assets: [{ name: 'ECU' }],
    associations: [],
  }
  const plan = prepareMalExport(snapshot, language)
  assert.deepEqual(plan.errors, [])
  const imported = parseMalModel(serializeMalModel(plan), language)
  assert.deepEqual(imported.metadata.crra, { active: draft })
  assert.equal(imported.metadata.crra.active.utility, undefined)
})

test('DB CM defaults retain classification provenance; assessment overrides remain authoritative', () => {
  const catalog = {
    countermeasures: [
      cm('M0818', null, {
        avId: 'T0001',
        effects: [
          { type: 'P', level: 'H' },
          { type: 'D', level: 'H' },
          { type: 'R', level: 'H' },
        ],
        basis: 'Validate inputs, alert and enter a safe state',
        source: 'CM default (AutoTARA classification)',
        effectScope: 'countermeasure',
      }),
    ],
  }
  const draft = configured()
  const [row] = evaluateCountermeasures([all[0]], catalog, draft)
  assert.deepEqual(row.counts, { P: 1, R: 1 })
  assert.equal(row.utility, 3)
  assert.equal(row.ratio, null)
  assert.equal(row.cost, null)
  assert.equal(effectLabel(row.mappings[0]), 'P (H) / D (H) / R (H)')
  assert.equal(row.mappings[0].source, 'CM default (AutoTARA classification)')
  assert.equal(row.mappings[0].effectScope, 'countermeasure')
  assert.equal(row.mappings[0].basis, 'Validate inputs, alert and enter a safe state')
  draft.overrides.M0818 = {
    mappings: { T0001: { effects: [{ type: 'R', level: 'Low' }], basis: 'Instance review' } },
  }
  const [override] = evaluateCountermeasures([all[0]], catalog, draft)
  assert.deepEqual(override.counts, { P: 0, R: 1 })
  assert.equal(override.mappings[0].source, 'Assessment override')
  assert.equal(override.mappings[0].effectScope, 'assessment')
  assert.equal(override.mappings[0].basis, 'Instance review')
  assert.equal(effectLabel(override.mappings[0]), 'R (Low)')
  draft.overrides.M0818.mappings.T0001.effects = null
  assert.equal(evaluateCountermeasures([all[0]], catalog, draft)[0].utility, null)
})
