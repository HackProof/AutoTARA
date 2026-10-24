import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeAttackFeasibility, conditionStatus } from '../src/services/attackFeasibility.js'
import { findAttackPaths } from '../src/services/attackPaths.js'
import { summarizeAttackPaths } from '../src/services/attackPathMetrics.js'

const graph = (nodes, edges, entryIds = ['E'], targetIds = ['T']) => ({
  nodes: Object.entries(nodes).map(([id, value]) => ({
    id,
    riskScore: 3,
    ...(typeof value === 'string' ? { type: value } : value),
  })),
  edges: edges.map(([source, target]) => ({ source, target })),
  entryIds,
  targetIds,
})
const base = () =>
  graph({ E: 'or', B: 'or', X: 'and', T: 'or' }, [
    ['E', 'X'],
    ['B', 'X'],
    ['X', 'T'],
  ])

test('a non-Entry leaf cannot satisfy AND; selected multiple Entries can', () => {
  const data = base(),
    before = structuredClone(data)
  assert.equal(analyzeAttackFeasibility(data).statuses.get('T'), 'infeasible')
  assert.deepEqual(findAttackPaths(data).paths, [['E', 'X', 'T']])
  assert.equal(findAttackPaths(data).metrics[0].status, 'infeasible')
  assert.equal(summarizeAttackPaths(data, [['E', 'X', 'T']])[0].status, 'infeasible')
  assert.deepEqual(data, before)
  data.entryIds.push('B')
  assert.equal(analyzeAttackFeasibility(data).statuses.get('T'), 'feasible')
  assert.equal(findAttackPaths(data).paths.length, 2)
})

test('unseeded AND cycles and self loops cannot bootstrap; an external OR input can', () => {
  const data = base()
  data.nodes.push({ id: 'C', type: 'and' })
  data.nodes.find((n) => n.id === 'B').type = 'and'
  data.edges.push({ source: 'B', target: 'C' }, { source: 'C', target: 'B' })
  assert.equal(analyzeAttackFeasibility(data).statuses.get('T'), 'infeasible')
  data.edges.push({ source: 'E', target: 'B' })
  assert.equal(analyzeAttackFeasibility(data).statuses.get('T'), 'infeasible')
  data.nodes.find((n) => n.id === 'B').type = 'or'
  assert.equal(analyzeAttackFeasibility(data).statuses.get('T'), 'feasible')
  const loop = graph({ E: 'or', T: 'and' }, [
    ['E', 'T'],
    ['T', 'T'],
  ])
  assert.equal(analyzeAttackFeasibility(loop).statuses.get('T'), 'infeasible')
  loop.nodes[1].type = 'or'
  assert.equal(analyzeAttackFeasibility(loop).statuses.get('T'), 'feasible')
})

for (const [type, property, blocked, allowed] of [
  ['exist', 'existenceStatus', false, true],
  ['notexist', 'existenceStatus', true, false],
  ['defense', 'defenseStatus', true, false],
])
  test(`${type} blocks a mandatory input; missing state is unresolved`, () => {
    const data = graph({ E: 'or', X: 'and', Q: { type, [property]: blocked }, T: 'or' }, [
      ['E', 'X'],
      ['Q', 'X'],
      ['X', 'T'],
    ])
    assert.equal(findAttackPaths(data).targetResults[0].feasibility, 'infeasible')
    delete data.nodes.find((node) => node.id === 'Q')[property]
    assert.equal(findAttackPaths(data).targetResults[0].feasibility, 'unresolved')
    assert.equal(summarizeAttackPaths(data, [['E', 'X', 'T']])[0].status, 'unresolved')
    data.nodes.find((node) => node.id === 'Q')[property] = allowed
    const result = findAttackPaths(data)
    assert.deepEqual(result.paths, [['E', 'X', 'T']])
    assert.deepEqual(result.metrics[0].conditionIds, ['Q'])
    assert.deepEqual(result.metrics[0].stepIds, ['E', 'T', 'X'])
  })

test('MAL OR alternatives can bypass blocked or unknown conditions', () => {
  const data = graph({ E: 'or', Q: { type: 'defense', enabled: true }, T: 'or' }, [
    ['E', 'T'],
    ['Q', 'T'],
  ])
  assert.equal(findAttackPaths(data).metrics[0].status, 'feasible')
  delete data.nodes[1].enabled
  assert.equal(findAttackPaths(data).metrics[0].status, 'feasible')
  data.edges.shift()
  assert.equal(analyzeAttackFeasibility(data).statuses.get('T'), 'unresolved')
})

