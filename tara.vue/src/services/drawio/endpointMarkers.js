import { readAttackEndpoints } from './attackEndpoints.js'
import { readDiagramSchema } from './diagramMetadata.js'
import { getAssetShape } from './shapes.js'

const MARKERS = [
  { role: 'entry', label: 'Entry', color: '#0d6efd', width: 44 },
  { role: 'target', label: 'Target', color: '#dc3545', width: 50 },
]
const HEIGHT = 20
const GAP = 4
const OFFSET = 6

// Paint from endpoint metadata without changing asset names, styles or history.
// Native SVG shapes also carry the badges into Screenshot/PNG exports.
export function configureAttackEndpointMarkers(graph, mx) {
  const model = graph.getModel()
  const renderer = graph.cellRenderer
  const paintedRoles = new WeakMap()
  function markers(cell) {
    if (!getAssetShape(model, cell)) return []
    const endpoints = readAttackEndpoints(model.getValue(cell))[readDiagramSchema(model)]
    return MARKERS.filter((marker) => endpoints?.[marker.role]?.length)
  }
  const key = (markers) => markers.map((marker) => marker.role).join(',')
  const totalWidth = (markers) =>
    markers.reduce((width, marker) => width + marker.width, 0) + (markers.length - 1) * GAP

  const createShape = renderer.createShape
  renderer.createShape = function (state) {
    const shape = createShape.call(this, state)
    if (!shape || !getAssetShape(model, state.cell)) return shape
    const paint = shape.paintVertexShape
    shape.paintVertexShape = function (canvas, x, y, width, height) {
      paint.call(this, canvas, x, y, width, height)
      const active = markers(state.cell)
      paintedRoles.set(this, key(active))
      if (!active.length || this.outline) return
      let left = x + (width - totalWidth(active)) / 2
      const top = y - HEIGHT - OFFSET
      const pointerEvents = canvas.pointerEvents
      canvas.save()
      try {
        canvas.pointerEvents = false
        canvas.setAlpha(1)
        canvas.setFillAlpha(1)
        canvas.setStrokeAlpha(1)
        canvas.setShadow(false)
        canvas.setDashed(false)
        canvas.setStrokeColor(null)
        canvas.setFontColor('#ffffff')
        canvas.setFontFamily('Arial')
        canvas.setFontSize(11)
        canvas.setFontStyle(mx.mxConstants.FONT_BOLD)
        canvas.setFontBackgroundColor(null)
        canvas.setFontBorderColor(null)
        for (const marker of active) {
          canvas.setFillColor(marker.color)
          canvas.roundrect(left, top, marker.width, HEIGHT, 6, 6)
          canvas.fill()
          canvas.text(
            left + marker.width / 2,
            top + HEIGHT / 2,
            0,
            0,
            marker.label,
            mx.mxConstants.ALIGN_CENTER,
            mx.mxConstants.ALIGN_MIDDLE,
          )
          left += marker.width + GAP
        }
      } finally {
        canvas.restore()
        canvas.pointerEvents = pointerEvents
      }
    }
    // Include badges above the asset in Fit, graph bounds and exported crops.
    const augmentBoundingBox = shape.augmentBoundingBox
    shape.augmentBoundingBox = function (bounds) {
      augmentBoundingBox.call(this, bounds)
      const active = markers(state.cell)
      if (!active.length) return
      const assetBounds = this.createBoundingBox()
      const width = totalWidth(active) * this.scale
      bounds.add(
        new mx.mxRectangle(
          assetBounds.getCenterX() - width / 2,
          assetBounds.y - (HEIGHT + OFFSET) * this.scale,
          width,
          HEIGHT * this.scale,
        ),
      )
    }
    return shape
  }
  // Endpoint edits change only XML attributes, so the normal geometry/style
  // invalidation would otherwise leave an existing shape's badges unchanged.
  const isShapeInvalid = renderer.isShapeInvalid
  renderer.isShapeInvalid = function (state, shape) {
    return (
      isShapeInvalid.call(this, state, shape) ||
      Boolean(
        getAssetShape(model, state.cell) && paintedRoles.get(shape) !== key(markers(state.cell)),
      )
    )
  }
}
