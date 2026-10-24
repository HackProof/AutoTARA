import { getAssetShape } from './shapes.js'

// Simulation decoration lives in the overlay pane, outside the model and its
// undo history. Native highlights follow the graph's zoom and translation.
export function createCompromisedAssetHighlights(graph, mx) {
  const model = graph.getModel()
  const highlights = []

  function clear() {
    for (const highlight of highlights) highlight.destroy()
    highlights.length = 0
  }

  function setAssets(ids) {
    clear()
    for (const id of new Set(ids)) {
      const cell = model.getCell(id)
      const state = cell && graph.view.getState(cell)
      if (!state || !getAssetShape(model, cell)) continue
      const highlight = new mx.mxCellHighlight(graph, '#dc3545')
      highlight.opacity = 25
      highlight.keepOnTop = true
      // The native repaint forces an outline. Track the same cell bounds and
      // rotation while painting a translucent fill inside the original shape.
      highlight.repaint = function () {
        if (!this.state || !this.shape) return
        this.shape.scale = this.state.view.scale
        this.shape.bounds = new mx.mxRectangle(
          this.state.x,
          this.state.y,
          this.state.width,
          this.state.height,
        )
        this.shape.rotation = Number(this.state.style[mx.mxConstants.STYLE_ROTATION] || 0)
        this.shape.redraw()
      }
      const createShape = highlight.createShape
      highlight.createShape = function () {
        const shape = createShape.call(this)
        shape.fill = '#dc3545'
        shape.fillOpacity = 100
        shape.stroke = null
        shape.outline = false
        shape.gradient = null
        shape.glass = false
        // Keep selection, dragging and connection ports available beneath the fill.
        shape.pointerEvents = false
        shape.svgPointerEvents = 'none'
        shape.node.setAttribute('data-simulation-compromised', String(cell.id))
        shape.node.setAttribute('aria-hidden', 'true')
        return shape
      }
      highlight.highlight(state)
      highlights.push(highlight)
    }
  }

  // Any model edit invalidates the simulation, including imports and undo/redo.
  model.addListener(mx.mxEvent.CHANGE, clear)
  return {
    setAssets,
    clear,
    destroy() {
      clear()
      model.removeListener(clear)
    },
  }
}
