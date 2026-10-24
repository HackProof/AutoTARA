import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeAttackPaths, sortAttackPathIndexes } from '../src/services/attackPathMetrics.js'
import { buildPathPrerequisites, findAttackPaths } from '../src/services/attackPaths.js'

function graph(types, edges, entries = ['0'], targets = ['3']) {
  return {
    nodes: types.map((type, index) => ({ id: String(index), type, riskScore: 3 })),
    edges: edges.map(([a, b]) => ({ source: String(a), target: String(b) })),
    entryIds: entries,
    targetIds: targets,
  }
}

test('route hops, required steps, additional steps and critical depth measure different quantities', () => {
  const data = graph(
    ['or', 'and', 'or', 'or'],
    [
      [0, 1],
      [2, 1],
      [1, 3],
    ],
    ['0', '2'],
  )
  const before = structuredClone(data)
  const [zero, metric] = summarizeAttackPaths(data, [['0'], ['0', '1', '3']])
  assert.equal(zero.hops, 0)
  assert.equal(zero.criticalPathHops, 0)
  assert.equal(zero.averageRisk, 3)
  assert.equal(metric.status, 'feasible')
  assert.equal(metric.routeHops, 2)
  assert.equal(metric.hops, 2)
  assert.equal(metric.requiredStepCount, 4)
  assert.equal(metric.additionalStepCount, 1)
  assert.equal(metric.criticalPathHops, 2)
  assert.deepEqual(metric.executionOrder, ['0', '2', '1', '3'])
  assert.deepEqual(data, before)
  assert(findAttackPaths(data, { maxHops: 2 }).metrics.every((m) => m.hops <= 2))
})

test('nested AND support is executable and shared steps are counted once', () => {
  const data = graph(
    ['or', 'and', 'and', 'or', 'or', 'or', 'or', 'defense'],
    [
      [0, 1],
      [1, 3],
      [2, 1],
      [4, 1],
      [4, 2],
      [5, 2],
      [0, 4],
      [6, 4],
      [7, 1],
    ],
    ['0', '5'],
  )
  data.nodes[7].defenseStatus = false
  const [metric] = summarizeAttackPaths(data, [['0', '1', '3']])
  assert.deepEqual(metric.stepIds, ['0', '1', '2', '3', '4', '5'])
  assert.equal(metric.requiredStepCount, 6)
  assert.equal(metric.additionalStepCount, 3)
  assert.equal(metric.criticalPathHops, 4)
  assert.equal(metric.averageRisk, 3)
  assert.equal(metric.riskCoverage, 1)
  assert.deepEqual(metric.conditionIds, ['7'])
  for (const [id, parents] of Object.entries(metric.prerequisites))
    for (const parent of parents)
      if (!metric.conditionIds.includes(parent))
        assert(metric.executionOrder.indexOf(parent) < metric.executionOrder.indexOf(id))
})

test('incomplete Risk has coverage but no average and cannot outrank a complete assessment', () => {
  const data = graph(
    ['or', 'or', 'or', 'or'],
    [
      [0, 1],
      [1, 3],
      [0, 2],
      [2, 3],
    ],
  )
  data.nodes.forEach((node) => {
    node.riskScore = 5
  })
  data.nodes[1].riskScore = null
  data.nodes[2].riskScore = 4
  const paths = [
    ['0', '1', '3'],
    ['0', '2', '3'],
  ]
  const result = { paths, metrics: summarizeAttackPaths(data, paths) }
  assert.equal(result.metrics[0].averageRisk, null)
  assert.equal(result.metrics[0].riskCoverage, 2 / 3)
  assert.equal(result.metrics[0].riskStatus, 'incomplete')
  assert.equal(result.metrics[1].averageRisk, 14 / 3)
  assert.deepEqual(sortAttackPathIndexes(result, 'risk'), [1, 0])
  data.nodes.forEach((node) => {
    node.riskScore = NaN
  })
  const [unscored] = summarizeAttackPaths(data, paths)
  assert.equal(unscored.averageRisk, null)
  assert.equal(unscored.riskCoverage, 0)
})

