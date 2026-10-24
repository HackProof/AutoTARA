import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  diagnoseAttackPaths,
  describeAttackPathTarget,
} from '../src/services/attackPathDiagnostics.js'
import { findAttackPaths, buildPathPrerequisites } from '../src/services/attackPaths.js'
import { summarizeAttackPaths, sortAttackPathIndexes } from '../src/services/attackPathMetrics.js'
import { buildCandidateAttackTree, treeNodeLabel } from '../src/services/attackTree.js'
import { conditionStatus } from '../src/services/attackFeasibility.js'
import { buildAttackGraph } from '../src/services/attackGraph.js'
import { parseLanguageGraph } from '../src/services/languageGraph.js'
import { parseMalModel } from '../src/services/malModelImport.js'

function graph(nodes, edges, entryIds = ['E'], targetIds = ['T']) {
  return {
    nodes: Object.entries(nodes).map(([id, type]) => ({
      id,
      fullName: id,
      riskScore: 3,
      ...(typeof type === 'string' ? { type } : type),
    })),
    edges: edges.map(([source, target]) => ({ source, target })),
    entryIds,
    targetIds,
  }
}
const andGraph = () =>
  graph({ E: 'or', B: 'or', X: 'and', T: 'or' }, [
    ['E', 'X'],
    ['B', 'X'],
    ['X', 'T'],
  ])

function checkAlignment(data, result) {
  assert.equal(result.paths.length, result.metrics.length)
  result.paths.forEach((path, i) => {
    assert.equal(result.metrics[i].routeHops, path.length - 1)
    assert.equal(new Set(path).size, path.length)
    assert(data.entryIds.includes(path[0]))
    assert(data.targetIds.includes(path.at(-1)))
    for (let j = 1; j < path.length; j++)
      assert(data.edges.some((edge) => edge.source === path[j - 1] && edge.target === path[j]))
  })
}

test('A/B: OR and fully supported AND routes have executable witnesses', () => {
  const plain = graph({ E: 'or', A: 'or', T: 'or' }, [
    ['E', 'A'],
    ['A', 'T'],
  ])
  const supported = andGraph()
  supported.edges.push({ source: 'E', target: 'B' })
  for (const data of [plain, supported]) {
    const result = findAttackPaths(data)
    checkAlignment(data, result)
    assert(result.paths.length > 0)
    for (const metric of result.metrics) {
      assert.equal(metric.status, 'feasible')
      for (const [id, parents] of Object.entries(metric.prerequisites))
        for (const parent of parents)
          assert(metric.executionOrder.indexOf(parent) < metric.executionOrder.indexOf(id))
    }
  }
})

test('C: missing AND support is retained, explained and shown in the tree without invented totals', () => {
  const data = andGraph(),
    result = findAttackPaths(data),
    metric = result.metrics[0]
  assert.deepEqual(result.paths, [['E', 'X', 'T']])
  assert.equal(metric.status, 'infeasible')
  for (const field of [
    'requiredStepCount',
    'additionalStepCount',
    'criticalPathHops',
    'averageRisk',
    'riskCoverage',
  ])
    assert.equal(metric[field], null)
  assert.deepEqual(metric.executionOrder, [])
  assert.deepEqual(metric.prerequisites.X, ['B', 'E'])
  assert(
    metric.blockedPrerequisites.some((item) => item.id === 'B' && item.reason === 'non-entry-leaf'),
  )
  const tree = buildCandidateAttackTree(data, result.paths[0], { metric })
  assert.match(treeNodeLabel(tree.root), /infeasible/)
  assert(tree.occurrences.some((item) => item.node.id === 'B' && item.feasibility === 'infeasible'))
  assert.equal(
    buildPathPrerequisites(data, result.paths[0], { metric }).requirements[0].feasibility,
    'infeasible',
  )
  assert.match(describeAttackPathTarget(result.targetResults[0], 40), /none is proven feasible/)
  assert.equal(result.diagnostics.structuralReachableCount, 3)
  assert.equal(result.diagnostics.reachableAfterFeasibilityFilterCount, 1)
})

for (const [label, props, status, reason] of [
  ['D', {}, 'unresolved', 'unknown-condition'],
  ['E', { defenseStatus: true }, 'infeasible', 'active-defense'],
])
  test(`${label}: mandatory Defense ${status} preserves the route and its condition details`, () => {
    const data = graph({ E: 'or', X: 'and', D: { type: 'defense', ...props }, T: 'or' }, [
      ['E', 'X'],
      ['D', 'X'],
      ['X', 'T'],
    ])
    const result = findAttackPaths(data)
    assert.deepEqual(result.paths, [['E', 'X', 'T']])
    assert.equal(result.metrics[0].status, status)
    assert.deepEqual(result.metrics[0].conditionIds, ['D'])
    assert(
      result.metrics[0].blockedPrerequisites.some(
        (item) => item.id === 'D' && item.reason === reason,
      ),
    )
    assert.equal(result.metrics[0].averageRisk, null)
    assert.deepEqual(result.metrics[0].unknownConditions, status === 'unresolved' ? ['D'] : [])
  })

