import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { requireDiagram } from '../src/router/guards.js'
import {
  createAssetShapes,
  createStencilGroups,
  dfdShapes,
  generalShapes,
} from '../src/services/drawio/palette.js'
import { parseLanguageGraph } from '../src/services/languageGraph.js'
import { useThreatModelStore } from '../src/stores/threatModelStore.js'

const STORAGE_KEY = 'autotara.active-threat-model'
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
let savedValues

beforeEach(() => {
  savedValues = new Map()
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key) => savedValues.get(key) ?? null,
      setItem: (key, value) => savedValues.set(key, value),
    },
  })
  setActivePinia(createPinia())
})

afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'sessionStorage', originalStorage)
  else Reflect.deleteProperty(globalThis, 'sessionStorage')
})

test('creates a model with trimmed metadata and an empty XML diagram', () => {
  const store = useThreatModelStore()
  store.createDiagram({ title: '  차량 / ECU #1  ', version: ' 2.1 ', description: ' Test model ' })

  assert.equal(store.hasDiagram, true)
  assert.deepEqual(store.data.modelInfo, {
    title: '차량 / ECU #1',
    version: '2.1',
    description: 'Test model',
    template: 'manual',
  })
  assert.equal(store.data.version, '2.1')
  assert.deepEqual(store.data.diagrams, { xml: '', savedXml: '' })
  assert.equal(store.data.languageGraph, null)
})

test('rejects a whitespace-only title without replacing the current model', () => {
  const store = useThreatModelStore()
  store.createDiagram({ title: 'Original' })

  assert.throws(() => store.createDiagram({ title: '   ' }), /title/)
  assert.equal(store.data.modelInfo.title, 'Original')
})

test('retains the active model across a new Pinia instance in the same session', () => {
  useThreatModelStore().createDiagram({ title: 'Persisted model' })
  setActivePinia(createPinia())

  const restored = useThreatModelStore()
  assert.equal(restored.hasDiagram, true)
  assert.equal(restored.data.modelInfo.title, 'Persisted model')
  assert.equal(restored.data.version, '1.0.0')
})

test('ignores corrupt session data and legacy X6 diagrams', () => {
  for (const saved of [
    '{invalid',
    '{}',
    JSON.stringify({ modelInfo: { title: 'Old' }, diagrams: { cells: [] } }),
  ]) {
    savedValues.set(STORAGE_KEY, saved)
    setActivePinia(createPinia())
    assert.equal(useThreatModelStore().hasDiagram, false)
  }
})

test('allows creation when session storage is unavailable', () => {
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    get() {
      throw new Error('Storage is disabled')
    },
  })
  const store = useThreatModelStore()
  store.createDiagram({ title: 'In memory' })
  assert.equal(store.data.modelInfo.title, 'In memory')
})

test('accepts an exported MAL LangGraph and preserves the original source', () => {
  const source = {
    metadata: { version: '1.2.0' },
    AbstractAsset: { is_abstract: true, attack_steps: {} },
    ECU: { super_asset: 'AbstractAsset', attack_steps: { access: { type: 'or' } } },
  }
  const text = JSON.stringify(source)
  const document = parseLanguageGraph(text, 'vehicle.json')
  const store = useThreatModelStore()
  store.createDiagram(
    { title: 'Vehicle', version: document.languageGraph.metadata.version },
    document,
  )

  assert.equal(store.data.modelInfo.template, 'langgraph')
  assert.equal(store.data.modelInfo.version, '1.2.0')
  assert.deepEqual(store.data.languageGraphSource, source)
  assert.equal(store.data.languageGraphSourceText, text)
  assert.equal(store.data.languageGraph.fileName, 'vehicle.json')
  assert.deepEqual(
    store.data.languageGraph.assets.map((asset) => [asset.name, asset.isAbstract]),
    [
      ['AbstractAsset', true],
      ['ECU', false],
    ],
  )
})

test('accepts asset arrays and asset dictionaries from existing catalogs', () => {
  for (const assets of [[{ name: 'ECU', attackSteps: [] }], { ECU: { attack_steps: {} } }]) {
    const document = parseLanguageGraph(JSON.stringify({ assets }))
    assert.equal(document.languageGraph.assets[0].name, 'ECU')
  }
})

