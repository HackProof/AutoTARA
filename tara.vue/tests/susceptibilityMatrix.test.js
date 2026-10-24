import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import * as Vue from 'vue'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import {
  buildSusceptibilityMatrix,
  createSusceptibilityMatrix,
} from '../src/services/susceptibilityMatrix.js'
import * as scoring from '../src/services/ttpScoring.js'
import { describeAttackStep } from '../src/services/attackStepSemantics.js'
import { DRAWIO_EDITOR_KEY } from '../src/services/drawio/palette.js'
import { groupAssetThreats } from '../src/services/threatCatalog.js'

const vector = (avId, riskScore, attackVector = avId) => ({ avId, riskScore, attackVector })

test('matrix shows each cart score, including row maxima and ties, and leaves missing scores blank', () => {
  const carts = [
    {
      id: 'one',
      name: 'Shopping Cart',
      attackVectors: [vector('shared', 1.3), vector('equal', 3)],
    },
    { id: 'two', name: 'Shopping Cart', attackVectors: [vector('shared', 5), vector('equal', 3)] },
    { id: 'three', name: 'No assessments', attackVectors: [] },
  ]
  const before = structuredClone(carts)
  const matrix = buildSusceptibilityMatrix(carts)
  assert.equal(matrix.rows.length, 2)
  assert.equal(matrix.columns.length, 3)
  assert.deepEqual(
    matrix.columns.map((column) => column.id),
    ['one', 'two', 'three'],
  )
  assert.deepEqual(
    matrix.rows.map((row) => row.riskScore),
    [5, 3],
  )
  assert.deepEqual(
    matrix.rows[0].cells.map((cell) => cell.label),
    ['X (1.3)', 'X (5.0)', ''],
  )
  assert.deepEqual(
    matrix.rows[1].cells.map((cell) => cell.label),
    ['X (3.0)', 'X (3.0)', ''],
  )
  assert.equal(matrix.rows[0].cells[2].riskScore, null)
  assert.deepEqual(carts, before)
})

test('matrix merges repeated assessments within a cart and sorts numerically with stable AV ID ties', () => {
  const matrix = buildSusceptibilityMatrix([
    {
      id: 'one',
      name: 'One',
      attackVectors: [
        vector('lower', 1.9),
        vector('tie-b', 4),
        vector('tie-a', 4),
        vector('lower', 2.5),
        vector('invalid', NaN),
        vector('unassessed', null),
        vector('cached-default', undefined),
      ],
    },
    { id: 'two', name: 'Two', attackVectors: [vector('lower', 2)] },
  ])
  assert.deepEqual(
    matrix.rows.map((row) => row.avId),
    ['tie-a', 'tie-b', 'lower'],
  )
  assert.deepEqual(
    matrix.rows[2].cells.map((cell) => cell.label),
    ['X (2.5)', 'X (2.0)'],
  )
  assert.equal(matrix.rows[2].riskScore, 2.5)
})

test('matrix uses AV identity rather than names, and creates dynamic columns even without evaluations', () => {
  const matrix = buildSusceptibilityMatrix([
    { id: 'a', name: 'Unit', attackVectors: [vector('Parent:access', 4, 'access')] },
    { id: 'b', name: 'Unit', attackVectors: [vector('Child:access', 3, 'access')] },
  ])
  assert.equal(matrix.rows.length, 2)
  assert.deepEqual(
    matrix.rows[0].cells.map((cell) => cell.label),
    ['X (4.0)', ''],
  )
  assert.deepEqual(
    matrix.rows[1].cells.map((cell) => cell.label),
    ['', 'X (3.0)'],
  )
  assert.deepEqual(buildSusceptibilityMatrix([]), { columns: [], rows: [] })
  assert.equal(
    buildSusceptibilityMatrix([{ id: 'empty', name: 'Empty', attackVectors: [] }]).columns.length,
    1,
  )
})

const factors = (value) => scoring.createTtpFactors().map((factor) => ({ ...factor, value }))
const saved = (steps) =>
  scoring.createCtsaMetadata({ version: 2, weights: scoring.createTtpWeights(), steps })
