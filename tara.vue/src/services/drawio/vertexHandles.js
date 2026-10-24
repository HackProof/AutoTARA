import { isTrustBoundary } from './properties.js'

function createRoundnessHandle(state, mx) {
  const marker = new mx.mxRhombus(new mx.mxRectangle(0, 0, 12, 12), '#ffd966', '#b45309', 1.5)
  const handle = new mx.mxHandle(state, 'ew-resize', null, marker)
  handle.shape.node.setAttribute('aria-label', 'Corner roundness')
  handle.ignoreGrid = true
  let changed = false

  // Like draw.io's arc handle, sit inside the upper-right corner, away from
  // the resize handles. Coordinates here are independent of zoom and pan.
  handle.getPosition = function (bounds) {
    const radius =
      String(this.state.style.rounded) === '1'
        ? mx.mxShape.prototype.getArcSize.call(
            { style: this.state.style },
            bounds.width,
            bounds.height,
          )
        : 0
    return new mx.mxPoint(bounds.x + bounds.width - radius, bounds.y + bounds.height / 8)
  }
  handle.setPosition = function (bounds, point) {
    const maximum = Math.min(bounds.width, bounds.height) / 2
    if (maximum <= 0) return
    const percentage = Math.round(
      Math.min(100, Math.max(0, ((bounds.x + bounds.width - point.x) / maximum) * 100)),
    )
    // Only mutate the view during the drag. mxHandle.positionChanged paints
    // every pointer move; the model, storage and undo history wait for release.
    this.state.style.rounded = 1
    this.state.style.absoluteArcSize = 0
    this.state.style.arcSize = percentage / 2
    changed = true
  }
  handle.execute = function () {
    if (!changed) return
    for (const key of ['rounded', 'absoluteArcSize', 'arcSize']) this.copyStyle(key)
    changed = false
  }
  const reset = handle.reset
  handle.reset = function () {
    changed = false
    reset.call(this)
  }
  return handle
}

export function configureVertexHandles(graph, mx) {
  class BoundaryVertexHandler extends mx.mxVertexHandler {
    createCustomHandles() {
      return [...(super.createCustomHandles() || []), createRoundnessHandle(this.state, mx)]
    }
  }

  const createVertexHandler = graph.createVertexHandler
  graph.createVertexHandler = function (state) {
    const handler = isTrustBoundary(this, state.cell)
      ? new BoundaryVertexHandler(state)
      : createVertexHandler.call(this, state)
    // The native resize handler redraws the shape, label and incident edges
    // without changing model geometry until mouseUp (one undoable operation).
    handler.livePreview = true
    if (this.getAllConnectionConstraints(state)?.length) {
      // Keep resize handles outside the eight connection ports.
      const getHandlePadding = handler.getHandlePadding
      handler.manageSizers = true
      handler.getHandlePadding = function () {
        const padding = getHandlePadding.call(this)
        return new mx.mxPoint(Math.max(28, padding.x), Math.max(28, padding.y))
      }
      handler.redrawHandles()
    }
    return handler
  }
}
