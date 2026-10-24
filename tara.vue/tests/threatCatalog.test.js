import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { compileScript, parse } from '@vue/compiler-sfc'
import {
  catalogErrorMessage,
  fetchAttackSteps,
  fetchLangSchemas,
  groupAssetThreats,
} from '../src/services/threatCatalog.js'
import { getAssetParents, parseLanguageGraph } from '../src/services/languageGraph.js'
import { useThreatCatalog } from '../src/services/useThreatCatalog.js'
import { useThreatModelStore } from '../src/stores/threatModelStore.js'
import { riskScoreClass, riskScoreLabel } from '../src/services/ttpScoring.js'
import { createStencilGroups, DRAWIO_EDITOR_KEY } from '../src/services/drawio/palette.js'
import { getStencilConnectionContext } from '../src/services/drawio/stencilConnections.js'
import api from '../src/api/client.js'
import {
  assessAssetThreats,
  createCtsaDraft,
  serializeCtsaDraft,
} from '../src/services/ttpScoring.js'

const mappings = [
  {
    mitre_technique_id: 'T0858',
    mitre_technique_name: 'Change Operating Mode',
    un_r155_attack_id: '12.10',
  },
  { mitre_technique_id: 'T0858', un_r155_attack_id: '12.1' },
  { mitre_technique_id: 'T0831', un_r155_attack_id: '12.10' },
]
const rows = [
  {
    attack_step_id: 'VehicleLang:ECU.changeOperationMode',
    asset: 'ECU',
    name: 'changeOperationMode',
    technique_mappings: mappings,
  },
  {
    attack_step_id: 'VehicleLang:ECU._hidden',
    asset: 'ECU',
    name: '_hidden',
    hidden: true,
    technique_mappings: [],
  },
  { attack_step_id: 'CoreLang:Data.access', asset: 'Data', name: 'access', technique_mappings: [] },
]
const settle = async () => {
  await Vue.nextTick()
  await Vue.nextTick()
}

test('groups every asset step and deduplicates only mapping badges, preserving string R155 IDs', () => {
  const assets = groupAssetThreats(rows)
  assert.equal(assets.get('ECU').length, 2)
  assert.equal(assets.get('Data').length, 1)
  assert.equal(assets.get('ECU')[0].riskScore, null)
  assert.deepEqual(
    assets.get('ECU')[0].techniques.map((item) => item.id),
    ['T0858', 'T0831'],
  )
  assert.deepEqual(
    assets.get('ECU')[0].r155.map((item) => item.id),
    ['12.10', '12.1'],
  )
  assert.deepEqual(assets.get('ECU')[1].techniques, [])
  assert.equal(assets.get('ECU')[1].hidden, true)
  assert.deepEqual(rows[0].technique_mappings, mappings)
})

test('sends all LangGraph parents, including abstract definitions, with the attack-step request', async () => {
  const { languageGraph } = parseLanguageGraph(
    JSON.stringify({
      assets: [
        { name: 'Child', extends: 'Abstract' },
        { name: 'Abstract', isAbstract: true, superAsset: 'Root' },
        { name: 'Root' },
      ],
    }),
  )
  const assetParents = getAssetParents(languageGraph)
  assert.deepEqual(assetParents, { Child: 'Abstract', Abstract: 'Root', Root: '' })
  const originalAdapter = api.defaults.adapter
  api.defaults.adapter = async (config) => {
    assert.equal(config.url, '/v1/lang-schemas/vehicle_lang/attack-steps')
    assert.deepEqual(JSON.parse(config.data), { assetTypes: ['Child'], assetParents })
    return { data: { attackSteps: rows }, status: 200, headers: {}, config }
  }
  try {
    assert.deepEqual(await fetchAttackSteps('vehicle_lang', ['Child'], { assetParents }), rows)
  } finally {
    api.defaults.adapter = originalAdapter
  }
})