const catalog = new Map([
  [
    'ECU',
    [
      {
        attack_step_id: 'Core:Base.access',
        name: 'access',
        declared_asset: 'Base',
        techniques: [{ id: 'T0800', name: 'Activate Firmware Update Mode' }],
      },
      {
        attack_step_id: 'Vehicle:ECU.inject',
        name: 'inject',
        techniques: [{ id: 'T0830', name: 'Adversary-in-the-Middle' }],
      },
      { attack_step_id: 'Vehicle:ECU.partial', name: 'partial', riskScore: 0 },
      { attack_step_id: 'Vehicle:ECU.unmapped', name: 'unmapped' },
    ],
  ],
])
function diagram() {
  const low = factors(1)
  low[0].value = 4
  const partial = factors(3)
  partial[0].value = null
  const assessment = saved({
    'Core:Base.access': low,
    'Vehicle:ECU.inject': factors(2),
    'Vehicle:ECU.partial': partial,
    'Vehicle:ECU.unmapped': factors(4),
  })
  assessment.riskScores['Core:Base.access'] = 99
  return {
    vertices: [
      {
        id: 'a',
        label: 'Shopping Cart',
        kind: 'asset',
        assetType: 'ECU',
        threatAssessments: { active: assessment },
      },
      {
        id: 'b',
        label: 'Shopping Cart',
        assetType: 'ECU',
        threatAssessments: {
          active: saved({ 'Core:Base.access': factors(5), 'Vehicle:ECU.inject': factors(2) }),
          other: saved({ 'Core:Base.access': factors(3) }),
        },
      },
      { id: 'c', label: 'Sensor', assetType: 'Sensor' },
      {
        id: 'boundary',
        kind: 'boundary',
        assetType: 'ECU',
        threatAssessments: { active: assessment },
      },
      { id: 'annotation', kind: 'annotation' },
    ],
    edges: [],
  }
}

test('diagram adapter reuses saved factors and weights per instance/schema without inventing missing scores', () => {
  const snapshot = diagram()
  const before = structuredClone(snapshot)
  const matrix = createSusceptibilityMatrix(snapshot, 'active', catalog)
  assert.equal(matrix.columns.length, 3)
  assert.equal(matrix.rows.length, 2)
  assert.equal(matrix.rows[0].avId, 'T0800')
  assert.equal(matrix.rows[0].attackVector, 'Activate Firmware Update Mode')
  assert.equal(matrix.rows[0].riskScore, 5)
  assert.equal(matrix.rows[0].cells[0].riskScore, 1.3)
  assert.deepEqual(
    matrix.rows[0].cells.map((cell) => cell.label),
    ['X (1.3)', 'X (5.0)', ''],
  )
  assert.deepEqual(
    matrix.rows[1].cells.map((cell) => cell.label),
    ['X (2.0)', 'X (2.0)', ''],
  )
  assert.equal(matrix.unmappedSteps.length, 1)
  assert.equal(matrix.unmappedSteps[0].attackStepId, 'Vehicle:ECU.unmapped')
  assert.equal(matrix.unmappedSteps[0].riskScore, 4)
  assert.equal(matrix.rows[0].cells[0].sourceSteps[0].attackStepId, 'Core:Base.access')
  assert.equal(matrix.rows[0].cells[0].sourceSteps[0].riskScore, 1.3)
  assert.equal(createSusceptibilityMatrix(snapshot, 'other', catalog).rows[0].riskScore, 3)
  assert.equal(createSusceptibilityMatrix(snapshot, 'missing', catalog).rows.length, 0)
  assert.equal(createSusceptibilityMatrix(snapshot, 'active', new Map()).rows.length, 0)
  assert.deepEqual(snapshot, before)
  // Changing saved asset weights affects the matrix through the existing scorer.
  snapshot.vertices[0].threatAssessments.active.weights.proximity = 10
  const weighted = createSusceptibilityMatrix(snapshot, 'active', catalog)
  assert.equal(
    weighted.rows[0].cells[0].riskScore,
    scoring.calculateTtpScore(
      snapshot.vertices[0].threatAssessments.active.steps['Core:Base.access'],
      snapshot.vertices[0].threatAssessments.active.weights,
    ),
  )
})