test('F/I: global reachability is distinct from a path-constrained circular OR choice', () => {
  const data = graph({ E: 'or', A: 'or', B: 'and', C: 'or', T: 'or' }, [
    ['E', 'A'],
    ['A', 'B'],
    ['C', 'B'],
    ['B', 'C'],
    ['E', 'C'],
    ['C', 'T'],
  ])
  const result = findAttackPaths(data)
  assert.equal(result.targetResults[0].targetFeasibility, 'feasible')
  const i = result.paths.findIndex((p) => p.join() === 'E,A,B,C,T')
  assert(i >= 0)
  assert.equal(result.metrics[i].status, 'infeasible')
  assert.deepEqual(result.metrics[i].prerequisites.C, ['B'])
  assert(result.metrics.some((m) => m.status === 'feasible'))
  assert(result.metrics[i].blockedPrerequisites.some((item) => item.id === 'B'))
})

test('G/H: disconnected directions and hop limits have different diagnostics', () => {
  const data = graph({ E: 'or', A: 'or', B: 'or', T: 'or' }, [
    ['E', 'A'],
    ['A', 'B'],
    ['B', 'T'],
  ])
  const limited = findAttackPaths(data, { maxHops: 2 })
  assert.equal(limited.paths.length, 0)
  assert.equal(limited.targetResults[0].structuralPath, true)
  assert.equal(limited.targetResults[0].shortestHops, 3)
  assert.equal(limited.targetResults[0].noPathReason, 'hopLimit')
  assert.match(describeAttackPathTarget(limited.targetResults[0], 2), /beyond maxHops=2/)
  data.edges = data.edges.map(({ source, target }) => ({ source: target, target: source }))
  const disconnected = findAttackPaths(data)
  assert.equal(disconnected.paths.length, 0)
  assert.equal(disconnected.targetResults[0].structuralPath, false)
  assert.equal(disconnected.targetResults[0].noPathReason, 'noStructuralPath')
  assert.match(
    describeAttackPathTarget(disconnected.targetResults[0], 40),
    /No structural directed/,
  )
})

test('J/K: missing Risk and mixed statuses preserve stable hop order and multiple endpoints', () => {
  const data = graph(
    { E: 'or', F: 'or', A: 'and', B: 'or', U: 'or', T: 'or', Z: 'or' },
    [
      ['E', 'A'],
      ['U', 'A'],
      ['A', 'T'],
      ['E', 'B'],
      ['B', 'T'],
      ['F', 'Z'],
      ['Z', 'T'],
    ],
    ['E', 'F'],
    ['T', 'Z'],
  )
  data.nodes.find((node) => node.id === 'B').riskScore = null
  const result = findAttackPaths(data)
  checkAlignment(data, result)
  assert.deepEqual(result.paths, [
    ['F', 'Z'],
    ['E', 'A', 'T'],
    ['E', 'B', 'T'],
    ['F', 'Z', 'T'],
  ])
  assert.deepEqual(sortAttackPathIndexes(result), [0, 1, 2, 3])
  assert.deepEqual(
    result.metrics.map((m) => m.status),
    ['feasible', 'infeasible', 'feasible', 'feasible'],
  )
  assert.equal(result.metrics[2].averageRisk, null)
  assert.equal(result.metrics[2].riskCoverage, 2 / 3)
  assert.deepEqual(sortAttackPathIndexes(result, 'risk'), [0, 3, 1, 2])
  assert.equal(result.globalRiskTopK, false)
  assert.equal(result.riskRankingScope, 'returned-candidates')
})

test('validation exhaustion preserves every candidate and reports limited, never infeasible', () => {
  const data = graph({ E: 'or', A: 'or', B: 'or', T: 'or' }, [
    ['E', 'A'],
    ['A', 'T'],
    ['E', 'B'],
    ['B', 'T'],
  ])
  const full = findAttackPaths(data)
  const result = findAttackPaths(data, { maxExpansions: full.searchExpansions })
  assert.deepEqual(result.paths, full.paths)
  checkAlignment(data, result)
  assert(result.metrics.every((m) => m.status === 'limited' && m.limitReason === 'workLimit'))
  assert.equal(result.validationStopReason, 'workLimit')
  assert.equal(result.candidateSearchComplete, true)
  assert.equal(result.targetResults[0].statusCounts.limited, 2)
  assert.equal(result.diagnostics.targets[0].structuralPath, true)
  assert.equal(result.diagnostics.targets[0].shortestHops, 2)
  assert.match(describeAttackPathTarget(result.targetResults[0], 40), /validation reached/)
  const incomplete = findAttackPaths(data, { maxExpansions: 1 })
  assert.equal(incomplete.targetResults[0].structuralPath, null)
  assert.equal(incomplete.targetResults[0].stopReason, 'workLimit')
  assert.match(describeAttackPathTarget(incomplete.targetResults[0], 40), /Search limit reached/)
})

