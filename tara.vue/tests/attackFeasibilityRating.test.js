import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateAttackFeasibilityRating,
  classifyAttackFeasibility,
} from '../src/services/attackFeasibilityRating.js'
import { summarizeSimulationAfr } from '../src/services/simulationResult.js'
import { prepareSimulation, attachSimulationCells } from '../src/services/simulation.js'
import { createTtpFactors } from '../src/services/ttpScoring.js'

const factors = (p, s, r) => [
  { key: 'proximity', value: p },
  { key: 'Required Skills', value: s },
  { key: 'Required Resources', value: r },
]
const step = (id, p, s, r, extra = {}) => ({
  id,
  type: 'or',
  name: id,
  asset: 'Unit',
  performedAt: 0,
  ttpFactors: factors(p, s, r),
  ...extra,
})
const edges = (pairs) => pairs.map(([source, target]) => ({ source, target }))

test('AFR honors every threshold and rejects missing or out-of-range scores', () => {
  for (const [score, value, label] of [
    [1, 0, 'Very Low'],
    [1.999, 0, 'Very Low'],
    [2, 1, 'Low'],
    [2.999, 1, 'Low'],
    [3, 1.5, 'Medium'],
    [3.999, 1.5, 'Medium'],
    [4, 2, 'High'],
    [5, 2, 'High'],
  ])
    assert.deepEqual(classifyAttackFeasibility(score), { value, label })
  for (const score of [null, undefined, NaN, Infinity, -1, 0, 0.99, 5.01, '3'])
    assert.equal(classifyAttackFeasibility(score), null)
})

test('AFR averages independent factor maxima, with no CTSA totals, weights or duplicate steps', () => {
  const nodes = [step('E', 5, 1, 1), step('S', 1, 4, 1), step('T', 1, 1, 3)]
  nodes.forEach((node) => {
    node.riskScore = 1
    node.ctsaScore = 1
  })
  const before = structuredClone(nodes)
  const result = calculateAttackFeasibilityRating([
    ...nodes,
    nodes[0],
    step('D', 5, 5, 5, { type: 'defense' }),
  ])
  assert.equal(result.score, 4)
  assert.equal(result.rating, 2)
  assert.equal(result.label, 'High')
  assert.deepEqual(result.maxima, { proximity: 5, 'Required Skills': 4, 'Required Resources': 3 })
  assert.equal(result.totalSteps, 3)
  assert.equal(result.assessedSteps, 3)
  assert.equal(result.status, 'complete')
  assert.deepEqual(nodes, before)
  assert.equal(calculateAttackFeasibilityRating([step('T', 1, 2, 2)]).score, 5 / 3)
})

test('missing factors never become zero and only steps with three valid factors count', () => {
  const nodes = [
    step('E', 2, 2, 2),
    step('blank', 5, null, 5),
    step('range', 6, 5, 5),
    step('string', '5', 5, 5),
    step('fraction', 1.5, 5, 5),
    step('missing', 5, 5, 5, { ttpFactors: null, riskScore: 5, ctsaScore: 5 }),
  ]
  const result = calculateAttackFeasibilityRating(nodes)
  assert.equal(result.score, 2)
  assert.equal(result.rating, 1)
  assert.equal(result.status, 'partial')
  assert.equal(result.assessedSteps, 1)
  assert.equal(result.missingStepIds.length, 5)
  const empty = calculateAttackFeasibilityRating(nodes.slice(1))
  assert.equal(empty.score, null)
  assert.equal(empty.rating, null)
  assert.equal(empty.label, null)
  assert.equal(empty.status, 'unavailable')
  assert.equal(calculateAttackFeasibilityRating([]).rating, null)
})

test('Target summaries keep AND support and performed alternatives while excluding unrelated and late steps', () => {
  const performedNodes = [
    step('E', 1, 2, 3),
    step('P', 4, 1, 2),
    step('S', 2, 5, 1),
    step('G', 1, 1, 1, { type: 'and' }),
    step('T', 3, 2, 4),
    step('E2', 1, 1, 1),
    step('T2', 1, 1, 1),
    step('outside', 5, 5, 5),
    step('before-entry', 5, 5, 5),
    step('late', 5, 5, 5, { performedAt: 2 }),
    step('defense', 5, 5, 5, { type: 'defense' }),
  ]
  const tree = {
    nodes: performedNodes,
    edges: [],
    performedNodes,
    performedEdges: edges([
      ['E', 'P'],
      ['E', 'S'],
      ['P', 'G'],
      ['S', 'G'],
      ['G', 'P'],
      ['G', 'T'],
      ['E2', 'T2'],
      ['E', 'outside'],
      ['before-entry', 'E'],
      ['late', 'T'],
      ['defense', 'G'],
    ]),
    entryIds: ['E', 'E2'],
    targetIds: ['T', 'T2', 'unreached'],
    targets: [
      { ...performedNodes.find((node) => node.id === 'T'), reached: true },
      { ...performedNodes.find((node) => node.id === 'T2'), reached: true },
      { id: 'unreached', reached: false },
    ],
  }
  const before = structuredClone(tree)
  const [first, second, unreached] = summarizeSimulationAfr(tree)
  assert.deepEqual(new Set(first.stepIds), new Set(['E', 'P', 'S', 'G', 'T']))
  assert.deepEqual(first.entryIds, ['E'])
  assert.equal(first.score, 13 / 3)
  assert.equal(first.rating, 2)
  assert.equal(second.score, 1)
  assert.equal(second.rating, 0)
  assert.equal(second.label, 'Very Low')
  assert.equal(unreached.status, 'not-reached')
  assert.equal(unreached.rating, null)
  assert.deepEqual(tree, before)
  const legacy = {
    ...tree,
    performedNodes: undefined,
    edges: tree.performedEdges,
    performedEdges: undefined,
  }
  assert.equal(summarizeSimulationAfr(legacy)[0].score, first.score)
  assert.equal(summarizeSimulationAfr({ ...tree, entryIds: [] })[0].rating, null)
  const sameEndpoint = { ...tree, entryIds: ['T'] }
  assert.deepEqual(summarizeSimulationAfr(sameEndpoint)[0].stepIds, ['T'])
})

