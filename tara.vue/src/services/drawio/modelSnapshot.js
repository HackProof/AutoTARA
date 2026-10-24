import { readDefenseStates } from '../defenseStates.js'
import { getAssetShape } from './shapes.js'
import { readThreatAssessments } from './threatAssessments.js'
import { createAssetCtsaMetadata } from '../ttpScoring.js'
import { readDiagramSchema } from './diagramMetadata.js'
import { readAttackEndpoints } from './attackEndpoints.js'
import { readCrraAssessments } from './crraMetadata.js'

// Read a plain snapshot without changing cells, selection, view, or undo history.
export function getModelSnapshot(graph) {
  const model = graph.getModel()
  const positions = new Map()
  function position(cell) {
    if (!cell) return { x: 0, y: 0 }
    if (positions.has(cell)) return positions.get(cell)
    const parent = model.getParent(cell)
    const origin = position(parent)
    const geometry = model.getGeometry(cell)
    const parentGeometry = parent && model.getGeometry(parent)
    const point = {
      x: origin.x + (geometry?.x || 0) * (geometry?.relative ? parentGeometry?.width || 0 : 1),
      y: origin.y + (geometry?.y || 0) * (geometry?.relative ? parentGeometry?.height || 0 : 1),
    }
    if (geometry?.relative && geometry.offset) {
      point.x += geometry.offset.x
      point.y += geometry.offset.y
    }
    positions.set(cell, point)
    return point
  }
  const vertices = []
  const edges = []
  for (const cell of model.filterDescendants(
    (cell) => model.isVertex(cell) || model.isEdge(cell),
  )) {
    const value = model.getValue(cell)
    const attribute = (name) => (value?.nodeType === 1 ? value.getAttribute(name) || '' : '')
    const entry = { id: String(cell.id), label: graph.convertValueToString(cell) }
    if (model.isEdge(cell)) {
      edges.push({
        ...entry,
        source: model.getTerminal(cell, true)?.id?.toString() || '',
        target: model.getTerminal(cell, false)?.id?.toString() || '',
        ...(attribute('malAssociationId') ? { associationId: attribute('malAssociationId') } : {}),
      })
    } else {
      const shape = attribute('taraShape')
      const assessments = createAssetCtsaMetadata(readThreatAssessments(value))
      const endpoints = readAttackEndpoints(value)
      const defenses = readDefenseStates(value)
      vertices.push({
        ...entry,
        kind:
          attribute('taraKind') ||
          (shape === 'boundary' ? 'boundary' : shape === 'text' ? 'annotation' : 'asset'),
        assetType: attribute('assetType') || (shape.startsWith('mal:') ? shape.slice(4) : ''),
        dfdShape: getAssetShape(model, cell)?.id || '',
        description: attribute('description'),
        ...(Object.keys(defenses).length ? { defenses } : {}),
        ...(Object.keys(assessments).length ? { threatAssessments: assessments } : {}),
        ...(Object.keys(endpoints).length ? { attackEndpoints: endpoints } : {}),
        position: { ...position(cell) },
      })
    }
  }
  const schema = readDiagramSchema(model)
  const crra = readCrraAssessments(model)
  return {
    vertices,
    edges,
    ...(schema !== null || Object.keys(crra).length
      ? {
          metadata: {
            ...(schema !== null ? { threatCatalogSchema: schema } : {}),
            ...(Object.keys(crra).length ? { crra } : {}),
          },
        }
      : {}),
  }
}