test('rejects invalid JSON, missing assets, unnamed assets, and abstract-only catalogs', () => {
  for (const source of [
    '{invalid',
    'null',
    '[]',
    '{}',
    '{"assets":[]}',
    '{"assets":[{}]}',
    '{"assets":{"ECU":null}}',
    '{"assets":[{"name":"Base","isAbstract":true}]}',
    '{"assets":{"Base":{"is_abstract":true}}}',
  ]) {
    assert.throws(() => parseLanguageGraph(source))
  }
})

function createTestRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'MainPage', component: { template: '<div />' } },
      { path: '/edit-diagram/:title', name: 'EditDiagram', component: { template: '<div />' } },
    ],
  })
  router.beforeEach(requireDiagram)
  return router
}

test('redirects direct editor access to home when no model has been created', async () => {
  const router = createTestRouter()
  await router.push('/edit-diagram/Unknown')
  assert.equal(router.currentRoute.value.name, 'MainPage')
})

test('opens titles with Korean and URL characters, and rejects a changed title parameter', async () => {
  const title = '차량 / ECU #1?'
  useThreatModelStore().createDiagram({ title })
  const router = createTestRouter()
  await router.push({ name: 'EditDiagram', params: { title } })

  assert.equal(router.currentRoute.value.name, 'EditDiagram')
  assert.equal(router.currentRoute.value.params.title, title)
  await router.push({ name: 'EditDiagram', params: { title: 'Different diagram' } })
  assert.equal(router.currentRoute.value.name, 'MainPage')
})

test('persists graph edits without replacing model metadata or the MAL catalog', () => {
  const document = parseLanguageGraph('{"assets":{"ECU":{"attack_steps":{}}}}', 'vehicle.json')
  const store = useThreatModelStore()
  store.createDiagram({ title: 'Vehicle', version: '2.0', description: 'Test' }, document)
  const xml =
    '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>'
  store.updateDiagramXml(xml)
  setActivePinia(createPinia())
  const restored = useThreatModelStore()
  assert.equal(restored.data.diagrams.xml, xml)
  assert.equal(restored.data.modelInfo.description, 'Test')
  assert.equal(restored.data.modelInfo.version, '2.0')
  assert.equal(restored.data.languageGraph.assets[0].name, 'ECU')
  assert.equal(restored.data.languageGraphSourceText, document.sourceText)
})

test('retains the last valid graph when an invalid update is attempted', () => {
  const store = useThreatModelStore()
  assert.throws(() => store.updateDiagramXml(''), /Create a diagram/)
  store.createDiagram({ title: 'Vehicle' })
  store.updateDiagramXml('<mxGraphModel/>')
  assert.throws(() => store.updateDiagramXml(null), /string/)
  assert.equal(store.data.diagrams.xml, '<mxGraphModel/>')
})

test('tracks the saved snapshot, including undo to the baseline and newer edits during saving', () => {
  const store = useThreatModelStore()
  store.createDiagram({ title: 'Vehicle' })
  assert.equal(store.hasUnsavedChanges, false)
  store.initializeDiagramXml('<mxGraphModel><root/></mxGraphModel>')
  assert.equal(store.hasUnsavedChanges, false)
  const empty = store.data.diagrams.xml
  store.updateDiagramXml('<mxGraphModel>first edit</mxGraphModel>')
  assert.equal(store.hasUnsavedChanges, true)
  const saved = store.data.diagrams.xml
  store.markDiagramSaved(saved)
  assert.equal(store.hasUnsavedChanges, false)
  store.updateDiagramXml('<mxGraphModel>second edit</mxGraphModel>')
  assert.equal(store.hasUnsavedChanges, true)
  store.updateDiagramXml(saved)
  assert.equal(store.hasUnsavedChanges, false)
  store.updateDiagramXml(empty)
  store.markDiagramSaved(saved)
  assert.equal(store.hasUnsavedChanges, true)
  assert.equal(store.data.diagrams.xml, empty)
  assert.throws(() => store.markDiagramSaved(null), /string/)
  assert.equal(store.hasUnsavedChanges, true)
})