test('true conditions can supply support; unknown conditions do not hide a hard impossibility', () => {
  const data = base()
  data.nodes.push({ id: 'Q', type: 'defense', defenseStatus: false })
  data.edges.push({ source: 'Q', target: 'B' })
  assert.equal(findAttackPaths(data).paths.length, 1)
  data.nodes.push({ id: 'Z', type: 'and' })
  data.edges.push({ source: 'Z', target: 'X' })
  delete data.nodes.find((node) => node.id === 'Q').defenseStatus
  assert.equal(analyzeAttackFeasibility(data).statuses.get('T'), 'infeasible')
})

test('Entries are initial compromises, including an Entry/Target behind an active defense', () => {
  const data = graph(
    { E: 'and', D: { type: 'defense', enabled: true } },
    [['D', 'E']],
    ['E'],
    ['E'],
  )
  assert.deepEqual(findAttackPaths(data, { maxHops: 0 }).paths, [['E']])
  assert.equal(conditionStatus({ type: 'notExist', existence_status: true }), false)
  assert.equal(conditionStatus({ type: 'defense', defenseStatus: 0.5 }), null)
})

test('global node reachability does not prove a selected route with circular support', () => {
  const data = graph({ E: 'or', A: 'or', B: 'and', C: 'or', T: 'or' }, [
    ['E', 'A'],
    ['A', 'B'],
    ['C', 'B'],
    ['B', 'C'],
    ['E', 'C'],
    ['C', 'T'],
    ['B', 'T'],
  ])
  assert.equal(analyzeAttackFeasibility(data).statuses.get('T'), 'feasible')
  assert.equal(summarizeAttackPaths(data, [['E', 'A', 'B', 'C', 'T']])[0].status, 'infeasible')
  const result = findAttackPaths(data, { maxPaths: 100 })
  assert.equal(result.targetResults[0].rejectedPathCount, 0)
  const blocked = result.paths.findIndex((path) => path.join() === 'E,A,B,C,T')
  assert(blocked >= 0)
  assert.equal(result.metrics[blocked].status, 'infeasible')
})

test('least fixed points agree with an independent repeated-scan oracle on mixed cyclic graphs', () => {
  let seed = 140
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32
  for (let trial = 0; trial < 100; trial++) {
    const nodes = Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [
        String(i),
        i < 6
          ? { type: random() < 0.5 ? 'and' : 'or' }
          : {
              type: i === 6 ? 'exist' : 'defense',
              existenceStatus: random() < 0.5,
              enabled: random() < 0.5,
            },
      ]),
    )
    const edges = []
    for (let a = 0; a < 8; a++)
      for (let b = 0; b < 6; b++) if (random() < 0.22) edges.push([String(a), String(b)])
    const data = graph(nodes, edges, ['0'], ['5'])
    const expected = new Set(['0'])
    if (nodes['6'].existenceStatus) expected.add('6')
    if (!nodes['7'].enabled) expected.add('7')
    let changed = true
    while (changed) {
      changed = false
      for (let i = 1; i < 6; i++) {
        const id = String(i),
          parents = edges.filter(([, b]) => b === id).map(([a]) => a)
        if (
          !expected.has(id) &&
          parents.length &&
          (nodes[id].type === 'and'
            ? parents.every((p) => expected.has(p))
            : parents.some((p) => expected.has(p)))
        ) {
          expected.add(id)
          changed = true
        }
      }
    }
    const actual = analyzeAttackFeasibility(data)
    assert.deepEqual(actual.reached, expected, `trial ${trial}`)
    for (const [id, parents] of actual.evidence)
      for (const parent of parents) assert(actual.order.indexOf(parent) < actual.order.indexOf(id))
  }
})

test('the per-Target structural cap includes candidates with circular support', () => {
  const data = graph(
    { E: 'or', A: 'or', B: 'and', C: 'or', T: 'or', L: 'or', M: 'or', N: 'or', O: 'or' },
    [
      ['E', 'A'],
      ['A', 'B'],
      ['C', 'B'],
      ['B', 'C'],
      ['E', 'C'],
      ['C', 'T'],
      ['B', 'T'],
      ['E', 'L'],
      ['L', 'M'],
      ['M', 'N'],
      ['N', 'O'],
      ['O', 'T'],
    ],
  )
  const result = findAttackPaths(data, { maxPaths: 4 })
  assert.equal(result.paths.length, 4)
  assert.equal(result.targetResults[0].rejectedPathCount, 0)
  assert(!result.paths.some((path) => path.join() === 'E,L,M,N,O,T'))
  assert(result.metrics.some((metric) => metric.status === 'infeasible'))
})
