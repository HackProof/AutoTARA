import { createDrawioFile, readDiagramModel, serializeModel } from './xml.js'
import { configureGraphBehavior } from './graphBehavior.js'
import { configureCellLabels, getCellProperties } from './properties.js'
import { createEditorHistory } from './history.js'
import { normalizeDfdCells } from './shapes.js'
import { configureAssociations } from './associations.js'
import { getModelSnapshot } from './modelSnapshot.js'
import { configureFlowAssociations } from './flowAssociations.js'
import { prepareDiagramFile } from './import.js'
import { updateThreatAssessments } from './threatAssessments.js'
import { initializeDiagramSchema, readDiagramSchema } from './diagramMetadata.js'
import { readAttackEndpoints, updateAttackEndpoints } from './attackEndpoints.js'
import { createCompromisedAssetHighlights } from './compromisedAssets.js'
import { updateCrraAssessment } from './crraMetadata.js'

export function createDrawioEditor({
  container,
  runtime: mx,
  xml = '',
  languageGraph = null,
  catalogSchema = '',
  onChange,
  onState,
  onSave,
  onChooseAssociation,
}) {
  const initialModel = xml ? readDiagramModel(xml, mx) : new mx.mxGraphModel()
  initializeDiagramSchema(initialModel, mx, catalogSchema)
  normalizeDfdCells(initialModel, mx)
  const graph = new mx.mxGraph(container, initialModel)
  const model = graph.getModel()
  const edits = createEditorHistory(graph, mx)
  const history = edits.history
  const disposers = []
  const stencilDisposers = new Set()
  let destroyed = false
  let importController
  const compromisedHighlights = createCompromisedAssetHighlights(graph, mx)
  disposers.push(() => compromisedHighlights.destroy())

  configureGraphBehavior(graph, mx)
  configureCellLabels(graph, mx)
  const flowAssociations = configureFlowAssociations(graph, mx, languageGraph, onChooseAssociation)
  if (flowAssociations) disposers.push(() => flowAssociations.destroy())
  disposers.push(
    configureAssociations(graph, mx, languageGraph, (connectionFeedback) =>
      onState?.({ connectionFeedback }),
    ),
  )
  graph.setConnectable(true)
  graph.setAllowDanglingEdges(false)
  graph.setMultigraph(true)
  graph.setPanning(true)
  graph.setTooltips(false)
  graph.setHtmlLabels(false)
  graph.setDropEnabled(false)
  graph.setCellsCloneable(true)
  graph.foldingEnabled = false
  graph.gridSize = 10
  graph.graphHandler.guidesEnabled = true
  graph.minimumGraphSize = new mx.mxRectangle(0, 0, 1200, 800)
  Object.assign(graph.getStylesheet().getDefaultVertexStyle(), {
    fillColor: 'none',
    strokeColor: '#000000',
    strokeWidth: 2,
    fontColor: '#000000',
    fontSize: 13,
    fontFamily: 'Arial',
    whiteSpace: 'wrap',
    html: 0,
  })
  function listen(target, event, handler) {
    target.addListener(event, handler)
    disposers.push(() => target.removeListener(handler))
  }

  function updateState() {
    if (destroyed) return
    const cells = model.filterDescendants((cell) => model.isVertex(cell) || model.isEdge(cell))
    const selected = graph.getSelectionCell()
    const scale = graph.view.scale
    const attackEndpointCounts = { entry: 0, target: 0 }
    const schema = readDiagramSchema(model)
    for (const cell of cells) {
      if (!model.isVertex(cell)) continue
      const endpoints = readAttackEndpoints(model.getValue(cell))[schema]
      attackEndpointCounts.entry += endpoints?.entry.length || 0
      attackEndpointCounts.target += endpoints?.target.length || 0
    }
    container.style.backgroundSize = `${graph.gridSize * scale}px ${graph.gridSize * scale}px`
    container.style.backgroundPosition = `${graph.view.translate.x * scale}px ${graph.view.translate.y * scale}px`
    onState?.({
      ready: true,
      canUndo: history.canUndo(),
      canRedo: history.canRedo(),
      selectionCount: graph.getSelectionCount(),
      shapeCount: cells.filter((cell) => model.isVertex(cell)).length,
      edgeCount: cells.filter((cell) => model.isEdge(cell)).length,
      zoom: Math.round(scale * 100),
      attackEndpointCounts,
      selection: selected
        ? {
            ...getCellProperties(graph, selected),
            association: flowAssociations?.getProperties(selected) || null,
          }
        : null,
    })
  }

  listen(model, mx.mxEvent.UNDO, updateState)
  listen(model, mx.mxEvent.CHANGE, () => {
    onChange?.(serializeModel(model, mx), readDiagramSchema(model))
    updateState()
  })
  for (const event of [mx.mxEvent.UNDO, mx.mxEvent.REDO, mx.mxEvent.CLEAR])
    listen(history, event, updateState)
  listen(graph.getSelectionModel(), mx.mxEvent.CHANGE, updateState)
  for (const event of [mx.mxEvent.SCALE, mx.mxEvent.TRANSLATE, mx.mxEvent.SCALE_AND_TRANSLATE]) {
    listen(graph.view, event, updateState)
  }

  const rubberband = new mx.mxRubberband(graph)
  const keys = new mx.mxKeyHandler(graph, container)
  keys.isControlDown = (event) => event.ctrlKey || event.metaKey

  function focus() {
    container.focus({ preventScroll: true })
  }
  function undo() {
    graph.stopEditing(false)
    edits.undo()
    graph.clearSelection()
    updateState()
    focus()
  }
  function redo() {
    graph.stopEditing(false)
    edits.redo()
    graph.clearSelection()
    updateState()
    focus()
  }
  function remove() {
    graph.stopEditing(false)
    graph.removeCells(graph.getSelectionCells(), true)
    focus()
  }
  function duplicate() {
    graph.stopEditing(false)
    graph.setSelectionCells(graph.moveCells(graph.getSelectionCells(), 20, 20, true))
    focus()
  }
  keys.bindKey(46, remove)
  keys.bindKey(8, remove)
  keys.bindKey(113, () => graph.startEditingAtCell())
  keys.bindKey(13, () => graph.startEditingAtCell())
  keys.bindControlKey(90, undo)
  keys.bindControlKey(89, redo)
  keys.bindControlShiftKey(90, redo)
  keys.bindControlKey(65, () => graph.selectAll())
  keys.bindControlKey(67, () => mx.mxClipboard.copy(graph))
  keys.bindControlKey(88, () => mx.mxClipboard.cut(graph))
  keys.bindControlKey(86, () => mx.mxClipboard.paste(graph))
  keys.bindControlKey(68, duplicate)
  keys.bindControlKey(83, () => onSave?.())
  for (const [key, dx, dy] of [
    [37, -1, 0],
    [38, 0, -1],
    [39, 1, 0],
    [40, 0, 1],
  ]) {
    keys.bindKey(key, () =>
      graph.moveCells(graph.getSelectionCells(), dx * graph.gridSize, dy * graph.gridSize),
    )
  }

  const focusOnPointer = () => {
    if (!graph.isEditing()) focus()
  }
  container.addEventListener('pointerdown', focusOnPointer)
  const preventMenu = (event) => event.preventDefault()
  container.addEventListener('contextmenu', preventMenu)
  graph.popupMenuHandler.factoryMethod = (menu, cell) => {
    if (cell) {
      menu.addItem('Edit label', null, () => graph.startEditingAtCell(cell))
      menu.addItem('Duplicate', null, duplicate)
      menu.addItem('Delete', null, remove)
      menu.addSeparator()
    }
    menu.addItem('Undo', null, undo, null, null, history.canUndo())
    menu.addItem('Redo', null, redo, null, null, history.canRedo())
  }

  function zoom(factor) {
    graph.zoomTo(Math.min(4, Math.max(0.2, graph.view.scale * factor)))
    focus()
  }
  const wheel = (event) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      zoom(event.deltaY < 0 ? 1.2 : 1 / 1.2)
    }
  }
  container.addEventListener('wheel', wheel, { passive: false })
  const observer = new ResizeObserver(() => {
    if (!destroyed) graph.sizeDidChange()
  })
  observer.observe(container)

  function insertShape(shape, point) {
    graph.stopEditing(false)
    const scale = graph.view.scale
    const position = point || {
      x:
        (container.scrollLeft + container.clientWidth / 2) / scale -
        graph.view.translate.x -
        shape.width / 2,
      y:
        (container.scrollTop + container.clientHeight / 2) / scale -
        graph.view.translate.y -
        shape.height / 2,
    }
    const value = mx.mxUtils.createXmlDocument().createElement('object')
    value.setAttribute('label', shape.label)
    value.setAttribute('taraKind', shape.kind)
    value.setAttribute('taraShape', shape.id)
    if (shape.kind === 'asset') value.setAttribute('dfdShape', shape.dfdShape || shape.id)
    if (shape.assetType) value.setAttribute('assetType', shape.assetType)
    let cell
    model.beginUpdate()
    try {
      cell = graph.insertVertex(
        graph.getDefaultParent(),
        null,
        value,
        graph.snap(Math.max(0, position.x)),
        graph.snap(Math.max(0, position.y)),
        shape.width,
        shape.height,
        shape.style,
      )
      cell.setConnectable(shape.kind === 'asset')
      if (shape.kind === 'boundary') graph.orderCells(true, [cell])
    } finally {
      model.endUpdate()
    }
    graph.setSelectionCell(cell)
    graph.scrollCellToVisible(cell)
    focus()
    return cell
  }

  function registerStencil(element, shape) {
    const preview = document.createElement('div')
    preview.style.width = `${shape.width}px`
    preview.style.height = `${shape.height}px`
    const icon = element.querySelector('svg')?.cloneNode(true)
    if (icon) {
      icon.setAttribute('width', '100%')
      icon.setAttribute('height', '100%')
      preview.appendChild(icon)
    }
    const source = mx.mxUtils.makeDraggable(
      element,
      graph,
      (_, event, target, x, y) => insertShape(shape, { x, y }),
      preview,
      0,
      0,
      true,
      true,
      false,
    )
    source.setGuidesEnabled(true)
    let origin
    const mouseDown = source.mouseDown
    source.mouseDown = function (event) {
      origin = { x: mx.mxEvent.getClientX(event), y: mx.mxEvent.getClientY(event) }
      mouseDown.call(this, event)
    }
    const mouseUp = source.mouseUp
    source.mouseUp = function (event) {
      const tapped =
        !this.currentGraph &&
        origin &&
        element.contains(mx.mxEvent.getSource(event)) &&
        Math.hypot(
          mx.mxEvent.getClientX(event) - origin.x,
          mx.mxEvent.getClientY(event) - origin.y,
        ) < 5
      mouseUp.call(this, event)
      if (tapped) insertShape(shape)
      origin = null
    }
    const cleanup = () => {
      source.reset()
      mx.mxEvent.release(element)
      stencilDisposers.delete(cleanup)
    }
    stencilDisposers.add(cleanup)
    return cleanup
  }

  function fit() {
    if (graph.getGraphBounds().width > 0) {
      graph.fit(40)
      graph.zoomTo(Math.max(0.2, Math.min(1, graph.view.scale)))
      graph.center(true, true)
    }
    focus()
  }

  function loadModel(imported) {
    initializeDiagramSchema(imported, mx, readDiagramSchema(model) || '')
    normalizeDfdCells(imported, mx)
    graph.stopEditing(false)
    model.setRoot(imported.getRoot())
    graph.clearSelection()
    fit()
  }

  async function loadFile(text) {
    importController?.abort()
    const controller = new AbortController()
    importController = controller
    try {
      const { model: imported, ctsaError } = await prepareDiagramFile(text, languageGraph, mx, {
        fallbackSchema: readDiagramSchema(model) || '',
        signal: controller.signal,
      })
      if (destroyed || controller.signal.aborted) return
      loadModel(imported)
      return { ctsaError }
    } catch (error) {
      if (!destroyed && !controller.signal.aborted) throw error
    } finally {
      if (importController === controller) importController = null
    }
  }

  function autoLayout() {
    graph.stopEditing(false)
    const layout = new mx.mxCircleLayout(graph)
    const isIgnored = layout.isVertexIgnored
    layout.isVertexIgnored = (cell) =>
      isIgnored.call(layout, cell) ||
      (cell.value?.nodeType === 1 &&
        ['boundary', 'annotation'].includes(cell.value.getAttribute('taraKind')))
    layout.moveCircle = true
    layout.disableEdgeStyle = false
    layout.x0 = 40
    layout.y0 = 40
    model.beginUpdate()
    try {
      layout.execute(graph.getDefaultParent())
    } finally {
      model.endUpdate()
    }
    fit()
  }

  function exportSvg() {
    graph.stopEditing(false)
    const bounds = graph.getGraphBounds()
    if (bounds.width <= 0 || bounds.height <= 0)
      throw new Error('Add diagram elements before exporting an image.')
    const border = 20
    const scale = graph.view.scale
    const width = Math.ceil(bounds.width / scale + border * 2)
    const height = Math.ceil(bounds.height / scale + border * 2)
    const doc = mx.mxUtils.createXmlDocument()
    const svg = doc.createElementNS(mx.mxConstants.NS_SVG, 'svg')
    svg.setAttribute('width', width)
    svg.setAttribute('height', height)
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    svg.setAttribute('version', '1.1')
    const canvas = new mx.mxSvgCanvas2D(svg)
    canvas.translate((border - bounds.x) / scale, (border - bounds.y) / scale)
    canvas.scale(1 / scale)
    new mx.mxImageExport().drawState(graph.view.getState(model.getRoot()), canvas)
    return { xml: mx.mxUtils.getXml(svg), width, height }
  }

  async function exportPng() {
    const svg = exportSvg()
    if (svg.width * svg.height > 16000000)
      throw new Error('This diagram is too large for a PNG. Save it as a draw.io file instead.')
    const url = URL.createObjectURL(new Blob([svg.xml], { type: 'image/svg+xml' }))
    try {
      const image = new Image()
      await new Promise((resolve, reject) => {
        image.onload = resolve
        image.onerror = () => reject(new Error('The diagram image could not be rendered.'))
        image.src = url
      })
      const canvas = document.createElement('canvas')
      canvas.width = svg.width
      canvas.height = svg.height
      const context = canvas.getContext('2d')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0)
      return await new Promise((resolve, reject) =>
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('PNG export failed.'))),
          'image/png',
        ),
      )
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  // Recreate any labels painted by the constructor before our label hooks
  // were installed, including diagrams restored from the current session.
  graph.refresh()
  graph.view.setTranslate(40, 40)
  updateState()

  return {
    setCompromisedAssets: compromisedHighlights.setAssets,
    insertShape,
    registerStencil,
    undo,
    redo,
    remove,
    fit,
    autoLayout,
    loadXml: (text) => loadModel(readDiagramModel(text, mx)),
    loadFile,
    exportPng,
    updateProperties(id, changes) {
      graph.stopEditing(false)
      const cell = model.getCell(id)
      const { associationId, ...properties } = changes
      if (associationId !== undefined) {
        if (!flowAssociations) throw new Error('Attach a LangGraph to choose an association.')
        flowAssociations.updateAssociation(cell, associationId)
      }
      edits.updateProperties(cell, properties)
    },
    getFlowAssociation: (id) => flowAssociations?.getProperties(model.getCell(id)) || null,
    getCatalogSchema: () => readDiagramSchema(model),
    updateCrraAssessment(schema, draft) {
      graph.stopEditing(false)
      updateCrraAssessment(model, mx, schema, draft)
    },
    updateThreatAssessments(id, schema, draft, assetType) {
      graph.stopEditing(false)
      updateThreatAssessments(graph, model.getCell(id), schema, draft, assetType)
    },
    updateAttackEndpoints(id, schema, kind, steps, assetType) {
      graph.stopEditing(false)
      updateAttackEndpoints(graph, model.getCell(id), schema, kind, steps, assetType)
    },
    zoomIn: () => zoom(1.2),
    zoomOut: () => zoom(1 / 1.2),
    getXml: () => {
      graph.stopEditing(false)
      return serializeModel(model, mx)
    },
    getFile: (title) => {
      graph.stopEditing(false)
      return createDrawioFile(model, title, mx)
    },
    getSnapshot: () => {
      graph.stopEditing(false)
      return getModelSnapshot(graph)
    },
    inspectAsset(id) {
      const cell = model.getCell(id)
      if (!cell || !model.isVertex(cell)) return
      graph.setSelectionCell(cell)
      graph.scrollCellToVisible(cell)
    },
    destroy() {
      if (destroyed) return
      graph.stopEditing(false)
      destroyed = true
      importController?.abort()
      observer.disconnect()
      for (const dispose of stencilDisposers) dispose()
      for (const dispose of disposers) dispose()
      container.removeEventListener('pointerdown', focusOnPointer)
      container.removeEventListener('contextmenu', preventMenu)
      container.removeEventListener('wheel', wheel)
      keys.destroy()
      rubberband.destroy()
      edits.destroy()
      mx.mxClipboard.cells = null
      graph.destroy()
      container.replaceChildren()
    },
  }
}