test('OR support policy is explicit, deterministic and not a maximum-Risk optimization', () => {
  const data = graph(
    ['or', 'and', 'or', 'or', 'or', 'or'],
    [
      [0, 1],
      [1, 3],
      [2, 1],
      [4, 2],
      [5, 2],
      [0, 4],
      [0, 5],
    ],
  )
  data.nodes[4].riskScore = 1
  data.nodes[5].riskScore = 5
  const [metric] = summarizeAttackPaths(data, [['0', '1', '3']])
  assert.equal(metric.supportPlanPolicy, 'earliest-reachable-witness')
  assert.equal(metric.supportPlanOptimal, false)
  assert(metric.stepIds.includes('4'))
  assert(!metric.stepIds.includes('5'))
  data.nodes.reverse()
  data.edges.reverse()
  assert.deepEqual(summarizeAttackPaths(data, [['0', '1', '3']])[0], metric)
})

test('display limits do not change support; calculation limits never yield partial plans', () => {
  const data = graph(
    Array.from({ length: 55 }, (_, i) => (i === 1 ? 'and' : 'or')),
    [[0, 1], [1, 3], [2, 1], [4, 2], ...Array.from({ length: 50 }, (_, i) => [i + 5, i + 4])],
    ['0', '54'],
  )
  const path = ['0', '1', '3']
  assert.equal(buildPathPrerequisites(data, path).truncated, true)
  const [metric] = summarizeAttackPaths(data, [path])
  assert.equal(metric.requiredStepCount, 55)
  assert.equal(metric.additionalStepCount, 52)
  assert.equal(metric.routeHops, 2)
  assert.equal(metric.criticalPathHops, 53)
  const [limited] = summarizeAttackPaths(data, [path], { maxWork: 1 })
  assert.equal(limited.status, 'limited')
  assert.equal(limited.requiredStepCount, null)
  assert.equal(limited.averageRisk, null)
  assert.deepEqual(limited.executionOrder, [])
})

test('Hop-first keeps route length ordering and Risk-first sorts only found candidates', () => {
  const data = graph(
    ['or', 'or', 'or', 'or', 'or'],
    [
      [0, 1],
      [1, 3],
      [0, 2],
      [2, 4],
      [4, 3],
    ],
  )
  data.nodes.forEach((node) => {
    node.riskScore = ['2', '4'].includes(node.id) ? 5 : 1
  })
  const capped = findAttackPaths(data, { maxPaths: 1 })
  assert.deepEqual(capped.paths, [['0', '1', '3']])
  assert.equal(capped.candidateSearchComplete, false)
  assert.equal(capped.riskRankingScope, 'returned-candidates')
  assert.equal(capped.globalRiskTopK, false)
  const result = findAttackPaths(data, { maxPaths: 100 })
  const before = structuredClone(result)
  assert.equal(result.candidateSearchComplete, true)
  assert.deepEqual(sortAttackPathIndexes(result), [0, 1])
  assert.deepEqual(sortAttackPathIndexes(result, 'risk'), [1, 0])
  assert.deepEqual(result, before)
})

test('invalid routes and infeasible support never get risk totals', () => {
  const data = graph(
    ['or', 'and', 'or', 'or'],
    [
      [0, 1],
      [1, 2],
      [2, 1],
      [2, 3],
    ],
  )
  for (const path of [
    ['0', '1', '2', '3'],
    ['2', '3'],
    ['0', '3'],
    ['0', '1', '0'],
    ['0', 'missing'],
  ]) {
    const [metric] = summarizeAttackPaths(data, [path])
    assert.equal(metric.status, 'infeasible')
    assert.equal(metric.averageRisk, null)
    assert.deepEqual(metric.stepIds, [])
  }
  assert.equal(summarizeAttackPaths(data, [[]])[0].status, 'empty')
})