test('simulation attaches raw factors for the exact instance, schema and declaration, preserving blank assessments', () => {
  const languageGraph = {
    metadata: { id: 'afr', version: '1' },
    assets: [
      {
        name: 'Parent',
        attack_steps: { entry: { type: 'or' }, target: { type: 'or' }, support: { type: 'or' } },
      },
      {
        name: 'Child',
        super_asset: 'Parent',
        attack_steps: { support: { type: 'or', overrides: true } },
      },
    ],
  }
  const completeFactors = (p, s, r) => createTtpFactors(factors(p, s, r))
  const snapshot = {
    vertices: ['a', 'b'].map((id, index) => ({
      id,
      label: 'Unit',
      assetType: 'Child',
      attackEndpoints: {
        active: {
          entry: [{ name: 'entry', attackStepId: 'Catalog:Parent.entry' }],
          target: [{ name: 'target', attackStepId: 'Catalog:Parent.target' }],
        },
      },
      threatAssessments: {
        active: {
          version: 2,
          steps: {
            'Catalog:Parent.entry': completeFactors(index ? 1 : 4, 2, 3),
            'Catalog:Parent.target': completeFactors(null, null, null),
            'Catalog:Parent.support': completeFactors(5, 5, 5),
          },
        },
        other: { version: 2, steps: { 'Catalog:Parent.entry': completeFactors(5, 5, 5) } },
      },
    })),
    edges: [],
  }
  const catalogRows = ['entry', 'target', 'support'].map((name) => ({
    asset: 'Child',
    declared_asset: 'Parent',
    name,
    ctsa: { proximity: 5, required_skills: 5, required_resources: 5, ctsa_score: 5 },
  }))
  const before = structuredClone(snapshot)
  const prepared = prepareSimulation({
    snapshot,
    languageGraph,
    schema: 'active',
    attackerType: 'BreadthFirstAttacker',
    catalogRows,
  })
  assert.equal(prepared.ttpAssessment({ asset: 'Unit', name: 'entry' }).source, 'assessment')
  assert.equal(prepared.ttpAssessment({ asset: 'Unit', name: 'entry' }).factors[0].value, 4)
  assert.equal(prepared.ttpAssessment({ asset: 'Unit:2', name: 'entry' }).factors[0].value, 1)
  assert.equal(prepared.ttpAssessment({ asset: 'Unit', name: 'target' }).factors[0].value, null)
  assert.equal(prepared.ttpAssessment({ asset: 'Unit', name: 'support' }), null)
  assert.equal(prepared.ttpAssessment({ asset: 'missing', name: 'entry' }), null)
  const node = { id: 'E', asset: 'Unit', name: 'entry', type: 'or' }
  const result = attachSimulationCells(
    { tree: { nodes: [node], performedNodes: [{ ...node, asset: 'Unit:2' }], targets: [node] } },
    prepared.cellIds,
    prepared.riskScore,
    prepared.ctsaScore,
    prepared.ttpAssessment,
  )
  assert.equal(result.tree.nodes[0].ttpFactorsSource, 'assessment')
  assert.equal(result.tree.targets[0].ttpFactors[0].value, 4)
  assert.equal(result.tree.performedNodes[0].ttpFactors[0].value, 1)
  // Other nine CTSA ratings can remain blank; AFR only needs its three inputs.
  assert.equal(result.tree.nodes[0].riskAssessed, false)
  assert.equal(calculateAttackFeasibilityRating(result.tree.nodes).score, 3)
  assert.deepEqual(snapshot, before)
  const unassessed = prepareSimulation({
    snapshot: {
      ...snapshot,
      vertices: snapshot.vertices.map(({ threatAssessments: _saved, ...asset }) => asset),
    },
    languageGraph,
    schema: 'active',
    attackerType: 'BreadthFirstAttacker',
    catalogRows,
  })
  const catalog = unassessed.ttpAssessment({ asset: 'Unit', name: 'entry' })
  assert.equal(catalog.source, 'catalog')
  assert.equal(catalog.factors[0].value, 5)
  assert.equal(unassessed.ttpAssessment({ asset: 'Unit', name: 'support' }), null)
})
