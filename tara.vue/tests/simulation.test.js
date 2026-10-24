import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import * as simulation from '../src/services/simulation.js'
import * as simulationResult from '../src/services/simulationResult.js'
import {
  findSimulationPaths,
  summarizeSimulationPathRisks,
} from '../src/services/simulationPaths.js'
import { createTtpFactors, createTtpWeights } from '../src/services/ttpScoring.js'
import * as treeService from '../src/services/attackTree.js'
import { parseLanguageGraph } from '../src/services/languageGraph.js'
import { DRAWIO_EDITOR_KEY } from '../src/services/drawio/palette.js'

const language = parseLanguageGraph(
  await readFile(
    new URL('../../simulate.server/tests/fixtures/simulation.json', import.meta.url),
    'utf8',
  ),
).languageGraph
const endpoint = (name) => ({ name, attackStepId: `test:Device.${name}` })
const snapshot = {
  vertices: ['a', 'b'].map((id) => ({
    id,
    label: 'Unit',
    assetType: 'Device',
    attackEndpoints: { active: { entry: [endpoint('entry')], target: [endpoint('target')] } },
  })),
  edges: [],
}

test('request uses the current model, exact exported duplicate names and active schema endpoints', () => {
  const before = structuredClone(snapshot)
  const prepared = simulation.prepareSimulation({
    snapshot,
    languageGraph: language,
    schema: 'active',
    attackerType: 'DepthFirstAttacker',
  })
  assert.deepEqual(prepared.request.entry_points, ['Unit:entry', 'Unit:2:entry'])
  assert.deepEqual(prepared.request.goals, ['Unit:target', 'Unit:2:target'])
  assert.equal(prepared.request.attacker_type, 'DepthFirstAttacker')
  assert.equal(prepared.request.model.assets[2].name, 'Unit:2')
  assert.equal(prepared.cellIds.get('Unit:2'), 'b')
  assert(prepared.request.language_graph.Device.attack_steps.entry)
  assert.deepEqual(snapshot, before)
  assert.throws(
    () =>
      simulation.prepareSimulation({
        snapshot,
        languageGraph: language,
        schema: 'other',
        attackerType: 'BreadthFirstAttacker',
      }),
    /Entry and one Target/,
  )
  assert.throws(
    () =>
      simulation.prepareSimulation({
        snapshot,
        languageGraph: language,
        schema: 'active',
        attackerType: 'KeyboardAgent',
      }),
    /BFS or DFS/,
  )
})

