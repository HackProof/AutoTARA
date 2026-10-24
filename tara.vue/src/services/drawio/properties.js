import { assetShapes } from './palette.js'
import { applyAssetShape, getAssetShape } from './shapes.js'
import { configureAssetLabels } from './assetLabels.js'
import { readThreatAssessments } from './threatAssessments.js'
import { readAttackEndpoints } from './attackEndpoints.js'

function getBoundaryRoundness(graph, cell) {
  const style = graph.getCurrentCellStyle(cell)
  if (String(style.rounded) !== '1') return 0
  const absolute = String(style.absoluteArcSize) === '1'
  const arcSize = Number(style.arcSize ?? (absolute ? 20 : 15))
  const geometry = graph.model.getGeometry(cell)
  const shortestSide = Math.min(geometry?.width || 0, geometry?.height || 0)
  // UI percentage of the maximum radius (half the shorter side). draw.io's
  // relative arcSize is a percentage of the full side; its absolute size is a diameter.
  const percentage = absolute
    ? shortestSide > 0
      ? (arcSize / shortestSide) * 100
      : 0
    : arcSize * 2
  return Number.isFinite(percentage) ? Math.round(Math.min(100, Math.max(0, percentage))) : 30
}

export function isTrustBoundary(graph, cell) {
  const value = cell && graph.model.getValue(cell)
  return !!(
    cell &&
    graph.model.isVertex(cell) &&
    value?.nodeType === 1 &&
    (value.getAttribute('taraKind') === 'boundary' ||
      value.getAttribute('taraShape') === 'boundary')
  )
}

export function getCellProperties(graph, cell) {
  if (!cell) return null
  const value = graph.model.getValue(cell)
  const attribute = (name) => (value?.nodeType === 1 ? value.getAttribute(name) || '' : '')
  const isBoundary = isTrustBoundary(graph, cell)
  const malShape = attribute('taraShape')
  return {
    id: cell.id,
    label: graph.convertValueToString(cell),
    description: attribute('description'),
    assetType: attribute('assetType') || (malShape.startsWith('mal:') ? malShape.slice(4) : ''),
    threatAssessments: readThreatAssessments(value),
    attackEndpoints: readAttackEndpoints(value),
    dfdShape: getAssetShape(graph.model, cell)?.id || '',
    isEdge: graph.model.isEdge(cell),
    isBoundary,
    cornerRoundness: isBoundary ? getBoundaryRoundness(graph, cell) : null,
  }
}

export function updateCellProperties(graph, mx, cell, changes, { resetAssetSize = true } = {}) {
  if (!cell || !graph.model.contains(cell)) return
  const current = getCellProperties(graph, cell)
  let assetShape = null
  if (changes.dfdShape !== undefined) {
    assetShape = assetShapes.find((shape) => shape.id === changes.dfdShape)
    if (!assetShape) throw new Error('Select Process, External Entity, or Data Store.')
    if (!current.dfdShape) throw new Error('Asset Type can only be changed for assets.')
  }
  const label = typeof changes.label === 'string' ? changes.label : current.label
  const description =
    typeof changes.description === 'string' ? changes.description : current.description
  let roundness = current.cornerRoundness
  if (current.isBoundary && changes.cornerRoundness !== undefined) {
    if (!Number.isFinite(changes.cornerRoundness)) {
      throw new Error('Corner roundness must be a number between 0 and 100.')
    }
    roundness = Math.round(Math.min(100, Math.max(0, changes.cornerRoundness)))
  }
  const textChanged = label !== current.label || description !== current.description
  const roundnessChanged = roundness !== current.cornerRoundness
  const shapeChanged = assetShape && cell.value.getAttribute('dfdShape') !== assetShape.id
  if (!textChanged && !roundnessChanged && !assetShape) return

  graph.model.beginUpdate()
  try {
    if (textChanged || shapeChanged) {
      const value =
        cell.value?.nodeType === 1
          ? cell.value.cloneNode(true)
          : mx.mxUtils.createXmlDocument().createElement('object')
      value.setAttribute(
        'label',
        typeof changes.label === 'string'
          ? label
          : cell.value?.nodeType === 1
            ? cell.value.getAttribute('label') || ''
            : String(cell.value ?? ''),
      )
      value.setAttribute('description', description)
      if (assetShape) value.setAttribute('dfdShape', assetShape.id)
      graph.model.setValue(cell, value)
      // A newly entered name is plain text, including literal < and > characters.
      if (typeof changes.label === 'string') graph.setCellStyles('html', '0', [cell])
    }
    if (assetShape) {
      applyAssetShape(
        graph.model,
        mx,
        cell,
        assetShape,
        resetAssetSize && assetShape.id !== current.dfdShape,
      )
    }
    if (roundnessChanged) {
      graph.setCellStyles('rounded', '1', [cell])
      graph.setCellStyles('absoluteArcSize', '0', [cell])
      graph.setCellStyles('arcSize', String(roundness / 2), [cell])
    }
  } finally {
    graph.model.endUpdate()
  }
}

export function configureCellLabels(graph, mx) {
  configureAssetLabels(graph, mx)
  const model = graph.getModel()
  graph.convertValueToString = (cell) => {
    const value = model.getValue(cell)
    const label = value?.nodeType === 1 ? value.getAttribute('label') || '' : String(value ?? '')
    if (/(?:^|;)html=1(?:;|$)/.test(model.getStyle(cell) || '')) {
      const text = mx.DOMPurify.sanitize(label, {
        ALLOWED_TAGS: ['br', 'div', 'p'],
        ALLOWED_ATTR: [],
        RETURN_DOM_FRAGMENT: true,
      })
      for (const br of text.querySelectorAll('br')) br.replaceWith('\n')
      for (const block of text.querySelectorAll('div,p'))
        block.appendChild(mx.document.createTextNode('\n'))
      return text.textContent.trim()
    }
    return label
  }

  const changeLabel = graph.cellLabelChanged
  graph.cellLabelChanged = function (cell, value, autoSize) {
    if (cell.value?.nodeType === 1) {
      const attributes = cell.value.cloneNode(true)
      attributes.setAttribute('label', value)
      value = attributes
    }
    model.beginUpdate()
    try {
      changeLabel.call(this, cell, value, autoSize)
      this.setCellStyles('html', '0', [cell])
    } finally {
      model.endUpdate()
    }
  }
}
