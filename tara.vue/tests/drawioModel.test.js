import { buildAttackGraph } from '../src/services/attackGraph.js'
import { findAttackPaths } from '../src/services/attackPaths.js'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { test } from 'node:test'
import { DOMImplementation, DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { parse as parseYaml } from 'yaml'
import { createPinia } from 'pinia'
import { getDrawioAssets } from '../build/drawioAssets.js'
import {
  createDrawioFile,
  decompressDiagramText,
  readDiagramModel,
  serializeModel,
} from '../src/services/drawio/xml.js'
import { configureGraphBehavior } from '../src/services/drawio/graphBehavior.js'
import {
  configureCellLabels,
  getCellProperties,
  updateCellProperties,
} from '../src/services/drawio/properties.js'
import { normalizeDfdCells, registerDrawioShapes } from '../src/services/drawio/shapes.js'
import { dfdShapes } from '../src/services/drawio/palette.js'
import { createEditorHistory } from '../src/services/drawio/history.js'
import { configureAssociations } from '../src/services/drawio/associations.js'
import { getModelSnapshot } from '../src/services/drawio/modelSnapshot.js'
import { createCrraDraft } from '../src/services/crra.js'
import { readCrraAssessments, updateCrraAssessment } from '../src/services/drawio/crraMetadata.js'
import { getStencilConnectionContext } from '../src/services/drawio/stencilConnections.js'
import { configureFlowAssociations } from '../src/services/drawio/flowAssociations.js'
import { parseLanguageGraph } from '../src/services/languageGraph.js'
import { prepareMalExport, serializeMalModel } from '../src/services/malModel.js'
import { useThreatModelStore } from '../src/stores/threatModelStore.js'
import { createAttackTreeDiagram } from '../src/services/drawio/attackTree.js'
import { createSimulationResultDiagram } from '../src/services/drawio/simulationResult.js'
import {
  buildSimulationResultGraph,
  layoutSimulationResult,
} from '../src/services/simulationResult.js'
import { createCompromisedAssetHighlights } from '../src/services/drawio/compromisedAssets.js'
import { buildCandidateAttackTree, layoutAttackTree } from '../src/services/attackTree.js'
import {
  convertMalModelToDrawio,
  prepareDiagramFile,
  readDiagramFile,
} from '../src/services/drawio/import.js'
import { assessAssetThreats, createCtsaDraft } from '../src/services/ttpScoring.js'
import { groupAssetThreats } from '../src/services/threatCatalog.js'
import { mergeLanguageAttackSteps } from '../src/services/languageAttackSteps.js'
import { createSusceptibilityMatrix } from '../src/services/susceptibilityMatrix.js'
import {
  readThreatAssessments,
  updateThreatAssessments,
} from '../src/services/drawio/threatAssessments.js'
import {
  initializeDiagramSchema,
  readDiagramSchema,
  writeDiagramSchema,
} from '../src/services/drawio/diagramMetadata.js'
import {
  readAttackEndpoints,
  updateAttackEndpoints,
} from '../src/services/drawio/attackEndpoints.js'

// Load the actual shipped draw.io core. Only browser capability detection is stubbed;
// these tests exercise models, history and layout, and do not claim to test rendering.
const element = () => ({
  style: {},
  setAttribute() {},
  getAttribute() {
    return null
  },
  appendChild() {},
  getElementsByTagName() {
    return []
  },
  addEventListener() {},
  removeEventListener() {},
  getBoundingClientRect: () => ({ left: 0, top: 0 }),
})
const document = {
  implementation: new DOMImplementation(),
  documentElement: element(),
  body: element(),
  location: { href: 'http://localhost/' },
  createElement: element,
  createElementNS: element,
  getElementsByTagName() {
    return [element()]
  },
  getElementById() {
    return null
  },
  addEventListener() {},
  removeEventListener() {},
}
const runtime = {
  // mxGraph probes HTML parsing at startup; this XML-only DOM rejects that
  // probe without printing an expected parser error to the test output.
  DOMParser: class extends DOMParser {
    constructor() {
      super({
        onError: (_level, message) => {
          throw new Error(message)
        },
      })
    }
  },
  XMLSerializer,
  Element: document.implementation.createDocument(null, 'object', null).documentElement.constructor,
  document,
  location: document.location,
  navigator: {
    userAgent: 'Mozilla/5.0',
    vendor: '',
    appVersion: 'Linux',
    platform: 'Linux',
    appName: 'Netscape',
  },
  mxLoadResources: false,
  mxLoadStylesheets: false,
  setTimeout,
  clearTimeout,
  console,
  atob,
  addEventListener() {},
  removeEventListener() {},
}
runtime.window = runtime
vm.createContext(runtime)
const assets = await getDrawioAssets()
vm.runInContext(await readFile(assets.get('mxgraph/mxClient.js'), 'utf8'), runtime)
vm.runInContext(await readFile(assets.get('pako.min.js'), 'utf8'), runtime)
registerDrawioShapes(runtime)

function createGraph() {
  const graph = new runtime.mxGraph()
  graph.view.validate = () => {}
  graph.cellEditor = graph.createCellEditor()
  configureGraphBehavior(graph, runtime)
  configureCellLabels(graph, runtime)
  return graph
}

test('CRRA inputs and selections survive draw.io export/reopen and update in one undo step', () => {
  const graph = createGraph()
  writeDiagramSchema(graph.model, runtime, 'vehicle_lang')
  const history = trackHistory(graph)
  const before = serializeModel(graph.model, runtime)
  const draft = createCrraDraft({
    selectedAvIds: ['T0800'],
    selectedCmIds: ['M0800'],
    weights: { P: 2, R: 1 },
    strategy: { high: { total: 1 } },
    overrides: {
      M0800: {
        cost: 2,
        costBasis: 'Reviewed estimate',
        mappings: {
          T0800: { effects: [{ type: 'P', level: 'High' }], basis: 'Engineering verification' },
        },
      },
    },
  })
  updateCrraAssessment(graph.model, runtime, 'vehicle_lang', draft)
  const after = serializeModel(graph.model, runtime)
  assert.notEqual(after, before)
  assert.deepEqual(getModelSnapshot(graph).metadata.crra.vehicle_lang, draft)
  const reopened = readDiagramModel(createDrawioFile(graph.model, 'CRRA', runtime), runtime)
  assert.deepEqual(readCrraAssessments(reopened).vehicle_lang, draft)
  assert.equal(serializeModel(graph.model, runtime), after)
  updateCrraAssessment(graph.model, runtime, 'vehicle_lang', draft)
  history.undo()
  assert.equal(serializeModel(graph.model, runtime), before)
  history.redo()
  assert.equal(serializeModel(graph.model, runtime), after)
})

test('read-only Attack Tree redraw replaces old cells without touching the Diagram or its undo history', () => {
  const original = createGraph(),
    history = trackHistory(original)
  original.insertVertex(original.getDefaultParent(), 'original', 'ECU', 0, 0, 100, 100)
  const saved = serializeModel(original.model, runtime)
  let treeGraph,
    disconnected = false
  const events = new Set(),
    selections = []
  const container = {
    addEventListener: (name) => events.add(name),
    removeEventListener: (name) => events.delete(name),
  }
  const previousObserver = globalThis.ResizeObserver
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {
      disconnected = true
    }
  }
  let diagram
  try {
    diagram = createAttackTreeDiagram({
      container,
      runtime: {
        ...runtime,
        mxGraph: function () {
          treeGraph = createGraph()
          treeGraph.panningHandler = { destroy() {} }
          return treeGraph
        },
      },
      onSelect: (item) => selections.push(item),
    })
    const data = {
      nodes: ['or', 'and', 'or', 'or'].map((type, i) => ({
        id: String(i),
        name: `step${i}`,
        asset: 'ECU',
        type,
      })),
      edges: [
        [0, 1],
        [1, 3],
        [2, 1],
        [0, 3],
      ].map(([a, b]) => ({ source: String(a), target: String(b) })),
      entryIds: ['0'],
      targetIds: ['3'],
    }
    const tree = buildCandidateAttackTree(data, ['0', '1', '3'])
    diagram.render(layoutAttackTree(tree))
    assert.equal(treeGraph.isCellsDeletable(), false)
    assert.equal(treeGraph.getChildVertices(treeGraph.getDefaultParent()).length, 4)
    assert.equal(selections.at(-1).node.id, '3')
    diagram.render(layoutAttackTree(buildCandidateAttackTree(data, ['0', '3'])))
    assert.equal(treeGraph.getChildVertices(treeGraph.getDefaultParent()).length, 2)
    assert.equal(treeGraph.getChildEdges(treeGraph.getDefaultParent()).length, 1)
    assert.deepEqual(
      Array.from(
        treeGraph.getChildVertices(treeGraph.getDefaultParent()),
        (cell) => cell.value.item.node.id,
      ),
      ['3', '0'],
    )
    diagram.render(layoutAttackTree(tree, new Set([tree.root.id])))
    assert.equal(treeGraph.getChildVertices(treeGraph.getDefaultParent()).length, 1)
    assert.equal(treeGraph.getChildEdges(treeGraph.getDefaultParent()).length, 0)
    assert.equal(serializeModel(original.model, runtime), saved)
    history.undo()
    assert.equal(original.getChildVertices(original.getDefaultParent()).length, 0)
  } finally {
    diagram?.destroy()
    if (previousObserver === undefined) delete globalThis.ResizeObserver
    else globalThis.ResizeObserver = previousObserver
  }
  assert.equal(disconnected, true)
  assert.equal(events.size, 0)
})

test('Simulator Result native dragging and edge routing survive collapse/filter and reset independently of the Diagram', (context) => {
  stubHandleDom(context)
  const original = createGraph()
  original.insertVertex(original.getDefaultParent(), 'original', 'Original model', 0, 0, 100, 100)
  const saved = serializeModel(original.model, runtime)
  const input = {
    performedNodes: [
      ['E', 'Browser', 0],
      ['A', 'Browser', 1],
      ['T', 'Gateway', 2],
      ['O', 'Off-path', 2],
    ].map(([id, asset, performedAt]) => ({ id, asset, performedAt, name: id, type: 'or' })),
    performedEdges: [
      ['E', 'A'],
      ['A', 'T'],
      ['E', 'T'],
      ['A', 'O'],
    ].map(([source, target]) => ({ source, target })),
    entryIds: ['E'],
    targetIds: ['T'],
    targets: [{ id: 'T', reached: true }],
  }
  Object.assign(
    input.performedNodes.find((node) => node.id === 'T'),
    { riskAssessed: true, riskScore: 4, ctsaScore: null },
  )
  const before = structuredClone(input)
  const data = buildSimulationResultGraph(input)
  const expanded = new Set(data.assets.map((asset) => asset.id))
  const browser = data.assets.find((asset) => asset.name === 'Browser')
  const asset = () =>
    resultGraph
      .getChildVertices(resultGraph.getDefaultParent())
      .find((cell) => cell.value.asset.id === browser.id)
  const step = (id) =>
    resultGraph.getChildVertices(asset()).find((cell) => cell.value.node.id === id)
  const connections = () =>
    resultGraph.model.filterDescendants((cell) => resultGraph.model.isEdge(cell))
  const edge = (source, target) =>
    connections().find(
      (cell) => cell.source.value.node?.id === source && cell.target.value.node?.id === target,
    )
  const move = (cell, dx, dy) => {
    const handler = resultGraph.graphHandler
    handler.cell = cell
    handler.scrollOnMove = false
    assert.equal(handler.getCells(cell)[0], cell)
    handler.moveCells([cell], dx, dy, false, null, null)
  }
  let resultGraph
  const toggled = []
  const previousObserver = globalThis.ResizeObserver
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
  let diagram
  try {
    diagram = createSimulationResultDiagram({
      container: { addEventListener() {}, removeEventListener() {} },
      onToggleAsset: (id) => toggled.push(id),
      runtime: {
        ...runtime,
        mxGraph: function () {
          resultGraph = new runtime.mxGraph()
          resultGraph.view.validate = () => {}
          resultGraph.scrollCellToVisible = () => {}
          resultGraph.panningHandler = { destroy() {} }
          return resultGraph
        },
      },
    })
    diagram.render(layoutSimulationResult(data, expanded))
    assert(resultGraph.isCellMovable(asset()))
    assert(resultGraph.isCellResizable(asset()))
    assert(resultGraph.isCellMovable(step('A')))
    const targetStep = resultGraph.model.filterDescendants(
      (cell) => cell.value?.node?.id === 'T',
    )[0]
    assert(resultGraph.isHtmlLabel(targetStep))
    assert.match(resultGraph.convertValueToString(targetStep), /CTSA Score: 4.0/)
    assert.match(targetStep.value.htmlLabel, /badge rounded-pill text-bg-danger/)
    assert.equal(targetStep.geometry.height, 88)
    assert(resultGraph.isCellSelectable(edge('A', 'T')))
    assert(resultGraph.isCellBendable(edge('A', 'T')))
    assert(!resultGraph.isCellDisconnectable(edge('A', 'T')))
    assert(!resultGraph.isConnectable())
    assert(!resultGraph.isCellsCloneable())
    assert(!resultGraph.graphHandler.isRemoveCellsFromParent())
    const assetState = new runtime.mxCellState(
      resultGraph.view,
      asset(),
      resultGraph.getCellStyle(asset()),
    )
    const drag = resultGraph.graphHandler
    resultGraph.view.states.put(asset(), assetState)
    const stepState = new runtime.mxCellState(
      resultGraph.view,
      step('A'),
      resultGraph.getCellStyle(step('A')),
    )
    const isHandled = resultGraph.selectionCellsHandler.isHandled
    resultGraph.selectionCellsHandler.isHandled = (cell) => cell === asset()
    resultGraph.setSelectionCell(asset())
    assert.equal(
      drag.isDelayedSelection(step('A'), pointerAt(stepState, 30, 170, 'mousedown')),
      false,
    )
    resultGraph.selectionCellsHandler.isHandled = isHandled
    resultGraph.clearSelection()
    assert.equal(drag.getInitialCellForEvent(pointerAt(stepState, 30, 170, 'mousedown')), step('A'))
    resultGraph.view.states.remove(asset())
    const releaseClick = pointerAt(assetState, 10, 10, 'mouseup')
    drag.cell = asset()
    drag.cellWasClicked = true
    drag.mouseUp(resultGraph, releaseClick)
    resultGraph.click(releaseClick)
    assert(!releaseClick.isConsumed())
    assert.deepEqual(toggled, [browser.id])
    // Finishing a native drag moves the asset but must not toggle its steps.
    const releaseDrag = pointerAt(assetState, 80, 40, 'mouseup')
    drag.cell = asset()
    drag.cells = [asset()]
    drag.cellWasClicked = true
    drag.first = new runtime.mxPoint(10, 10)
    drag.currentDx = 70
    drag.currentDy = 30
    drag.shape = { destroy() {} }
    drag.scrollOnMove = false
    drag.mouseUp(resultGraph, releaseDrag)
    resultGraph.click(releaseDrag)
    assert(releaseDrag.isConsumed())
    assert.deepEqual([asset().geometry.x, asset().geometry.y], [94, 54])
    assert.equal(toggled.length, 1)
    assert(!resultGraph.isCellEditable(step('A')))
    resultGraph.startEditingAtCell(edge('A', 'T'))
    assert(!resultGraph.isEditing())
    const edgeState = new runtime.mxCellState(
      resultGraph.view,
      edge('A', 'T'),
      resultGraph.getCellStyle(edge('A', 'T')),
    )
    edgeState.absolutePoints = [
      new runtime.mxPoint(10, 10),
      new runtime.mxPoint(10, 150),
      new runtime.mxPoint(250, 150),
    ]
    edgeState.shape = new runtime.mxPolyline()
    const edgeHandler = resultGraph.createEdgeHandler(edgeState, runtime.mxEdgeStyle.OrthConnector)
    try {
      edgeHandler.getHandleForEvent = () => 1
      const press = pointerAt(edgeState, 10, 80, 'mousedown')
      press.getEvent().buttons = 1
      edgeHandler.mouseDown(resultGraph, press)
      assert.equal(edgeHandler.handle, 1)
      edgeHandler.index = null
      edgeHandler.start(10, 10, 0)
      assert.equal(edgeHandler.index, null)
      edgeHandler.start(10, 80, 1)
      assert.equal(edgeHandler.index, 1)
    } finally {
      edgeHandler.destroy()
    }

    move(asset(), 240, 80)
    resultGraph.resizeCell(
      asset(),
      new runtime.mxRectangle(asset().geometry.x, asset().geometry.y, 640, 400),
    )
    move(step('A'), 90, 60)
    assert.equal(step('A').parent, asset())
    assert.deepEqual([step('A').geometry.x, step('A').geometry.y], [114, 216])
    // A step stays below its asset header, even if dragged far above it.
    move(step('E'), 0, -500)
    assert.equal(step('E').geometry.y, 72)
    const position = [asset().geometry.x, asset().geometry.y]
    const route = [new runtime.mxPoint(800, 40), new runtime.mxPoint(800, 280)]
    runtime.mxEdgeHandler.prototype.changePoints.call(
      { graph: resultGraph },
      edge('A', 'T'),
      route,
      false,
    )
    runtime.mxEdgeHandler.prototype.changePoints.call(
      { graph: resultGraph },
      edge('E', 'A'),
      [new runtime.mxPoint(580, 100)],
      false,
    )
    const points = (cell) => Array.from(cell.geometry.points || [], (point) => [point.x, point.y])
    assert.deepEqual(points(edge('A', 'T')), [
      [800, 40],
      [800, 280],
    ])

    diagram.render(layoutSimulationResult(data))
    assert.deepEqual([asset().geometry.x, asset().geometry.y], position)
    assert.equal(asset().geometry.height, 120)
    diagram.render(
      layoutSimulationResult(
        buildSimulationResultGraph(input, { targetPathsOnly: true }),
        expanded,
      ),
    )
    assert.deepEqual([asset().geometry.x, asset().geometry.y], position)
    assert.deepEqual([asset().geometry.width, asset().geometry.height], [640, 400])
    assert.deepEqual([step('A').geometry.x, step('A').geometry.y], [114, 216])
    assert.deepEqual(points(edge('A', 'T')), [
      [800, 40],
      [800, 280],
    ])
    assert.deepEqual(points(edge('E', 'A')), [[580, 100]])
    assert.equal(edge('A', 'T').source, step('A'))
    assert.equal(edge('A', 'T').target.value.node.id, 'T')
    assert.equal(connections().length, 3)
    diagram.render(layoutSimulationResult(data, expanded))
    assert.equal(connections().length, 4)
    assert.deepEqual(points(edge('A', 'T')), [
      [800, 40],
      [800, 280],
    ])

    diagram.render(layoutSimulationResult(data, expanded), { resetLayout: true })
    assert.deepEqual([asset().geometry.x, asset().geometry.y], [24, 24])
    assert.deepEqual([asset().geometry.width, asset().geometry.height], [320, 248])
    assert.deepEqual([step('A').geometry.x, step('A').geometry.y], [24, 156])
    assert.deepEqual(points(edge('A', 'T')), [])
    // Automatic routes use floating perimeter points. Moving a target changes
    // the attachment continuously, rather than snapping to fixed ports.
    diagram.render(layoutSimulationResult(data), { resetLayout: true })
    const gateway = resultGraph
      .getChildVertices(resultGraph.getDefaultParent())
      .find((cell) => cell.value.asset.name === 'Gateway')
    const blocker = resultGraph
      .getChildVertices(resultGraph.getDefaultParent())
      .find((cell) => cell.value.asset.name === 'Off-path')
    const summary = connections().find((cell) => cell.source === asset() && cell.target === gateway)
    assert(!/entry[XY]=|exit[XY]=/.test(summary.style))
    const rectangleState = (cell) => {
      const state = new runtime.mxCellState(resultGraph.view, cell, resultGraph.getCellStyle(cell))
      Object.assign(state, cell.geometry)
      return state
    }
    const routedPoints = () => {
      const sourceState = rectangleState(asset()),
        targetState = rectangleState(gateway)
      const state = new runtime.mxCellState(
        resultGraph.view,
        summary,
        resultGraph.getCellStyle(summary),
      )
      resultGraph.view.updateFixedTerminalPoints(state, sourceState, targetState)
      resultGraph.view.updatePoints(state, null, sourceState, targetState)
      resultGraph.view.updateFloatingTerminalPoints(state, sourceState, targetState)
      return Array.from(state.absolutePoints, (point) => ({ x: point.x, y: point.y }))
    }
    const initialPort = routedPoints()[0]
    move(gateway, 0, 94 - gateway.geometry.y)
    const floatingPort = routedPoints()[0]
    assert.notEqual(initialPort.y, floatingPort.y)
    const fraction = (floatingPort.y - asset().geometry.y) / asset().geometry.height
    assert([0, 0.5, 1].every((fixed) => Math.abs(fraction - fixed) > 0.01))
    resultGraph.resizeCell(blocker, new runtime.mxRectangle(384, 60, 100, 140))
    const detour = routedPoints()
    assert(detour.length > 2)
    for (let index = 1; index < detour.length; index++)
      for (let sample = 0; sample <= 100; sample++) {
        const a = detour[index - 1],
          b = detour[index]
        const x = a.x + ((b.x - a.x) * sample) / 100,
          y = a.y + ((b.y - a.y) * sample) / 100
        assert(
          !(x > 384 && x < 484 && y > 60 && y < 200),
          'automatic connection crossed another asset',
        )
      }
    assert.deepEqual(input, before)
    assert.equal(serializeModel(original.model, runtime), saved)
  } finally {
    diagram?.destroy()
    original.destroy()
    if (previousObserver === undefined) delete globalThis.ResizeObserver
    else globalThis.ResizeObserver = previousObserver
  }
})

