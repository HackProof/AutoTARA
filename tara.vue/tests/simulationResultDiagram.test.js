import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSimulationResultGraph,
  layoutSimulationResult,
} from '../src/services/simulationResult.js'
import { createSimulationResultDiagram } from '../src/services/drawio/simulationResult.js'

test('asset diagrams hide steps until expanded and preserve real connections across collapsed endpoints', () => {
  let instance
  const selectionListeners = new Set()
  const listeners = new Map()
  const modelListeners = new Map()
  const containerListeners = new Map()
  let disconnected = false
  class Graph {
    constructor() {
      instance = this
      this.vertices = []
      this.edges = []
      this.root = {}
      this.panningHandler = {}
      this.graphHandler = {}
      this.model = {
        beginUpdate() {},
        endUpdate() {},
        addListener: (event, handler) => modelListeners.set(event, handler),
        removeListener: (handler) => {
          for (const [event, value] of modelListeners)
            if (value === handler) modelListeners.delete(event)
        },
        clear: () => {
          this.vertices = []
          this.edges = []
        },
      }
      this.view = { scale: 1, addListener() {}, removeListener() {} }
      this.selectionModel = {
        addListener: (_, handler) => selectionListeners.add(handler),
        removeListener: (handler) => selectionListeners.delete(handler),
      }
      for (const method of [
        'setConnectable',
        'setCellsEditable',
        'setCellsMovable',
        'setCellsResizable',
        'setCellsDeletable',
        'setCellsDisconnectable',
        'setCellsBendable',
        'setCellsCloneable',
        'setDropEnabled',
        'setAllowDanglingEdges',
        'setConstrainChildren',
        'setPanning',
        'setCellsSelectable',
        'setTooltips',
        'setHtmlLabels',
      ])
        this[method] = () => {}
    }
    getSelectionModel() {
      return this.selectionModel
    }
    getSelectionCell() {
      return this.selected
    }
    setSelectionCell(cell) {
      this.selected = cell
      selectionListeners.forEach((handler) => handler())
    }
    clearSelection() {
      this.setSelectionCell(null)
    }
    addListener(event, handler) {
      listeners.set(event, handler)
    }
    removeListener(handler) {
      for (const [event, value] of listeners) if (value === handler) listeners.delete(event)
    }
    getDefaultParent() {
      return this.root
    }
    insertVertex(parent, id, value, x, y, width, height, style) {
      const cell = {
        parent,
        id: id ?? `v${this.vertices.length}`,
        value,
        geometry: { x, y, width, height },
        style,
      }
      this.vertices.push(cell)
      return cell
    }
    insertEdge(parent, id, value, source, target, style) {
      this.edges.push({ parent, id, value, source, target, style })
    }
    scrollCellToVisible() {}
    zoomTo(scale) {
      this.view.scale = scale
    }
    destroy() {
      this.destroyed = true
    }
  }
  const previousObserver = globalThis.ResizeObserver
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {
      disconnected = true
    }
  }
  const nodes = [
    ['E', 'Browser'],
    ['A', 'Browser'],
    ['B', 'Gateway'],
    ['C', 'Gateway'],
    ['T', 'ECU'],
    ['O', 'Off-path'],
  ].map(([id, asset], index) => ({ id, name: `step-${id}`, type: 'or', asset, performedAt: index }))
  Object.assign(nodes[1], {
    name: '<img src=x onerror=bad()>',
    riskScore: 4.3,
    riskAssessed: true,
    ctsaScore: null,
  })
  const edges = [
    ['E', 'A'],
    ['A', 'B'],
    ['E', 'B'],
    ['B', 'C'],
    ['C', 'T'],
    ['B', 'T'],
    ['A', 'O'],
  ].map(([source, target]) => ({ source, target }))
  const data = buildSimulationResultGraph({
    performedNodes: nodes,
    performedEdges: edges,
    entryIds: ['E'],
    targetIds: ['T'],
    targets: [{ id: 'T', reached: true }],
  })
  const selected = []
  const selectedAssets = []
  const toggled = []
  const container = {
    addEventListener: (event, handler) => containerListeners.set(event, handler),
    removeEventListener: (event) => containerListeners.delete(event),
  }
  let diagram
  try {
    diagram = createSimulationResultDiagram({
      container,
      runtime: {
        mxGraph: Graph,
        mxEvent: {
          CHANGE: 'change',
          CLICK: 'click',
          SCALE: 'scale',
          SCALE_AND_TRANSLATE: 'scaleAndTranslate',
        },
      },
      onSelect: (node) => selected.push(node),
      onSelectAsset: (asset) => selectedAssets.push(asset),
      onToggleAsset: (id) => toggled.push(id),
    })
    diagram.render(layoutSimulationResult(data))
    assert.equal(instance.vertices.length, 4)
    assert(instance.vertices.every((cell) => cell.value.asset && !cell.value.node))
    assert(instance.vertices.every((cell) => /\(\+\d+ steps\)/.test(cell.value.label)))
    assert(instance.vertices.every((cell) => !/Click to|compromised steps/.test(cell.value.label)))
    assert(instance.edges.every((edge) => !/exit[XY]=|entry[XY]=/.test(edge.style)))
    assert.equal(instance.edges.length, 3)
    assert.equal(instance.edges.filter((edge) => edge.value.label === '2 connections').length, 2)
    assert(
      instance.edges.every(
        (edge) => edge.source !== edge.target && edge.style.includes('dashed=1'),
      ),
    )
    const browser = data.assets.find((asset) => asset.name === 'Browser')
    const browserCell = instance.vertices.find((cell) => cell.value.asset.id === browser.id)
    instance.setSelectionCell(browserCell)
    listeners.get('click')(null, { isConsumed: () => false, getProperty: () => browserCell })
    assert.equal(selectedAssets.at(-1).id, browser.id)
    assert.deepEqual(toggled, [browser.id])
    listeners.get('click')(null, { isConsumed: () => true, getProperty: () => browserCell })
    assert.equal(toggled.length, 1)

    diagram.render(layoutSimulationResult(data, new Set([browser.id])), {
      selectedAssetId: browser.id,
    })
    assert.equal(instance.vertices.filter((cell) => cell.value.node).length, 2)
    assert.equal(instance.vertices.length, 6)
    const scored = instance.vertices.find((cell) => cell.value.node?.id === 'A')
    assert.equal(scored.geometry.height, 88)
    assert.match(scored.value.htmlLabel, /class="badge rounded-pill text-bg-danger"/)
    assert.match(scored.value.htmlLabel, /CTSA Score: 4.3/)
    assert.match(scored.value.htmlLabel, /&lt;img/)
    assert(!scored.value.htmlLabel.includes('<img'))
    assert.equal(instance.convertValueToString(scored), scored.value.htmlLabel)
    assert.equal(
      instance.convertValueToString({ value: { label: '<svg>&name' } }),
      '&lt;svg&gt;&amp;name',
    )
    assert.equal(instance.edges.length, 5)
    assert(
      instance.edges.some(
        (edge) => edge.source.value.node?.id === 'E' && edge.target.value.node?.id === 'A',
      ),
    )
    assert(
      instance.edges.some(
        (edge) => edge.source.value.node?.id === 'A' && edge.target.value.asset?.name === 'Gateway',
      ),
    )
    diagram.select('A')
    assert.equal(selected.at(-1).id, 'A')
    assert.equal(selectedAssets.at(-1).id, browser.id)
    listeners.get('click')(null, {
      isConsumed: () => false,
      getProperty: () => instance.getSelectionCell(),
    })
    assert.equal(toggled.length, 1)

    diagram.render(layoutSimulationResult(data, new Set(data.assets.map((asset) => asset.id))))
    assert.equal(instance.edges.length, edges.length)
    assert.deepEqual(
      new Set(
        instance.edges.map((edge) => `${edge.source.value.node.id}->${edge.target.value.node.id}`),
      ),
      new Set(edges.map((edge) => `${edge.source}->${edge.target}`)),
    )
    diagram.render(layoutSimulationResult(data), { selectedNodeId: 'A' })
    assert.equal(selected.at(-1), null)
    assert.equal(selectedAssets.at(-1).id, browser.id)
    assert.equal(instance.vertices.length, 4)
  } finally {
    diagram?.destroy()
    if (previousObserver === undefined) delete globalThis.ResizeObserver
    else globalThis.ResizeObserver = previousObserver
  }
  assert(disconnected && instance.destroyed)
  assert.equal(selectionListeners.size, 0)
  assert.equal(modelListeners.size, 0)
  assert.equal(listeners.size, 0)
  assert.equal(containerListeners.size, 0)
})