test('time limits stop discovery and do not assert an absent structural route', (t) => {
  let calls = 0
  t.mock.method(Date, 'now', () => (calls++ ? 1000 : 0))
  const result = findAttackPaths(graph({ E: 'or', T: 'or' }, [['E', 'T']]), { timeLimitMs: 1 })
  assert.equal(result.targetResults[0].stopReason, 'timeLimit')
  assert.equal(result.targetResults[0].structuralPath, null)
})

test('diagnostics validates the real graph contract before accessing arrays', () => {
  const valid = andGraph()
  for (const input of [
    undefined,
    null,
    {},
    { graph: valid, result: {} },
    { vertices: [], edges: [] },
  ])
    assert.throws(() => diagnoseAttackPaths(input), /Attack graph.nodes must be an array/)
  for (const field of ['nodes', 'edges', 'entryIds', 'targetIds']) {
    const malformed = { ...valid, [field]: undefined }
    assert.throws(
      () => diagnoseAttackPaths(malformed),
      new RegExp(`graph.${field} must be an array`),
    )
    assert.throws(() => findAttackPaths(malformed), new RegExp(`graph.${field} must be an array`))
  }
  assert.throws(() => diagnoseAttackPaths({ ...valid, entryIds: ['missing'] }), /missing/)
  assert.throws(
    () => diagnoseAttackPaths({ ...valid, edges: [{ source: 'E', target: 'missing' }] }),
    /edge endpoint/,
  )
  assert.equal(conditionStatus({ type: 'defense', defenseStatus: null, enabled: false }), null)
  assert.equal(
    conditionStatus({ type: 'exist', existenceStatus: null, existence_status: true }),
    null,
  )
  const before = structuredClone(valid)
  diagnoseAttackPaths(valid)
  assert.deepEqual(valid, before)
})

test('saved Tesla sample reproduces localConnect → messageInjection without hiding structural candidates', async () => {
  const read = (name) => readFileSync(new URL(`../../sample/${name}`, import.meta.url), 'utf8')
  const language = parseLanguageGraph(read('vehicleLang_v2-langgraph.json')).languageGraph
  const snapshot = parseMalModel(read('Tesla_Model_S_MAL_Model.yaml'), language)
  assert(!snapshot.vertices.some((asset) => asset.label === 'QtCarABrowser'))
  for (const [asset, kind, name] of [
    ['QtCarBrowser', 'entry', 'localConnect'],
    ['PT-CAN', 'target', 'messageInjection'],
  ])
    snapshot.vertices.find((item) => item.label === asset).attackEndpoints = {
      s: { [kind]: [{ attackStepId: name, name }] },
    }
  const data = buildAttackGraph(snapshot, language, 's'),
    before = structuredClone(data)
  const result = findAttackPaths(data)
  assert.equal(data.nodes.length, 1015)
  assert.equal(data.edges.length, 1450)
  assert.equal(result.paths.length, 30)
  assert.equal(result.metrics[0].routeHops, 18)
  assert(result.metrics.every((m) => m.status === 'infeasible'))
  assert.equal(result.diagnostics.structuralReachableCount, 383)
  assert.equal(result.diagnostics.reachableAfterFeasibilityFilterCount, 152)
  assert.equal(result.diagnostics.feasibleAttackStepCount, 166)
  assert.equal(result.targetResults[0].stopReason, 'pathLimit')
  const names = new Map(data.nodes.map((n) => [n.id, n.fullName]))
  assert(
    result.metrics[0].blockedPrerequisites.some(
      (item) => names.get(item.id) === 'QtCarBrowser:specificAccessAuthenticate',
    ),
  )
  assert.deepEqual(result.metrics, summarizeAttackPaths(data, result.paths))
  assert.deepEqual(data, before)
  checkAlignment(data, result)
  const previousSelf = globalThis.self
  let posted
  globalThis.self = {
    postMessage: (message) => {
      posted = message
    },
  }
  try {
    await import('../src/services/attackPaths.worker.js')
    globalThis.self.onmessage({
      data: { snapshot, languageGraph: language, schema: 's', options: { maxPaths: 2 } },
    })
    assert.equal(posted.error, undefined)
    assert.deepEqual(posted.result.paths, result.paths.slice(0, 2))
    assert.deepEqual(posted.result.metrics, result.metrics.slice(0, 2))
    assert.equal(posted.result.diagnostics.nodeCount, 1015)
  } finally {
    if (previousSelf === undefined) delete globalThis.self
    else globalThis.self = previousSelf
  }
})