test('restores saved and dirty state across sessions without treating initialization as a save', () => {
  let store = useThreatModelStore()
  store.createDiagram({ title: 'Vehicle' })
  store.initializeDiagramXml('empty')
  store.updateDiagramXml('saved graph')
  store.markDiagramSaved('saved graph')
  setActivePinia(createPinia())
  store = useThreatModelStore()
  assert.equal(store.hasUnsavedChanges, false)
  store.initializeDiagramXml('canonical saved graph')
  assert.equal(store.hasUnsavedChanges, false)
  store.updateDiagramXml('unsaved edit')
  setActivePinia(createPinia())
  store = useThreatModelStore()
  assert.equal(store.hasUnsavedChanges, true)
  store.initializeDiagramXml('canonical unsaved edit')
  assert.equal(store.hasUnsavedChanges, true)
  assert.equal(store.data.diagrams.savedXml, 'canonical saved graph')
  store.createDiagram({ title: 'New model' })
  assert.equal(store.hasUnsavedChanges, false)
})

test('legacy sessions without a save marker remain unsaved and storage failures do not erase the baseline', () => {
  savedValues.set(
    STORAGE_KEY,
    JSON.stringify({ modelInfo: { title: 'Old model' }, diagrams: { xml: 'old graph' } }),
  )
  const store = useThreatModelStore()
  assert.equal(store.hasUnsavedChanges, true)
  store.initializeDiagramXml('old graph')
  assert.equal(store.hasUnsavedChanges, true)
  globalThis.sessionStorage.setItem = () => {
    throw new Error('Quota exceeded')
  }
  store.markDiagramSaved('old graph')
  assert.equal(store.hasUnsavedChanges, false)
  store.updateDiagramXml('new graph')
  assert.equal(store.hasUnsavedChanges, true)
  assert.equal(store.data.diagrams.savedXml, 'old graph')
})

test('reports storage failures while retaining the current graph in memory', () => {
  const store = useThreatModelStore()
  store.createDiagram({ title: 'Vehicle' })
  globalThis.sessionStorage.setItem = () => {
    throw new Error('Quota exceeded')
  }
  store.updateDiagramXml('<mxGraphModel/>')
  assert.equal(store.data.diagrams.xml, '<mxGraphModel/>')
  assert.match(store.storageError, /Save a diagram file/)
})

test('MAL palette excludes abstract assets and defaults every concrete asset to Process', () => {
  const shapes = createAssetShapes({
    assets: [
      { name: 'Base', isAbstract: true },
      { name: 'LegacyBase', is_abstract: true },
      { name: 'ECU', dfdShape: 'process' },
      { name: 'Storage', dfdShape: 'store' },
      { name: 'Unknown', dfdShape: 'unknown' },
    ],
  })
  assert.deepEqual(
    shapes.map((shape) => shape.assetType),
    ['ECU', 'Storage', 'Unknown'],
  )
  for (const shape of shapes) {
    assert.equal(shape.icon, 'ellipse')
    assert.equal(shape.dfdShape, 'process')
    assert.equal(shape.style, dfdShapes[0].style)
    assert.equal(shape.width, shape.height)
  }
  assert.equal(dfdShapes[0].label, 'Process')
})