test('reloads when LangGraph ancestry changes even if the stencil type list stays the same', async () => {
  const languageGraph = Vue.ref({
    assets: [
      { name: 'Child', super_asset: 'Abstract' },
      { name: 'Abstract', isAbstract: true, super_asset: 'Root' },
      { name: 'Root' },
    ],
  })
  const calls = []
  const scope = Vue.effectScope()
  const catalog = scope.run(() =>
    useThreatCatalog('vehicle_lang', ['Child'], {
      languageGraph,
      load: async (schema, names, options) => {
        calls.push({ schema, names, ...options })
        return [{ ...rows[0], asset: 'Child', declared_asset: 'Root', inheritance_depth: 2 }]
      },
    }),
  )
  try {
    await settle()
    assert.deepEqual(calls[0].names, ['Child'])
    assert.deepEqual(calls[0].assetParents, { Child: 'Abstract', Abstract: 'Root', Root: '' })
    assert.equal(catalog.assets.value.get('Child')[0].attack_step_id, rows[0].attack_step_id)
    languageGraph.value.assets[1].super_asset = 'OtherRoot'
    await settle()
    assert.equal(calls.length, 2)
    assert.equal(calls[0].signal.aborted, true)
    assert.equal(calls[1].assetParents.Abstract, 'OtherRoot')
  } finally {
    scope.stop()
  }
})

test('inherited steps participate in CTSA and preserve scores by their original DB IDs per asset instance', () => {
  const inherited = groupAssetThreats([
    { ...rows[0], asset: 'GatewayECU', declared_asset: 'ECU', inheritance_depth: 1 },
    { ...rows[1], asset: 'GatewayECU', declared_asset: 'ECU', inheritance_depth: 1 },
  ]).get('GatewayECU')
  const draft = createCtsaDraft(inherited)
  for (const threat of draft.threats) for (const factor of threat.factors) factor.value = 4
  const metadata = serializeCtsaDraft(draft)
  assert.equal(metadata.riskScores[rows[0].attack_step_id], 4)
  assert.ok(!Object.hasOwn(metadata.steps, 'VehicleLang:GatewayECU.changeOperationMode'))
  assert.deepEqual(
    assessAssetThreats(inherited, JSON.parse(JSON.stringify(metadata))).map(
      (threat) => threat.riskScore,
    ),
    [4, 4],
  )
  assert.ok(assessAssetThreats(inherited).every((threat) => threat.riskScore === null))
})

test('the sample LangGraph provides the full imported ancestry for threat lookup', async () => {
  const { languageGraph } = parseLanguageGraph(
    await readFile(new URL('../../sample/vehicleLang_v2-langgraph.json', import.meta.url), 'utf8'),
  )
  const parents = getAssetParents(languageGraph)
  const chain = []
  let name = 'EthernetGatewayECU'
  while (name) {
    chain.push(name)
    name = parents[name]
  }
  assert.deepEqual(chain, ['EthernetGatewayECU', 'GatewayECU', 'ECU', 'Machine', 'Hardware'])
  assert.equal(parents.NetworkClient, 'Client')
  assert.equal(parents.Client, 'VehicularApplication')
  assert.equal(parents.VehicularApplication, 'Application')
  assert.equal(parents.SoftwareProduct, 'Information')
})

test('loads stencil types once and ignores late results after changing schema', async () => {
  const schema = Vue.ref('vehicle_lang')
  const types = Vue.ref(['ECU', 'Data', 'ECU'])
  const pending = []
  const scope = Vue.effectScope()
  const catalog = scope.run(() =>
    useThreatCatalog(schema, types, {
      load: (selected, names, { signal }) =>
        new Promise((resolve) => pending.push({ selected, names, signal, resolve })),
    }),
  )
  assert.deepEqual(pending[0].names, ['Data', 'ECU'])
  types.value = ['Data', 'ECU']
  await settle()
  assert.equal(pending.length, 1)
  schema.value = 'other_lang'
  await settle()
  assert.equal(pending[0].signal.aborted, true)
  pending[1].resolve([rows[2]])
  await settle()
  pending[0].resolve(rows)
  await settle()
  assert.equal(catalog.assets.value.has('ECU'), false)
  assert.equal(catalog.assets.value.get('Data').length, 1)
  schema.value = ''
  await settle()
  assert.equal(catalog.assets.value.size, 0)
  assert.equal(catalog.loading.value, false)
  scope.stop()
})

