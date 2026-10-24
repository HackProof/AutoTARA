import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { compileScript, parse } from '@vue/compiler-sfc'
import { collectCrraAssessments } from '../src/services/crraAssessments.js'
import * as scoring from '../src/services/ttpScoring.js'
import * as crra from '../src/services/crra.js'
import { createSusceptibilityMatrix } from '../src/services/susceptibilityMatrix.js'
import { DRAWIO_EDITOR_KEY } from '../src/services/drawio/palette.js'

const factors = (value) => scoring.createTtpFactors().map((factor) => ({ ...factor, value }))
const saved = (steps) =>
  scoring.createCtsaMetadata({ version: 2, weights: scoring.createTtpWeights(), steps })
const threats = new Map([
  [
    'ECU',
    [
      {
        attack_step_id: 'Core:Base.access',
        name: 'access',
        declared_asset: 'Base',
        techniques: [{ id: 'T1234', name: 'Example technique' }],
      },
      { attack_step_id: 'Vehicle:ECU.inject', name: 'inject', techniques: [] },
      { attack_step_id: 'Vehicle:ECU.partial', name: 'partial' },
      { attack_step_id: 'Vehicle:ECU.unassessed', name: 'unassessed' },
    ],
  ],
])
function diagram() {
  const partial = factors(3)
  partial[0].value = null
  const assessment = saved({
    'Core:Base.access': factors(5),
    'Vehicle:ECU.inject': factors(2),
    'Vehicle:ECU.partial': partial,
  })
  assessment.riskScores['Core:Base.access'] = 99
  return {
    vertices: [
      {
        id: 'a',
        label: 'Brake',
        assetType: 'ECU',
        kind: 'asset',
        threatAssessments: { active: assessment },
      },
      {
        id: 'b',
        label: 'Brake',
        assetType: 'ECU',
        threatAssessments: {
          active: saved({ 'Core:Base.access': factors(1), 'Vehicle:ECU.inject': factors(4) }),
          other: saved({ 'Core:Base.access': factors(3) }),
        },
      },
      { id: 'c', assetType: 'Sensor', label: 'Unassessed sensor' },
      {
        id: 'boundary',
        assetType: 'ECU',
        kind: 'boundary',
        threatAssessments: { active: assessment },
      },
      { id: 'note', kind: 'annotation' },
      { id: 'general', kind: 'asset', label: 'General shape' },
    ],
    edges: [],
  }
}

test('CRRA collects assessed steps for every instance in the active schema without trusting cached scores', () => {
  const snapshot = diagram()
  const before = structuredClone(snapshot)
  const report = collectCrraAssessments(snapshot, 'active', threats)
  assert.equal(report.assetCount, 3)
  assert.equal(report.assessedAssetCount, 2)
  assert.deepEqual(
    report.rows.map((row) => row.riskScore),
    [5, 2, 1, 4],
  )
  assert.deepEqual(
    report.rows.map((row) => row.assetId),
    ['a', 'a', 'b', 'b'],
  )
  assert.equal(report.rows[0].declaredAsset, 'Base')
  assert.equal(report.rows[0].techniques[0].id, 'T1234')
  assert.equal(report.rows[1].techniques.length, 0)
  assert.equal(collectCrraAssessments(snapshot, 'other', threats).rows.length, 1)
  assert.equal(collectCrraAssessments(snapshot, 'missing', threats).rows.length, 0)
  assert.deepEqual(snapshot, before)
})

test('CRRA excludes partial, obsolete, overridden and invalid assessments instead of using zero defaults', () => {
  const snapshot = diagram()
  snapshot.vertices[0].threatAssessments.active.weights = Object.fromEntries(
    scoring.TTP_FACTORS.map(({ key }) => [key, 0]),
  )
  assert.equal(collectCrraAssessments(snapshot, 'active', threats).rows.length, 2)
  const overridden = new Map([
    ['ECU', [{ attack_step_id: 'Vehicle:ECU.access', name: 'access', riskScore: 0 }]],
  ])
  assert.equal(collectCrraAssessments(snapshot, 'active', overridden).rows.length, 0)
  assert.equal(collectCrraAssessments(snapshot, 'active', new Map()).rows.length, 0)
  assert.equal(collectCrraAssessments(null, 'active', threats).assetCount, 0)
})

async function compile(name, dependencies = {}, inlineTemplate = false, vue = Vue) {
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
  return new Function('Vue', 'dependencies', 'document', executable)(vue, dependencies, {
    activeElement: { focus() {} },
  })
}
const isolatedVue = { ...Vue, onMounted() {}, onBeforeUnmount() {}, provide() {} }