test('many-to-many Technique mappings merge across Step IDs and asset types using two levels of maximum', () => {
  const technique = (id, name) => ({ mitre_technique_id: id, mitre_technique_name: name })
  const threats = groupAssetThreats([
    {
      asset: 'ECU',
      attack_step_id: 'Core:Base.access',
      name: 'access',
      technique_mappings: [
        technique('T0800', 'Activate Firmware Update Mode'),
        technique('T0830', 'Adversary-in-the-Middle'),
      ],
    },
    {
      asset: 'ECU',
      attack_step_id: 'Vehicle:ECU.inject',
      name: 'inject',
      technique_mappings: [
        technique('T0830', 'Adversary-in-the-Middle'),
        technique('T0830', 'Adversary-in-the-Middle'),
      ],
    },
    {
      asset: 'Sensor',
      attack_step_id: 'Vehicle:Sensor.observe',
      name: 'observe',
      technique_mappings: [technique('T0830', 'Adversary-in-the-Middle')],
    },
  ])
  const snapshot = diagram()
  snapshot.vertices[2].threatAssessments = {
    active: saved({ 'Vehicle:Sensor.observe': factors(4) }),
  }
  const matrix = createSusceptibilityMatrix(snapshot, 'active', threats)
  assert.deepEqual(
    matrix.rows.map((row) => row.avId),
    ['T0800', 'T0830'],
  )
  const merged = matrix.rows[1]
  assert.equal(merged.riskScore, 5)
  assert.deepEqual(
    merged.cells.map((cell) => cell.riskScore),
    [2, 5, 4],
  )
  assert.deepEqual(
    merged.cells.map((cell) => cell.label),
    ['X (2.0)', 'X (5.0)', 'X (4.0)'],
  )
  assert.deepEqual(
    merged.cells[0].sourceSteps.map((step) => step.riskScore),
    [2, 1.3],
  )
  assert.deepEqual(
    merged.cells[1].sourceSteps.map((step) => step.attackStepId),
    ['Core:Base.access', 'Vehicle:ECU.inject'],
  )
  assert.equal(merged.cells[2].sourceSteps[0].attackStepId, 'Vehicle:Sensor.observe')
  assert.equal(matrix.unmappedSteps.length, 0)
})

test('Technique and sub-technique IDs stay separate; unmapped-only assessments remain visible and sorted', () => {
  const snapshot = diagram()
  const threats = new Map([
    [
      'ECU',
      [
        {
          attack_step_id: 'Core:Base.access',
          name: 'access',
          techniques: [{ id: 'T0800' }, { id: 'T0800.001', name: 'Specific technique' }],
        },
        { attack_step_id: 'Vehicle:ECU.inject', name: 'inject', techniques: [{ id: '' }] },
        { attack_step_id: 'Vehicle:ECU.unmapped', name: 'unmapped' },
      ],
    ],
  ])
  const matrix = createSusceptibilityMatrix(snapshot, 'active', threats)
  assert.deepEqual(
    matrix.rows.map((row) => row.avId),
    ['T0800', 'T0800.001'],
  )
  assert.equal(matrix.rows[0].attackVector, 'T0800')
  assert.deepEqual(
    matrix.unmappedSteps.map((step) => step.riskScore),
    [4, 2, 2],
  )
  const unmapped = createSusceptibilityMatrix(
    snapshot,
    'active',
    new Map([['ECU', threats.get('ECU').map((step) => ({ ...step, techniques: [] }))]]),
  )
  assert.equal(unmapped.rows.length, 0)
  assert.equal(unmapped.columns.length, 3)
  assert.equal(unmapped.unmappedSteps.length, 5)
  assert.deepEqual(
    unmapped.unmappedSteps.map((step) => step.riskScore),
    [5, 4, 2, 2, 1.3],
  )
})

