import { normalizeAttackEndpoints, normalizeEndpointSteps } from '../attackEndpoints.js'
import { readDiagramSchema } from './diagramMetadata.js'

export function readAttackEndpoints(value) {
  try {
    return normalizeAttackEndpoints(
      JSON.parse(value?.nodeType === 1 ? value.getAttribute('taraAttackEndpoints') || '{}' : '{}'),
    )
  } catch {
    return {}
  }
}

export function updateAttackEndpoints(graph, cell, schema, kind, steps, assetType) {
  const model = graph.getModel()
  const current = cell && model.getValue(cell)
  const shape = current?.nodeType === 1 ? current.getAttribute('taraShape') || '' : ''
  const currentType =
    current?.nodeType === 1
      ? current.getAttribute('assetType') || (shape.startsWith('mal:') ? shape.slice(4) : '')
      : ''
  if (
    !cell ||
    !model.contains(cell) ||
    !model.isVertex(cell) ||
    !assetType ||
    currentType !== assetType ||
    ['boundary', 'annotation'].includes(current.getAttribute('taraKind')) ||
    ['boundary', 'text'].includes(shape)
  ) {
    throw new Error(
      'The asset is no longer available. Close the dialog and select the asset again.',
    )
  }
  if (typeof schema !== 'string' || !schema.trim())
    throw new Error('Choose a DB Schema before setting attack endpoints.')
  const diagramSchema = readDiagramSchema(model)
  if (diagramSchema !== null && diagramSchema !== schema)
    throw new Error(
      'The diagram language has changed. Close the dialog and select the asset again.',
    )
  if (!['entry', 'target'].includes(kind)) throw new Error('Choose Entry or Target.')
  const saved = readAttackEndpoints(current)
  const next = normalizeAttackEndpoints({
    ...saved,
    [schema]: { ...saved[schema], [kind]: normalizeEndpointSteps(steps) },
  })
  if (JSON.stringify(saved) === JSON.stringify(next)) return
  const value = current.cloneNode(true)
  if (Object.keys(next).length) value.setAttribute('taraAttackEndpoints', JSON.stringify(next))
  else value.removeAttribute('taraAttackEndpoints')
  model.beginUpdate()
  try {
    model.setValue(cell, value)
  } finally {
    model.endUpdate()
  }
}