test('retries failed loads and aborts a pending request when the editor unmounts', async () => {
  let attempts = 0
  let signal
  const scope = Vue.effectScope()
  const catalog = scope.run(() =>
    useThreatCatalog('vehicle_lang', ['ECU'], {
      load: async (schema, names, options) => {
        signal = options.signal
        if (++attempts === 1) throw { response: { data: { error: 'Database unavailable' } } }
        return rows
      },
    }),
  )
  await settle()
  assert.equal(catalog.error.value, 'Database unavailable')
  assert.equal(catalog.assets.value.size, 0)
  catalog.retry()
  await settle()
  assert.equal(catalog.error.value, '')
  assert.equal(catalog.assets.value.get('ECU').length, 2)
  scope.stop()
  assert.equal(signal.aborted, true)
})

test('persists the diagram schema and restores file metadata without a manual schema setter', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  const values = new Map()
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key) => values.get(key),
      setItem: (key, value) => values.set(key, value),
    },
  })
  try {
    setActivePinia(createPinia())
    useThreatModelStore().createDiagram({ title: 'Vehicle', threatCatalogSchema: 'vehicle_lang' })
    setActivePinia(createPinia())
    const store = useThreatModelStore()
    assert.equal(store.data.threatCatalogSchema, 'vehicle_lang')
    assert.equal(store.setThreatCatalogSchema, undefined)
    store.initializeDiagramXml('initial graph', 'vehicle_lang')
    store.updateDiagramXml('edited graph')
    assert.equal(store.data.threatCatalogSchema, 'vehicle_lang')
    store.updateDiagramXml('imported graph', 'other_lang')
    assert.equal(store.data.threatCatalogSchema, 'other_lang')
    setActivePinia(createPinia())
    const restored = useThreatModelStore()
    assert.equal(restored.data.threatCatalogSchema, 'other_lang')
    assert.throws(() => restored.updateDiagramXml('invalid schema graph', null), /string/)
    assert.equal(restored.data.diagrams.xml, 'imported graph')
    restored.updateDiagramXml('no catalog graph', '')
    assert.equal(restored.data.threatCatalogSchema, '')
  } finally {
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original)
    else Reflect.deleteProperty(globalThis, 'sessionStorage')
  }
})

