import { assetShapes, dfdShapes } from './palette.js'

// MAL identity (assetType/taraShape) stays separate from its editable DFD shape.
export function getAssetShape(model, cell) {
  if (!cell || !model.isVertex(cell)) return null
  const value = model.getValue(cell)
  if (value?.nodeType !== 1) return null
  const id = value.getAttribute('taraShape') || ''
  const kind = value.getAttribute('taraKind') || ''
  if (kind === 'boundary' || kind === 'annotation' || id === 'boundary' || id === 'text')
    return null
  if (kind !== 'asset' && !id.startsWith('mal:') && !assetShapes.some((shape) => shape.id === id))
    return null
  const saved = assetShapes.find((shape) => shape.id === value.getAttribute('dfdShape'))
  if (saved) return saved
  const preset = assetShapes.find((shape) => shape.id === id)
  if (preset) return preset
  // Older MAL cells stored only the native draw.io style.
  const nativeShape = /(?:^|;)shape=([^;]+)/.exec(model.getStyle(cell) || '')?.[1]
  const inferred = ['cylinder', 'partialRectangle'].includes(nativeShape)
    ? 'store'
    : nativeShape === 'rectangle'
      ? 'actor'
      : 'process'
  return assetShapes.find((shape) => shape.id === inferred)
}

function assetShapeStyle(style, shape, mx) {
  // Remove shape-specific flags so switching away from Process allows free resizing
  // and switching away from Data Store restores all rectangle sides.
  for (const key of ['aspect', 'top', 'bottom', 'left', 'right']) {
    style = mx.mxUtils.setStyle(style, key, null)
  }
  for (const property of shape.style.split(';').filter(Boolean)) {
    const [key, value] = property.split('=')
    style = mx.mxUtils.setStyle(style, key, value)
  }
  return style
}

export function applyAssetShape(model, mx, cell, shape, resetSize = false) {
  const style = assetShapeStyle(model.getStyle(cell) || '', shape, mx)
  if (model.getStyle(cell) !== style) model.setStyle(cell, style)
  const geometry = model.getGeometry(cell)
  if (geometry) {
    const width = resetSize ? shape.width : geometry.width
    const height = resetSize ? shape.height : shape.id === 'process' ? width : geometry.height
    if (geometry.width !== width || geometry.height !== height) {
      const resized = geometry.clone()
      resized.width = width
      resized.height = height
      model.setGeometry(cell, resized)
    }
  }
}

// The partialRectangle style is also understood by the full draw.io editor.
// Adapted from js/grapheditor/Shapes.js without loading its other shape libraries.
export function registerDrawioShapes(mx) {
  if (mx.mxCellRenderer.defaultShapes.partialRectangle) return

  function PartialRectangleShape() {
    mx.mxRectangleShape.call(this)
  }
  mx.mxUtils.extend(PartialRectangleShape, mx.mxRectangleShape)
  // The open sides must still allow clicking and dragging inside the Data Store.
  PartialRectangleShape.prototype.shapePointerEvents = true
  PartialRectangleShape.prototype.paintBackground = function (canvas, x, y, width, height) {
    canvas.rect(x, y, width, height)
    canvas.fill()
    canvas.begin()
    canvas.moveTo(x, y)
    for (const [side, endX, endY] of [
      ['top', x + width, y],
      ['right', x + width, y + height],
      ['bottom', x, y + height],
      ['left', x, y],
    ]) {
      if (this.outline || String(mx.mxUtils.getValue(this.style, side, '1')) === '1') {
        canvas.lineTo(endX, endY)
      } else {
        canvas.moveTo(endX, endY)
      }
    }
    canvas.stroke()
  }
  mx.mxCellRenderer.registerShape('partialRectangle', PartialRectangleShape)
}
// Update AutoTARA's earlier DFD styles when restoring a session or opening a file.
// Other draw.io cells keep their own appearance and geometry.
export function normalizeDfdCells(model, mx) {
  for (const cell of model.filterDescendants((entry) => model.isVertex(entry))) {
    const value = model.getValue(cell)
    if (value?.nodeType !== 1) continue
    const assetShape = getAssetShape(model, cell)
    if (assetShape) {
      applyAssetShape(model, mx, cell, assetShape)
      continue
    }
    const id = value.getAttribute('taraShape') || ''
    let style = model.getStyle(cell) || ''
    const shape = dfdShapes.find((entry) => entry.id === id)
    if (!shape) continue
    for (const property of shape.style.split(';').filter(Boolean)) {
      const [key, val] = property.split('=')
      style = mx.mxUtils.setStyle(style, key, val)
    }
    if (model.getStyle(cell) !== style) model.setStyle(cell, style)
  }
}
