import { createCtsaMetadata, normalizeCtsaAssessment, serializeCtsaDraft } from '../ttpScoring.js'

export function readThreatAssessments(value) {
  try {
    const data = JSON.parse(
      value?.nodeType === 1 ? value.getAttribute('taraTtpAssessments') || '{}' : '{}',
    )
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch {
    return {}
  }
}

export function mergeThreatAssessments(saved, schema, draft) {
  const assessment = serializeCtsaDraft(draft)
  const previous = normalizeCtsaAssessment(saved[schema])
  return {
    ...saved,
    [schema]: createCtsaMetadata({
      ...assessment,
      steps: { ...previous.steps, ...assessment.steps },
    }),
  }
}

export function updateThreatAssessments(graph, cell, schema, draft, assetType) {
  const model = graph.getModel()
  const shape = cell?.value?.nodeType === 1 ? cell.value.getAttribute('taraShape') || '' : ''
  const currentAssetType =
    cell?.value?.nodeType === 1
      ? cell.value.getAttribute('assetType') || (shape.startsWith('mal:') ? shape.slice(4) : '')
      : ''
  if (
    !cell ||
    !model.contains(cell) ||
    !model.isVertex(cell) ||
    cell.value?.nodeType !== 1 ||
    !assetType ||
    currentAssetType !== assetType ||
    ['boundary', 'annotation'].includes(cell.value.getAttribute('taraKind')) ||
    ['boundary', 'text'].includes(shape)
  ) {
    throw new Error('The asset is no longer available. Close CTSA and select the asset again.')
  }
  if (typeof schema !== 'string' || !schema.trim())
    throw new Error('Choose a DB Schema before assessing threats.')
  const saved = readThreatAssessments(cell.value)
  const next = mergeThreatAssessments(saved, schema, draft)
  if (JSON.stringify(saved) === JSON.stringify(next)) return
  const value = cell.value.cloneNode(true)
  value.setAttribute('taraTtpAssessments', JSON.stringify(next))
  model.beginUpdate()
  try {
    model.setValue(cell, value)
  } finally {
    model.endUpdate()
  }
}