// Real XML nodes allow native mxCodec persistence checks without a browser renderer.
function userObject(attributes) {
  const value = document.implementation.createDocument(null, 'object', null).documentElement
  for (const [key, valueText] of Object.entries(attributes))
    value.setAttribute(key, String(valueText))
  return value
}

function trackHistory(graph) {
  const history = new runtime.mxUndoManager()
  graph.model.addListener(runtime.mxEvent.UNDO, (_, event) =>
    history.undoableEditHappened(event.getProperty('edit')),
  )
  return history
}

test('the fixed diagram schema survives draw.io, compressed XML and MAL YAML even without CTSA evaluations', async () => {
  const { languageGraph } = parseLanguageGraph(
    await readFile(new URL('../../sample/vehicleLang_v2-langgraph.json', import.meta.url), 'utf8'),
  )
  for (const schema of ['vehicle_lang', '']) {
    const graph = createGraph()
    insertMalAsset(graph, 'ECU')
    assert.equal(initializeDiagramSchema(graph.model, runtime, schema), schema)
    assert.equal(initializeDiagramSchema(graph.model, runtime, 'different_lang'), schema)
    const snapshot = getModelSnapshot(graph)
    assert.equal(snapshot.metadata.threatCatalogSchema, schema)
    const before = serializeModel(graph.model, runtime)
    const xml = createDrawioFile(graph.model, 'Fixed schema', runtime)
    assert.equal(readDiagramSchema(readDiagramFile(xml, languageGraph, runtime)), schema)
    const compressed = btoa(
      String.fromCharCode(...runtime.pako.deflateRaw(encodeURIComponent(before))),
    )
    assert.equal(
      readDiagramSchema(
        readDiagramFile(
          `<mxfile><diagram>${compressed}</diagram></mxfile>`,
          languageGraph,
          runtime,
        ),
      ),
      schema,
    )
    const yaml = serializeMalModel(prepareMalExport(snapshot, languageGraph))
    assert.equal(parseYaml(yaml).metadata.threatCatalogSchema, schema)
    assert.equal(readDiagramSchema(readDiagramFile(yaml, languageGraph, runtime)), schema)
    assert.equal(serializeModel(graph.model, runtime), before)
    graph.destroy()
  }
})

test('legacy diagrams resolve an assessment schema or the creation choice, and explicit metadata stays fixed', () => {
  const graph = createGraph()
  const cell = insertMalAsset(graph, 'ECU')
  const draft = createCtsaDraft([{ attack_step_id: 'VehicleLang:ECU.connect' }])
  updateThreatAssessments(graph, cell, 'vehicle_lang', draft, 'ECU')
  assert.equal(readDiagramSchema(graph.model), null)
  assert.equal(initializeDiagramSchema(graph.model, runtime, 'creation_lang'), 'vehicle_lang')
  assert.equal(initializeDiagramSchema(graph.model, runtime, 'other_lang'), 'vehicle_lang')
  const empty = new runtime.mxGraphModel()
  assert.equal(initializeDiagramSchema(empty, runtime, 'creation_lang'), 'creation_lang')
  const multiple = createGraph()
  const otherCell = insertMalAsset(multiple, 'ECU')
  updateThreatAssessments(multiple, otherCell, 'vehicle_lang', draft, 'ECU')
  updateThreatAssessments(multiple, otherCell, 'another_lang', draft, 'ECU')
  assert.equal(initializeDiagramSchema(multiple.model, runtime, 'creation_lang'), 'creation_lang')
  graph.destroy()
  multiple.destroy()
})

test('loading a different graph and undoing it keep the stored schema aligned with graph metadata', () => {
  const graph = createGraph()
  initializeDiagramSchema(graph.model, runtime, 'vehicle_lang')
  const store = useThreatModelStore(createPinia())
  store.createDiagram({ title: 'Fixed schema', threatCatalogSchema: 'vehicle_lang' })
  store.initializeDiagramXml(serializeModel(graph.model, runtime), readDiagramSchema(graph.model))
  const history = createEditorHistory(graph, runtime)
  const changed = () =>
    store.updateDiagramXml(serializeModel(graph.model, runtime), readDiagramSchema(graph.model))
  graph.model.addListener(runtime.mxEvent.CHANGE, changed)
  const imported = new runtime.mxGraphModel()
  writeDiagramSchema(imported, runtime, 'different_lang')
  graph.model.setRoot(imported.getRoot())
  assert.equal(store.data.threatCatalogSchema, 'different_lang')
  history.undo()
  assert.equal(store.data.threatCatalogSchema, 'vehicle_lang')
  assert.equal(store.hasUnsavedChanges, false)
  history.redo()
  assert.equal(store.data.threatCatalogSchema, 'different_lang')
  graph.model.removeListener(changed)
  history.destroy()
  graph.destroy()
})

test('Entry and Target persist per asset and schema, clear independently, and update dirty state in one undo step', () => {
  const graph = createGraph()
  const asset = insertMalAsset(graph, 'ECU')
  const otherAsset = insertMalAsset(graph, 'ECU', 200)
  const step = { attackStepId: 'CoreLang:HardwareAccess.access', name: 'access' }
  const target = {
    attackStepId: 'VehicleLang:ECU.changeOperationMode',
    name: 'changeOperationMode',
  }
  const history = createEditorHistory(graph, runtime)
  const store = useThreatModelStore(createPinia())
  store.createDiagram({ title: 'Endpoints', threatCatalogSchema: 'vehicle_lang' })
  store.initializeDiagramXml(serializeModel(graph.model, runtime))
  const changed = () => store.updateDiagramXml(serializeModel(graph.model, runtime))
  graph.model.addListener(runtime.mxEvent.CHANGE, changed)

  updateAttackEndpoints(graph, asset, 'vehicle_lang', 'entry', [step, target], 'ECU')
  assert.equal(history.history.history.length, 1)
  assert.equal(store.hasUnsavedChanges, true)
  const saved = readAttackEndpoints(asset.value)
  assert.deepEqual(saved.vehicle_lang.entry, [step, target])
  assert.deepEqual(getCellProperties(graph, otherAsset).attackEndpoints, {})
  history.undo()
  assert.deepEqual(readAttackEndpoints(asset.value), {})
  assert.equal(store.hasUnsavedChanges, false)
  history.redo()
  assert.deepEqual(readAttackEndpoints(asset.value), saved)
  const edits = history.history.history.length
  updateAttackEndpoints(graph, asset, 'vehicle_lang', 'entry', [target, step, step], 'ECU')
  assert.equal(history.history.history.length, edits)

  updateAttackEndpoints(graph, asset, 'vehicle_lang', 'target', [target], 'ECU')
  updateAttackEndpoints(graph, asset, 'other_lang', 'entry', [step], 'ECU')
  updateAttackEndpoints(graph, asset, 'vehicle_lang', 'entry', [], 'ECU')
  assert.deepEqual(readAttackEndpoints(asset.value).vehicle_lang, { entry: [], target: [target] })
  assert.deepEqual(readAttackEndpoints(asset.value).other_lang.entry, [step])
  updateAttackEndpoints(graph, asset, 'vehicle_lang', 'target', [], 'ECU')
  assert.equal(readAttackEndpoints(asset.value).vehicle_lang, undefined)
  updateAttackEndpoints(graph, asset, 'other_lang', 'entry', [], 'ECU')
  assert.equal(asset.value.hasAttribute('taraAttackEndpoints'), false)
  graph.model.removeListener(changed)
  history.destroy()
  graph.destroy()
})

test('Entry and Target reject stale assets, schema changes and invalid steps without editing the graph', () => {
  const graph = createGraph()
  const asset = insertMalAsset(graph, 'ECU')
  initializeDiagramSchema(graph.model, runtime, 'vehicle_lang')
  const step = { attackStepId: 'VehicleLang:ECU.connect', name: 'connect' }
  const before = serializeModel(graph.model, runtime)
  for (const [schema, kind, steps, type, message] of [
    ['', 'entry', [step], 'ECU', /DB Schema/],
    ['different_lang', 'entry', [step], 'ECU', /language has changed/],
    ['vehicle_lang', 'invalid', [step], 'ECU', /Entry or Target/],
    ['vehicle_lang', 'entry', [{ name: 'connect' }], 'ECU', /Attack Step ID/],
    ['vehicle_lang', 'entry', [step], 'Firmware', /no longer available/],
  ]) {
    assert.throws(() => updateAttackEndpoints(graph, asset, schema, kind, steps, type), message)
    assert.equal(serializeModel(graph.model, runtime), before)
  }
  graph.removeCells([asset])
  assert.throws(
    () => updateAttackEndpoints(graph, asset, 'vehicle_lang', 'entry', [step], 'ECU'),
    /no longer available/,
  )
  graph.destroy()
})

test('Entry and Target survive draw.io, MAL YAML and session restoration with original inherited step IDs', async (t) => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  const values = new Map()
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) },
  })
  t.after(() => {
    if (originalStorage) Object.defineProperty(globalThis, 'sessionStorage', originalStorage)
    else Reflect.deleteProperty(globalThis, 'sessionStorage')
  })
  const { languageGraph } = parseLanguageGraph(
    await readFile(new URL('../../sample/vehicleLang_v2-langgraph.json', import.meta.url), 'utf8'),
  )
  const graph = createGraph()
  const first = insertMalAsset(graph, 'ECU')
  const second = insertMalAsset(graph, 'ECU', 200)
  updateCellProperties(graph, runtime, first, { label: 'Entry ECU' })
  updateCellProperties(graph, runtime, second, { label: 'Target ECU' })
  initializeDiagramSchema(graph.model, runtime, 'vehicle_lang')
  const inherited = { attackStepId: 'CoreLang:HardwareAccess.access', name: 'access' }
  const target = {
    attackStepId: 'VehicleLang:ECU.changeOperationMode',
    name: 'changeOperationMode',
  }
  updateAttackEndpoints(graph, first, 'vehicle_lang', 'entry', [inherited], 'ECU')
  updateAttackEndpoints(graph, second, 'vehicle_lang', 'target', [target], 'ECU')
  const assessment = createCtsaDraft([{ attack_step_id: target.attackStepId, name: target.name }])
  updateThreatAssessments(graph, second, 'vehicle_lang', assessment, 'ECU')
  const snapshot = getModelSnapshot(graph)
  const before = serializeModel(graph.model, runtime)
  const restored = createGraph()
  restored.model.setRoot(
    readDiagramFile(
      createDrawioFile(graph.model, 'Endpoints', runtime),
      languageGraph,
      runtime,
    ).getRoot(),
  )
  assert.deepEqual(getModelSnapshot(restored), snapshot)
  const yaml = serializeMalModel(prepareMalExport(snapshot, languageGraph))
  assert.deepEqual(parseYaml(yaml).assets[1].extras.attackEndpoints.vehicle_lang.entry, [inherited])
  restored.model.setRoot(readDiagramFile(yaml, languageGraph, runtime).getRoot())
  for (const vertex of snapshot.vertices) {
    const reopened = getModelSnapshot(restored).vertices.find((item) => item.label === vertex.label)
    assert.deepEqual(reopened.attackEndpoints, vertex.attackEndpoints)
    assert.deepEqual(reopened.threatAssessments, vertex.threatAssessments)
  }
  const store = useThreatModelStore(createPinia())
  store.createDiagram({ title: 'Endpoints', threatCatalogSchema: 'vehicle_lang' })
  store.updateDiagramXml(before)
  const session = useThreatModelStore(createPinia())
  assert.equal(session.data.diagrams.xml, before)
  assert.equal(serializeModel(graph.model, runtime), before)
  restored.destroy()
  graph.destroy()
})

test('CTSA saves every asset threat in one undoable edit, preserves other assets and schemas, and survives draw.io export', () => {
  const graph = createGraph()
  const asset = insertMalAsset(graph, 'ECU')
  const otherAsset = insertMalAsset(graph, 'ECU', 200)
  const threats = [
    { attack_step_id: 'VehicleLang:ECU.changeOperationMode', name: 'changeOperationMode' },
    { attack_step_id: 'VehicleLang:ECU.connect', name: 'connect' },
  ]
  const history = createEditorHistory(graph, runtime)
  const store = useThreatModelStore(createPinia())
  store.createDiagram({ title: 'CTSA asset scoring', threatCatalogSchema: 'vehicle_lang' })
  store.initializeDiagramXml(serializeModel(graph.model, runtime))
  const changed = () => store.updateDiagramXml(serializeModel(graph.model, runtime))
  graph.model.addListener(runtime.mxEvent.CHANGE, changed)

  const draft = createCtsaDraft(threats)
  for (const threat of draft.threats) for (const factor of threat.factors) factor.value = 3
  draft.threats[1].factors[0].value = 5
  draft.weights.recoveryTime = 0.2
  updateThreatAssessments(graph, asset, 'vehicle_lang', draft, 'ECU')
  assert.equal(history.history.history.length, 1)
  assert.equal(store.hasUnsavedChanges, true)
  const saved = getCellProperties(graph, asset).threatAssessments.vehicle_lang
  assert.deepEqual(
    assessAssetThreats(threats, saved).map((threat) => threat.riskScore),
    [3, 3.2],
  )
  assert.equal(saved.weights.recoveryTime, 0.2)
  assert.deepEqual(saved.riskScores, {
    [threats[0].attack_step_id]: 3,
    [threats[1].attack_step_id]: 3.2,
  })
  assert.equal(saved.scoringMethod, 'weighted-average')
  assert.deepEqual(getCellProperties(graph, otherAsset).threatAssessments, {})
  const edited = serializeModel(graph.model, runtime)
  history.undo()
  assert.deepEqual(getCellProperties(graph, asset).threatAssessments, {})
  assert.equal(store.hasUnsavedChanges, false)
  history.redo()
  assert.equal(serializeModel(graph.model, runtime), edited)
  store.markDiagramSaved(edited)
  assert.equal(store.hasUnsavedChanges, false)

  const imported = readDiagramModel(createDrawioFile(graph.model, 'Scored asset', runtime), runtime)
  const restoredAsset = imported.getCell(asset.id)
  assert.deepEqual(readThreatAssessments(restoredAsset.value).vehicle_lang, saved)

  const otherSchemaDraft = createCtsaDraft(threats)
  otherSchemaDraft.threats[0].factors[0].value = 4
  updateThreatAssessments(graph, asset, 'other_lang', otherSchemaDraft, 'ECU')
  assert.deepEqual(getCellProperties(graph, asset).threatAssessments.vehicle_lang, saved)
  assert.equal(
    getCellProperties(graph, asset).threatAssessments.other_lang.steps[threats[0].attack_step_id][0]
      .value,
    4,
  )
  history.updateProperties(asset, { label: 'Renamed ECU', dfdShape: 'store' })
  assert.deepEqual(getCellProperties(graph, asset).threatAssessments.vehicle_lang, saved)
  graph.model.removeListener(changed)
  history.destroy()
  graph.destroy()
})