test('Evaluate CMs prefills catalog cost/effect/confidence and retains saved assessment edits', async () => {
  const component = await compile('CrraCandidateTable', { '@/services/crra.js': crra }, true)
  const vectors = [{ avId: 'T0800' }]
  const catalog = {
    countermeasures: [
      {
        id: 'M0801',
        name: 'Example countermeasure',
        cost: 3,
        mappings: [{ avId: 'T0800', effects: [{ type: 'P', level: 'H' }] }],
      },
    ],
  }
  const draft = crra.createCrraDraft()
  for (const [type, confidence, cost] of [
    ['P', 'H', 3],
    ['R', 'L', 5],
  ]) {
    if (type === 'R')
      draft.overrides.M0801 = {
        cost,
        mappings: { T0800: { effects: [{ type, level: confidence }] } },
      }
    const candidates = crra.evaluateCountermeasures(vectors, catalog, draft)
    const html = await renderToString(Vue.createSSRApp(component, { candidates, selectedIds: [] }))
    assert.match(html, new RegExp(`<select[^>]+id="effect-M0801-T0800"[^>]+value="${type}"`))
    assert.match(html, new RegExp(`<select[^>]+id="cost-M0801"[^>]+value="${cost}"`))
    assert.match(html, new RegExp(`T0800 · ${type} \\(${confidence}\\)`))
    assert.equal(candidates[0].utility, 1)
    assert.equal(candidates[0].cost, cost)
    assert.equal(candidates[0].costSource, type === 'P' ? 'Catalog' : 'Assessment override')
    assert.ok(Math.abs(candidates[0].ratio - 100 / cost) < 1e-10)
    assert.equal(candidates[0].eligible, true)
  }
  assert.equal(catalog.countermeasures[0].cost, 3)
})

test('CRRA opens with the current matrix, keeps saved selection, searches and guards schema changes', async () => {
  const component = await compile(
    'CrraModal',
    {
      bootstrap: {},
      '@/services/crra.js': crra,
      '@/services/susceptibilityMatrix.js': { createSusceptibilityMatrix },
      '@/services/ttpScoring.js': scoring,
    },
    false,
    { ...isolatedVue, watch() {} },
  )
  const props = Vue.reactive({ threatsByAsset: threats, catalogSchema: 'active' })
  const state = component.setup(props, { expose() {} })
  let shown = 0
  state.modalInstance = { show: () => shown++ }
  const snapshot = diagram()
  snapshot.metadata = { crra: { active: { selectedAvIds: ['T1234'], weights: { P: 2, R: 1 } } } }
  state.openModal({ snapshot, schema: 'active' })
  assert.equal(shown, 1)
  assert.equal(state.vectors.value.length, 1)
  assert.equal(state.vectors.value[0].riskScore, 5)
  assert.equal(state.draft.value.weights.P, 2)
  state.search.value = 'not-found'
  assert.equal(state.visibleVectors.value.length, 0)
  props.catalogSchema = 'other'
  assert.equal(state.schemaMatches.value, false)
  assert.equal(state.vectors.value.length, 0)
  props.catalogSchema = 'active'
  state.handleHidden()
  assert.equal(state.snapshot.value, null)
  state.openModal({ snapshot: diagram(), schema: 'active' })
  assert.equal(state.search.value, '')
  assert.equal(state.draft.value.selectedAvIds.length, 0)
  assert.deepEqual(state.draft.value.weights, { P: 1, R: 1 })
})

test('CRRA toolbar availability is independent from CTSA and the asset selection', async () => {
  const component = await compile(
    'SimulateButtons',
    { '@/services/drawio/palette.js': { DRAWIO_EDITOR_KEY } },
    true,
  )
  for (const available of [false, true]) {
    const app = Vue.createSSRApp(component)
    app.provide(DRAWIO_EDITOR_KEY, {
      crraAvailable: available,
      ctsaAvailable: false,
      selectedEndpoints: {},
      pathOptions: {},
    })
    const html = await renderToString(app)
    const button = html.match(/<button[^>]*aria-label="CRRA"[^>]*>/)[0]
    assert.equal(button.includes('disabled'), !available)
  }
})

test('Graph opens CRRA with the entire current snapshot and loads all asset types without selecting one', async () => {
  const store = Vue.reactive({
    data: { modelInfo: {}, diagrams: { xml: '' }, threatCatalogSchema: 'active' },
    updateDiagramXml() {},
  })
  const component = await compile(
    'Graph',
    {
      'vue-router': { useRouter: () => ({}) },
      '@/stores/threatModelStore.js': { useThreatModelStore: () => store },
      '@/services/drawio/palette.js': { DRAWIO_EDITOR_KEY, createAssetShapes: () => [] },
      '@/services/useThreatCatalog.js': {
        useThreatCatalog: () => ({
          assets: Vue.ref(threats),
          loading: Vue.ref(false),
          error: Vue.ref(''),
        }),
      },
    },
    false,
    isolatedVue,
  )
  const scope = Vue.effectScope()
  try {
    const state = scope.run(() => component.setup({}, { expose() {} }))
    const snapshot = diagram()
    state.editor.value = {
      getSnapshot: () => structuredClone(snapshot),
      getXml: () => '',
      getCatalogSchema: () => 'active',
      setCompromisedAssets() {},
    }
    state.state.ready = true
    const opened = []
    state.crraDialog.value = { openModal: (context) => opened.push(context) }
    assert.equal(state.ctsaAvailable.value, true)
    assert.equal(state.crraAvailable.value, true)
    assert.deepEqual([...new Set(state.catalogAssetTypes.value)], ['ECU', 'Sensor'])
    await state.perform('crra')
    assert.equal(opened.length, 1)
    assert.deepEqual(opened[0].snapshot, snapshot)
    assert.equal(opened[0].schema, 'active')
    snapshot.vertices.push({ id: 'new', assetType: 'Gateway' })
    store.data.diagrams.xml = 'new diagram'
    assert(state.catalogAssetTypes.value.includes('Gateway'))
    store.data.threatCatalogSchema = ''
    assert.equal(state.crraAvailable.value, false)
    await state.perform('crra')
    assert.equal(opened.length, 1)
  } finally {
    scope.stop()
  }
})
