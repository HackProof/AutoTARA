import { getAssetShape } from './shapes.js'

const segmenter =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

function wrapLabel(value, width, measure) {
  if (width <= 0) return value
  const lines = []
  for (const paragraph of value.split(/\r\n|\r|\n/)) {
    let line = ''
    for (const word of paragraph.match(/\S+/gu) || []) {
      const candidate = line ? `${line} ${word}` : word
      if (measure(candidate) <= width) {
        line = candidate
        continue
      }
      if (line) lines.push(line)
      line = ''
      // Asset types often have long names without spaces. Break at grapheme
      // boundaries so Korean, emoji and combining characters remain intact.
      const characters = segmenter
        ? Array.from(segmenter.segment(word), ({ segment }) => segment)
        : Array.from(word)
      for (const character of characters) {
        if (line && measure(line + character) > width) {
          lines.push(line)
          line = ''
        }
        line += character
      }
    }
    lines.push(line)
  }
  return lines.join('\n')
}

export function configureAssetLabels(graph, mx) {
  const renderer = graph.cellRenderer
  const shapeBounds = renderer.getShapeLabelBounds
  renderer.getShapeLabelBounds = function (state, bounds) {
    const result = shapeBounds.call(this, state, bounds)
    const shape = getAssetShape(graph.model, state.cell)
    if (!shape) return result
    // An inscribed rectangle keeps every line inside a Process circle.
    const ratio = shape.id === 'process' ? Math.SQRT1_2 : 1
    const padding = 4 * state.view.scale
    const width = Math.max(0, result.width * ratio - padding * 2)
    const height = Math.max(0, result.height * ratio - padding * 2)
    return new mx.mxRectangle(
      result.x + (result.width - width) / 2,
      result.y + (result.height - height) / 2,
      width,
      height,
    )
  }

  const createText = renderer.createTextShape
  renderer.createTextShape = function (state, value, dialect) {
    const text = createText.call(this, state, value, dialect)
    if (!getAssetShape(graph.model, state.cell)) return text
    const paint = text.paint
    let cached
    text.paint = function (canvas, update) {
      const original = this.value
      if (typeof original !== 'string' || this.dialect === mx.mxConstants.DIALECT_STRICTHTML) {
        return paint.call(this, canvas, update)
      }
      const width = this.bounds.width / this.scale
      const bold = this.fontStyle & mx.mxConstants.FONT_BOLD ? 'bold ' : ''
      const italic = this.fontStyle & mx.mxConstants.FONT_ITALIC ? 'italic ' : ''
      const font = `${italic}${bold}${this.size}px ${this.family}`
      if (!cached || cached.value !== original || cached.width !== width || cached.font !== font) {
        const context = mx.mxUtils.canvasContext
        if (context) context.font = font
        const measure = context
          ? (value) => context.measureText(value).width
          : (value) =>
              mx.mxUtils.getSizeForString(
                mx.mxUtils.htmlEntities(value),
                this.size,
                this.family,
                null,
                this.fontStyle,
              ).width
        cached = { value: original, width, font, wrapped: wrapLabel(original, width, measure) }
      }
      // Only the painted SVG contains these line breaks. Editing, history,
      // draw.io XML and MAL exports continue to use the original asset name.
      this.value = cached.wrapped
      try {
        return paint.call(this, canvas, update)
      } finally {
        this.value = original
      }
    }
    return text
  }

  const editor = graph.cellEditor
  const resize = editor.resize
  editor.resize = function () {
    resize.call(this)
    if (!this.textarea) return
    const style = this.textarea.style
    style.overflowWrap = ''
    if (this.bounds && getAssetShape(graph.model, this.editingCell)) {
      style.whiteSpace = 'pre-wrap'
      style.wordWrap = 'break-word'
      style.overflowWrap = 'anywhere'
      style.width = `${this.bounds.width / graph.view.scale}px`
    }
  }
}