const databaseCtsaRatings = (value) => ({
  proximity: value,
  locality: value,
  recovery_time: value,
  restoration_costs: value,
  impact_confidentiality: value,
  impact_integrity: value,
  impact_availability: value,
  prior_use: value,
  required_skills: value,
  required_resources: value,
  stealth: value,
  attribution: value,
  ctsa_score: 4.9,
})

test('draw.io import auto-fills missing DB CTSA ratings per instance and original Step ID in one undoable import', async () => {
  const languageGraph = {
    assets: [
      { name: 'Base', attack_steps: { access: { type: 'or' } } },
      { name: 'ECU', super_asset: 'Base', attack_steps: { complete: { type: 'or' } } },
      { name: 'Override', super_asset: 'Base', attack_steps: { access: { type: 'or' } } },
    ],
  }
  const rows = [
    {
      asset: 'ECU',
      declared_asset: 'Base',
      name: 'access',
      attack_step_id: 'CoreLang:Base.access',
      ctsa: databaseCtsaRatings(3),
      technique_mappings: [{ mitre_technique_id: 'T0800' }],
    },
    {
      asset: 'ECU',
      name: 'complete',
      attack_step_id: 'VehicleLang:ECU.complete',
      ctsa: databaseCtsaRatings(2),
      technique_mappings: [{ mitre_technique_id: 'T0800' }],
    },
    {
      asset: 'Override',
      declared_asset: 'Base',
      name: 'access',
      attack_step_id: 'CoreLang:Base.access',
      ctsa: databaseCtsaRatings(5),
      technique_mappings: [{ mitre_technique_id: 'T0800' }],
    },
  ]
  const originalRows = structuredClone(rows)
  const source = createGraph()
  writeDiagramSchema(source.model, runtime, 'file_lang')
  const first = insertMalAsset(source, 'ECU')
  const second = insertMalAsset(source, 'ECU', 200)
  const override = insertMalAsset(source, 'Override', 400)
  const boundary = source.insertVertex(
    source.getDefaultParent(),
    null,
    userObject({ assetType: 'BoundaryOnly', taraKind: 'boundary' }),
    0,
    0,
    300,
    300,
  )
  const draft = createCtsaDraft([
    { attack_step_id: 'CoreLang:Base.access' },
    { attack_step_id: 'VehicleLang:ECU.complete' },
    { attack_step_id: 'Removed:ECU.old' },
  ])
  draft.threats[0].factors[0].value = 4
  for (const factor of draft.threats[1].factors) factor.value = 5
  for (const factor of draft.threats[2].factors) factor.value = 2
  draft.weights.proximity = 0.4
  updateThreatAssessments(source, first, 'file_lang', draft, 'ECU')
  updateThreatAssessments(source, first, 'other_lang', draft, 'ECU')
  const original = readThreatAssessments(first.value)
  const sourceXml = serializeModel(source.model, runtime)
  let requests = 0
  const { model: imported, ctsaError } = await prepareDiagramFile(
    createDrawioFile(source.model, 'Import', runtime),
    languageGraph,
    runtime,
    {
      fallbackSchema: 'wrong_lang',
      load: async (schema, types, options) => {
        requests++
        assert.equal(schema, 'file_lang')
        assert.deepEqual(types, ['ECU', 'Override'])
        assert.deepEqual(options.assetParents, { Base: '', ECU: 'Base', Override: 'Base' })
        return rows
      },
    },
  )
  assert.equal(requests, 1)
  assert.equal(ctsaError, '')
  assert.equal(serializeModel(source.model, runtime), sourceXml)
  assert.deepEqual(rows, originalRows)
  const firstSaved = readThreatAssessments(imported.getCell(first.id).value)
  const secondSaved = readThreatAssessments(imported.getCell(second.id).value)
  assert.equal(firstSaved.file_lang.steps['CoreLang:Base.access'][0].value, 4)
  assert.equal(firstSaved.file_lang.steps['CoreLang:Base.access'][2].value, 3)
  assert.equal(firstSaved.file_lang.riskScores['CoreLang:Base.access'], 3.3)
  assert.equal(firstSaved.file_lang.riskScores['VehicleLang:ECU.complete'], 5)
  assert.deepEqual(firstSaved.file_lang.weights, original.file_lang.weights)
  assert.deepEqual(
    firstSaved.file_lang.steps['Removed:ECU.old'],
    original.file_lang.steps['Removed:ECU.old'],
  )
  assert.deepEqual(firstSaved.other_lang, original.other_lang)
  assert.equal(secondSaved.file_lang.riskScores['CoreLang:Base.access'], 3)
  assert.equal(secondSaved.file_lang.riskScores['VehicleLang:ECU.complete'], 2)
  assert.deepEqual(readThreatAssessments(imported.getCell(override.id).value), {})
  assert.deepEqual(readThreatAssessments(imported.getCell(boundary.id).value), {})

  const target = createGraph()
  insertMalAsset(target, 'Existing')
  const before = serializeModel(target.model, runtime)
  const history = trackHistory(target)
  target.model.setRoot(imported.getRoot())
  const after = serializeModel(target.model, runtime)
  const threats = groupAssetThreats(
    mergeLanguageAttackSteps(rows, languageGraph, ['ECU', 'Override']),
  )
  const matrix = createSusceptibilityMatrix(getModelSnapshot(target), 'file_lang', threats)
  assert.equal(matrix.rows[0].avId, 'T0800')
  assert.deepEqual(
    matrix.rows[0].cells.map((cell) => cell.riskScore),
    [5, 3, null],
  )
  const reopened = readDiagramModel(createDrawioFile(target.model, 'Saved', runtime), runtime)
  assert.deepEqual(readThreatAssessments(reopened.getCell(first.id).value), firstSaved)
  history.undo()
  assert.equal(serializeModel(target.model, runtime), before)
  assert.equal(history.canUndo(), false)
  history.redo()
  assert.equal(serializeModel(target.model, runtime), after)
  source.destroy()
  target.destroy()
})

test('draw.io import leaves unavailable DB ratings blank and preserves valid files when the catalog is offline', async () => {
  const graph = createGraph()
  writeDiagramSchema(graph.model, runtime, 'file_lang')
  const asset = insertMalAsset(graph, 'ECU')
  const file = createDrawioFile(graph.model, 'No scores', runtime)
  const before = serializeModel(graph.model, runtime)
  const offline = await prepareDiagramFile(file, null, runtime, {
    load: async () => {
      throw new Error('DB offline')
    },
  })
  assert.match(offline.ctsaError, /diagram was imported, but DB CTSA values could not be loaded/)
  assert.equal(serializeModel(offline.model, runtime), before)
  const missing = await prepareDiagramFile(file, null, runtime, {
    load: async () => [
      {
        asset: 'ECU',
        name: 'access',
        attack_step_id: 'DB:ECU.access',
        ctsa: { proximity: 0, recovery_time: '3', attribution: 6, ctsa_score: 4 },
      },
    ],
  })
  assert.equal(missing.ctsaError, '')
  assert.equal(serializeModel(missing.model, runtime), before)
  const partial = await prepareDiagramFile(file, null, runtime, {
    load: async () => [
      {
        asset: 'ECU',
        name: 'access',
        attack_step_id: 'DB:ECU.access',
        ctsa: { proximity: 4, recovery_time: 2, ctsa_score: 5 },
      },
    ],
  })
  const saved = readThreatAssessments(partial.model.getCell(asset.id).value).file_lang
  assert.equal(saved.steps['DB:ECU.access'][0].value, 4)
  assert.equal(saved.steps['DB:ECU.access'][2].value, 2)
  assert.equal(saved.steps['DB:ECU.access'][1].value, null)
  assert.equal(saved.riskScores['DB:ECU.access'], null)
  assert.equal(serializeModel(graph.model, runtime), before)
  graph.destroy()
})

test('draw.io import honors an explicit empty schema, infers legacy schemas and hydrates compressed files', async () => {
  const graph = createGraph()
  const asset = insertMalAsset(graph, 'ECU')
  const withoutMetadata = await prepareDiagramFile(
    createDrawioFile(graph.model, 'No TTP metadata', runtime),
    null,
    runtime,
    {
      fallbackSchema: 'creation_lang',
      load: async (schema) => {
        assert.equal(schema, 'creation_lang')
        return [
          {
            asset: 'ECU',
            name: 'access',
            attack_step_id: 'DB:ECU.access',
            ctsa: databaseCtsaRatings(3),
          },
        ]
      },
    },
  )
  assert.equal(readDiagramSchema(withoutMetadata.model), 'creation_lang')
  assert.equal(
    readThreatAssessments(withoutMetadata.model.getCell(asset.id).value).creation_lang.riskScores[
      'DB:ECU.access'
    ],
    3,
  )
  assert.deepEqual(readThreatAssessments(asset.value), {})
  const draft = createCtsaDraft([{ attack_step_id: 'DB:ECU.access' }])
  updateThreatAssessments(graph, asset, 'legacy_lang', draft, 'ECU')
  const compressed = btoa(
    String.fromCharCode(
      ...runtime.pako.deflateRaw(encodeURIComponent(serializeModel(graph.model, runtime))),
    ),
  )
  const result = await prepareDiagramFile(
    `<mxfile><diagram>${compressed}</diagram></mxfile>`,
    null,
    runtime,
    {
      fallbackSchema: 'wrong_lang',
      load: async (schema) => {
        assert.equal(schema, 'legacy_lang')
        return [
          {
            asset: 'ECU',
            name: 'access',
            attack_step_id: 'DB:ECU.access',
            ctsa: databaseCtsaRatings(2),
          },
        ]
      },
    },
  )
  assert.equal(result.ctsaError, '')
  assert.equal(readDiagramSchema(result.model), 'legacy_lang')
  assert.equal(
    readThreatAssessments(result.model.getCell(asset.id).value).legacy_lang.riskScores[
      'DB:ECU.access'
    ],
    2,
  )
  writeDiagramSchema(graph.model, runtime, '')
  let requested = false
  const noCatalog = await prepareDiagramFile(
    createDrawioFile(graph.model, 'No catalog', runtime),
    null,
    runtime,
    {
      fallbackSchema: 'wrong_lang',
      load: async () => {
        requested = true
        return []
      },
    },
  )
  assert.equal(requested, false)
  assert.equal(readDiagramSchema(noCatalog.model), '')
  assert.equal(
    readThreatAssessments(noCatalog.model.getCell(asset.id).value).legacy_lang.riskScores[
      'DB:ECU.access'
    ],
    null,
  )
  graph.destroy()
})

test('cancelled or invalid draw.io imports cannot apply late DB ratings', async () => {
  const graph = createGraph()
  writeDiagramSchema(graph.model, runtime, 'file_lang')
  insertMalAsset(graph, 'ECU')
  const before = serializeModel(graph.model, runtime)
  const controller = new AbortController()
  let finish
  const preparing = prepareDiagramFile(
    createDrawioFile(graph.model, 'Cancelled', runtime),
    null,
    runtime,
    {
      signal: controller.signal,
      load: async () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    },
  )
  controller.abort()
  finish([
    { asset: 'ECU', name: 'access', attack_step_id: 'DB:ECU.access', ctsa: databaseCtsaRatings(5) },
  ])
  await assert.rejects(preparing, /abort/i)
  let requested = false
  await assert.rejects(
    prepareDiagramFile('<mxfile/>', null, runtime, {
      load: async () => {
        requested = true
        return []
      },
    }),
    /single-page/,
  )
  assert.equal(requested, false)
  assert.equal(serializeModel(graph.model, runtime), before)
  graph.destroy()
})

test('CTSA rejects stale assets and invalid scoring without changing the graph', () => {
  const graph = createGraph()
  const asset = insertMalAsset(graph, 'ECU')
  const draft = createCtsaDraft([{ attack_step_id: 'VehicleLang:ECU.connect', name: 'connect' }])
  const before = serializeModel(graph.model, runtime)
  assert.throws(() => updateThreatAssessments(graph, asset, '', draft, 'ECU'), /DB Schema/)
  assert.throws(
    () => updateThreatAssessments(graph, asset, 'vehicle_lang', draft, 'Firmware'),
    /no longer available/,
  )
  draft.weights.proximity = -1
  assert.throws(
    () => updateThreatAssessments(graph, asset, 'vehicle_lang', draft, 'ECU'),
    /Asset weights/,
  )
  for (const key of Object.keys(draft.weights)) draft.weights[key] = 0
  assert.throws(
    () => updateThreatAssessments(graph, asset, 'vehicle_lang', draft, 'ECU'),
    /total greater than 0/,
  )
  assert.equal(serializeModel(graph.model, runtime), before)
  graph.removeCells([asset])
  assert.throws(
    () => updateThreatAssessments(graph, asset, 'vehicle_lang', draft, 'ECU'),
    /no longer available/,
  )
  graph.destroy()
})

test('draw.io export adds score metadata to older evaluations without editing the live graph or history', () => {
  const graph = createGraph()
  const asset = insertMalAsset(graph, 'ECU')
  const draft = createCtsaDraft([{ attack_step_id: 'VehicleLang:ECU.connect' }])
  const factors = draft.threats[0].factors
  for (const factor of factors) factor.value = 5
  const legacy = {
    vehicle_lang: {
      version: 2,
      weights: draft.weights,
      steps: { 'VehicleLang:ECU.connect': factors },
    },
  }
  const value = asset.value.cloneNode(true)
  value.setAttribute('taraTtpAssessments', JSON.stringify(legacy))
  graph.model.setValue(asset, value)
  const history = createEditorHistory(graph, runtime)
  const before = serializeModel(graph.model, runtime)
  const file = createDrawioFile(graph.model, 'Existing scored model', runtime)
  const restored = readDiagramModel(file, runtime)
  const saved = readThreatAssessments(restored.getCell(asset.id).value).vehicle_lang
  assert.equal(saved.riskScores['VehicleLang:ECU.connect'], 5)
  assert.deepEqual(saved.steps, legacy.vehicle_lang.steps)
  assert.deepEqual(saved.weights, legacy.vehicle_lang.weights)
  assert.equal(serializeModel(graph.model, runtime), before)
  assert.equal(history.history.canUndo(), false)
  history.destroy()
  graph.destroy()
})

test('CTSA values, weights and risk scores survive draw.io and MAL YAML roundtrips for separate asset instances', async () => {
  const { languageGraph } = parseLanguageGraph(
    await readFile(new URL('../../sample/vehicleLang_v2-langgraph.json', import.meta.url), 'utf8'),
  )
  const graph = createGraph()
  const first = insertMalAsset(graph, 'ECU')
  const second = insertMalAsset(graph, 'ECU', 200)
  updateCellProperties(graph, runtime, first, { label: 'Engine ECU' })
  updateCellProperties(graph, runtime, second, { label: 'Body ECU' })
  const threats = [
    { attack_step_id: 'VehicleLang:ECU.changeOperationMode', name: 'changeOperationMode' },
    { attack_step_id: 'VehicleLang:ECU.connect', name: 'connect' },
  ]
  const draft = createCtsaDraft(threats)
  for (const factor of draft.threats[0].factors) factor.value = 4
  draft.threats[1].factors[0].value = 2
  draft.weights.recoveryTime = 0.3
  updateThreatAssessments(graph, first, 'vehicle_lang', draft, 'ECU')
  const secondDraft = createCtsaDraft(threats)
  for (const threat of secondDraft.threats) for (const factor of threat.factors) factor.value = 1
  updateThreatAssessments(graph, second, 'vehicle_lang', secondDraft, 'ECU')
  const before = serializeModel(graph.model, runtime)
  const snapshot = getModelSnapshot(graph)
  const xml = createDrawioFile(graph.model, 'CTSA roundtrip', runtime)
  const restoredGraph = createGraph()
  restoredGraph.model.setRoot(readDiagramFile(xml, languageGraph, runtime).getRoot())
  assert.deepEqual(getModelSnapshot(restoredGraph), snapshot)
  const yaml = serializeMalModel(prepareMalExport(snapshot, languageGraph))
  const model = parseYaml(yaml)
  assert.equal(model.assets[1].extras.ctsa.vehicle_lang.riskScores[threats[0].attack_step_id], 4)
  assert.equal(model.assets[1].extras.ctsa.vehicle_lang.riskScores[threats[1].attack_step_id], null)
  assert.equal(model.assets[2].extras.ctsa.vehicle_lang.riskScores[threats[0].attack_step_id], 1)
  restoredGraph.model.setRoot(readDiagramFile(yaml, languageGraph, runtime).getRoot())
  const reopened = getModelSnapshot(restoredGraph)
  for (const asset of snapshot.vertices) {
    const imported = reopened.vertices.find((item) => item.label === asset.label)
    assert.deepEqual(imported.threatAssessments, asset.threatAssessments)
    assert.deepEqual(
      assessAssetThreats(threats, imported.threatAssessments.vehicle_lang).map(
        (threat) => threat.riskScore,
      ),
      threats.map(
        (threat) => asset.threatAssessments.vehicle_lang.riskScores[threat.attack_step_id],
      ),
    )
  }
  const secondExport = parseYaml(serializeMalModel(prepareMalExport(reopened, languageGraph)))
  assert.deepEqual(secondExport.assets[1].extras.ctsa, model.assets[1].extras.ctsa)
  assert.deepEqual(secondExport.assets[2].extras.ctsa, model.assets[2].extras.ctsa)
  assert.equal(serializeModel(graph.model, runtime), before)
  restoredGraph.destroy()
  graph.destroy()
})