async function compile(name, dependencies = {}, renderTemplate = false) {
  const { descriptor } = parse(
    await readFile(new URL(`../src/components/${name}.vue`, import.meta.url), 'utf8'),
  )
  const script = compileScript(descriptor, { id: name })
  const executable = script.content
    .replace(
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
  const component = new Function('Vue', 'dependencies', 'document', executable)(
    { ...Vue, onMounted() {}, onBeforeUnmount() {}, provide() {} },
    dependencies,
    { activeElement: { focus() {} } },
  )
  if (renderTemplate) {
    const template = compileTemplate({
      source: descriptor.template.content,
      filename: `${name}.vue`,
      id: name,
      compilerOptions: { bindingMetadata: script.bindings },
    })
    assert.deepEqual(template.errors, [])
    const render = template.code
      .replace(
        /import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/g,
        (_, names) => `const { ${names.replace(/\bas\b/g, ':')} } = Vue;`,
      )
      .replace('export function render', 'return function render')
    component.render = new Function('Vue', render)(Vue)
  }
  return component
}

test('the matrix remains visible with asset columns before any complete TTP assessment exists', async () => {
  const partial = factors(3)
  partial[0].value = null
  const component = await compile(
    'SusceptibilityMatrixModal',
    {
      '@/services/susceptibilityMatrix.js': { createSusceptibilityMatrix },
      '@/services/ttpScoring.js': scoring,
      '@/services/attackStepSemantics.js': { describeAttackStep },
    },
    true,
  )
  const setup = component.setup
  component.setup = (props, context) => {
    const state = setup(props, context)
    state.modalInstance = { show() {} }
    state.openModal({
      snapshot: {
        vertices: [
          { id: 'unassessed', label: 'ECU without scores', assetType: 'ECU' },
          {
            id: 'partial',
            label: 'ECU with partial scores',
            assetType: 'ECU',
            threatAssessments: { active: saved({ 'Core:Base.access': partial }) },
          },
        ],
      },
      schema: 'active',
    })
    return state
  }
  const context = {}
  await renderToString(
    Vue.createSSRApp(component, {
      catalogSchema: 'active',
      threatsByAsset: catalog,
    }),
    context,
  )
  const html = context.teleports.body
  assert.match(html, /<table[^>]*matrix-table/)
  assert.match(html, /ECU without scores/)
  assert.match(html, /ECU with partial scores/)
  assert.match(html, /No TTP-scored attack vectors yet/)
  assert.doesNotMatch(html, /X \(\d/)
})

test('the toolbar exposes CTSA without a separate Susceptibility Matrix button', async () => {
  const component = await compile(
    'SimulateButtons',
    {
      '@/services/drawio/palette.js': { DRAWIO_EDITOR_KEY },
    },
    true,
  )
  for (const available of [true, false]) {
    const app = Vue.createSSRApp(component)
    app.provide(DRAWIO_EDITOR_KEY, {
      ctsaAvailable: Vue.ref(available),
      selectedEndpoints: {},
    })
    const html = await renderToString(app)
    const button = html.match(/<button[^>]*aria-label="CTSA"[^>]*>/)?.[0]
    assert.ok(button)
    assert.equal(button.includes('disabled'), !available)
    assert.doesNotMatch(html, /aria-label="Susceptibility Matrix"/)
  }
})

test('matrix modal searches rows, guards schema changes and uses fresh assessments when reopened', async () => {
  const component = await compile('SusceptibilityMatrixModal', {
    bootstrap: {},
    '@/services/susceptibilityMatrix.js': { createSusceptibilityMatrix },
    '@/services/ttpScoring.js': scoring,
    '@/services/attackStepSemantics.js': { describeAttackStep },
  })
  const props = Vue.reactive({ catalogSchema: 'active', threatsByAsset: catalog })
  const state = component.setup(props, { expose() {} })
  let shown = 0
  state.modalInstance = { show: () => shown++ }
  state.openModal({ snapshot: diagram(), schema: 'active' })
  assert.equal(shown, 1)
  assert.equal(state.visibleRows.value.length, 2)
  state.search.value = 'ACCESS'
  assert.equal(state.visibleRows.value.length, 1)
  state.search.value = 'Vehicle:ECU'
  assert.equal(state.visibleRows.value[0].attackVector, 'Adversary-in-the-Middle')
  assert.equal(state.visibleUnmappedSteps.value[0].attackStepId, 'Vehicle:ECU.unmapped')
  state.selectCell('T0800', 'a')
  assert.equal(state.selectedEvidence.value.cell.riskScore, 1.3)
  assert.equal(state.selectedEvidence.value.cell.sourceSteps[0].name, 'access')
  props.catalogSchema = 'other'
  assert.equal(state.schemaMatches.value, false)
  assert.equal(state.matrix.value.rows.length, 0)
  assert.equal(state.matrix.value.unmappedSteps.length, 0)
  assert.equal(state.selectedEvidence.value, null)
  props.catalogSchema = 'active'
  state.handleHidden()
  assert.equal(state.snapshot.value, null)
  assert.equal(state.selectedCell.value, null)
  const next = diagram()
  next.vertices[1].threatAssessments.active = saved({ 'Core:Base.access': factors(3) })
  state.openModal({ snapshot: next, schema: 'active' })
  assert.equal(state.search.value, '')
  assert.equal(state.selectedEvidence.value, null)
  assert.equal(state.matrix.value.rows[0].riskScore, 3)
})

test('CTSA without selection opens the matrix while one selected asset retains TTP scoring', async () => {
  const store = Vue.reactive({
    data: { modelInfo: {}, diagrams: { xml: '' }, threatCatalogSchema: 'active' },
    updateDiagramXml() {},
  })
  const loading = Vue.ref(false)
  const error = Vue.ref('')
  const component = await compile('Graph', {
    'vue-router': { useRouter: () => ({}) },
    '@/stores/threatModelStore.js': { useThreatModelStore: () => store },
    '@/services/drawio/palette.js': { DRAWIO_EDITOR_KEY, createAssetShapes: () => [] },
    '@/services/ttpScoring.js': scoring,
    '@/services/useThreatCatalog.js': {
      useThreatCatalog: () => ({ assets: Vue.ref(catalog), loading, error }),
    },
  })
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
    const matrices = []
    const assessments = []
    state.susceptibilityDialog.value = { openModal: (context) => matrices.push(context) }
    state.ctsaDialog.value = { openModal: (context) => assessments.push(context) }
    state.state.ready = true
    assert.equal(state.ctsaAvailable.value, true)
    assert.match(state.ctsaHint.value, /Susceptibility Matrix/)
    await state.perform('ctsa')
    assert.deepEqual(matrices[0].snapshot, snapshot)
    assert.equal(assessments.length, 0)
    // The matrix remains accessible during loading/errors so it can show Retry.
    loading.value = true
    error.value = 'Catalog offline'
    assert.equal(state.ctsaAvailable.value, true)
    state.state.selectionCount = 1
    state.state.selection = snapshot.vertices[0]
    assert.equal(state.ctsaAvailable.value, false)
    loading.value = false
    error.value = ''
    assert.equal(state.ctsaAvailable.value, true)
    await state.perform('ctsa')
    assert.equal(assessments[0].asset.id, 'a')
    assert.equal(assessments[0].threats[0].riskScore, 1.3)
    assert.equal(matrices.length, 1)
    state.state.selectionCount = 2
    assert.equal(state.ctsaAvailable.value, false)
    await state.perform('ctsa')
    assert.equal(matrices.length, 1)
    assert.equal(assessments.length, 1)
    state.state.selectionCount = 1
    state.state.selection = { isEdge: true }
    assert.equal(state.ctsaAvailable.value, false)
    loading.value = true
    error.value = 'Catalog offline'
    await state.perform('ctsa')
    assert.equal(matrices.length, 1)
    state.state.selectionCount = 0
    assert.equal(state.ctsaAvailable.value, true)
    await state.perform('ctsa')
    assert.equal(matrices.length, 2)
    state.state.busy = true
    assert.equal(state.ctsaAvailable.value, false)
    await state.perform('ctsa')
    assert.equal(matrices.length, 2)
    state.state.busy = false
    state.state.ready = false
    assert.equal(state.ctsaAvailable.value, false)
    await state.perform('ctsa')
    assert.equal(matrices.length, 2)
    state.state.ready = true
    state.state.selectionCount = 0
    store.data.threatCatalogSchema = ''
    assert.equal(state.ctsaAvailable.value, false)
    await state.perform('ctsa')
    assert.equal(matrices.length, 2)
  } finally {
    scope.stop()
  }
})

test('file import waits for DB enrichment before clearing busy state and reports catalog failures', async () => {
  const store = Vue.reactive({
    data: { modelInfo: {}, diagrams: { xml: '' }, threatCatalogSchema: 'active' },
    updateDiagramXml() {},
  })
  const component = await compile('Graph', {
    'vue-router': { useRouter: () => ({}) },
    '@/stores/threatModelStore.js': { useThreatModelStore: () => store },
    '@/services/drawio/palette.js': { DRAWIO_EDITOR_KEY, createAssetShapes: () => [] },
    '@/services/ttpScoring.js': scoring,
    '@/services/useThreatCatalog.js': {
      useThreatCatalog: () => ({
        assets: Vue.ref(catalog),
        loading: Vue.ref(false),
        error: Vue.ref(''),
      }),
    },
  })
  const scope = Vue.effectScope()
  try {
    const state = scope.run(() => component.setup({}, { expose() {} }))
    let finish
    let loadedText
    state.editor.value = {
      setCompromisedAssets() {},
      loadFile: (text) => {
        loadedText = text
        return new Promise((resolve) => {
          finish = resolve
        })
      },
    }
    state.state.ready = true
    const importing = state.importFile({ text: async () => '<mxfile/>' })
    await Vue.nextTick()
    assert.equal(loadedText, '<mxfile/>')
    assert.equal(state.state.busy, true)
    assert.equal(state.ctsaAvailable.value, false)
    finish({ ctsaError: 'The diagram was imported, but DB CTSA values could not be loaded.' })
    await importing
    assert.equal(state.state.busy, false)
    assert.match(state.errorMessage.value, /DB CTSA values could not be loaded/)
  } finally {
    scope.stop()
  }
})
