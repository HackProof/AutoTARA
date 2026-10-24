import { createAssociationMatcher } from '../associations.js'
import { getAssetShape } from './shapes.js'

export function configureAssociations(graph, mx, languageGraph, onFeedback) {
  if (!languageGraph) return () => {}
  const model = graph.getModel()
  const connection = graph.connectionHandler
  const matcher = createAssociationMatcher(languageGraph)
  const highlights = new Map()
  const handlerDisposers = new Set()
  const listeners = []
  let active = null

  function assetType(cell) {
    if (!getAssetShape(model, cell)) return ''
    const value = model.getValue(cell)
    const shape = value.getAttribute('taraShape') || ''
    return value.getAttribute('assetType') || (shape.startsWith('mal:') ? shape.slice(4) : '')
  }
  const isValidConnection = graph.isValidConnection
  graph.isValidConnection = function (source, target) {
    return (
      isValidConnection.call(this, source, target) &&
      matcher.canConnect(assetType(source), assetType(target))
    )
  }

  // Validate at commit as well as during hover, including existing edge endpoints.
  const connect = connection.connect
  connection.connect = function (source, target, ...args) {
    if (graph.getEdgeValidationError(null, source, target) != null) return
    return connect.call(this, source, target, ...args)
  }
  const connectCell = graph.connectCell
  graph.connectCell = function (edge, terminal, source, ...args) {
    const from = source ? terminal : model.getTerminal(edge, true)
    const to = source ? model.getTerminal(edge, false) : terminal
    if (!this.isValidConnection(from, to) || this.getEdgeValidationError(edge, from, to) != null)
      return edge
    return connectCell.call(this, edge, terminal, source, ...args)
  }

  function clear(owner) {
    if (owner && active?.owner !== owner) return
    active = null
    for (const highlight of highlights.values()) highlight.destroy()
    highlights.clear()
    onFeedback?.(null)
  }

  function refresh() {
    if (!active) return
    const { anchor, edge, movingSource } = active
    if (!model.contains(anchor)) {
      clear()
      return
    }
    const candidates = new Map()
    for (const cell of model.filterDescendants((entry) => model.isVertex(entry))) {
      const source = movingSource ? cell : anchor
      const target = movingSource ? anchor : cell
      const state = graph.view.getState(cell)
      if (
        state &&
        graph.isValidConnection(source, target) &&
        graph.getEdgeValidationError(edge, source, target) == null
      ) {
        candidates.set(cell, state)
      }
    }
    for (const [cell, highlight] of highlights) {
      if (!candidates.has(cell)) {
        highlight.destroy()
        highlights.delete(cell)
      }
    }
    for (const [cell, state] of candidates) {
      if (!highlights.has(cell)) {
        const highlight = new mx.mxCellHighlight(graph, '#198754', 3, true)
        highlight.spacing = 5
        highlight.opacity = 100
        highlight.keepOnTop = true
        const createShape = highlight.createShape
        highlight.createShape = function () {
          const shape = createShape.call(this)
          // The overlay must not intercept body drags or the eight connection ports.
          shape.pointerEvents = false
          shape.svgPointerEvents = 'none'
          return shape
        }
        highlights.set(cell, highlight)
      }
      highlights.get(cell).highlight(state)
    }
    onFeedback?.({
      sourceLabel: graph.convertValueToString(anchor),
      sourceAssetType: assetType(anchor),
      hasAssetType: matcher.hasAsset(assetType(anchor)),
      targetCount: candidates.size,
    })
  }

  function begin(anchor, owner, edge = null, movingSource = false) {
    clear()
    if (!anchor) return
    active = { anchor, owner, edge, movingSource }
    refresh()
  }
  function listen(target, event, handler) {
    target.addListener(event, handler)
    listeners.push(() => target.removeListener(handler))
  }
  listen(connection, mx.mxEvent.START, (_, event) =>
    begin(event.getProperty('state')?.cell, connection),
  )
  listen(connection, mx.mxEvent.RESET, () => clear(connection))
  listen(connection, mx.mxEvent.CONNECT, () => clear(connection))
  listen(graph, mx.mxEvent.ESCAPE, () => clear())
  listen(model, mx.mxEvent.CHANGE, refresh)
  for (const event of [mx.mxEvent.SCALE, mx.mxEvent.TRANSLATE, mx.mxEvent.SCALE_AND_TRANSLATE])
    listen(graph.view, event, refresh)

  const createEdgeHandler = graph.createEdgeHandler
  graph.createEdgeHandler = function (...args) {
    const handler = createEdgeHandler.apply(this, args)
    const { start, reset, destroy } = handler
    const restore = () => {
      handler.start = start
      handler.reset = reset
      handler.destroy = destroy
      handlerDisposers.delete(restore)
    }
    handler.start = function (...startArgs) {
      const result = start.apply(this, startArgs)
      if (this.index != null && (this.isSource || this.isTarget)) {
        begin(
          model.getTerminal(this.state.cell, !this.isSource),
          this,
          this.state.cell,
          this.isSource,
        )
      }
      return result
    }
    handler.reset = function (...resetArgs) {
      clear(this)
      return reset.apply(this, resetArgs)
    }
    handler.destroy = function (...destroyArgs) {
      clear(this)
      restore()
      return destroy.apply(this, destroyArgs)
    }
    handlerDisposers.add(restore)
    return handler
  }

  return () => {
    clear()
    for (const dispose of listeners) dispose()
    for (const dispose of handlerDisposers) dispose()
    graph.isValidConnection = isValidConnection
    graph.connectCell = connectCell
    graph.createEdgeHandler = createEdgeHandler
    connection.connect = connect
  }
}