test('the vehicleLang sample creates 49 Process stencils and restores the same catalog', async () => {
  const source = await readFile(
    new URL('../../sample/vehicleLang_v2-langgraph.json', import.meta.url),
    'utf8',
  )
  const document = parseLanguageGraph(source, 'vehicleLang_v2-langgraph.json')
  useThreatModelStore().createDiagram({ title: 'Vehicle' }, document)
  setActivePinia(createPinia())
  const restored = useThreatModelStore()
  const shapes = createAssetShapes(restored.data.languageGraph)
  const concreteNames = Object.values(JSON.parse(source))
    .filter((asset) => asset.name && !asset.is_abstract)
    .map((asset) => asset.name)
  assert.equal(shapes.length, 49)
  assert.deepEqual(
    shapes.map((shape) => shape.label),
    concreteNames,
  )
  for (const shape of shapes) {
    assert.equal(shape.assetType, shape.label)
    assert.equal(shape.dfdShape, 'process')
    assert.equal(shape.style, dfdShapes[0].style)
  }
  assert.equal(restored.data.languageGraphSourceText, source)
  const groups = createStencilGroups(restored.data.languageGraph)
  const malGroups = groups.filter((group) => group.id !== 'general')
  const byCategory = new Map(
    malGroups.map((group) => [group.title, group.shapes.map((shape) => shape.label)]),
  )
  assert.equal(malGroups.flatMap((group) => group.shapes).length, 49)
  assert.equal(
    new Set(malGroups.flatMap((group) => group.shapes.map((shape) => shape.id))).size,
    49,
  )
  assert.ok(byCategory.get('Hardware').includes('EthernetGatewayECU'))
  assert.ok(byCategory.get('Application').includes('FirmwareUpdaterService'))
  assert.ok(byCategory.get('Network').includes('J1939Network'))
  assert.deepEqual(byCategory.get('Dataflow'), [
    'ConnectionlessDataflow',
    'ConnectionOrientedDataflow',
  ])
  assert.deepEqual(byCategory.get('Vulnerability'), [
    'HardwareVulnerability',
    'SoftwareVulnerability',
  ])
  assert.equal(groups.at(-1).title, 'General')
})

test('groups MAL assets by explicit category or inherited root and searches categories and names', () => {
  const languageGraph = {
    assets: [
      { name: 'Root', isAbstract: true },
      { name: 'Child', superAsset: 'Root', isAbstract: true },
      { name: 'Leaf', super_asset: 'Child' },
      { name: 'Typed', category: ' Custom ', super_asset: 'Root' },
      { name: 'Standalone' },
      { name: 'MissingParent', super_asset: 'Unknown' },
      { name: 'CycleA', super_asset: 'CycleB' },
      { name: 'CycleB', super_asset: 'CycleA' },
      { name: 'One', category: 'A B' },
      { name: 'Two', category: 'A-B' },
    ],
  }
  const groups = createStencilGroups(languageGraph)
  const categoryFor = (name) =>
    groups.find((group) => group.shapes.some((shape) => shape.label === name))?.title
  assert.equal(categoryFor('Leaf'), 'Root')
  assert.equal(categoryFor('Typed'), 'Custom')
  assert.equal(categoryFor('Standalone'), 'Standalone')
  assert.equal(categoryFor('MissingParent'), 'MissingParent')
  assert.equal(categoryFor('CycleA'), 'Uncategorized')
  assert.equal(categoryFor('CycleB'), 'Uncategorized')
  assert.equal(new Set(groups.map((group) => group.id)).size, groups.length)
  assert.deepEqual(
    createStencilGroups(languageGraph, ' rOoT ').map((group) =>
      group.shapes.map((shape) => shape.label),
    ),
    [['Leaf']],
  )
  assert.deepEqual(
    createStencilGroups(languageGraph, 'typed').map((group) => group.title),
    ['Custom'],
  )
  assert.deepEqual(createStencilGroups(languageGraph, 'no match'), [])
})

test('offers all DFD shapes and Text under General without a separate DFD group', () => {
  assert.deepEqual(
    generalShapes.map((shape) => shape.id),
    ['process', 'actor', 'store', 'boundary', 'text'],
  )
  assert.deepEqual(createStencilGroups(null), [
    { id: 'general', title: 'General', shapes: generalShapes },
  ])
  assert.deepEqual(
    createStencilGroups(null, 'store')[0].shapes.map((shape) => shape.id),
    ['store'],
  )
  for (const shape of dfdShapes) {
    assert.match(shape.style, /fillColor=none;/)
    assert.match(
      shape.style,
      shape.id === 'boundary' ? /strokeColor=#ff0000;/ : /strokeColor=#000000;/,
    )
  }
  assert.match(dfdShapes[0].style, /aspect=fixed;/)
  assert.match(dfdShapes[2].style, /shape=partialRectangle;/)
  assert.match(dfdShapes[2].style, /top=1;bottom=1;left=0;right=0;/)
})