test('simulation scores use recalculated factors for the exact instance, schema and declaration', () => {
  const factors = (value) => createTtpFactors().map((factor) => ({ ...factor, value }))
  const languageGraph = {
    metadata: { id: 'scoring', version: '1' },
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
  const assessed = {
    vertices: ['a', 'b'].map((id, index) => ({
      id,
      label: 'Unit',
      assetType: 'Child',
      attackEndpoints: { active: { entry: [endpoint('entry')], target: [endpoint('target')] } },
      threatAssessments: {
        active: {
          version: 2,
          weights: createTtpWeights(),
          steps: {
            'Catalog:Parent.entry': factors(index ? 1 : 4),
            'Catalog:Parent.target': factors(null),
            'Catalog:Parent.support': factors(5),
          },
          riskScores: { 'Catalog:Parent.entry': 99, 'Catalog:Parent.target': 5 },
        },
        other: {
          version: 2,
          weights: createTtpWeights(),
          steps: { 'Catalog:Parent.target': factors(5) },
        },
      },
    })),
    edges: [],
  }
  const before = structuredClone(assessed)
  const prepare = (catalogRows = []) =>
    simulation.prepareSimulation({
      snapshot: assessed,
      languageGraph,
      schema: 'active',
      attackerType: 'BreadthFirstAttacker',
      catalogRows,
    })
  const prepared = prepare()
  assert.equal(prepared.riskScore({ asset: 'Unit', name: 'entry' }), 4)
  assert.equal(prepared.riskScore({ asset: 'Unit:2', name: 'entry' }), 1)
  assert.equal(prepared.riskScore({ asset: 'Unit', name: 'target' }), null)
  assert.equal(prepared.riskScore({ asset: 'Unit', name: 'support' }), null)
  assert.equal(prepared.riskScore({ asset: 'missing', name: 'entry' }), null)
  const node = { id: 'E', name: 'entry', asset: 'Unit', type: 'or', riskScore: 99 }
  const response = {
    tree: { nodes: [node], targets: [node], performedNodes: [{ ...node, asset: 'Unit:2' }] },
  }
  const mapped = simulation.attachSimulationCells(response, prepared.cellIds, prepared.riskScore)
  assert.equal(mapped.tree.nodes[0].riskScore, 4)
  assert.equal(mapped.tree.targets[0].riskScore, 4)
  assert.equal(mapped.tree.performedNodes[0].riskScore, 1)
  assert.equal(mapped.tree.nodes[0].ctsaScore, 4)
  assert.equal(mapped.tree.nodes[0].ctsaScoreSource, 'assessment')
  assert.equal(mapped.tree.performedNodes[0].ctsaScore, 1)
  const unassessedNode = { ...node, name: 'target' }
  const unassessed = simulation.attachSimulationCells(
    {
      tree: {
        nodes: [unassessedNode],
        targets: [unassessedNode],
        performedNodes: [unassessedNode],
      },
    },
    prepared.cellIds,
    prepared.riskScore,
  )
  assert.equal(unassessed.tree.nodes[0].riskScore, 0)
  assert.equal(unassessed.tree.nodes[0].riskAssessed, false)
  assert.equal(unassessed.tree.nodes[0].ctsaScore, null)
  assert.equal(response.tree.nodes[0].riskScore, 99)
  assert.deepEqual(assessed, before)
  const saved = assessed.vertices[0].threatAssessments.active
  saved.steps['Alternative:Parent.entry'] = factors(5)
  assert.equal(prepare().riskScore(node), null)
  saved.steps['opaque-step-id'] = factors(2)
  const catalogRows = [
    {
      asset: 'Child',
      name: 'entry',
      declared_asset: 'Parent',
      qualified_name: 'Parent.entry',
      attack_step_id: 'opaque-step-id',
    },
  ]
  assert.equal(prepare(catalogRows).riskScore(node), 2)
  saved.steps['opaque-step-id'] = factors(null)
  assert.equal(prepare(catalogRows).riskScore(node), null)
  // Scores belong to the submitted snapshot, even if the source is later edited.
  saved.steps['Catalog:Parent.entry'] = factors(1)
  assert.equal(prepared.riskScore(node), 4)
})

test('CTSA scores attach exact catalog declarations to each exported instance without borrowing overrides or project Risk', () => {
  const languageGraph = {
    metadata: { id: 'ctsa', version: '1' },
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
  const catalogRows = [
    { asset: 'Child', name: 'entry', declared_asset: 'Parent', ctsa: { ctsa_score: 4.7 } },
    { asset: 'Child', name: 'target', declared_asset: 'Parent', ctsa: { ctsa_score: 3.1 } },
    { asset: 'Child', name: 'support', declared_asset: 'Parent', ctsa: { ctsa_score: 5 } },
  ]
  const prepared = simulation.prepareSimulation({
    snapshot: {
      ...snapshot,
      vertices: snapshot.vertices.map((asset) => ({ ...asset, assetType: 'Child' })),
    },
    languageGraph,
    schema: 'active',
    attackerType: 'BreadthFirstAttacker',
    catalogRows,
  })
  assert.equal(prepared.ctsaScore({ asset: 'Unit', name: 'entry' }), 4.7)
  assert.equal(prepared.ctsaScore({ asset: 'Unit:2', name: 'entry' }), 4.7)
  assert.equal(prepared.ctsaScore({ asset: 'Unit', name: 'support' }), null)
  assert.equal(prepared.ctsaScore({ asset: 'missing', assetType: 'Child', name: 'entry' }), null)
  catalogRows[0].ctsa.ctsa_score = 1
  assert.equal(prepared.ctsaScore({ asset: 'Unit', name: 'entry' }), 4.7)
  const node = { id: 'E', asset: 'Unit', name: 'entry' }
  const mapped = simulation.attachSimulationCells(
    {
      tree: {
        nodes: [node],
        targets: [{ ...node, name: 'target' }],
        performedNodes: [
          { ...node, asset: 'Unit:2' },
          { ...node, name: 'support' },
        ],
      },
    },
    prepared.cellIds,
    prepared.riskScore,
    prepared.ctsaScore,
  )
  assert.equal(mapped.tree.nodes[0].ctsaScore, 4.7)
  assert.equal(mapped.tree.nodes[0].riskScore, 0)
  assert.equal(mapped.tree.nodes[0].ctsaScoreSource, 'catalog')
  assert.equal(mapped.tree.targets[0].ctsaScore, 3.1)
  assert.equal(mapped.tree.performedNodes[0].ctsaScore, 4.7)
  assert.equal(mapped.tree.performedNodes[1].ctsaScore, null)
  const assessed = simulation.attachSimulationCells(
    { tree: { nodes: [node], targets: [], performedNodes: [node] } },
    prepared.cellIds,
    () => 2,
    prepared.ctsaScore,
  )
  assert.equal(assessed.tree.nodes[0].ctsaScore, 2)
  assert.equal(assessed.tree.nodes[0].ctsaScoreSource, 'assessment')
  assert.equal(assessed.tree.nodes[0].catalogCtsaScore, 4.7)
})

test('result score display recovers saved CTSA assessments when the catalog has no score', () => {
  const node = { riskScore: 3.8, riskAssessed: true, ctsaScore: null }
  assert.deepEqual(simulationResult.getSimulationCtsaScore(node), {
    value: 3.8,
    source: 'assessment',
  })
  assert.match(simulationResult.simulationCtsaScoreTitle(node), /Saved CTSA assessment/)
  assert.equal(
    simulationResult.getSimulationCtsaScore({ riskScore: 0, riskAssessed: false, ctsaScore: null }),
    null,
  )
  assert.deepEqual(
    simulationResult.getSimulationCtsaScore({ riskScore: 0, riskAssessed: false, ctsaScore: 4.7 }),
    { value: 4.7, source: 'catalog' },
  )
})

test('path averages include only assessed unique Entry-to-Target steps', () => {
  const nodes = [
    { id: 'E', type: 'or', riskScore: 1 },
    { id: 'A', type: 'or', riskScore: 5 },
    { id: 'B', type: 'or', riskScore: null },
    { id: 'G', type: 'and', riskScore: 2 },
    { id: 'T', type: 'or', riskScore: 4 },
    { id: 'D', type: 'defense', riskScore: 99 },
  ]
  const before = structuredClone(nodes)
  const paths = [
    ['E', 'A', 'G', 'T'],
    ['E', 'B', 'G', 'T'],
    ['E', 'E', 'A', 'D', 'G', 'T'],
    ['missing'],
    [],
  ]
  const summaries = summarizeSimulationPathRisks(nodes, paths)
  assert.equal(summaries[0].averageRiskScore, 3)
  assert.equal(summaries[0].riskStatus, 'complete')
  assert.equal(summaries[0].riskScope, 'route')
  assert.equal(summaries[0].totalSteps, 4)
  assert.equal(summaries[1].averageRiskScore, 7 / 3)
  assert.equal(summaries[1].riskStatus, 'incomplete')
  assert.equal(summaries[1].defaultedSteps, 1)
  assert.equal(summaries[1].scoredSteps, 3)
  assert.equal(summaries[1].riskCoverage, 0.75)
  assert.deepEqual(summaries[1].missingStepIds, ['B'])
  assert.equal(summaries[2].averageRiskScore, 3)
  assert.equal(summaries[2].totalSteps, 4)
  assert.equal(summaries[3].averageRiskScore, null)
  assert.equal(summaries[3].riskStatus, 'unavailable')
  assert.equal(summaries[4].averageRiskScore, null)
  assert.equal(summaries[4].riskStatus, 'unavailable')
  assert.equal(
    summarizeSimulationPathRisks(
      nodes.map((node) => ({ ...node, riskScore: 0 })),
      [paths[0]],
    )[0].averageRiskScore,
    0,
  )
  const tree = result().tree
  const scores = new Map(nodes.map((node) => [node.id, node.riskScore]))
  tree.nodes = tree.nodes.map((node) => ({ ...node, riskScore: scores.get(node.id) }))
  const candidates = findSimulationPaths(tree, 'T')
  assert.equal(candidates.riskSummaries[0].averageRiskScore, 3)
  assert.equal(candidates.riskSummaries[1].averageRiskScore, 7 / 3)
  const defaulted = [{ id: 'E', type: 'or', riskScore: 0, riskAssessed: false }]
  assert.equal(summarizeSimulationPathRisks(defaulted, [['E']])[0].averageRiskScore, null)
  assert.equal(summarizeSimulationPathRisks(defaulted, [['E']])[0].scoredSteps, 0)
  assert.equal(
    summarizeSimulationPathRisks([{ ...defaulted[0], riskScore: 99 }], [['E']])[0].averageRiskScore,
    null,
  )
  const mixed = summarizeSimulationPathRisks(
    [
      { id: 'E', type: 'or', riskScore: 0, riskAssessed: true },
      { id: 'B', type: 'or', riskScore: 0, riskAssessed: false },
      { id: 'T', type: 'or', riskScore: 4, riskAssessed: true },
    ],
    [['E', 'B', 'T']],
  )[0]
  // Assessed zero scores count in the denominator; display defaults do not.
  assert.equal(mixed.averageRiskScore, 2)
  assert.equal(mixed.scoredSteps, 2)
  assert.equal(mixed.totalSteps, 3)
  // An unassessed AND support alternative does not alter the explicitly route-scoped mean.
  assert(
    simulation
      .buildSimulationTree(tree, 'T', { path: candidates.paths[0] })
      .occurrences.some((item) => item.node.id === 'B'),
  )
  assert.deepEqual(nodes, before)
})

function result() {
  const nodes = ['E', 'A', 'B', 'G', 'T', 'U'].map((id) => ({
    id,
    name: id,
    fullName: `Unit:${id}`,
    asset: 'Unit',
    type: id === 'G' ? 'and' : 'or',
    performedAt: 1,
  }))
  return {
    attackerType: 'BreadthFirstAttacker',
    seed: 0,
    ttcMode: 'DISABLED',
    steps: 5,
    performedCount: 6,
    scenario: 'agents:\n  Attacker:\n    agent_class: BreadthFirstAttacker',
    artifacts: {},
    tree: {
      nodes: nodes.filter((node) => node.id !== 'U'),
      edges: [
        ['E', 'A'],
        ['E', 'B'],
        ['A', 'G'],
        ['B', 'G'],
        ['G', 'A'],
        ['G', 'T'],
      ].map(([source, target]) => ({ source, target })),
      entryIds: ['E'],
      targetIds: ['T', 'U'],
      targets: nodes
        .filter((node) => ['T', 'U'].includes(node.id))
        .map((node) => ({ ...node, reached: node.id === 'T' })),
      performedNodes: [
        ...nodes.filter((node) => node.id !== 'U'),
        { id: 'outside', name: 'outside', asset: 'Unit:2', type: 'or' },
      ],
      performedEdges: [
        ['E', 'A'],
        ['E', 'B'],
        ['A', 'G'],
        ['B', 'G'],
        ['G', 'A'],
        ['G', 'T'],
        ['E', 'outside'],
      ].map(([source, target]) => ({ source, target })),
      compromisedAssets: ['Unit'],
    },
  }
}

test('simulation trees keep AND branches and terminate cycles/shared references without inventing edges', () => {
  const data = result()
  const tree = simulation.buildSimulationTree(data.tree, 'T')
  assert.equal(tree.root.node.id, 'T')
  assert.equal(tree.root.children[0].node.type, 'and')
  assert.deepEqual(
    tree.root.children[0].children.map((item) => item.node.id),
    ['A', 'B'],
  )
  assert(tree.occurrences.some((item) => item.terminal === 'cycle'))
  const layout = treeService.layoutAttackTree(tree)
  const occurrences = new Map(tree.occurrences.map((item) => [item.id, item]))
  for (const edge of layout.edges)
    assert(
      data.tree.edges.some(
        (original) =>
          original.source === occurrences.get(edge.source).node.id &&
          original.target === occurrences.get(edge.target).node.id,
      ),
    )
  assert.equal(simulation.buildSimulationTree(data.tree, 'U').root, null)
  assert.equal(
    simulation.buildSimulationTree(data.tree, 'T', { maxNodes: 2 }).occurrences.length,
    2,
  )
  assert.equal(simulation.buildSimulationTree(data.tree, 'T', { maxNodes: 2 }).truncated, true)
  assert.match(treeService.treeNodeLabel(tree.root), /Performed/)
  const mapped = simulation.attachSimulationCells(data, new Map([['Unit', 'cell-1']]))
  assert(mapped.tree.nodes.every((node) => node.cellId === 'cell-1'))
  assert.equal(mapped.tree.performedNodes.find((node) => node.id === 'outside').cellId, null)
  assert.equal(data.tree.nodes[0].cellId, undefined)
  const scored = simulation.buildSimulationTree(
    { ...data.tree, nodes: data.tree.nodes.map((node) => ({ ...node, riskScore: 3.5 })) },
    'T',
  )
  assert.match(treeService.treeNodeLabel(scored.root), /Risk Score: 3\.5/)
  assert.match(treeService.treeNodeHtmlLabel(scored.root), /text-bg-warning/)
  assert.match(treeService.treeNodeLabel(tree.root), /Risk Score: 0\.0/)
})

test('HTTP client posts the payload, preserves cancellation and reports server validation/network errors', async () => {
  const controller = new AbortController()
  const response = await simulation.requestSimulation(
    { attacker_type: 'DepthFirstAttacker' },
    controller.signal,
    async (url, options) => {
      assert.equal(url, '/api/simulations')
      assert.equal(options.method, 'POST')
      assert.equal(options.signal, controller.signal)
      assert.equal(JSON.parse(options.body).attacker_type, 'DepthFirstAttacker')
      return { ok: true, json: async () => result() }
    },
  )
  assert.equal(response.tree.targets.length, 2)
  await assert.rejects(
    simulation.requestSimulation({}, null, async () => ({
      ok: false,
      json: async () => ({ detail: [{ msg: 'Invalid endpoint' }] }),
    })),
    /Invalid endpoint/,
  )
  await assert.rejects(
    simulation.requestSimulation({}, null, async () => {
      throw new Error('Network failed')
    }),
    /Start simulate.server/,
  )
  controller.abort()
  const aborted = new DOMException('Cancelled', 'AbortError')
  await assert.rejects(
    simulation.requestSimulation({}, controller.signal, async () => {
      throw aborted
    }),
    (error) => error === aborted,
  )
})

async function compile(name, dependencies = {}, vue = Vue, inlineTemplate = true) {
  const { descriptor } = parse(
    await readFile(new URL(`../src/components/${name}.vue`, import.meta.url), 'utf8'),
  )
  const executable = compileScript(descriptor, { id: name, inlineTemplate })
    .content.replace(
      /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g,
      (_, names, from) =>
        `const { ${names.replace(/\bas\b/g, ':')} } = ${from === 'vue' ? 'Vue' : `dependencies[${JSON.stringify(from)}] || {}`};`,
    )
    .replace(
      /import\s+(\w+)\s+from\s*['"]([^'"]+)['"];?/g,
      (_, name, from) => `const ${name} = dependencies[${JSON.stringify(from)}];`,
    )
    .replaceAll('import.meta.url', '"http://test/Graph.vue"')
    .replace('export default', 'return')
  return new Function('Vue', 'dependencies', executable)(vue, dependencies)
}

test('actual toolbar exposes BFS/DFS, keeps Find Paths disabled, and disables Simulate while running', async () => {
  const component = await compile('SimulateButtons', {
    '@/services/drawio/palette.js': { DRAWIO_EDITOR_KEY },
  })
  for (const running of [false, true]) {
    const app = Vue.createSSRApp(component)
    app.provide(DRAWIO_EDITOR_KEY, {
      selectedEndpoints: {},
      pathOptions: {},
      attackerType: Vue.ref('DepthFirstAttacker'),
      simulationRunning: Vue.ref(running),
      simulationAvailable: Vue.ref(!running),
    })
    const html = await renderToString(app)
    assert.match(html, /BFS \(BreadthFirstAttacker\)/)
    assert.match(html, /DFS \(DepthFirstAttacker\)/)
    assert.match(html, /<button[^>]+disabled[^>]*>[\s\S]*?Find Paths/)
    assert.match(html, running ? /Simulating…/ : /> Simulate<\/button>/)
    const simulateButton = html.match(/<button[^>]*class="btn btn-sm btn-success fw-bold"[^>]*>/)[0]
    assert.equal(simulateButton.includes('disabled'), running)
  }
})

test('actual result view distinguishes unreached and partial targets and shows scenario downloads', async () => {
  const component = await compile('SimulationTreeView', {
    '@/services/simulation.js': simulation,
    '@/services/attackTree.js': treeService,
  })
  const data = result()
  data.tree.targets = data.tree.targets.filter((node) => !node.reached)
  data.tree.nodes = []
  data.partial = true
  const html = await renderToString(Vue.createSSRApp(component, { result: data }))
  assert.match(html, /0\/1 Targets reached/)
  assert.match(html, /partial result/)
  assert.match(html, /was not reached in this simulation/)
  assert.match(html, /Scenario and simulation files/)
  assert.match(html, /BreadthFirstAttacker/)
})

test('Graph keeps Diagram active after simulation, cancels on edits/reset and ignores late results', async () => {
  const store = Vue.reactive({
    data: {
      modelInfo: { title: 'Test' },
      diagrams: { xml: '' },
      languageGraph: language,
      threatCatalogSchema: 'active',
    },
    updateDiagramXml() {},
  })
  const requests = []
  const catalogLoading = Vue.ref(false)
  const component = await compile(
    'Graph',
    {
      'vue-router': { useRouter: () => ({}) },
      '@/stores/threatModelStore.js': { useThreatModelStore: () => store },
      '@/services/drawio/palette.js': { DRAWIO_EDITOR_KEY, createAssetShapes: () => [] },
      '@/services/useThreatCatalog.js': {
        useThreatCatalog: () => ({
          assets: Vue.ref(new Map()),
          loading: catalogLoading,
          error: Vue.ref(''),
        }),
      },
      '@/services/simulation.js': {
        ...simulation,
        requestSimulation: (payload, signal) =>
          new Promise((resolve, reject) => requests.push({ payload, signal, resolve, reject })),
      },
    },
    { ...Vue, onMounted() {}, onBeforeUnmount() {}, provide() {} },
    false,
  )
  const scope = Vue.effectScope()
  const highlights = []
  const previousDocument = globalThis.document
  const focused = []
  globalThis.document = { getElementById: (id) => ({ focus: () => focused.push(id) }) }
  try {
    const state = scope.run(() => component.setup({}, { expose() {} }))
    assert.deepEqual(state.availableTabs.value, ['diagram'])
    state.switchTab('simulation')
    assert.equal(state.activeTab.value, 'diagram')
    const key = (key) => ({ key, preventDefault() {} })
    await state.navigateTabs(key('End'))
    assert.equal(state.activeTab.value, 'diagram')
    state.editor.value = {
      getSnapshot: () => snapshot,
      getXml: () => '',
      getCatalogSchema: () => 'active',
      setCompromisedAssets: (ids) => highlights.push(ids),
      inspectAsset: (id) => assert.equal(id, 'b'),
    }
    Object.assign(state.state, { ready: true, attackEndpointCounts: { entry: 2, target: 2 } })
    catalogLoading.value = true
    assert.equal(state.simulationAvailable.value, false)
    assert.match(state.simulationHint.value, /Loading attack steps and CTSA scores/)
    await state.perform('simulate')
    assert.equal(requests.length, 0)
    catalogLoading.value = false
    const first = state.perform('simulate')
    assert.equal(state.simulationRunning.value, true)
    store.data.diagrams.xml = 'edited'
    assert.equal(requests[0].signal.aborted, true)
    assert.equal(state.simulationRunning.value, false)
    assert.deepEqual(highlights.at(-1), [])
    const second = state.perform('simulate')
    requests[0].resolve(result())
    await first
    assert.equal(state.simulationResult.value, null)
    assert.equal(state.simulationRunning.value, true)
    assert.deepEqual(highlights.at(-1), [])
    requests[1].resolve(result())
    await second
    assert.equal(state.activeTab.value, 'diagram')
    assert.equal(state.simulationResult.value.tree.nodes[0].cellId, 'a')
    // The performed off-tree step belongs to the second, duplicate-named asset.
    assert.deepEqual(highlights.at(-1), ['a', 'b'])
    assert.deepEqual(state.availableTabs.value, ['diagram', 'tree', 'simulation'])
    state.switchTab('tree')
    assert.equal(state.activeTab.value, 'tree')
    await state.navigateTabs(key('ArrowRight'))
    assert.equal(state.activeTab.value, 'simulation')
    assert.equal(focused.at(-1), 'simulation-tab')
    await state.navigateTabs(key('ArrowRight'))
    assert.equal(state.activeTab.value, 'diagram')
    await state.navigateTabs(key('ArrowLeft'))
    assert.equal(state.activeTab.value, 'simulation')
    await state.navigateTabs(key('Home'))
    assert.equal(state.activeTab.value, 'diagram')
    await state.navigateTabs(key('End'))
    assert.equal(state.activeTab.value, 'simulation')
    await state.inspectPathAsset('b')
    assert.equal(state.activeTab.value, 'diagram')
    state.resetPaths()
    assert.equal(state.simulationResult.value, null)
    assert.equal(state.activeTab.value, 'diagram')
    assert.deepEqual(state.availableTabs.value, ['diagram'])
    assert.deepEqual(highlights.at(-1), [])
    const third = state.perform('simulate')
    state.resetPaths()
    requests[2].reject(new Error('Late server error'))
    await third
    assert.equal(state.errorMessage.value, '')
  } finally {
    scope.stop()
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})

test('Simulator Result includes off-Target compromises and separates duplicate-named asset instances', () => {
  const data = result()
  const before = structuredClone(data)
  const graph = simulationResult.buildSimulationResultGraph(data.tree)
  assert.equal(graph.nodes.length, 6)
  assert.deepEqual(
    graph.assets.map((asset) => asset.name),
    ['Unit', 'Unit:2'],
  )
  assert(graph.edges.some((edge) => edge.target === 'outside'))
  assert(!graph.nodes.some((node) => node.id === 'U'))
  assert.equal(graph.nodes.find((node) => node.id === 'E').isEntry, true)
  assert.equal(graph.nodes.find((node) => node.id === 'T').isTarget, true)
  const layout = simulationResult.layoutSimulationResult(graph)
  assert.equal(layout.assets.flatMap((asset) => asset.nodes).length, 6)
  assert(layout.assets.every((asset) => !asset.expanded && asset.height === 120))
  const expanded = simulationResult.layoutSimulationResult(graph, new Set([graph.assets[0].id]))
  assert.equal(expanded.assets[0].expanded, true)
  assert(expanded.assets[0].height > 120)
  assert.equal(expanded.assets[1].expanded, false)
  assert.deepEqual(data, before)
  // A partial run has no Target tree, but all observed compromises remain visible.
  data.tree.nodes = []
  data.tree.edges = []
  data.tree.targets.forEach((node) => {
    node.reached = false
  })
  const partial = simulationResult.buildSimulationResultGraph(data.tree)
  assert.equal(partial.nodes.length, 6)
  assert.equal(partial.edges.length, 7)
  // Never fabricate connections from execution order or include conditions.
  data.tree.performedNodes.push({ id: 'D', type: 'defense', asset: 'Unit' })
  data.tree.performedEdges.push(
    { source: 'D', target: 'G' },
    { source: 'E', target: 'outside' },
    { source: 'T', target: 'E' },
  )
  const filtered = simulationResult.buildSimulationResultGraph(data.tree)
  assert.equal(filtered.nodes.length, 6)
  assert.equal(filtered.edges.length, 7)
  data.tree.performedNodes = []
  assert.deepEqual(
    simulationResult.layoutSimulationResult(simulationResult.buildSimulationResultGraph(data.tree))
      .assets,
    [],
  )
})

test('compromised assets and their steps sort by iteration in either direction, with missing times last', () => {
  const nodes = [
    ['entry', 'Entry', 0],
    ['early', 'Early', 1],
    ['later', 'Early', 8],
    ['late', 'Late', 5],
    ['same2', 'Same2', 3],
    ['same10', 'Same10', 3],
    ['known', 'Mixed', 2],
    ['unknownMixed', 'Mixed', null],
    ['unknown', 'Unknown', null],
  ].map(([id, asset, performedAt]) => ({ id, name: id, asset, performedAt, type: 'or' }))
  const graph = simulationResult.buildSimulationResultGraph({
    performedNodes: nodes,
    performedEdges: [],
    entryIds: ['entry'],
    targetIds: [],
    targets: [],
  })
  const assets = [...graph.assets]
    .reverse()
    .map((asset) => ({ ...asset, nodes: [...asset.nodes].reverse() }))
  const before = structuredClone(assets)
  const ascending = simulationResult.sortSimulationAssets(assets)
  assert.deepEqual(
    ascending.map((asset) => asset.name),
    ['Entry', 'Early', 'Mixed', 'Same2', 'Same10', 'Late', 'Unknown'],
  )
  assert.equal(ascending[0].firstCompromisedAt, 0)
  assert.deepEqual(
    ascending.find((asset) => asset.name === 'Early').nodes.map((node) => node.performedAt),
    [1, 8],
  )
  const descending = simulationResult.sortSimulationAssets(assets, 'iteration-desc')
  assert.deepEqual(
    descending.map((asset) => asset.name),
    ['Late', 'Same2', 'Same10', 'Mixed', 'Early', 'Entry', 'Unknown'],
  )
  assert.deepEqual(
    descending.find((asset) => asset.name === 'Early').nodes.map((node) => node.performedAt),
    [8, 1],
  )
  assert.deepEqual(
    descending.find((asset) => asset.name === 'Mixed').nodes.map((node) => node.performedAt),
    [2, null],
  )
  assert.deepEqual(
    simulationResult.sortSimulationAssets(assets, 'name').map((asset) => asset.name),
    ['Early', 'Entry', 'Late', 'Mixed', 'Same2', 'Same10', 'Unknown'],
  )
  assert.deepEqual(assets, before)
})

test('asset first-compromise ordering retains the original time when a Target filter hides its earliest step', () => {
  const nodes = [
    ['E', 'Entry', 0],
    ['offPath', 'Unit', 1],
    ['relevant', 'Unit', 5],
    ['T', 'Goal', 7],
  ].map(([id, asset, performedAt]) => ({ id, asset, performedAt, name: id, type: 'or' }))
  const graph = simulationResult.buildSimulationResultGraph(
    {
      performedNodes: nodes,
      performedEdges: [
        ['E', 'offPath'],
        ['E', 'relevant'],
        ['relevant', 'T'],
      ].map(([source, target]) => ({ source, target })),
      entryIds: ['E'],
      targetIds: ['T'],
      targets: [{ id: 'T', reached: true }],
    },
    { targetPathsOnly: true },
  )
  const asset = graph.assets.find((asset) => asset.name === 'Unit')
  assert.equal(asset.firstCompromisedAt, 1)
  assert.deepEqual(
    asset.nodes.map((node) => node.id),
    ['relevant'],
  )
})

test('Target-only filtering removes unrelated branches while preserving AND support and reached Targets', () => {
  const data = result().tree
  const before = structuredClone(data)
  const filtered = simulationResult.buildSimulationResultGraph(data, { targetPathsOnly: true })
  assert.deepEqual(
    new Set(filtered.nodes.map((node) => node.id)),
    new Set(['E', 'A', 'B', 'G', 'T']),
  )
  assert.equal(filtered.hiddenStepCount, 1)
  assert.equal(filtered.assets.length, 1)
  assert(filtered.edges.some((edge) => edge.source === 'B' && edge.target === 'G'))
  assert(!filtered.edges.some((edge) => edge.target === 'outside'))
  assert.deepEqual(data, before)

  // Preserve a second reached goal, but exclude an unrelated Entry and the
  // performed prerequisites of a granted Entry. AND support need not itself
  // lie on a simple Entry-to-Target main route.
  data.performedNodes.push(
    { id: 'V', asset: 'Unit:2', name: 'V', type: 'or', performedAt: 2 },
    { id: 'support', asset: 'Support', name: 'support', type: 'or', performedAt: 0 },
    { id: 'beforeEntry', asset: 'Other', name: 'beforeEntry', type: 'or', performedAt: 0 },
    { id: 'otherEntry', asset: 'Other', name: 'otherEntry', type: 'or', performedAt: 0 },
    { id: 'late', asset: 'Late', name: 'late', type: 'or', performedAt: 9 },
  )
  data.entryIds.push('otherEntry')
  data.targetIds.push('V')
  data.targets.push({ id: 'V', reached: true })
  data.performedEdges.push(
    { source: 'outside', target: 'V' },
    { source: 'support', target: 'G' },
    { source: 'beforeEntry', target: 'E' },
    { source: 'E', target: 'late' },
    { source: 'late', target: 'T' },
  )
  const multi = simulationResult.buildSimulationResultGraph(data, { targetPathsOnly: true })
  assert(multi.nodes.some((node) => node.id === 'outside'))
  assert(multi.nodes.some((node) => node.id === 'V' && node.isTarget))
  assert(multi.nodes.some((node) => node.id === 'support'))
  for (const id of ['U', 'beforeEntry', 'otherEntry', 'late'])
    assert(!multi.nodes.some((node) => node.id === id))
  assert(
    multi.edges.every((edge) =>
      data.performedEdges.some(
        (original) => original.source === edge.source && original.target === edge.target,
      ),
    ),
  )
  const legacy = result().tree
  delete legacy.performedEdges
  assert.equal(
    simulationResult.buildSimulationResultGraph(legacy, { targetPathsOnly: true }).nodes.length,
    5,
  )
  data.targets.forEach((node) => {
    node.reached = false
  })
  const empty = simulationResult.buildSimulationResultGraph(data, { targetPathsOnly: true })
  assert.deepEqual(empty.nodes, [])
  assert.deepEqual(empty.assets, [])
  assert.deepEqual(empty.edges, [])
  assert.equal(empty.hiddenStepCount, data.performedNodes.length)
  assert.equal(
    simulationResult.buildSimulationResultGraph(data).nodes.length,
    data.performedNodes.length,
  )
})

function interleavedResult() {
  const data = result()
  const nodes = [
    ['E', 'Asset A', 'A-entry', 0],
    ['B1', 'Asset B', 'B-cross', 1],
    ['A2', 'Asset A', 'A-return', 2],
    ['B3', 'Asset B', 'B-effect', 3],
    ['C3', 'Asset C', 'C-effect', 3],
    ['T', 'Asset A', 'A-goal', 4],
    ['off', 'Unrelated', 'Off-path', 1],
  ].map(([id, asset, name, performedAt]) => ({
    id,
    asset,
    name,
    performedAt,
    type: id === 'T' ? 'and' : 'or',
    fullName: `${asset}:${name}`,
    ctsaScore: id === 'B1' ? 4.2 : null,
  }))
  data.tree = {
    ...data.tree,
    performedNodes: [...nodes].reverse(),
    performedEdges: [
      ['E', 'B1'],
      ['B1', 'A2'],
      ['A2', 'B3'],
      ['A2', 'C3'],
      ['B3', 'T'],
      ['C3', 'T'],
      ['E', 'off'],
    ].map(([source, target]) => ({ source, target })),
    entryIds: ['E'],
    targetIds: ['T'],
    targets: [{ ...nodes.find((node) => node.id === 'T'), reached: true }],
  }
  return data
}

test('compromise timeline interleaves revisited assets and groups same-iteration effects without inventing an order', () => {
  const data = interleavedResult()
  const graph = simulationResult.buildSimulationResultGraph(data.tree, { targetPathsOnly: true })
  const before = structuredClone(graph)
  const timeline = simulationResult.buildSimulationTimeline([...graph.nodes].reverse())
  assert.deepEqual(
    timeline.map((group) => group.iteration),
    [0, 1, 2, 3, 4],
  )
  assert.deepEqual(
    timeline.flatMap((group) => group.nodes.map((node) => node.asset)),
    ['Asset A', 'Asset B', 'Asset A', 'Asset B', 'Asset C', 'Asset A'],
  )
  assert.equal(timeline.find((group) => group.iteration === 3).assetCount, 2)
  assert.equal(timeline.find((group) => group.iteration === 3).nodes.length, 2)
  assert(!timeline.some((group) => group.nodes.some((node) => node.id === 'off')))
  assert.equal(timeline[1].nodes[0].ctsaScore, 4.2)
  const unknown = [
    { id: 'unknown1', asset: 'Asset A', performedAt: null },
    { id: 'unknown2', asset: 'Asset B', performedAt: NaN },
  ]
  const withUnknown = [...graph.nodes, ...unknown]
  const descending = simulationResult.buildSimulationTimeline(withUnknown, 'iteration-desc')
  assert.deepEqual(
    descending.map((group) => group.iteration),
    [4, 3, 2, 1, 0, null],
  )
  assert.equal(descending.at(-1).nodes.length, 2)
  assert.equal(descending.at(-1).assetCount, 2)
  assert.deepEqual(simulationResult.buildSimulationTimeline([]), [])
  const all = simulationResult.buildSimulationTimeline(
    simulationResult.buildSimulationResultGraph(data.tree).nodes,
  )
  assert(all.find((group) => group.iteration === 1).nodes.some((node) => node.id === 'off'))
  assert.deepEqual(graph, before)
})

function consecutiveAssetResult() {
  const data = result()
  const nodes = [
    ['E', 'QtCarBrowser', 'localConnect', 0],
    ['A1', 'QtCarBrowser', 'attemptUseVulnerability', 1],
    ['B3', 'Use-After-Free', 'localAccessArchived', 3],
    ['T', 'QtWebKit JSArray sort', 'localAccessAchived', 4],
  ].map(([id, asset, name, performedAt]) => ({
    id,
    asset,
    name,
    performedAt,
    type: 'or',
    fullName: `${asset}:${name}`,
  }))
  const edges = [
    ['E', 'A1'],
    ['A1', 'B3'],
    ['B3', 'T'],
  ].map(([source, target]) => ({ source, target }))
  data.tree = {
    ...data.tree,
    nodes,
    edges,
    performedNodes: [...nodes].reverse(),
    performedEdges: edges,
    entryIds: ['E'],
    targetIds: ['T'],
    targets: [{ ...nodes.at(-1), reached: true }],
  }
  return data
}

test('timeline groups consecutive iterations for one asset while preserving returns, shared iterations and unknown times', () => {
  const data = consecutiveAssetResult()
  const graph = simulationResult.buildSimulationResultGraph(data.tree, { targetPathsOnly: true })
  const timeline = simulationResult.buildSimulationTimeline(graph.nodes)
  const before = structuredClone(timeline)
  const groups = simulationResult.groupSimulationTimelineByAsset(timeline)
  assert.equal(groups.length, 3)
  assert.deepEqual(
    groups.map((group) => group.assets[0].name),
    ['QtCarBrowser', 'Use-After-Free', 'QtWebKit JSArray sort'],
  )
  assert.equal(groups[0].firstIteration, 0)
  assert.equal(groups[0].lastIteration, 1)
  assert.deepEqual(
    groups[0].assets[0].nodes.map((node) => node.name),
    ['localConnect', 'attemptUseVulnerability'],
  )
  const descending = simulationResult.groupSimulationTimelineByAsset(
    simulationResult.buildSimulationTimeline(graph.nodes, 'iteration-desc'),
  )
  assert.equal(descending.at(-1).firstIteration, 1)
  assert.equal(descending.at(-1).lastIteration, 0)
  assert.deepEqual(
    descending.at(-1).nodes.map((node) => node.id),
    ['A1', 'E'],
  )
  const revisited = simulationResult.groupSimulationTimelineByAsset(
    simulationResult.buildSimulationTimeline(
      simulationResult.buildSimulationResultGraph(interleavedResult().tree, {
        targetPathsOnly: true,
      }).nodes,
    ),
  )
  assert.equal(revisited.length, 5)
  assert.deepEqual(
    revisited.map((group) => group.assets.map((asset) => asset.name)),
    [['Asset A'], ['Asset B'], ['Asset A'], ['Asset B', 'Asset C'], ['Asset A']],
  )
  assert.equal(revisited[3].firstIteration, revisited[3].lastIteration)
  const distinctInstances = [
    { id: 'x', asset: 'Device', assetId: '1', performedAt: 0 },
    { id: 'y', asset: 'Device', assetId: '2', performedAt: 1 },
    { id: 'z', asset: 'Device', assetId: '2', performedAt: null },
  ]
  const unknown = simulationResult.groupSimulationTimelineByAsset(
    simulationResult.buildSimulationTimeline(distinctInstances),
  )
  assert.equal(unknown.length, 3)
  assert.equal(unknown.at(-1).firstIteration, null)
  assert.equal(unknown.at(-1).nodes.length, 1)
  assert.deepEqual(simulationResult.groupSimulationTimelineByAsset([]), [])
  assert.deepEqual(timeline, before)
})

test('flow UI shows the QtCarBrowser iterations in one expandable asset card', async () => {
  const component = await compile('SimulationResultView', {
    '@/services/simulationResult.js': simulationResult,
    '@/services/ttpScoring.js': await import('../src/services/ttpScoring.js'),
  })
  const html = await renderToString(
    Vue.createSSRApp(component, { result: consecutiveAssetResult() }),
  )
  assert.match(html, /Iterations 0–1/)
  assert.match(html, /Iteration 3/)
  assert.match(html, /Iteration 4/)
  assert.equal((html.match(/QtCarBrowser<\/strong>/g) || []).length, 1)
  assert.match(html, /\(\+2 steps\)/)
  assert.match(html, /aria-expanded="false"/)
  assert.equal((html.match(/aria-expanded=/g) || []).length, 1)
  assert.match(html, /Use-After-Free:localAccessArchived<\/strong>/)
  assert.match(html, /QtWebKit JSArray sort:localAccessAchived<\/strong>/)
  assert(!html.includes('(+1 steps)'))
  assert(!html.includes('>localConnect</strong>'))
  assert(!html.includes('>attemptUseVulnerability</strong>'))
})

test('default flow UI renders cross-asset chronology and CTSA badges with step selection wired to the diagram', async () => {
  const component = await compile(
    'SimulationResultView',
    {
      '@/services/simulationResult.js': simulationResult,
      '@/services/ttpScoring.js': await import('../src/services/ttpScoring.js'),
    },
    Vue,
    false,
  )
  const { descriptor } = parse(
    await readFile(new URL('../src/components/SimulationResultView.vue', import.meta.url), 'utf8'),
  )
  component.render = Vue.compile(descriptor.template.content)
  const setup = component.setup
  component.setup = (props, context) => {
    const state = setup(props, context)
    for (const asset of state.graph.value.assets) state.toggleAsset(asset.id)
    return { ...state }
  }
  const html = await renderToString(Vue.createSSRApp(component, { result: interleavedResult() }))
  const names = ['A-entry', 'B-cross', 'A-return', 'B-effect', 'C-effect', 'A-goal']
  const positions = names.map((name) => html.indexOf(`:${name}</strong>`))
  assert(
    positions.every(
      (position, index) => position >= 0 && (!index || positions[index - 1] < position),
    ),
  )
  assert.match(html, /Iteration 0/)
  assert.match(html, /Iteration 3/)
  assert.match(html, /2 steps · 2 assets/)
  assert.match(html, /CTSA Score: 4.2/)
  assert.match(html, /1 unrelated steps hidden/)
  assert(!html.includes(':Off-path</strong>'))
  assert(!html.includes('Sort assets'))
  assert.match(html, /same iteration have no recorded internal order/)
})

test('Simulator Result defaults to Target-only results and explains how to view unreached progress', async () => {
  const component = await compile('SimulationResultView', {
    '@/services/simulationResult.js': simulationResult,
    '@/services/ttpScoring.js': await import('../src/services/ttpScoring.js'),
  })
  const data = result()
  const initial = await renderToString(Vue.createSSRApp(component, { result: data }))
  assert.match(initial, /5 compromised steps · 1 assets/)
  assert.match(initial, /Compromise flow by iteration/)
  assert.match(initial, /Sort flow/)
  assert.match(initial, /Iteration: Earliest first/)
  assert.match(initial, /Iteration: Latest first/)
  assert.match(initial, /By asset/)
  assert.match(initial, /same iteration have no recorded internal order/)
  assert.match(initial, /id="simulation-target-paths-only"[^>]*checked/)
  data.tree.nodes = []
  data.tree.targets.forEach((node) => {
    node.reached = false
  })
  data.partial = true
  const html = await renderToString(Vue.createSSRApp(component, { result: data }))
  assert.match(html, /0 compromised steps · 0 assets/)
  assert.match(html, /6 unrelated steps hidden/)
  assert.match(html, /0\/2 Targets reached/)
  assert.match(html, /Step limit reached · partial result/)
  assert(!html.includes('Unit:2'))
  assert(!html.includes('<strong>outside</strong>'))
  assert.match(html, /Uncheck the filter to view all compromised steps/)
  assert.match(html, /Only steps leading to reached Targets/)
  assert.match(html, /Reset layout/)
  assert.match(html, /Compromised Attack Steps and assets diagram/)
  assert(!html.includes('No compromised Attack Steps were recorded'))
  assert(!html.includes('only Target-related connections'))
  data.tree.performedNodes = []
  assert.match(
    await renderToString(Vue.createSSRApp(component, { result: data })),
    /No compromised steps lead to a reached Target/,
  )
})

test('Simulator Result displays all AFR coefficients, partial coverage and unavailable Targets', async () => {
  const component = await compile('SimulationResultView', {
    '@/services/simulationResult.js': simulationResult,
    '@/services/ttpScoring.js': await import('../src/services/ttpScoring.js'),
  })
  const data = result()
  for (const [value, rating, label] of [
    [1, 0, 'Very Low'],
    [2, 1, 'Low'],
    [3, 1.5, 'Medium'],
    [4, 2, 'High'],
  ]) {
    data.tree.performedNodes.forEach((node) => {
      node.ttpFactors = createTtpFactors().map((factor) => ({ ...factor, value }))
    })
    const html = await renderToString(Vue.createSSRApp(component, { result: data }))
    assert.match(html, /Attack Feasibility Rating \(AFR\)/)
    assert.match(html, /AF score A\(π\)/)
    assert.match(html, /AFR F\(π\)/)
    assert(html.includes(`<td class="fw-bold">${rating}</td>`))
    assert(html.includes(`>${label}</span>`))
    assert.match(html, /5\/5 steps/)
    assert.match(html, /Target not reached/)
    assert.match(html, /Performed OR alternatives are included/)
    assert.match(html, /higher raw values mean greater attack difficulty/)
  }
  data.tree.performedNodes.find((node) => node.id === 'B').ttpFactors = null
  const partial = await renderToString(Vue.createSSRApp(component, { result: data }))
  assert.match(partial, /4\/5 steps/)
  assert.match(partial, /Partial assessment · 1 missing/)
  data.tree.performedNodes.forEach((node) => {
    node.ttpFactors = null
  })
  const unavailable = await renderToString(Vue.createSSRApp(component, { result: data }))
  assert.match(unavailable, /0\/5 steps/)
  assert.match(unavailable, /No complete TTP factors/)
  assert.match(unavailable, /<td class="fw-bold">N\/A<\/td>/)
})

test('result-body shows saved CTSA assessments when database CTSA scores are empty', async () => {
  const scoring = await import('../src/services/ttpScoring.js')
  const component = await compile(
    'SimulationResultView',
    {
      '@/services/simulationResult.js': simulationResult,
      '@/services/ttpScoring.js': scoring,
    },
    Vue,
    false,
  )
  const { descriptor } = parse(
    await readFile(new URL('../src/components/SimulationResultView.vue', import.meta.url), 'utf8'),
  )
  component.render = Vue.compile(descriptor.template.content)
  const setup = component.setup
  component.setup = (props, context) => {
    const state = setup(props, context)
    state.listView.value = 'assets'
    for (const asset of state.graph.value.assets) state.toggleAsset(asset.id)
    return { ...state }
  }
  const data = result()
  data.tree.performedNodes = data.tree.performedNodes.map((node) => ({
    ...node,
    ctsaScore: null,
    riskAssessed: node.id === 'A',
    riskScore: node.id === 'A' ? 3.6 : 0,
  }))
  const html = await renderToString(Vue.createSSRApp(component, { result: data }))
  assert.match(html, /class="badge rounded-pill mt-1 text-bg-warning"[^>]*>CTSA Score: 3.6/)
  assert.match(html, /Saved CTSA assessment for this asset and attack step/)
  assert.equal((html.match(/CTSA Score:/g) || []).length, 1)
  assert(!html.includes('CTSA Score: 0.0'))
  assert.match(html, /Sort assets/)
  assert.match(html, /Asset name: A–Z/)
})

test('Simulator Result renders on activation, preserves the view across tabs and disposes its diagram', async () => {
  const mounted = []
  const disposers = []
  const rendered = []
  const renderOptions = []
  let toggleFromDiagram
  let destroyed = false
  const component = await compile(
    'SimulationResultView',
    {
      '@/services/simulationResult.js': simulationResult,
      '@/services/drawio/runtime.js': { loadDrawioRuntime: async () => ({}) },
      '@/services/drawio/simulationResult.js': {
        createSimulationResultDiagram: ({ onSelect, onToggleAsset }) => {
          toggleFromDiagram = onToggleAsset
          return {
            render: (layout, options) => {
              rendered.push(layout)
              renderOptions.push(options)
            },
            select: (id) =>
              onSelect(
                rendered
                  .at(-1)
                  .assets.flatMap((asset) => asset.nodes)
                  .find((node) => node.id === id),
              ),
            fit() {},
            resize() {},
            destroy: () => {
              destroyed = true
            },
          }
        },
      },
    },
    {
      ...Vue,
      onMounted: (handler) => mounted.push(handler),
      onBeforeUnmount: (handler) => disposers.push(handler),
    },
    false,
  )
  const scope = Vue.effectScope()
  try {
    const props = Vue.reactive({ result: result(), active: false })
    const state = scope.run(() => component.setup(props, { expose() {}, emit() {} }))
    await mounted[0]()
    assert.equal(rendered.length, 0)
    props.active = true
    await Vue.nextTick()
    await Vue.nextTick()
    assert.equal(rendered.length, 1)
    assert.equal(renderOptions.at(-1).resetLayout, true)
    assert(rendered[0].assets.every((asset) => !asset.expanded))
    assert.equal(state.targetPathsOnly.value, true)
    assert.equal(state.listView.value, 'flow')
    assert.equal(state.flowSortBy.value, 'iteration-asc')
    const afrBeforeFilter = state.afrResults.value
    state.targetPathsOnly.value = false
    await Vue.nextTick()
    assert.equal(state.afrResults.value, afrBeforeFilter)
    const assetId = state.graph.value.assets.find((asset) => asset.name === 'Unit:2').id
    toggleFromDiagram(assetId)
    await Vue.nextTick()
    assert.equal(state.selectedAssetId.value, assetId)
    assert.equal(renderOptions.at(-1).resetLayout, false)
    assert(rendered.at(-1).assets.find((asset) => asset.id === assetId).expanded)
    state.select(state.graph.value.nodes.find((node) => node.id === 'outside'))
    assert.equal(state.selected.value.asset, 'Unit:2')
    assert.equal(state.assetSortBy.value, 'iteration-asc')
    const rendersBeforeSort = rendered.length
    const selectedBeforeSort = state.selected.value
    for (const order of ['iteration-desc', 'name', 'iteration-asc']) {
      state.assetSortBy.value = order
      await Vue.nextTick()
      assert.equal(state.selected.value, selectedBeforeSort)
      assert(state.expandedAssets.value.has(assetId))
      assert.equal(rendered.length, rendersBeforeSort)
    }
    for (const view of ['assets', 'flow']) {
      state.listView.value = view
      state.flowSortBy.value = 'iteration-desc'
      await Vue.nextTick()
      assert.equal(state.selected.value, selectedBeforeSort)
      assert(state.expandedAssets.value.has(assetId))
      assert.equal(rendered.length, rendersBeforeSort)
    }
    state.toggleAsset(assetId)
    await Vue.nextTick()
    assert.equal(state.selected.value, null)
    assert(!rendered.at(-1).assets.find((asset) => asset.id === assetId).expanded)
    // Selecting a hidden step also opens its asset, without losing the selection.
    state.select(
      state.timeline.value.flatMap((group) => group.nodes).find((node) => node.id === 'outside'),
    )
    await Vue.nextTick()
    assert(state.expandedAssets.value.has(assetId))
    assert.equal(state.selected.value.id, 'outside')
    assert.equal(renderOptions.at(-1).selectedNodeId, 'outside')
    const renderedBeforeTabs = rendered.length
    props.active = false
    await Vue.nextTick()
    props.active = true
    await Vue.nextTick()
    await Vue.nextTick()
    assert.equal(rendered.length, renderedBeforeTabs)
    assert.equal(state.selected.value.id, 'outside')
    state.targetPathsOnly.value = true
    await Vue.nextTick()
    assert.equal(state.graph.value.hiddenStepCount, 1)
    assert.equal(state.selected.value, null)
    assert.equal(state.selectedAsset.value, undefined)
    assert(!state.expandedAssets.value.has(assetId))
    assert(!state.timeline.value.some((group) => group.nodes.some((node) => node.id === 'outside')))
    assert(!rendered.at(-1).assets.some((asset) => asset.id === assetId))
    state.targetPathsOnly.value = false
    await Vue.nextTick()
    assert(state.graph.value.assets.some((asset) => asset.id === assetId))
    assert.equal(renderOptions.at(-1).resetLayout, false)
    state.resetLayout()
    assert.equal(renderOptions.at(-1).resetLayout, true)
    const renderedBeforeInactiveUpdate = rendered.length
    props.active = false
    await Vue.nextTick()
    props.result = { ...result(), tree: { ...result().tree, performedNodes: [] } }
    await Vue.nextTick()
    assert.equal(state.selected.value, null)
    assert.equal(rendered.length, renderedBeforeInactiveUpdate)
    props.active = true
    await Vue.nextTick()
    await Vue.nextTick()
    assert.equal(rendered.length, renderedBeforeInactiveUpdate + 1)
    assert.equal(renderOptions.at(-1).resetLayout, true)
    assert.deepEqual(rendered.at(-1).assets, [])
    disposers.forEach((dispose) => dispose())
    assert.equal(destroyed, true)
  } finally {
    scope.stop()
  }
})

test('simulation candidates are bounded simple routes using performed steps and the selected reached Target', () => {
  const data = result().tree
  const candidates = findSimulationPaths(data, 'T', { maxPaths: 10, maxHops: 10 })
  assert.deepEqual(candidates.paths, [
    ['E', 'A', 'G', 'T'],
    ['E', 'B', 'G', 'T'],
  ])
  assert.equal(candidates.candidateSearchComplete, true)
  assert.equal(candidates.metrics, undefined)
  for (const path of candidates.paths) {
    assert.equal(new Set(path).size, path.length)
    assert.equal(path[0], 'E')
    assert.equal(path.at(-1), 'T')
  }
  const bounded = findSimulationPaths(data, 'T', { maxPaths: 1 })
  assert.equal(bounded.paths.length, 1)
  assert.equal(bounded.targetResults[0].stopReason, 'pathLimit')
  const hops = findSimulationPaths(data, 'T', { maxHops: 2 })
  assert.deepEqual(hops.paths, [])
  assert.equal(hops.targetResults[0].noPathReason, 'hopLimit')
  assert.equal(hops.targetResults[0].shortestHops, 3)
  const limited = findSimulationPaths(data, 'T', { maxExpansions: 1 })
  assert.equal(limited.candidateSearchComplete, false)
  assert.equal(limited.targetResults[0].stopReason, 'workLimit')
  assert.equal(findSimulationPaths(data, 'U').noPathReason, 'targetNotReached')
  assert.deepEqual(findSimulationPaths({ ...data, entryIds: ['outside'] }, 'T').paths, [])
  const filtered = {
    ...data,
    performedNodes: data.performedNodes.filter((node) => node.id !== 'A'),
  }
  assert.deepEqual(findSimulationPaths(filtered, 'T').paths, [['E', 'B', 'G', 'T']])
  assert.deepEqual(findSimulationPaths({ ...data, entryIds: ['E', 'B'] }, 'T').paths[0], [
    'B',
    'G',
    'T',
  ])
})

test('a candidate tree preserves the full route, adds AND support, constrains route ORs and references cycles', () => {
  const data = result().tree
  const path = ['E', 'B', 'G', 'T']
  const tree = simulation.buildSimulationTree(data, 'T', { path })
  assert.equal(tree.root.node.id, 'T')
  assert.deepEqual(
    tree.occurrences.filter((item) => item.routeStep).map((item) => item.node.id),
    path,
  )
  assert.deepEqual(
    tree.root.children.map((item) => item.node.id),
    ['G'],
  )
  const gate = tree.occurrences.find((item) => item.routeStep && item.node.id === 'G')
  assert.deepEqual(
    gate.children.map((item) => item.node.id),
    ['B', 'A'],
  )
  assert.equal(gate.children[1].role, 'support')
  assert(
    tree.occurrences.some((item) => item.node.id === 'G' && item.terminal === 'route-reference'),
  )
  for (const item of tree.occurrences)
    for (const child of item.children)
      assert(
        data.edges.some((edge) => edge.source === child.node.id && edge.target === item.node.id),
      )
  const capped = simulation.buildSimulationTree(data, 'T', { path, maxNodes: path.length })
  assert.equal(capped.truncated, true)
  assert.equal(capped.occurrences.filter((item) => item.routeStep).length, path.length)
  assert.throws(
    () => simulation.buildSimulationTree(data, 'T', { path: ['E', 'T'] }),
    /valid performed/,
  )
  const entryTarget = { ...data, targets: [{ ...data.nodes[0], reached: true }], targetIds: ['E'] }
  assert.deepEqual(findSimulationPaths(entryTarget, 'E').paths, [['E']])
  assert.equal(
    simulation.buildSimulationTree(entryTarget, 'E', { path: ['E'] }).root.terminal,
    'entry',
  )
})

test('the actual simulation path Worker returns structural routes and reports invalid search options', async () => {
  const outputs = []
  const source = (
    await readFile(new URL('../src/services/simulationPaths.worker.js', import.meta.url), 'utf8')
  ).replace(/import[^\n]+\n/, '')
  const self = { postMessage: (message) => outputs.push(message) }
  vm.runInNewContext(source, { self, findSimulationPaths })
  self.onmessage({ data: { tree: result().tree, targetId: 'T', options: { maxPaths: 5 } } })
  assert.equal(outputs[0].paths.length, 2)
  self.onmessage({ data: { tree: result().tree, targetId: 'T', options: { maxPaths: 0 } } })
  assert.match(outputs[1].error, /maxPaths/)
})

test('candidate UI starts on demand, shows selected routes, and discards workers on Target changes and disposal', async () => {
  const workers = []
  const disposers = []
  const previousWorker = globalThis.Worker
  globalThis.Worker = class {
    constructor() {
      workers.push(this)
    }
    postMessage(data) {
      this.data = data
    }
    terminate() {
      this.terminated = true
    }
  }
  const scope = Vue.effectScope()
  try {
    const component = await compile(
      'SimulationTreeView',
      {
        '@/services/simulation.js': simulation,
        '@/services/attackTree.js': treeService,
      },
      {
        ...Vue,
        onMounted() {},
        onBeforeUnmount(handler) {
          disposers.push(handler)
        },
      },
      false,
    )
    const props = Vue.reactive({ result: result(), active: false })
    const state = scope.run(() => component.setup(props, { expose() {}, emit() {} }))
    assert.equal(workers.length, 0)
    props.active = true
    await Vue.nextTick()
    assert.equal(workers.length, 1)
    assert.equal(state.pathSearching.value, true)
    workers[0].onmessage({ data: findSimulationPaths(workers[0].data.tree, 'T') })
    assert.equal(state.paths.value.length, 2)
    assert.equal(state.selectedPathIndex.value, -1)
    state.selectedPathIndex.value = 1
    assert.deepEqual([...state.selectedPath.value], ['E', 'B', 'G', 'T'])
    assert.equal(state.tree.value.root.routeStep, true)
    state.searchPaths()
    const stale = workers.at(-1)
    state.targetId.value = 'U'
    await Vue.nextTick()
    assert.equal(stale.terminated, true)
    stale.onmessage({ data: findSimulationPaths(stale.data.tree, 'T') })
    assert.equal(state.pathResult.value, null)
    assert.equal(state.selectedPathIndex.value, -1)
    state.targetId.value = 'T'
    await Vue.nextTick()
    const pending = workers.at(-1)
    disposers.forEach((dispose) => dispose())
    assert.equal(pending.terminated, true)
  } finally {
    scope.stop()
    if (previousWorker === undefined) delete globalThis.Worker
    else globalThis.Worker = previousWorker
  }
})