// Compile the real Vue component so these assertions check the rendered UI.
async function compileComponent(name, dependencies = {}) {
  const source = await readFile(new URL(`../src/components/${name}.vue`, import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const compiled = compileScript(descriptor, { id: name, inlineTemplate: true }).content
  const executable = compiled
    .replace(
      /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g,
      (_, names, from) =>
        `const { ${names.replace(/\bas\b/g, ':')} } = ${from === 'vue' ? 'Vue' : `dependencies[${JSON.stringify(from)}]`};`,
    )
    .replace(
      /import\s+(\w+)\s+from\s*['"]([^'"]+)['"];?/g,
      (_, name, from) => `const ${name} = dependencies[${JSON.stringify(from)}];`,
    )
    .replace('export default', 'return')
  return new Function('Vue', 'dependencies', executable)(Vue, dependencies)
}
const ThreatProperties = await compileComponent('ThreatProperties', {
  '@/services/ttpScoring.js': { riskScoreClass, riskScoreLabel },
})
const render = (props) => renderToString(Vue.createSSRApp(ThreatProperties, props))

test('ThreatProperties renders attack step names and risk scores without mapping badges', async () => {
  const html = await render({
    selectedElement: { assetType: 'ECU', label: 'Renamed instance' },
    catalogSchema: 'vehicle_lang',
    threats: groupAssetThreats(rows).get('ECU'),
  })
  assert.match(html, /changeOperationMode/)
  assert.match(html, /_hidden/)
  assert.equal((html.match(/Risk Score: -/g) || []).length, 2)
  assert.ok(!html.includes('T0858'))
  assert.ok(!html.includes('Threat mappings'))
  assert.ok(!html.includes('MITRE ATT'))
  assert.ok(!html.includes('attack-step-badge'))
  assert.match(html, /class="fw-semibold text-break mb-2 attack-step-name"/)
  assert.ok(!html.includes('UN R155'))
  assert.ok(!html.includes('CoreLang:Data'))
  assert.ok(!html.includes('Threat analysis is coming soon'))
})

test('ThreatProperties displays saved calculated risk scores, including zero', async () => {
  const threats = groupAssetThreats(rows).get('ECU')
  threats[0].riskScore = 3.3
  threats[1].riskScore = 0
  const html = await render({
    selectedElement: { assetType: 'ECU' },
    catalogSchema: 'vehicle_lang',
    threats,
  })
  assert.match(html, /Risk Score: 3\.3/)
  assert.match(html, /Risk Score: 0\.0/)
  assert.ok(!html.includes('Risk Score: -'))
})

test('the CTSA toolbar button follows assessment availability and explains disabled states', async () => {
  const SimulateButtons = await compileComponent('SimulateButtons', {
    '@/services/drawio/palette.js': { DRAWIO_EDITOR_KEY },
  })
  for (const available of [false, true]) {
    const html = await renderToString(
      Vue.createSSRApp(SimulateButtons).provide(DRAWIO_EDITOR_KEY, {
        perform() {},
        ctsaAvailable: Vue.ref(available),
        ctsaHint: Vue.ref('Select one MAL asset to assess its threats.'),
        endpointsAvailable: Vue.ref(false),
        endpointHint: Vue.ref('Select one MAL asset to set attack endpoints.'),
        selectedEndpoints: Vue.ref({}),
        pathOptions: Vue.reactive({ maxPaths: 30, maxHops: 40 }),
      }),
    )
    const button = html.match(/<button[^>]*aria-label="CTSA"[^>]*>/)[0]
    assert.equal(button.includes('disabled'), !available)
    assert.match(button, /Select one MAL asset/)
  }
})

test('Entry and Target toolbar buttons follow availability and show separate selected-asset counts', async () => {
  const SimulateButtons = await compileComponent('SimulateButtons', {
    '@/services/drawio/palette.js': { DRAWIO_EDITOR_KEY },
  })
  for (const available of [false, true]) {
    const html = await renderToString(
      Vue.createSSRApp(SimulateButtons).provide(DRAWIO_EDITOR_KEY, {
        perform() {},
        ctsaAvailable: Vue.ref(false),
        ctsaHint: Vue.ref(''),
        endpointsAvailable: Vue.ref(available),
        endpointHint: Vue.ref('Select one MAL asset to set attack endpoints.'),
        selectedEndpoints: Vue.ref({ entry: [{}, {}], target: [{}] }),
        pathOptions: Vue.reactive({ maxPaths: 30, maxHops: 40 }),
      }),
    )
    for (const label of ['Entry', 'Target']) {
      const button = html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))[0]
      assert.equal(button.includes('disabled'), !available)
      assert.match(button, /Select one MAL asset/)
    }
    assert.match(html, /Entry[\s\S]*?badge[^>]*>2<\/span>/)
    assert.match(html, /Target[\s\S]*?badge[^>]*>1<\/span>/)
  }
})

test('Find Paths stays disabled and Reset Paths reflects results and running work', async () => {
  const SimulateButtons = await compileComponent('SimulateButtons', {
    '@/services/drawio/palette.js': { DRAWIO_EDITOR_KEY },
  })
  for (const [available, searching, result] of [
    [false, false, null],
    [true, false, null],
    [false, true, null],
    [true, false, {}],
  ]) {
    const html = await renderToString(
      Vue.createSSRApp(SimulateButtons).provide(DRAWIO_EDITOR_KEY, {
        perform() {},
        selectedEndpoints: Vue.ref({}),
        pathsAvailable: Vue.ref(available),
        pathsHint: Vue.ref('Select at least one Entry and one Target.'),
        pathSearching: Vue.ref(searching),
        pathAnalysis: Vue.ref(result),
        pathOptions: Vue.reactive({ maxPaths: 30, maxHops: 40 }),
      }),
    )
    const find = html.match(
      /<button[^>]*title="Select at least one Entry and one Target\."[^>]*>/,
    )[0]
    const reset = html.match(/<button[^>]*aria-label="Reset Paths"[^>]*>/)[0]
    assert.equal(find.includes('disabled'), true)
    assert.equal(reset.includes('disabled'), !searching && !result)
    assert.match(html, /Candidates per Target/)
    assert.match(html, /Maximum main-route hops/)
  }
})