test('Open converts Tesla MAL YAML into native draw.io assets and named flows that survive XML and MAL export', async () => {
  const { languageGraph } = parseLanguageGraph(
    await readFile(new URL('../../sample/vehicleLang_v2-langgraph.json', import.meta.url), 'utf8'),
  )
  const yaml = await readFile(
    new URL('../../sample/Tesla_Model_S_MAL_Model.yaml', import.meta.url),
    'utf8',
  )
  const xml = convertMalModelToDrawio(yaml, languageGraph, runtime)
  assert.match(xml, /<mxfile/)
  const imported = readDiagramFile(yaml, languageGraph, runtime)
  assert.equal(
    serializeModel(imported, runtime),
    serializeModel(readDiagramFile(xml, languageGraph, runtime), runtime),
  )
  const graph = createGraph()
  graph.model.setRoot(imported.getRoot())
  const controller = configureFlowAssociations(graph, runtime, languageGraph)
  const snapshot = getModelSnapshot(graph)
  assert.equal(snapshot.vertices.length, 22)
  assert.equal(snapshot.edges.length, 24)
  assert.equal(snapshot.vertices[0].label, 'QtCarBrowser')
  assert.deepEqual(snapshot.vertices[0].position, { x: -2112, y: -580 })
  for (const vertex of snapshot.vertices) {
    const cell = graph.model.getCell(vertex.id)
    assert.equal(getCellProperties(graph, cell).assetType, vertex.assetType)
    assert.equal(cell.geometry.width, 100)
    assert.equal(cell.geometry.height, 100)
    assert.equal(graph.getAllConnectionConstraints({ cell }).length, 8)
  }
  for (const edge of snapshot.edges) {
    const cell = graph.model.getCell(edge.id)
    const relation = controller.getProperties(cell)
    assert.equal(relation.id, edge.associationId)
    assert.equal(relation.options.find((option) => option.id === relation.id).name, edge.label)
    assert.match(cell.style, /curved=1;/)
    assert.match(cell.style, /strokeWidth=2;/)
  }
  const exported = parseYaml(serializeMalModel(prepareMalExport(snapshot, languageGraph)))
  const original = parseYaml(yaml)
  assert.equal(Object.keys(exported.assets).length, 22)
  for (const asset of Object.values(original.assets)) {
    const restored = Object.values(exported.assets).find((entry) => entry.name === asset.name)
    for (const field of Object.keys(asset.associated_assets)) {
      assert.deepEqual(
        Object.values(restored.associated_assets[field]).sort(),
        Object.values(asset.associated_assets[field]).sort(),
      )
    }
  }
  controller.destroy()
  graph.destroy()
})

test('Open detects YAML or draw.io XML by content and imported shapes and literal labels persist', () => {
  const yaml = `
assets:
  0:
    name: '<ECU & "Vehicle">'
    type: ECU
    extras:
      dfdShape: store
      description: |-
        First line
        Second <line> & text
      position: {x: 0, y: -20.5}
    associated_assets: {firmware: {1: Firmware}}
  1:
    name: Firmware
    type: Firmware
    extras: {dfdShape: actor}
`
  const graph = createGraph()
  graph.model.setRoot(readDiagramFile(`\uFEFF  ${yaml}`, null, runtime).getRoot())
  const snapshot = getModelSnapshot(graph)
  assert.equal(snapshot.vertices[0].label, '<ECU & "Vehicle">')
  assert.equal(snapshot.vertices[0].description, 'First line\nSecond <line> & text')
  assert.deepEqual(snapshot.vertices[0].position, { x: 0, y: -20.5 })
  assert.equal(snapshot.vertices[0].dfdShape, 'store')
  assert.equal(snapshot.vertices[1].dfdShape, 'actor')
  assert.equal(snapshot.edges[0].label, 'firmware')
  for (const vertex of snapshot.vertices) {
    const cell = graph.model.getCell(vertex.id)
    assert.equal(cell.geometry.width, 130)
    assert.equal(cell.geometry.height, 70)
  }
  const xml = createDrawioFile(graph.model, 'Roundtrip', runtime)
  graph.model.setRoot(readDiagramFile(xml, null, runtime).getRoot())
  assert.deepEqual(getModelSnapshot(graph), snapshot)
  // Both the unwrapped XML model and the native compressed form still open.
  const raw = serializeModel(graph.model, runtime)
  assert.equal(
    readDiagramFile(raw, null, runtime).getCell('mal-asset-0').value.getAttribute('label'),
    snapshot.vertices[0].label,
  )
  const compressed = btoa(String.fromCharCode(...runtime.pako.deflateRaw(encodeURIComponent(raw))))
  const file = `<mxfile><diagram>${compressed}</diagram></mxfile>`
  assert.ok(readDiagramFile(file, null, runtime).getCell('mal-flow-1'))
  graph.destroy()
})

test('valid MAL imports replace the graph in one undo step, and rejected imports leave it untouched', () => {
  const graph = createGraph()
  const original = graph.insertVertex(graph.getDefaultParent(), null, 'Original', 10, 20, 100, 100)
  const before = serializeModel(graph.model, runtime)
  const history = createEditorHistory(graph, runtime)
  function open(text) {
    const imported = readDiagramFile(text, null, runtime)
    normalizeDfdCells(imported, runtime)
    graph.model.setRoot(imported.getRoot())
  }
  assert.throws(
    () => open('assets: { 1: { type: ECU, associated_assets: {link: {2: missing}} } }'),
    /missing MAL asset/,
  )
  assert.throws(() => open('<mxfile>'), /./)
  assert.equal(serializeModel(graph.model, runtime), before)
  assert.equal(history.history.canUndo(), false)
  open('assets: { 0: ECU, 1: Firmware }')
  assert.equal(graph.model.contains(original), false)
  assert.equal(getModelSnapshot(graph).vertices.length, 2)
  assert.equal(history.history.history.length, 1)
  history.undo()
  assert.equal(serializeModel(graph.model, runtime), before)
  history.redo()
  assert.ok(graph.model.getCell('mal-asset-0'))
  assert.ok(graph.model.getCell('mal-asset-1'))
  history.destroy()
  graph.destroy()
})

test('real graph undo returns to the saved snapshot and Asset Type edits remain unsaved despite history exclusion', () => {
  const graph = createGraph()
  const store = useThreatModelStore(createPinia())
  store.createDiagram({ title: 'Saved state test' })
  store.initializeDiagramXml(serializeModel(graph.model, runtime))
  const edits = createEditorHistory(graph, runtime)
  const changed = () => store.updateDiagramXml(serializeModel(graph.model, runtime))
  graph.model.addListener(runtime.mxEvent.CHANGE, changed)
  const asset = insertMalAsset(graph, 'ECU')
  assert.equal(store.hasUnsavedChanges, true)
  edits.undo()
  assert.equal(store.hasUnsavedChanges, false)
  edits.redo()
  assert.equal(store.hasUnsavedChanges, true)
  store.markDiagramSaved(store.data.diagrams.xml)
  assert.equal(store.hasUnsavedChanges, false)
  graph.setSelectionCell(asset)
  graph.view.scale = 2
  graph.view.translate = new runtime.mxPoint(40, 50)
  changed()
  assert.equal(store.hasUnsavedChanges, false)
  const historyLength = edits.history.history.length
  edits.updateProperties(asset, { dfdShape: 'store' })
  assert.equal(edits.history.history.length, historyLength)
  assert.equal(store.hasUnsavedChanges, true)
  graph.model.removeListener(changed)
  edits.destroy()
  graph.destroy()
})

test('MAL snapshot reads identity, edited shape, nested positions and terminals without changing graph/history', () => {
  const graph = createGraph()
  const parent = graph.getDefaultParent()
  const group = graph.insertVertex(
    parent,
    'group',
    userObject({ taraShape: 'boundary' }),
    100,
    200,
    300,
    300,
  )
  const source = graph.insertVertex(
    group,
    'source',
    userObject({
      label: 'Engine ECU',
      taraShape: 'mal:ECU',
      dfdShape: 'store',
      description: 'Control unit',
    }),
    20,
    30,
    130,
    70,
  )
  const target = graph.insertVertex(
    parent,
    'target',
    userObject({ label: 'Bus', taraKind: 'asset', assetType: 'CANNetwork', dfdShape: 'actor' }),
    -50,
    0,
    130,
    70,
  )
  graph.insertEdge(parent, 'flow', 'Data', source, target)
  graph.setSelectionCell(source)
  graph.view.scale = 2
  graph.view.translate = new runtime.mxPoint(80, 90)
  const history = trackHistory(graph)
  const snapshot = getModelSnapshot(graph)
  assert.deepEqual(
    snapshot.vertices.find((entry) => entry.id === 'source'),
    {
      id: 'source',
      label: 'Engine ECU',
      kind: 'asset',
      assetType: 'ECU',
      dfdShape: 'store',
      description: 'Control unit',
      position: { x: 120, y: 230 },
    },
  )
  assert.equal(snapshot.vertices.find((entry) => entry.id === 'group').kind, 'boundary')
  assert.equal(snapshot.vertices.find((entry) => entry.id === 'target').assetType, 'CANNetwork')
  assert.equal(getCellProperties(graph, source).assetType, 'ECU')
  assert.deepEqual(snapshot.edges, [
    { id: 'flow', label: 'Data', source: 'source', target: 'target' },
  ])
  assert.equal(graph.getSelectionCell(), source)
  assert.equal(history.canUndo(), false)
  snapshot.vertices.find((entry) => entry.id === 'source').position.x = 999
  assert.equal(source.geometry.x, 20)
})

function cellState(graph, cell) {
  const state = new runtime.mxCellState(graph.view, cell, graph.getCellStyle(cell))
  Object.assign(state, cell.geometry)
  return state
}

function assetLabelState(graph, cell) {
  const state = cellState(graph, cell)
  const scale = graph.view.scale
  for (const dimension of ['x', 'y', 'width', 'height']) state[dimension] *= scale
  state.shape = graph.cellRenderer.createShape(state)
  state.shape.apply(state)
  state.shape.node = element()
  state.text = graph.cellRenderer.createTextShape(state, graph.getLabel(cell), graph.dialect)
  state.text.apply(state)
  state.text.node = element()
  state.text.scale = scale
  state.text.bounds = graph.cellRenderer.getLabelBounds(state)
  return state
}

function paintAssetLabel(state, exportImage = false) {
  const document = runtime.mxUtils.createXmlDocument()
  const svg = document.createElementNS(runtime.mxConstants.NS_SVG, 'svg')
  document.appendChild(svg)
  const canvas = new runtime.mxSvgCanvas2D(svg)
  const createElement = canvas.createElement
  canvas.createElement = function (name) {
    const node = createElement.call(this, name)
    // xmldom supplies real SVG/XML nodes, but no CSSStyleDeclaration.
    node.style = {}
    return node
  }
  if (exportImage) {
    const createSvg = state.text.createSvg
    // Use the XML document for exported nodes instead of the stub HTML document.
    state.text.createSvg = () => canvas.createElement('g')
    try {
      new runtime.mxImageExport().drawText(state, canvas)
    } finally {
      state.text.createSvg = createSvg
    }
  } else state.text.paint(canvas)
  return svg
}

function stubFontMeasurement(context) {
  const previous = runtime.mxUtils.canvasContext
  runtime.mxUtils.canvasContext = {
    font: '',
    measureText: (text) => ({ width: Array.from(text).length * 7 }),
  }
  context.after(() => {
    runtime.mxUtils.canvasContext = previous
  })
}

function endpointMarkerState(graph, cell) {
  const state = cellState(graph, cell)
  const scale = graph.view.scale
  for (const dimension of ['x', 'y', 'width', 'height']) state[dimension] *= scale
  state.shape = graph.cellRenderer.createShape(state)
  state.shape.apply(state)
  state.shape.bounds = new runtime.mxRectangle(state.x, state.y, state.width, state.height)
  state.shape.scale = scale
  state.shape.dialect = runtime.mxConstants.DIALECT_SVG
  state.shape.node = element()
  return state
}

function paintEndpointMarkers(state, exportImage = false) {
  const doc = runtime.mxUtils.createXmlDocument()
  const svg = doc.createElementNS(runtime.mxConstants.NS_SVG, 'svg')
  doc.appendChild(svg)
  const canvas = new runtime.mxSvgCanvas2D(svg)
  const createElement = canvas.createElement
  canvas.createElement = function (name) {
    const node = createElement.call(this, name)
    node.style = {}
    return node
  }
  // The native Data Store hit area also needs real SVG nodes during export.
  const createSvgElement = document.createElementNS
  document.createElementNS = (namespace, name) => {
    const node = doc.createElementNS(namespace, name)
    node.style = {}
    return node
  }
  try {
    if (exportImage) {
      new runtime.mxImageExport().drawShape(state, canvas)
    } else state.shape.paint(canvas)
  } finally {
    document.createElementNS = createSvgElement
  }
  return svg
}

test('asset Entry/Target badges repaint on metadata changes, independent clearing and undo/redo without changing names or styles', () => {
  const graph = createGraph()
  const cell = insertMalAsset(graph, 'ECU')
  initializeDiagramSchema(graph.model, runtime, 'vehicle_lang')
  const history = createEditorHistory(graph, runtime)
  const state = endpointMarkerState(graph, cell)
  const labels = () =>
    Array.from(paintEndpointMarkers(state).getElementsByTagName('text'), (node) => node.textContent)
  const step = { attackStepId: 'VehicleLang:ECU.connect', name: 'connect' }
  const style = cell.style
  assert.deepEqual(labels(), [])
  assert.equal(graph.cellRenderer.isShapeInvalid(state, state.shape), false)
  updateAttackEndpoints(graph, cell, 'vehicle_lang', 'entry', [step], 'ECU')
  assert.equal(graph.cellRenderer.isShapeInvalid(state, state.shape), true)
  assert.deepEqual(labels(), ['Entry'])
  assert.equal(graph.cellRenderer.isShapeInvalid(state, state.shape), false)
  history.undo()
  assert.equal(graph.cellRenderer.isShapeInvalid(state, state.shape), true)
  assert.deepEqual(labels(), [])
  history.redo()
  assert.deepEqual(labels(), ['Entry'])
  updateAttackEndpoints(graph, cell, 'vehicle_lang', 'target', [step], 'ECU')
  assert.deepEqual(labels(), ['Entry', 'Target'])
  updateAttackEndpoints(graph, cell, 'vehicle_lang', 'entry', [], 'ECU')
  assert.deepEqual(labels(), ['Target'])
  updateAttackEndpoints(graph, cell, 'vehicle_lang', 'target', [], 'ECU')
  assert.deepEqual(labels(), [])
  assert.equal(cell.style, style)
  assert.equal(graph.convertValueToString(cell), 'ECU')
  assert.equal(graph.getEditingValue(cell), 'ECU')
  history.destroy()
  graph.destroy()
})