test('ThreatProperties marks each saved Entry and Target step independently', async () => {
  const html = await render({
    selectedElement: {
      assetType: 'ECU',
      attackEndpoints: {
        vehicle_lang: {
          entry: [{ attackStepId: rows[0].attack_step_id, name: rows[0].name }],
          target: [{ attackStepId: rows[1].attack_step_id, name: rows[1].name }],
        },
      },
    },
    catalogSchema: 'vehicle_lang',
    threats: groupAssetThreats(rows).get('ECU'),
  })
  assert.match(html, /changeOperationMode[\s\S]*?text-bg-primary[^>]*>Entry<\/span>/)
  assert.match(html, /_hidden[\s\S]*?text-bg-danger[^>]*>Target<\/span>/)
})

test('ThreatProperties distinguishes no selection, wrong element, no schema, loading, failure and no mappings', async () => {
  assert.match(await render({}), /Select an element/)
  assert.match(
    await render({ selectedElement: { isEdge: true, assetType: 'ECU' } }),
    /Select a MAL asset/,
  )
  const asset = { selectedElement: { assetType: 'ECU' } }
  assert.match(await render(asset), /Choose a DB Schema/)
  const selected = { ...asset, catalogSchema: 'vehicle_lang' }
  assert.match(await render({ ...selected, loading: true }), /Loading attack steps/)
  assert.match(await render({ ...selected, error: 'Database unavailable' }), /Database unavailable/)
  assert.match(await render(selected), /No attack steps are recorded/)
})

test('New Diagram renders the DB Schema selector before any LangGraph file is attached', async () => {
  const LangSchemaSelect = await compileComponent('LangSchemaSelect', {
    '@/services/threatCatalog.js': { catalogErrorMessage, fetchLangSchemas },
  })
  const CreateDiagramModal = await compileComponent('CreateDiagramModal', {
    bootstrap: { Modal: class {} },
    'vue-router': { useRouter: () => ({}) },
    '@/services/languageGraph.js': { parseLanguageGraph },
    '@/stores/threatModelStore.js': { useThreatModelStore },
    '@/components/LangSchemaSelect.vue': LangSchemaSelect,
  })
  const context = {}
  await renderToString(Vue.createSSRApp(CreateDiagramModal).use(createPinia()), context)
  const html = context.teleports.body
  assert.match(html, /id="language-graph-file"/)
  assert.match(html, /DB Schema \(Lang\)/)
  assert.match(html, /<select[^>]*id="diagram-lang-schema"/)
  assert.match(html, /No database catalog/)
})

test('Stencil has shapes and search without an editable DB Schema selector', async () => {
  const StencilPalette = await compileComponent('StencilPalette', {
    '@/components/StencilItem.vue': {
      props: ['shape', 'compatible', 'connectionSource'],
      setup: (props) => () => Vue.h('button', props.shape.label),
    },
    '@/services/drawio/palette.js': { createStencilGroups },
    '@/services/drawio/stencilConnections.js': { getStencilConnectionContext },
  })
  const html = await renderToString(
    Vue.createSSRApp(StencilPalette, {
      languageGraph: { assets: [{ name: 'ECU' }] },
    }),
  )
  assert.match(html, /Shapes/)
  assert.match(html, /Search shapes/)
  assert.match(html, /ECU/)
  assert.ok(!html.includes('DB Schema'))
  assert.ok(!html.includes('stencil-lang-schema'))
  assert.ok(!html.includes('<select'))
})