test('all DFD asset shapes paint distinct role badges in SVG exports and include them in bounds at every zoom', () => {
  const graph = createGraph()
  initializeDiagramSchema(graph.model, runtime, 'vehicle_lang')
  for (const shape of dfdShapes.filter((shape) => shape.kind === 'asset')) {
    const cell = graph.insertVertex(
      graph.getDefaultParent(),
      null,
      userObject({
        label: 'ECU',
        assetType: 'ECU',
        taraKind: 'asset',
        taraShape: shape.id,
        dfdShape: shape.id,
      }),
      40,
      40,
      shape.width,
      shape.height,
      shape.style,
    )
    const step = { attackStepId: 'VehicleLang:ECU.connect', name: 'connect' }
    updateAttackEndpoints(graph, cell, 'vehicle_lang', 'entry', [step], 'ECU')
    updateAttackEndpoints(graph, cell, 'vehicle_lang', 'target', [step], 'ECU')
    const before = serializeModel(graph.model, runtime)
    for (const scale of [0.5, 1, 2]) {
      graph.view.scale = scale
      const state = endpointMarkerState(graph, cell)
      for (const exported of [false, true]) {
        const svg = paintEndpointMarkers(state, exported)
        assert.deepEqual(
          Array.from(svg.getElementsByTagName('text'), (node) => node.textContent),
          ['Entry', 'Target'],
        )
        const xml = new XMLSerializer().serializeToString(svg)
        assert.match(xml, /#0d6efd/)
        assert.match(xml, /#dc3545/)
        assert.equal(svg.getElementsByTagName('foreignObject').length, 0)
      }
      const bounds = state.shape.getShapeBoundingBox()
      assert.ok(bounds.y <= state.y - 26 * scale, shape.id)
      assert.ok(bounds.x <= state.getCenterX() - 49 * scale, shape.id)
      assert.ok(bounds.x + bounds.width >= state.getCenterX() + 49 * scale, shape.id)
    }
    assert.equal(serializeModel(graph.model, runtime), before)
  }
  graph.destroy()
})

test('role badges restore from draw.io metadata, honor the active schema, and ignore flows and trust boundaries', () => {
  const graph = createGraph()
  initializeDiagramSchema(graph.model, runtime, 'vehicle_lang')
  const step = { attackStepId: 'VehicleLang:ECU.connect', name: 'connect' }
  const endpoints = {
    vehicle_lang: { entry: [step], target: [] },
    other_lang: { entry: [], target: [step] },
  }
  const cell = graph.insertVertex(
    graph.getDefaultParent(),
    null,
    userObject({
      label: 'ECU',
      assetType: 'ECU',
      taraKind: 'asset',
      taraShape: 'mal:ECU',
      taraAttackEndpoints: JSON.stringify(endpoints),
    }),
    0,
    0,
    100,
    100,
    dfdShapes[0].style,
  )
  const restored = createGraph()
  restored.model.setRoot(
    readDiagramModel(createDrawioFile(graph.model, 'Roles', runtime), runtime).getRoot(),
  )
  let state = endpointMarkerState(restored, restored.model.getCell(cell.id))
  assert.equal(paintEndpointMarkers(state).textContent, 'Entry')
  writeDiagramSchema(restored.model, runtime, 'other_lang')
  assert.equal(restored.cellRenderer.isShapeInvalid(state, state.shape), true)
  assert.equal(paintEndpointMarkers(state).textContent, 'Target')
  writeDiagramSchema(restored.model, runtime, '')
  assert.equal(paintEndpointMarkers(state).textContent, '')
  const boundary = restored.insertVertex(
    restored.getDefaultParent(),
    null,
    userObject({
      label: 'Boundary',
      taraKind: 'boundary',
      taraShape: 'boundary',
      taraAttackEndpoints: JSON.stringify(endpoints),
    }),
    0,
    0,
    100,
    100,
    dfdShapes[3].style,
  )
  state = endpointMarkerState(restored, boundary)
  assert.equal(state.shape.paintVertexShape, runtime.mxShape.prototype.paintVertexShape)
  const edge = restored.insertEdge(restored.getDefaultParent(), null, '', boundary, boundary)
  const edgeState = cellState(restored, edge)
  assert.equal(
    restored.cellRenderer.createShape(edgeState).paintVertexShape,
    runtime.mxShape.prototype.paintVertexShape,
  )
  restored.destroy()
  graph.destroy()
})

test('asset labels wrap in native SVG for every DFD shape and image export without changing saved names or history', (context) => {
  stubFontMeasurement(context)
  const graph = createGraph()
  const history = createEditorHistory(graph, runtime)
  for (const shape of dfdShapes.filter((shape) => shape.kind === 'asset')) {
    const name = 'Center Information Display EthernetGatewayECU'
    const cell = graph.insertVertex(
      graph.getDefaultParent(),
      null,
      userObject({ label: name, taraKind: 'asset', taraShape: shape.id, dfdShape: shape.id }),
      0,
      0,
      shape.width,
      shape.height,
      shape.style,
    )
    history.history.clear()
    const xml = serializeModel(graph.model, runtime)
    const state = assetLabelState(graph, cell)
    const svg = paintAssetLabel(state)
    const lines = Array.from(svg.getElementsByTagName('text'), (text) => text.textContent)
    assert.ok(lines.length > 1, shape.id)
    assert.ok(
      lines.every((line) => line.length * 7 <= state.text.bounds.width),
      shape.id,
    )
    assert.equal(lines.join('').replaceAll(' ', ''), name.replaceAll(' ', ''))
    assert.equal(svg.getElementsByTagName('foreignObject').length, 0)
    assert.ok(svg.getElementsByTagName('clipPath').length > 0, shape.id)
    const exported = paintAssetLabel(state, true)
    assert.deepEqual(
      Array.from(exported.getElementsByTagName('text'), (text) => text.textContent),
      lines,
    )
    assert.equal(state.text.value, name)
    assert.equal(graph.getEditingValue(cell), name)
    assert.equal(getModelSnapshot(graph).vertices.at(-1).label, name)
    assert.equal(serializeModel(graph.model, runtime), xml)
    assert.equal(history.history.canUndo(), false)
    if (shape.id === 'process') {
      assert.ok(state.text.bounds.width < shape.width * Math.SQRT1_2)
      assert.ok(state.text.bounds.height < shape.height * Math.SQRT1_2)
    }
  }
  history.destroy()
  graph.destroy()
})

test('label wrapping follows resizing and zoom, preserves literal Unicode and manual newlines, and leaves non-assets alone', (context) => {
  stubFontMeasurement(context)
  const graph = createGraph()
  const shape = dfdShapes[1]
  const name = '차량제어시스템👩‍💻éAccessPoint\n\n<Engine&ECU>'
  const cell = graph.insertVertex(
    graph.getDefaultParent(),
    null,
    userObject({ label: name, taraKind: 'asset', taraShape: 'actor', dfdShape: 'actor' }),
    0,
    0,
    100,
    150,
    shape.style,
  )
  const state = assetLabelState(graph, cell)
  const lines = (state) =>
    Array.from(paintAssetLabel(state).getElementsByTagName('text'), (text) => text.textContent)
  const narrow = lines(state)
  assert.equal(narrow.join('').replaceAll(' ', ''), name.replaceAll('\n', ''))
  assert.ok(narrow.some((line) => line.includes('👩‍💻')))
  assert.ok(narrow.some((line) => line.includes('é')))
  const width = state.text.bounds.width
  state.text.bounds.width = width * 3
  const wide = lines(state)
  assert.ok(wide.length < narrow.length)
  state.text.bounds.width = width * 2
  state.text.bounds.height *= 2
  state.text.scale = 2
  assert.deepEqual(lines(state), narrow)
  assert.equal(state.text.value, name)
  const saved = readDiagramModel(createDrawioFile(graph.model, 'Name', runtime), runtime)
  assert.equal(saved.getCell(cell.id).value.getAttribute('label'), name)
  graph.view.states.put(cell, state)
  const editor = graph.cellEditor
  editor.editingCell = cell
  editor.textShape = state.text
  editor.textarea = element()
  editor.textarea.innerHTML = name
  state.text.node.getElementsByTagName = () => [{}]
  editor.resize()
  assert.equal(editor.textarea.style.whiteSpace, 'pre-wrap')
  assert.equal(editor.textarea.style.overflowWrap, 'anywhere')
  assert.equal(editor.textarea.style.width, `${editor.bounds.width / graph.view.scale}px`)
  editor.editingCell = null
  const boundary = graph.insertVertex(
    graph.getDefaultParent(),
    null,
    userObject({ label: 'Boundary label', taraKind: 'boundary', taraShape: 'boundary' }),
    0,
    0,
    100,
    100,
    dfdShapes[3].style,
  )
  const edge = graph.insertEdge(graph.getDefaultParent(), null, 'Association name', cell, cell)
  for (const other of [boundary, edge]) {
    const otherState = cellState(graph, other)
    const text = graph.cellRenderer.createTextShape(
      otherState,
      graph.getLabel(other),
      graph.dialect,
    )
    assert.equal(text.paint, runtime.mxText.prototype.paint)
  }
  graph.destroy()
})

function stubHandleDom(context) {
  // Keep native handler construction, event processing and geometry; skip SVG DOM painting.
  context.mock.method(runtime.mxShape.prototype, 'init', function () {
    this.node = element()
  })
  context.mock.method(runtime.mxShape.prototype, 'redraw', () => {})
  context.mock.method(runtime.mxShape.prototype, 'destroy', () => {})
}

function interactiveState(graph, cell) {
  graph.setSelectionCell(cell)
  const state = cellState(graph, cell)
  const { scale, translate } = graph.view
  state.x = (state.x + translate.x) * scale
  state.y = (state.y + translate.y) * scale
  state.width *= scale
  state.height *= scale
  state.shape = new runtime.mxRectangleShape()
  state.shape.init()
  state.shape.apply(state)
  state.updateCachedBounds()
  return state
}

function pointerAt(state, x, y, type = 'mousemove') {
  const event = new runtime.mxMouseEvent(
    { type, button: 0, clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} },
    state,
  )
  event.graphX = x
  event.graphY = y
  return event
}

function drawDataFlow(graph, targetY) {
  const parent = graph.getDefaultParent()
  const source = graph.insertVertex(parent, null, 'Source', 20, 30, 100, 100, dfdShapes[0].style)
  const target = graph.insertVertex(
    parent,
    null,
    'Target',
    280,
    targetY,
    100,
    100,
    dfdShapes[0].style,
  )
  const sourceState = cellState(graph, source)
  const targetState = cellState(graph, target)
  const connection = graph.connectionHandler
  connection.sourceConstraint = graph
    .getAllConnectionConstraints(sourceState)
    .find((port) => port.name === 'east')
  connection.constraintHandler.currentConstraint = graph
    .getAllConnectionConstraints(targetState)
    .find((port) => port.name === 'west')
  connection.edgeState = connection.createEdgeState()
  const previewStyle = connection.edgeState.style
  connection.connect(source, target, {})
  const edge = graph.getChildEdges(parent)[0]
  const state = new runtime.mxCellState(graph.view, edge, graph.getCellStyle(edge))
  graph.view.updateFixedTerminalPoints(state, sourceState, targetState)
  graph.view.updatePoints(state, null, sourceState, targetState)
  graph.view.updateFloatingTerminalPoints(state, sourceState, targetState)
  const shape = new runtime.mxPolyline()
  shape.apply(state)
  const path = []
  shape.paintEdgeShape(
    {
      begin() {},
      stroke() {},
      moveTo(x, y) {
        path.push(['M', x, y])
      },
      lineTo(x, y) {
        path.push(['L', x, y])
      },
      quadTo(cx, cy, x, y) {
        path.push(['Q', cx, cy, x, y])
      },
    },
    state.absolutePoints,
  )
  return { edge, path, previewStyle }
}

const associationCatalog = {
  assets: [
    {
      name: 'Hardware',
      isAbstract: true,
      associations: {
        apps: { left: { asset: 'Hardware' }, right: { asset: 'Application' } },
      },
    },
    { name: 'ECU', super_asset: 'Hardware' },
    { name: 'Application' },
    { name: 'Firmware', super_asset: 'Application' },
    { name: 'Unrelated' },
  ],
}

function insertMalAsset(graph, type, x = 0) {
  const cell = graph.insertVertex(
    graph.getDefaultParent(),
    null,
    userObject({ label: type, assetType: type, taraShape: `mal:${type}`, taraKind: 'asset' }),
    x,
    30,
    100,
    100,
    dfdShapes[0].style,
  )
  graph.view.states.put(cell, cellState(graph, cell))
  return cell
}

function startPortConnection(graph, cell) {
  const connection = graph.connectionHandler
  const state = graph.view.getState(cell)
  // Bypass only browser hit testing; native port press/start/reset logic still runs.
  connection.constraintHandler.update = () => {}
  connection.constraintHandler.currentFocus = state
  connection.constraintHandler.currentConstraint = graph.getAllConnectionConstraints(state)[2]
  connection.constraintHandler.currentPoint = new runtime.mxPoint(
    state.x + state.width,
    state.y + state.height / 2,
  )
  graph.setConnectable(true)
  connection.mouseDown(
    graph,
    pointerAt(state, state.x + state.width, state.y + state.height / 2, 'mousedown'),
  )
}

const { languageGraph: vehicleLanguage } = parseLanguageGraph(
  await readFile(new URL('../../sample/vehicleLang_v2-langgraph.json', import.meta.url), 'utf8'),
)

test('a unique association names the new flow in the same undoable transaction', async () => {
  const graph = createGraph()
  const source = insertMalAsset(graph, 'ECU')
  const target = insertMalAsset(graph, 'CANNetwork', 200)
  const requests = []
  const associations = configureFlowAssociations(graph, runtime, vehicleLanguage, (id) =>
    requests.push(id),
  )
  const edits = createEditorHistory(graph, runtime)
  graph.connectionHandler.connect(source, target, {})
  const edge = graph.getChildEdges(graph.getDefaultParent())[0]
  assert.equal(graph.convertValueToString(edge), 'EcuConnection')
  assert.equal(associations.getProperties(edge).options.length, 1)
  assert.equal(edge.value.getAttribute('malAssociationId'), associations.getProperties(edge).id)
  await Promise.resolve()
  assert.deepEqual(requests, [])
  edits.undo()
  assert.equal(graph.model.contains(edge), false)
  assert.equal(edits.history.canUndo(), false)
  edits.redo()
  assert.equal(graph.model.contains(edge), true)
  assert.equal(graph.convertValueToString(edge), 'EcuConnection')
  assert.ok(associations.getProperties(edge).id)
  associations.destroy()
  edits.destroy()
  graph.destroy()
})

test('multiple associations prompt after connection and edits keep name and relationship together in history', async () => {
  const graph = createGraph()
  const source = insertMalAsset(graph, 'ECU')
  const target = insertMalAsset(graph, 'Firmware', 200)
  const requests = []
  const nativeStartEditing = graph.startEditingAtCell
  const associations = configureFlowAssociations(graph, runtime, vehicleLanguage, (id) =>
    requests.push(id),
  )
  const edits = createEditorHistory(graph, runtime)
  graph.connectionHandler.connect(source, target, {})
  const edge = graph.getChildEdges(graph.getDefaultParent())[0]
  assert.deepEqual(requests, [])
  await Promise.resolve()
  assert.deepEqual(requests, [edge.id])
  assert.equal(associations.getProperties(edge).id, '')
  const options = associations.getProperties(edge).options
  assert.equal(options.length, 3)
  const firmware = options.find((option) => option.sourceField === 'firmware')
  const system = options.find((option) => option.sourceField === 'sysExecutedApps')
  associations.updateAssociation(edge, firmware.id)
  assert.equal(graph.convertValueToString(edge), 'FirmwareExecution')
  edits.updateProperties(edge, { description: 'Firmware traffic' })
  associations.updateAssociation(edge, system.id)
  assert.equal(graph.convertValueToString(edge), 'SysExecution')
  assert.equal(edge.value.getAttribute('description'), 'Firmware traffic')
  edits.undo()
  assert.equal(graph.convertValueToString(edge), 'FirmwareExecution')
  assert.equal(associations.getProperties(edge).id, firmware.id)
  edits.redo()
  assert.equal(graph.convertValueToString(edge), 'SysExecution')
  assert.equal(associations.getProperties(edge).id, system.id)
  assert.throws(() => associations.updateAssociation(edge, 'invalid'), /valid association/)
  assert.throws(() => associations.updateAssociation(source, firmware.id), /valid association/)
  graph.startEditingAtCell(edge)
  await Promise.resolve()
  assert.deepEqual(requests, [edge.id, edge.id])
  assert.equal(graph.isEditing(), false)
  associations.destroy()
  assert.equal(graph.startEditingAtCell, nativeStartEditing)
  edits.destroy()
  graph.destroy()
})

test('reconnecting a flow preserves valid choices, replaces unique choices and clears obsolete ambiguous choices', async () => {
  const graph = createGraph()
  const source = insertMalAsset(graph, 'ECU')
  const firmware = insertMalAsset(graph, 'Firmware', 200)
  const anotherFirmware = insertMalAsset(graph, 'Firmware', 400)
  const network = insertMalAsset(graph, 'CANNetwork', 600)
  const updater = insertMalAsset(graph, 'FirmwareUpdaterService', 800)
  const requests = []
  const associations = configureFlowAssociations(graph, runtime, vehicleLanguage, (id) =>
    requests.push(id),
  )
  const restrict = configureAssociations(graph, runtime, vehicleLanguage)
  const edge = graph.insertEdge(graph.getDefaultParent(), 'association-edge', '', source, firmware)
  const choice = associations
    .getProperties(edge)
    .options.find((option) => option.sourceField === 'firmware').id
  associations.updateAssociation(edge, choice)
  const edits = createEditorHistory(graph, runtime)
  graph.connectCell(edge, anotherFirmware, false)
  assert.equal(associations.getProperties(edge).id, choice)
  graph.connectCell(edge, network, false)
  assert.equal(graph.convertValueToString(edge), 'EcuConnection')
  edits.undo()
  assert.equal(edge.target, anotherFirmware)
  assert.equal(graph.convertValueToString(edge), 'FirmwareExecution')
  assert.equal(associations.getProperties(edge).id, choice)
  edits.redo()
  assert.equal(edge.target, network)
  assert.equal(graph.convertValueToString(edge), 'EcuConnection')
  graph.connectCell(edge, updater, false)
  assert.equal(associations.getProperties(edge).id, '')
  assert.equal(edge.value.getAttribute('malAssociationId'), '')
  assert.equal(graph.convertValueToString(edge), '')
  await Promise.resolve()
  assert.deepEqual(requests, [edge.id])
  edits.undo()
  assert.equal(edge.target, network)
  assert.equal(graph.convertValueToString(edge), 'EcuConnection')
  associations.destroy()
  restrict()
  edits.destroy()
  graph.destroy()
})

test('self-type relations with identical names retain the selected endpoint roles', () => {
  const graph = createGraph()
  const source = insertMalAsset(graph, 'Application')
  const target = insertMalAsset(graph, 'Application', 200)
  const edge = graph.insertEdge(graph.getDefaultParent(), null, '', source, target)
  const associations = configureFlowAssociations(graph, runtime, vehicleLanguage)
  const options = associations.getProperties(edge).options
  assert.equal(options.length, 2)
  assert.equal(options[0].name, options[1].name)
  assert.notEqual(options[0].id, options[1].id)
  const edits = createEditorHistory(graph, runtime)
  associations.updateAssociation(edge, options[0].id)
  associations.updateAssociation(edge, options[1].id)
  assert.equal(associations.getProperties(edge).id, options[1].id)
  edits.undo()
  assert.equal(associations.getProperties(edge).id, options[0].id)
  assert.equal(graph.convertValueToString(edge), options[0].name)
  associations.destroy()
  edits.destroy()
  graph.destroy()
})

test('undoing a new flow or disposing the editor cancels queued association dialogs', async () => {
  for (const cancel of ['undo', 'dispose']) {
    const graph = createGraph()
    const source = insertMalAsset(graph, 'ECU')
    const target = insertMalAsset(graph, 'Firmware', 200)
    const requests = []
    const associations = configureFlowAssociations(graph, runtime, vehicleLanguage, (id) =>
      requests.push(id),
    )
    const edits = createEditorHistory(graph, runtime)
    graph.connectionHandler.connect(source, target, {})
    if (cancel === 'undo') edits.undo()
    else associations.destroy()
    await Promise.resolve()
    assert.deepEqual(requests, [])
    if (cancel === 'undo') associations.destroy()
    edits.destroy()
    graph.destroy()
  }
})

test('draw.io XML roundtrip preserves association identity and MAL export uses it without reselection', () => {
  const graph = createGraph()
  const source = insertMalAsset(graph, 'ECU')
  const target = insertMalAsset(graph, 'Firmware', 200)
  const edge = graph.insertEdge(graph.getDefaultParent(), 'flow', '', source, target)
  const associations = configureFlowAssociations(graph, runtime, vehicleLanguage)
  const choice = associations
    .getProperties(edge)
    .options.find((option) => option.sourceField === 'firmware').id
  associations.updateAssociation(edge, choice)
  updateCellProperties(graph, runtime, edge, { description: '차량 <Firmware> & traffic' })
  const xml = createDrawioFile(graph.model, 'Association model', runtime)
  const imported = readDiagramModel(xml, runtime)
  const restored = createGraph()
  restored.model.setRoot(imported.getRoot())
  const restoredAssociations = configureFlowAssociations(restored, runtime, vehicleLanguage)
  const restoredEdge = restored.model.getCell('flow')
  assert.equal(restored.convertValueToString(restoredEdge), 'FirmwareExecution', xml)
  assert.equal(restoredEdge.value.getAttribute('description'), '차량 <Firmware> & traffic')
  assert.equal(restoredAssociations.getProperties(restoredEdge).id, choice)
  const snapshot = getModelSnapshot(restored)
  assert.equal(snapshot.edges[0].associationId, choice)
  const yaml = parseYaml(serializeMalModel(prepareMalExport(snapshot, vehicleLanguage)))
  assert.deepEqual(yaml.assets[1].associated_assets, { firmware: { 2: 'Firmware' } })
  assert.deepEqual(yaml.assets[2].associated_assets, { hardware: { 1: 'ECU' } })
  restoredAssociations.destroy()
  associations.destroy()
  restored.destroy()
  graph.destroy()
})

test('manual diagrams retain free Data Flow names without an association controller', () => {
  const graph = createGraph()
  const nativeStartEditing = graph.startEditingAtCell
  assert.equal(configureFlowAssociations(graph, runtime, null), null)
  assert.equal(graph.startEditingAtCell, nativeStartEditing)
  const edge = graph.insertEdge(graph.getDefaultParent(), null, 'Custom name', null, null)
  updateCellProperties(graph, runtime, edge, { label: 'New name' })
  assert.equal(graph.convertValueToString(edge), 'New name')
  assert.equal(edge.value.getAttribute('malAssociationId'), null)
  graph.destroy()
})

test('LangGraph restricts new flows and reconnection by MAL identity, independent of Asset Type', () => {
  const graph = createGraph()
  const source = insertMalAsset(graph, 'ECU')
  const target = insertMalAsset(graph, 'Firmware', 200)
  const invalid = insertMalAsset(graph, 'Unrelated', 400)
  const generic = graph.insertVertex(
    graph.getDefaultParent(),
    null,
    userObject({ taraShape: 'process', taraKind: 'asset' }),
    0,
    0,
    100,
    100,
  )
  const dispose = configureAssociations(graph, runtime, associationCatalog)
  assert.equal(graph.connectionHandler.validateConnection(source, target), null)
  for (const cell of [invalid, generic, source]) {
    assert.notEqual(graph.connectionHandler.validateConnection(source, cell), null)
    graph.connectionHandler.connect(source, cell, {})
    assert.equal(graph.getChildEdges(graph.getDefaultParent()).length, 0)
  }
  updateCellProperties(graph, runtime, source, { dfdShape: 'store', label: 'Renamed ECU' })
  assert.equal(graph.connectionHandler.validateConnection(source, target), null)
  graph.connectionHandler.connect(source, target, {})
  const edge = graph.getChildEdges(graph.getDefaultParent())[0]
  assert.equal(edge.source, source)
  assert.equal(edge.target, target)
  graph.connectCell(edge, invalid, false)
  assert.equal(edge.target, target)
  graph.connectCell(edge, generic, true)
  assert.equal(edge.source, source)
  const replacement = insertMalAsset(graph, 'Application', 600)
  graph.connectCell(edge, replacement, false)
  assert.equal(edge.target, replacement)
  dispose()
  graph.destroy()
})

test('port gestures highlight only compatible assets without model edits, and clear on reset or Escape', (context) => {
  stubHandleDom(context)
  const graph = createGraph()
  const source = insertMalAsset(graph, 'ECU')
  const target = insertMalAsset(graph, 'Firmware', 200)
  insertMalAsset(graph, 'Unrelated', 400)
  const rendered = []
  const draw = runtime.mxCellHighlight.prototype.drawHighlight
  context.mock.method(runtime.mxCellHighlight.prototype, 'drawHighlight', function () {
    draw.call(this)
    if (this.highlightColor === '#198754') rendered.push(this)
  })
  let feedback
  const beforeListeners = graph.model.eventListeners.length
  const dispose = configureAssociations(graph, runtime, associationCatalog, (next) => {
    feedback = next
  })
  const history = trackHistory(graph)
  const installedListeners = graph.model.eventListeners.length
  const originalStyle = target.style
  for (const cancel of ['reset', 'escape']) {
    startPortConnection(graph, source)
    assert.equal(feedback.targetCount, 1)
    assert.equal(feedback.hasAssetType, true)
    assert.equal(feedback.sourceAssetType, 'ECU')
    const highlight = rendered.at(-1)
    assert.equal(highlight.state.cell, target)
    assert.equal(highlight.shape.svgPointerEvents, 'none')
    assert.equal(highlight.shape.isDashed, true)
    assert.equal(highlight.shape.stroke, '#198754')
    assert.equal(history.canUndo(), false)
    assert.equal(target.style, originalStyle)
    if (cancel === 'reset') graph.connectionHandler.reset()
    else graph.fireEvent(new runtime.mxEventObject(runtime.mxEvent.ESCAPE))
    assert.equal(feedback, null)
    assert.equal(highlight.shape, null)
    assert.equal(graph.model.eventListeners.length, installedListeners)
  }
  startPortConnection(graph, source)
  graph.connectionHandler.connect(source, target, {})
  assert.equal(feedback, null)
  assert.equal(rendered.at(-1).shape, null)
  dispose()
  // Only the test's history listener remains after disposing the feature.
  assert.equal(graph.model.eventListeners.length, beforeListeners + 2)
  graph.destroy()
})

test('simulation fills preserve styles, XML, selection and history; edits and teardown clear every overlay', (context) => {
  stubHandleDom(context)
  const graph = createGraph()
  const asset = insertMalAsset(graph, 'ECU')
  const other = insertMalAsset(graph, 'Firmware', 200)
  const boundary = graph.insertVertex(
    graph.getDefaultParent(),
    'boundary',
    userObject({
      taraKind: 'boundary',
      taraShape: 'boundary',
    }),
    0,
    0,
    400,
    200,
  )
  const edge = graph.insertEdge(graph.getDefaultParent(), 'flow', '', asset, other)
  graph.view.states.put(boundary, cellState(graph, boundary))
  graph.view.states.put(edge, new runtime.mxCellState(graph.view, edge, {}))
  graph.setSelectionCell(other)
  const rendered = []
  const draw = runtime.mxCellHighlight.prototype.drawHighlight
  context.mock.method(runtime.mxCellHighlight.prototype, 'drawHighlight', function () {
    draw.call(this)
    if (this.highlightColor === '#dc3545') rendered.push(this)
  })
  const xml = serializeModel(graph.model, runtime)
  const style = asset.style
  const history = trackHistory(graph)
  const modelListeners = graph.model.eventListeners.length
  const viewListeners = graph.view.eventListeners?.length || 0
  const highlights = createCompromisedAssetHighlights(graph, runtime)
  try {
    highlights.setAssets([asset.id, asset.id, boundary.id, edge.id, 'missing'])
    assert.equal(rendered.length, 1)
    const highlight = rendered[0]
    assert.equal(highlight.state.cell, asset)
    assert.equal(highlight.shape.fill, '#dc3545')
    assert.equal(highlight.shape.opacity, 25)
    assert.equal(highlight.shape.stroke, null)
    assert.equal(highlight.shape.outline, false)
    assert.equal(highlight.shape.isDashed, false)
    assert.equal(highlight.shape.svgPointerEvents, 'none')
    assert.equal(asset.style, style)
    assert.equal(serializeModel(graph.model, runtime), xml)
    assert.equal(history.canUndo(), false)
    assert.equal(graph.getSelectionCell(), other)
    graph.view.setScale(1.5)
    assert.equal(highlight.shape, rendered[0].shape)
    assert.equal(highlight.shape.scale, 1.5)
    assert.equal(serializeModel(graph.model, runtime), xml)
    highlights.setAssets([other.id])
    assert.equal(highlight.shape, null)
    assert.equal(rendered.at(-1).state.cell, other)
    assert.equal(history.canUndo(), false)
    graph.model.setValue(other, other.value.cloneNode(true))
    assert.equal(rendered.at(-1).shape, null)
    assert.equal(graph.model.eventListeners.length, modelListeners + 2)
    highlights.setAssets([asset.id])
    highlights.clear()
    assert.equal(rendered.at(-1).shape, null)
    highlights.setAssets([asset.id, other.id])
  } finally {
    highlights.destroy()
    assert(rendered.every((highlight) => highlight.shape === null))
    assert.equal(graph.model.eventListeners.length, modelListeners)
    assert.equal(graph.view.eventListeners.length, viewListeners)
    graph.destroy()
  }
})

test('connection feedback handles no matches and unknown types, and releases highlights on source removal', (context) => {
  stubHandleDom(context)
  const graph = createGraph()
  const source = insertMalAsset(graph, 'ECU')
  const unrelated = insertMalAsset(graph, 'Unrelated', 200)
  const unknown = insertMalAsset(graph, 'NotInCatalog', 400)
  let feedback
  const dispose = configureAssociations(graph, runtime, associationCatalog, (next) => {
    feedback = next
  })
  startPortConnection(graph, source)
  assert.equal(feedback.targetCount, 0)
  assert.equal(feedback.sourceAssetType, 'ECU')
  assert.ok(
    getStencilConnectionContext(associationCatalog, null, feedback).compatibleAssetTypes.has(
      'Firmware',
    ),
  )
  graph.connectionHandler.reset()
  startPortConnection(graph, unknown)
  assert.equal(feedback.hasAssetType, false)
  assert.equal(feedback.targetCount, 0)
  graph.connectionHandler.reset()
  startPortConnection(graph, unrelated)
  graph.removeCells([unrelated])
  assert.equal(feedback, null)
  dispose()
  graph.destroy()
})

test('without a LangGraph the original manual connection behavior remains available', () => {
  const graph = createGraph()
  const source = insertMalAsset(graph, 'ECU')
  const target = insertMalAsset(graph, 'Unrelated', 200)
  const original = graph.isValidConnection
  const dispose = configureAssociations(graph, runtime, null)
  assert.equal(graph.isValidConnection, original)
  assert.equal(graph.connectionHandler.validateConnection(source, target), null)
  graph.connectionHandler.connect(source, target, {})
  assert.equal(graph.getChildEdges(graph.getDefaultParent()).length, 1)
  dispose()
  graph.destroy()
})

test('dragging either endpoint of an existing flow highlights eligible replacements and cleans up', (context) => {
  stubHandleDom(context)
  context.mock.method(runtime.mxEdgeHandler.prototype, 'init', function () {
    this.graph = this.state.view.graph
    this.bends = [new runtime.mxRectangleShape(), new runtime.mxRectangleShape()]
  })
  context.mock.method(runtime.mxEdgeHandler.prototype, 'redraw', () => {})
  const graph = createGraph()
  const source = insertMalAsset(graph, 'ECU')
  const target = insertMalAsset(graph, 'Firmware', 200)
  insertMalAsset(graph, 'Application', 400)
  insertMalAsset(graph, 'Unrelated', 600)
  const edge = graph.insertEdge(graph.getDefaultParent(), null, 'Flow', source, target)
  let feedback
  const dispose = configureAssociations(graph, runtime, associationCatalog, (next) => {
    feedback = next
  })
  const state = new runtime.mxCellState(graph.view, edge, graph.getCellStyle(edge))
  state.shape = new runtime.mxPolyline()
  const handler = graph.createEdgeHandler(state, null)
  handler.start(200, 30, 1)
  assert.equal(feedback.sourceLabel, 'ECU')
  assert.equal(feedback.sourceAssetType, 'ECU')
  assert.ok(
    getStencilConnectionContext(associationCatalog, null, feedback).compatibleAssetTypes.has(
      'Firmware',
    ),
  )
  assert.equal(feedback.targetCount, 2)
  // A reset from the new-connection handler must not clear endpoint-drag feedback.
  graph.connectionHandler.reset()
  assert.equal(feedback.targetCount, 2)
  handler.reset()
  assert.equal(feedback, null)
  handler.start(0, 30, 0)
  assert.equal(feedback.sourceLabel, 'Firmware')
  assert.equal(feedback.sourceAssetType, 'Firmware')
  assert.ok(
    getStencilConnectionContext(associationCatalog, null, feedback).compatibleAssetTypes.has('ECU'),
  )
  assert.equal(feedback.targetCount, 1)
  handler.destroy()
  assert.equal(feedback, null)
  dispose()
  graph.destroy()
})

test('aligned Data Flow endpoints produce a straight line in the native curve renderer', () => {
  const graph = createGraph()
  const { edge, path, previewStyle } = drawDataFlow(graph, 30)
  assert.match(edge.style, /curved=1;/)
  assert.match(edge.style, /edgeStyle=orthogonalEdgeStyle;/)
  assert.equal(previewStyle.curved, 1)
  assert.equal(graph.connectionHandler.livePreview, true)
  assert.deepEqual(path[0], ['M', 120, 80])
  assert.deepEqual(path.at(-1).slice(-2), [280, 80])
  for (const command of path) {
    for (let index = 2; index < command.length; index += 2) assert.equal(command[index], 80)
  }
  graph.destroy()
})

test('bent Data Flow routes render quadratic curves instead of angular polylines', () => {
  const graph = createGraph()
  const { path } = drawDataFlow(graph, 210)
  assert.deepEqual(path[0], ['M', 120, 80])
  assert.deepEqual(path.at(-1).slice(-2), [280, 260])
  assert.equal(
    path.some(([command]) => command === 'L'),
    false,
  )
  let position = path[0].slice(1)
  let hasBend = false
  for (const [command, cx, cy, x, y] of path.slice(1)) {
    if (command === 'Q') {
      hasBend ||=
        Math.abs((cx - position[0]) * (y - position[1]) - (cy - position[1]) * (x - position[0])) >
        0.001
      position = [x, y]
    }
  }
  assert.equal(hasBend, true)
  graph.destroy()
})

test('the local draw.io engine creates connected shapes and lays them out', () => {
  const graph = createGraph()
  const parent = graph.getDefaultParent()
  const ecu = graph.insertVertex(parent, null, 'ECU', 20, 30, 100, 80, 'shape=ellipse;')
  const gateway = graph.insertVertex(parent, null, 'Gateway', 180, 30, 100, 80)
  const edge = graph.insertEdge(parent, null, 'CAN', ecu, gateway)
  const layout = new runtime.mxCircleLayout(graph)
  layout.execute(parent)
  assert.equal(graph.model.getChildCount(parent), 3)
  assert.equal(edge.source, ecu)
  assert.equal(edge.target, gateway)
  assert.notDeepEqual([ecu.geometry.x, ecu.geometry.y], [gateway.geometry.x, gateway.geometry.y])
  graph.destroy()
})

test('native undo restores a deleted shape and its connected flow', () => {
  const graph = createGraph()
  const parent = graph.getDefaultParent()
  const a = graph.insertVertex(parent, null, 'ECU', 0, 0, 100, 80)
  const b = graph.insertVertex(parent, null, 'Gateway', 200, 0, 100, 80)
  const edge = graph.insertEdge(parent, null, 'CAN', a, b)
  const history = new runtime.mxUndoManager()
  graph.model.addListener(runtime.mxEvent.UNDO, (_, event) =>
    history.undoableEditHappened(event.getProperty('edit')),
  )
  graph.removeCells([a], true)
  assert.equal(graph.model.getChildCount(parent), 1)
  history.undo()
  assert.equal(graph.model.getChildCount(parent), 3)
  assert.equal(edge.source, a)
  assert.equal(edge.target, b)
  history.redo()
  assert.equal(graph.model.getChildCount(parent), 1)
  graph.destroy()
})

test('opens the native draw.io compression format including Korean labels', () => {
  const xml =
    '<mxGraphModel><root><mxCell id="ECU" value="차량 &amp; Gateway"/></root></mxGraphModel>'
  const compressed = runtime.pako.deflateRaw(encodeURIComponent(xml))
  const base64 = btoa(String.fromCharCode(...compressed))
  assert.equal(decompressDiagramText(base64, runtime), xml)
})

test('rejects damaged compressed draw.io data', () => {
  assert.throws(() => decompressDiagramText('not base64!', runtime), /could not be read/)
  assert.throws(() => decompressDiagramText(btoa('not compressed'), runtime), /could not be read/)
})

test('the native drag handler moves both newly placed and already selected shapes', () => {
  const graph = createGraph()
  const cell = graph.insertVertex(graph.getDefaultParent(), null, 'ECU', 10, 20, 100, 100)
  const history = trackHistory(graph)
  const handler = graph.graphHandler
  handler.cell = cell
  handler.scrollOnMove = false
  // Both branches previously called a missing getCompositeParent extension.
  assert.equal(handler.getCells(cell)[0], cell)
  graph.setSelectionCell(cell)
  handler.delayedSelection = true
  const cells = handler.getCells(cell)
  assert.equal(cells[0], cell)
  handler.moveCells(cells, 70, 40, false, null, null)
  assert.deepEqual([cell.geometry.x, cell.geometry.y], [80, 60])
  history.undo()
  assert.deepEqual([cell.geometry.x, cell.geometry.y], [10, 20])
  history.redo()
  assert.deepEqual([cell.geometry.x, cell.geometry.y], [80, 60])
  graph.destroy()
})

test('live dragging redraws cells at the pointer delta and commits one undoable move', () => {
  const graph = createGraph()
  const cell = graph.insertVertex(graph.getDefaultParent(), null, 'ECU', 20, 30, 100, 100)
  const state = cellState(graph, cell)
  state.shape = { pointerEvents: true, destroy() {} }
  graph.view.states.put(cell, state)
  const history = trackHistory(graph)
  const drawn = []
  // Observe native renderer calls; actual SVG painting requires a browser.
  graph.cellRenderer.redraw = (current) => drawn.push([current.x, current.y])
  const handler = graph.graphHandler
  handler.cell = cell
  handler.cells = [cell]
  handler.cellCount = 1
  handler.allCells = new runtime.mxDictionary()
  handler.allCells.put(cell, state)
  handler.checkPreview()
  assert.equal(handler.livePreviewActive, true)
  handler.updateLivePreview(40, 20)
  handler.updateLivePreview(70, 50)
  assert.deepEqual(drawn, [
    [60, 50],
    [90, 80],
  ])
  assert.deepEqual([cell.geometry.x, cell.geometry.y], [20, 30])
  assert.equal(history.canUndo(), false)
  handler.resetLivePreview()
  assert.equal(state.shape.pointerEvents, true)
  handler.scrollOnMove = false
  handler.moveCells([cell], 70, 50, false, null, null)
  assert.deepEqual([cell.geometry.x, cell.geometry.y], [90, 80])
  history.undo()
  assert.deepEqual([cell.geometry.x, cell.geometry.y], [20, 30])
  assert.equal(history.canUndo(), false)
  graph.destroy()
})

test('selected rectangle ports do not hit the native resize handles', (context) => {
  // Skip only DOM creation; native handle positioning and hit testing still run.
  context.mock.method(runtime.mxVertexHandler.prototype, 'init', function () {
    this.graph = this.state.view.graph
    this.bounds = this.getSelectionBounds(this.state)
    this.sizers = Array.from({ length: 8 }, () => {
      const sizer = new runtime.mxRectangleShape(new runtime.mxRectangle(0, 0, 6, 6))
      sizer.node = element()
      sizer.redraw = () => {}
      sizer.destroy = () => {}
      return sizer
    })
  })
  const graph = createGraph()
  const cell = graph.insertVertex(
    graph.getDefaultParent(),
    null,
    'Entity',
    40,
    40,
    130,
    70,
    dfdShapes[1].style,
  )
  const state = cellState(graph, cell)
  const handler = graph.createVertexHandler(state)
  const mouseAt = (x, y) => {
    const event = new runtime.mxMouseEvent({ type: 'mousedown', button: 0 }, state)
    event.graphX = x
    event.graphY = y
    return event
  }
  for (const constraint of graph.getAllConnectionConstraints(state)) {
    const point = graph.getConnectionPoint(state, constraint)
    assert.equal(handler.getHandleForEvent(mouseAt(point.x, point.y)), null)
  }
  const eastHandle = handler.sizers[4].bounds
  assert.equal(
    handler.getHandleForEvent(mouseAt(eastHandle.getCenterX(), eastHandle.getCenterY())),
    4,
  )
  handler.destroy()
  graph.destroy()
})

test('connection ports follow the circle perimeter and the native handler creates fixed endpoints', () => {
  const graph = createGraph()
  const parent = graph.getDefaultParent()
  const source = graph.insertVertex(parent, null, 'ECU', 20, 30, 100, 100, dfdShapes[0].style)
  const target = graph.insertVertex(parent, null, 'Gateway', 250, 30, 130, 70, dfdShapes[1].style)
  const sourceState = cellState(graph, source)
  const ports = graph.getAllConnectionConstraints(sourceState)
  assert.equal(ports.length, 8)
  assert.equal(new Set(ports.map((port) => port.name)).size, 8)
  const originalPoint = graph.getConnectionPoint(sourceState, ports[2])
  for (const port of ports) {
    const point = graph.getConnectionPoint(sourceState, port, false)
    assert.ok(Math.abs(Math.hypot(point.x - 70, point.y - 80) - 50) < 0.01)
  }
  const angles = ports
    .map((port) => {
      const point = graph.getConnectionPoint(sourceState, port, false)
      return (Math.round((Math.atan2(80 - point.y, point.x - 70) * 180) / Math.PI) + 360) % 360
    })
    .sort((a, b) => a - b)
  assert.deepEqual(angles, [0, 45, 90, 135, 180, 225, 270, 315])
  const history = trackHistory(graph)
  const connection = graph.connectionHandler
  connection.sourceConstraint = ports[2]
  connection.constraintHandler.currentConstraint = ports[6]
  // This path used to throw getReferenceTerminal is not a function.
  connection.connect(source, target, {})
  const edge = graph.getChildEdges(parent)[0]
  assert.ok(edge)
  assert.equal(edge.source, source)
  assert.equal(edge.target, target)
  assert.match(edge.style, /exitX=1;/)
  assert.match(edge.style, /exitY=0.5;/)
  assert.match(edge.style, /entryX=0;/)
  assert.match(edge.style, /entryY=0.5;/)
  history.undo()
  assert.equal(graph.getChildEdges(parent).length, 0)
  history.redo()
  assert.equal(graph.getChildEdges(parent)[0], edge)
  graph.moveCells([source], 50, 30)
  const moved = graph.getConnectionPoint(cellState(graph, source), ports[2])
  assert.deepEqual([moved.x - originalPoint.x, moved.y - originalPoint.y], [50, 30])
  graph.destroy()
})

test('body presses leave dragging available and boundaries/text have no connection ports', () => {
  const graph = createGraph()
  const handler = graph.connectionHandler
  const press = { getEvent: () => ({ button: 0, type: 'mousedown' }) }
  handler.constraintHandler.currentFocus = {}
  assert.equal(handler.isStartEvent(press), false)
  handler.constraintHandler.currentConstraint = {}
  assert.equal(handler.isStartEvent(press), true)
  for (const kind of ['boundary', 'annotation']) {
    const cell = graph.insertVertex(
      graph.getDefaultParent(),
      null,
      userObject({ taraKind: kind }),
      0,
      0,
      100,
      100,
    )
    assert.equal(graph.getAllConnectionConstraints(cellState(graph, cell)), null)
  }
  graph.destroy()
})

test('inline label editors use absolute coordinates inside the graph container', () => {
  const graph = createGraph()
  graph.container = { scrollLeft: 0, scrollTop: 0, removeEventListener() {} }
  graph.cellEditor.init()
  assert.equal(graph.cellEditor.textarea.style.position, 'absolute')
  assert.equal(graph.cellEditor.textarea.style.boxSizing, 'content-box')
  assert.equal(graph.cellEditor.blurEnabled, true)
  assert.equal(graph.isEnterStopsCellEditing(), true)
  graph.container = null
  graph.destroy()
})

test('property changes and inline renames retain descriptions, MAL types and undo history', () => {
  const graph = createGraph()
  const cell = graph.insertVertex(
    graph.getDefaultParent(),
    null,
    userObject({
      label: 'ECU',
      assetType: 'VehicleECU',
      taraKind: 'asset',
      taraShape: 'mal:VehicleECU',
      description: '',
    }),
    0,
    0,
    100,
    100,
  )
  const history = trackHistory(graph)
  updateCellProperties(graph, runtime, cell, {
    label: '차량 <ECU>',
    description: 'Line 1\n통신 설명',
  })
  assert.equal(getCellProperties(graph, cell).label, '차량 <ECU>')
  assert.equal(getCellProperties(graph, cell).description, 'Line 1\n통신 설명')
  assert.equal(cell.value.getAttribute('assetType'), 'VehicleECU')
  assert.equal(cell.value.getAttribute('taraShape'), 'mal:VehicleECU')
  history.undo()
  assert.equal(getCellProperties(graph, cell).label, 'ECU')
  assert.equal(getCellProperties(graph, cell).description, '')
  history.redo()
  graph.cellLabelChanged(cell, 'Renamed on canvas', false)
  assert.equal(getCellProperties(graph, cell).label, 'Renamed on canvas')
  assert.equal(getCellProperties(graph, cell).description, 'Line 1\n통신 설명')
  assert.equal(getCellProperties(graph, cell).assetType, 'VehicleECU')
  history.undo()
  assert.equal(getCellProperties(graph, cell).label, '차량 <ECU>')
  graph.destroy()
})

test('Asset Type changes preserve MAL identity and flows while changing native shapes and ports', () => {
  const graph = createGraph()
  const cell = graph.insertVertex(
    graph.getDefaultParent(),
    null,
    userObject({
      label: 'ECU 1',
      description: 'Control unit',
      assetType: 'ECU',
      taraKind: 'asset',
      taraShape: 'mal:ECU',
      dfdShape: 'process',
    }),
    30,
    40,
    120,
    120,
    dfdShapes[0].style,
  )
  const other = graph.insertVertex(graph.getDefaultParent(), null, 'Gateway', 300, 40, 100, 100)
  const edge = graph.insertEdge(graph.getDefaultParent(), null, 'CAN', cell, other)
  for (const [dfdShape, nativeShape] of [
    ['store', 'partialRectangle'],
    ['actor', 'rectangle'],
    ['process', 'ellipse'],
  ]) {
    updateCellProperties(graph, runtime, cell, { dfdShape })
    const preset = dfdShapes.find((shape) => shape.id === dfdShape)
    assert.deepEqual([cell.geometry.width, cell.geometry.height], [preset.width, preset.height])
    assert.deepEqual([cell.geometry.x, cell.geometry.y], [30, 40])
    assert.equal(cell.style, preset.style)
    assert.equal(getCellProperties(graph, cell).dfdShape, dfdShape)
    assert.equal(graph.getCellStyle(cell).shape, nativeShape)
    assert.equal(cell.value.getAttribute('assetType'), 'ECU')
    assert.equal(cell.value.getAttribute('taraShape'), 'mal:ECU')
    assert.equal(getCellProperties(graph, cell).label, 'ECU 1')
    assert.equal(getCellProperties(graph, cell).description, 'Control unit')
    assert.equal(edge.source, cell)
    assert.equal(edge.target, other)
    assert.equal(graph.getAllConnectionConstraints(cellState(graph, cell)).length, 8)
    if (dfdShape !== 'process') assert.equal(graph.getCellStyle(cell).aspect, undefined)
    if (dfdShape !== 'store') assert.equal(graph.getCellStyle(cell).left, undefined)
    normalizeDfdCells(graph.model, runtime)
    assert.equal(graph.getCellStyle(cell).shape, nativeShape)
  }
  graph.destroy()
})

test('Asset Type stays outside undo/redo, including older values, styles and restored deletions', () => {
  const graph = createGraph()
  const cell = graph.insertVertex(
    graph.getDefaultParent(),
    null,
    userObject({ label: 'ECU', assetType: 'ECU', taraShape: 'mal:ECU', dfdShape: 'process' }),
    30,
    40,
    100,
    100,
    dfdShapes[0].style,
  )
  const edits = createEditorHistory(graph, runtime)
  edits.updateProperties(cell, { dfdShape: 'actor' })
  assert.equal(edits.history.canUndo(), false)
  edits.updateProperties(cell, { label: 'Main ECU', description: 'Engine controller' })
  edits.updateProperties(cell, { dfdShape: 'store' })
  edits.undo()
  assert.equal(getCellProperties(graph, cell).label, 'ECU')
  assert.equal(getCellProperties(graph, cell).description, '')
  assert.equal(getCellProperties(graph, cell).dfdShape, 'store')
  assert.equal(graph.getCellStyle(cell).shape, 'partialRectangle')
  assert.equal(edits.history.canUndo(), false)
  assert.equal(edits.history.canRedo(), true)
  // A type edit must not discard the existing redo branch.
  edits.updateProperties(cell, { dfdShape: 'process' })
  assert.equal(edits.history.canRedo(), true)
  edits.redo()
  assert.equal(getCellProperties(graph, cell).label, 'Main ECU')
  assert.equal(getCellProperties(graph, cell).description, 'Engine controller')
  assert.equal(getCellProperties(graph, cell).dfdShape, 'process')
  assert.equal(graph.getCellStyle(cell).shape, 'ellipse')
  graph.removeCells([cell])
  edits.undo()
  assert.equal(graph.model.contains(cell), true)
  edits.updateProperties(cell, { dfdShape: 'actor' })
  edits.redo()
  assert.equal(graph.model.contains(cell), false)
  edits.undo()
  assert.equal(getCellProperties(graph, cell).dfdShape, 'actor')
  assert.equal(graph.getCellStyle(cell).shape, 'rectangle')
  edits.destroy()
  graph.destroy()
})

test('type choices survive undoing insertion and diagram replacement', () => {
  const graph = createGraph()
  const edits = createEditorHistory(graph, runtime)
  const cell = graph.insertVertex(
    graph.getDefaultParent(),
    null,
    userObject({ label: 'Process', taraKind: 'asset', taraShape: 'process', dfdShape: 'process' }),
    0,
    0,
    100,
    100,
    dfdShapes[0].style,
  )
  edits.updateProperties(cell, { dfdShape: 'store' })
  edits.undo()
  assert.equal(graph.model.contains(cell), false)
  assert.equal(edits.history.canUndo(), false)
  edits.redo()
  assert.equal(getCellProperties(graph, cell).dfdShape, 'store')
  assert.equal(graph.getCellStyle(cell).shape, 'partialRectangle')
  graph.model.setRoot(new runtime.mxGraphModel().getRoot())
  edits.undo()
  assert.equal(graph.model.contains(cell), true)
  assert.equal(getCellProperties(graph, cell).dfdShape, 'store')
  edits.destroy()
  graph.destroy()
})

test('preset dimensions survive undoing old moves while later resizing remains undoable', () => {
  const graph = createGraph()
  const cell = graph.insertVertex(
    graph.getDefaultParent(),
    null,
    userObject({ label: 'ECU', taraShape: 'mal:ECU', dfdShape: 'process' }),
    20,
    30,
    100,
    100,
    dfdShapes[0].style,
  )
  const edits = createEditorHistory(graph, runtime)
  const bounds = () => [cell.geometry.x, cell.geometry.y, cell.geometry.width, cell.geometry.height]
  graph.moveCells([cell], 50, 30)
  edits.updateProperties(cell, { dfdShape: 'actor' })
  assert.deepEqual(bounds(), [70, 60, 130, 70])
  edits.undo()
  assert.deepEqual(bounds(), [20, 30, 130, 70])
  assert.equal(edits.history.canUndo(), false)
  edits.redo()
  assert.deepEqual(bounds(), [70, 60, 130, 70])
  graph.resizeCell(cell, new runtime.mxRectangle(70, 60, 260, 140))
  edits.undo()
  assert.deepEqual(bounds(), [70, 60, 130, 70])
  edits.redo()
  assert.deepEqual(bounds(), [70, 60, 260, 140])
  edits.updateProperties(cell, { label: 'Renamed' })
  edits.undo()
  assert.equal(getCellProperties(graph, cell).label, 'ECU')
  assert.deepEqual(bounds(), [70, 60, 260, 140])
  normalizeDfdCells(graph.model, runtime)
  assert.deepEqual(bounds(), [70, 60, 260, 140])
  // Choosing the same type later must still keep its newly applied default size.
  edits.updateProperties(cell, { dfdShape: 'process' })
  edits.updateProperties(cell, { dfdShape: 'actor' })
  edits.undo()
  assert.deepEqual(bounds(), [70, 60, 130, 70])
  edits.redo()
  assert.deepEqual(bounds(), [70, 60, 130, 70])
  edits.destroy()
  graph.destroy()
})

test('Asset Type rejects invalid choices and cannot turn flows, boundaries or text into assets', () => {
  const graph = createGraph()
  const parent = graph.getDefaultParent()
  for (const shape of dfdShapes) {
    const cell = graph.insertVertex(
      parent,
      null,
      userObject({ taraKind: shape.kind, taraShape: shape.id }),
      0,
      0,
      shape.width,
      shape.height,
      shape.style,
    )
    if (shape.kind === 'asset') {
      assert.equal(getCellProperties(graph, cell).dfdShape, shape.id)
      assert.throws(
        () => updateCellProperties(graph, runtime, cell, { dfdShape: 'invalid' }),
        /Select Process/,
      )
    } else {
      assert.equal(getCellProperties(graph, cell).dfdShape, '')
      assert.throws(
        () => updateCellProperties(graph, runtime, cell, { dfdShape: 'process' }),
        /only be changed for assets/,
      )
    }
  }
  const text = graph.insertVertex(
    parent,
    null,
    userObject({ taraKind: 'annotation', taraShape: 'text' }),
    0,
    0,
    100,
    40,
  )
  const edge = graph.insertEdge(parent, null, 'Flow', text, text)
  for (const cell of [text, edge]) {
    assert.equal(getCellProperties(graph, cell).dfdShape, '')
    assert.throws(
      () => updateCellProperties(graph, runtime, cell, { dfdShape: 'store' }),
      /only be changed for assets/,
    )
  }
  graph.destroy()
})

test('Trust Boundary roundness edits are a single undoable style change that preserves metadata', () => {
  const graph = createGraph()
  const value = userObject({
    label: 'Vehicle',
    description: 'Internal network',
    taraKind: 'boundary',
    taraShape: 'boundary',
  })
  const cell = graph.insertVertex(
    graph.getDefaultParent(),
    null,
    value,
    10,
    20,
    300,
    220,
    dfdShapes[3].style,
  )
  const history = trackHistory(graph)
  assert.equal(getCellProperties(graph, cell).cornerRoundness, 30)
  updateCellProperties(graph, runtime, cell, { cornerRoundness: 75 })
  assert.equal(getCellProperties(graph, cell).cornerRoundness, 75)
  assert.equal(cell.value, value)
  assert.equal(cell.value.getAttribute('description'), 'Internal network')
  assert.equal(graph.getCellStyle(cell).strokeColor, '#ff0000')
  assert.equal(graph.getCellStyle(cell).dashed, 1)
  updateCellProperties(graph, runtime, cell, { cornerRoundness: 75 })
  history.undo()
  assert.equal(getCellProperties(graph, cell).cornerRoundness, 30)
  assert.equal(history.canUndo(), false)
  history.redo()
  assert.equal(getCellProperties(graph, cell).cornerRoundness, 75)
  graph.destroy()
})

test('the boundary handle previews rounded corners while dragging and commits a single undoable edit', (context) => {
  stubHandleDom(context)
  const graph = createGraph()
  const value = userObject({
    label: 'Vehicle',
    taraKind: 'boundary',
    description: 'Internal network',
  })
  const boundary = graph.insertVertex(
    graph.getDefaultParent(),
    null,
    value,
    10,
    20,
    300,
    220,
    dfdShapes[3].style,
  )
  const history = trackHistory(graph)
  const state = interactiveState(graph, boundary)
  const handler = graph.createVertexHandler(state)
  assert.equal(handler.customHandles.length, 1)
  const handle = handler.customHandles[0]
  const origin = handle.getPosition(state.getPaintBounds())
  const index = handler.getHandleForEvent(pointerAt(state, origin.x, origin.y, 'mousedown'))
  assert.equal(index, runtime.mxEvent.CUSTOM_HANDLE)
  assert.equal(graph.getAllConnectionConstraints(state), null)
  const radii = []
  graph.cellRenderer.redraw = (preview) => {
    preview.shape.apply(preview)
    preview.shape.paintBackground(
      {
        roundrect(x, y, width, height, rx) {
          radii.push(rx)
        },
        fillAndStroke() {},
      },
      0,
      0,
      300,
      220,
    )
  }
  handler.start(origin.x, origin.y, index)
  assert.equal(handler.livePreviewActive, true)
  // The native handle offsets the pointer by one quarter of its marker size.
  const dragTo = (percentage) => pointerAt(state, 310 - (110 * percentage) / 100 + 3, origin.y)
  handler.mouseMove(graph, dragTo(60))
  handler.mouseMove(graph, dragTo(80))
  assert.deepEqual(radii, [66, 88])
  assert.equal(boundary.style, dfdShapes[3].style)
  assert.equal(history.canUndo(), false)
  handler.mouseUp(graph, dragTo(80))
  assert.equal(getCellProperties(graph, boundary).cornerRoundness, 80)
  assert.equal(boundary.value, value)
  assert.equal(graph.getCellStyle(boundary).fontColor, '#ff0000')
  assert.equal(graph.getCellStyle(boundary).fontStyle, 1)
  history.undo()
  assert.equal(getCellProperties(graph, boundary).cornerRoundness, 30)
  assert.equal(history.canUndo(), false)
  history.redo()
  assert.equal(getCellProperties(graph, boundary).cornerRoundness, 80)
  normalizeDfdCells(graph.model, runtime)
  assert.equal(getCellProperties(graph, boundary).cornerRoundness, 80)
  handler.destroy()
  graph.destroy()
})

test('boundary handles respect zoom/pan, clamp endpoints and cancel previews with Escape', (context) => {
  stubHandleDom(context)
  const graph = createGraph()
  graph.view.scale = 2
  graph.view.translate = new runtime.mxPoint(35, 40)
  const boundary = graph.insertVertex(
    graph.getDefaultParent(),
    null,
    userObject({ taraShape: 'boundary' }),
    10,
    20,
    300,
    220,
    `${dfdShapes[3].style}absoluteArcSize=1;arcSize=44;`,
  )
  const history = trackHistory(graph)
  const state = interactiveState(graph, boundary)
  const handler = graph.createVertexHandler(state)
  const handle = handler.customHandles[0]
  graph.cellRenderer.redraw = (preview) => preview.shape.apply(preview)
  const origin = handle.getPosition(state.getPaintBounds())
  assert.equal(origin.x, 310 - 22)
  assert.equal(handle.shape.bounds.getCenterX(), (origin.x + 35) * 2)
  handler.start((origin.x + 35) * 2, (origin.y + 40) * 2, runtime.mxEvent.CUSTOM_HANDLE)
  const dragTo = (x) => pointerAt(state, (x + 35) * 2 + 3, (origin.y + 40) * 2)
  handler.mouseMove(graph, dragTo(500))
  assert.equal(state.style.arcSize, 0)
  handler.mouseMove(graph, dragTo(100))
  assert.equal(state.style.arcSize, 50)
  handler.mouseMove(graph, dragTo(310 - 110 * 0.45))
  assert.equal(state.style.arcSize, 22.5)
  graph.fireEvent(new runtime.mxEventObject(runtime.mxEvent.ESCAPE))
  assert.equal(state.style.absoluteArcSize, 1)
  assert.equal(state.style.arcSize, 44)
  assert.equal(getCellProperties(graph, boundary).cornerRoundness, 20)
  assert.equal(history.canUndo(), false)
  assert.equal(handler.index, null)
  // A click without a drag after cancellation must not commit the old preview.
  handler.start((origin.x + 35) * 2, (origin.y + 40) * 2, runtime.mxEvent.CUSTOM_HANDLE)
  handler.mouseUp(graph, dragTo(origin.x))
  assert.equal(history.canUndo(), false)
  handler.refresh()
  assert.equal(handler.customHandles.length, 1)
  handler.destroy()
  graph.destroy()
})

test('native resize previews update boundary and asset sizes before committing one undoable resize', (context) => {
  stubHandleDom(context)
  for (const shape of [dfdShapes[3], dfdShapes[1]]) {
    const graph = createGraph()
    const cell = graph.insertVertex(
      graph.getDefaultParent(),
      null,
      userObject({ taraKind: shape.kind }),
      20,
      30,
      300,
      220,
      shape.style,
    )
    const history = trackHistory(graph)
    const state = interactiveState(graph, cell)
    const handler = graph.createVertexHandler(state)
    if (shape.kind !== 'boundary') assert.equal(handler.customHandles, null)
    const drawn = []
    graph.cellRenderer.redraw = (preview) => {
      drawn.push([preview.width, preview.height])
    }
    const southeast = handler.sizers[7].bounds
    const x = southeast.getCenterX()
    const y = southeast.getCenterY()
    handler.start(x, y, 7)
    assert.equal(handler.livePreviewActive, true)
    handler.mouseMove(graph, pointerAt(state, x + 40, y + 20))
    handler.mouseMove(graph, pointerAt(state, x + 80, y + 60))
    assert.deepEqual(drawn, [
      [340, 240],
      [380, 280],
    ])
    assert.deepEqual([cell.geometry.width, cell.geometry.height], [300, 220])
    assert.equal(history.canUndo(), false)
    handler.mouseUp(graph, pointerAt(state, x + 80, y + 60, 'mouseup'))
    assert.deepEqual([cell.geometry.width, cell.geometry.height], [380, 280])
    history.undo()
    assert.deepEqual([cell.geometry.width, cell.geometry.height], [300, 220])
    assert.equal(history.canUndo(), false)
    history.redo()
    assert.deepEqual([cell.geometry.width, cell.geometry.height], [380, 280])
    handler.destroy()
    graph.destroy()
  }
})

test('boundary rounding reaches square and fully rounded corners and survives style restoration', () => {
  const graph = createGraph()
  const cell = graph.insertVertex(
    graph.getDefaultParent(),
    null,
    userObject({ taraShape: 'boundary' }),
    0,
    0,
    300,
    220,
    dfdShapes[3].style,
  )
  for (const percentage of [0, 40, 100]) {
    updateCellProperties(graph, runtime, cell, { cornerRoundness: percentage })
    normalizeDfdCells(graph.model, runtime)
    assert.equal(getCellProperties(graph, cell).cornerRoundness, percentage)
    const shape = new runtime.mxRectangleShape()
    shape.apply(cellState(graph, cell))
    let radius
    // Exercise the actual draw.io geometry without painting SVG to a browser.
    shape.paintBackground(
      {
        roundrect(x, y, width, height, rx, ry) {
          radius = [rx, ry]
        },
        fillAndStroke() {},
      },
      0,
      0,
      300,
      220,
    )
    assert.ok(radius.every((value) => Math.abs(value - (percentage / 100) * 110) < 1e-9))
  }
  graph.destroy()
})

test('roundness controls reject nonnumeric values, clamp limits and affect only boundaries', () => {
  const graph = createGraph()
  const parent = graph.getDefaultParent()
  const boundary = graph.insertVertex(
    parent,
    null,
    userObject({ taraKind: 'boundary' }),
    0,
    0,
    300,
    220,
    dfdShapes[3].style,
  )
  const actor = graph.insertVertex(parent, null, 'Actor', 0, 0, 130, 70, dfdShapes[1].style)
  const history = trackHistory(graph)
  updateCellProperties(graph, runtime, actor, { cornerRoundness: 80 })
  assert.equal(getCellProperties(graph, actor).cornerRoundness, null)
  assert.equal(actor.style, dfdShapes[1].style)
  for (const cornerRoundness of [NaN, Infinity, '', null]) {
    assert.throws(
      () => updateCellProperties(graph, runtime, boundary, { cornerRoundness }),
      /Corner roundness/,
    )
  }
  assert.equal(history.canUndo(), false)
  updateCellProperties(graph, runtime, boundary, { cornerRoundness: -20 })
  assert.equal(getCellProperties(graph, boundary).cornerRoundness, 0)
  updateCellProperties(graph, runtime, boundary, { cornerRoundness: 120 })
  assert.equal(getCellProperties(graph, boundary).cornerRoundness, 100)
  graph.destroy()
})

test('Data Store paints only top and bottom lines while retaining an interior hit area', () => {
  const Shape = runtime.mxCellRenderer.defaultShapes.partialRectangle
  const shape = new Shape()
  shape.style = { top: '1', bottom: '1', left: '0', right: '0' }
  const lines = []
  let position
  shape.paintBackground(
    {
      rect() {},
      fill() {},
      begin() {},
      stroke() {},
      moveTo(x, y) {
        position = [x, y]
      },
      lineTo(x, y) {
        lines.push([position, [x, y]])
        position = [x, y]
      },
    },
    10,
    20,
    130,
    70,
  )
  assert.deepEqual(lines, [
    [
      [10, 20],
      [140, 20],
    ],
    [
      [140, 90],
      [10, 90],
    ],
  ])
  assert.equal(shape.shapePointerEvents, true)
})

test('restores older AutoTARA DFD styles without changing unrelated imported shapes', () => {
  const graph = createGraph()
  const parent = graph.getDefaultParent()
  const process = graph.insertVertex(
    parent,
    null,
    userObject({ taraShape: 'process' }),
    10,
    20,
    120,
    80,
    'shape=ellipse;fillColor=#dae8fc;strokeColor=#6c8ebf;',
  )
  const store = graph.insertVertex(
    parent,
    null,
    userObject({ taraShape: 'mal:Storage' }),
    200,
    20,
    110,
    90,
    'shape=cylinder;fillColor=#d5e8d4;',
  )
  const imported = graph.insertVertex(parent, null, 'Custom', 0, 0, 80, 60, 'fillColor=red;')
  normalizeDfdCells(graph.model, runtime)
  assert.equal(process.geometry.width, process.geometry.height)
  assert.equal(process.geometry.x, 10)
  assert.match(process.style, /fillColor=none;/)
  assert.match(process.style, /strokeColor=#000000;/)
  assert.match(store.style, /shape=partialRectangle;/)
  assert.equal(imported.style, 'fillColor=red;')
  graph.destroy()
})

test('restoring a saved Asset Type takes precedence over the original stencil and old style', () => {
  const graph = createGraph()
  for (const taraShape of ['process', 'mal:ECU']) {
    const cell = graph.insertVertex(
      graph.getDefaultParent(),
      null,
      userObject({ taraShape, dfdShape: 'store', label: 'Saved asset' }),
      20,
      30,
      150,
      80,
      dfdShapes[0].style,
    )
    normalizeDfdCells(graph.model, runtime)
    assert.equal(getCellProperties(graph, cell).dfdShape, 'store')
    assert.equal(graph.getCellStyle(cell).shape, 'partialRectangle')
    assert.equal(graph.getCellStyle(cell).aspect, undefined)
    assert.deepEqual(
      [cell.geometry.x, cell.geometry.y, cell.geometry.width, cell.geometry.height],
      [20, 30, 150, 80],
    )
    const edits = createEditorHistory(graph, runtime)
    graph.resizeCell(cell, new runtime.mxRectangle(40, 50, 200, 100))
    edits.updateProperties(cell, { dfdShape: 'process' })
    assert.equal(cell.geometry.height, 100)
    edits.undo()
    assert.equal(getCellProperties(graph, cell).dfdShape, 'process')
    assert.equal(graph.getCellStyle(cell).shape, 'ellipse')
    assert.deepEqual(
      [cell.geometry.x, cell.geometry.y, cell.geometry.width, cell.geometry.height],
      [20, 30, 100, 100],
    )
    assert.equal(edits.history.canUndo(), false)
    edits.redo()
    assert.deepEqual(
      [cell.geometry.x, cell.geometry.y, cell.geometry.width, cell.geometry.height],
      [40, 50, 100, 100],
    )
    edits.destroy()
  }
  graph.destroy()
})

test('Defense states survive native Diagram import, XML save and model snapshots', () => {
  const yaml =
    'assets:\n  0:\n    name: Device\n    type: Device\n    defenses:\n      shield: 1\n      bypass: 0\n      uncertain: 0.5\n      unknown: null\n'
  const graph = createGraph()
  graph.model.setRoot(readDiagramFile(yaml, null, runtime).getRoot())
  const expected = { shield: 1, bypass: 0, uncertain: 0.5, unknown: null }
  assert.deepEqual(getModelSnapshot(graph).vertices[0].defenses, expected)
  const xml = createDrawioFile(graph.model, 'defenses', runtime)
  graph.model.setRoot(readDiagramFile(xml, null, runtime).getRoot())
  assert.deepEqual(getModelSnapshot(graph).vertices[0].defenses, expected)
  graph.destroy()
})

test('saved draw.io Diagram → snapshot → graph → worker search contract retains blocked structural paths', async () => {
  const read = (name) => readFile(new URL(`../../sample/${name}`, import.meta.url), 'utf8')
  const { languageGraph } = parseLanguageGraph(await read('vehicleLang_v2-langgraph.json'))
  const graph = createGraph()
  graph.model.setRoot(
    readDiagramFile(await read('Tesla_Model_S_Model.drawio'), languageGraph, runtime).getRoot(),
  )
  const snapshot = getModelSnapshot(graph)
  for (const [asset, kind, name] of [
    ['QtCarBrowser', 'entry', 'localConnect'],
    ['PT-CAN', 'target', 'messageInjection'],
  ])
    snapshot.vertices.find((item) => item.label === asset).attackEndpoints = {
      s: { [kind]: [{ name, attackStepId: name }] },
    }
  const data = buildAttackGraph(snapshot, languageGraph, 's')
  const result = findAttackPaths(data, { maxPaths: 2 })
  assert.equal(result.paths.length, 2)
  assert.equal(result.metrics[0].routeHops, 18)
  assert(result.metrics.every((metric) => metric.status === 'infeasible'))
  assert.equal(result.targetResults[0].structuralPath, true)
  graph.destroy()
})
