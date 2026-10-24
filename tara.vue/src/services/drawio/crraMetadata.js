import { createCrraDraft } from '../crra.js'
import { readDiagramSchema } from './diagramMetadata.js'

export function normalizeCrraAssessments(saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}
  return Object.fromEntries(
    Object.entries(saved).map(([schema, value]) => [schema, createCrraDraft(value)]),
  )
}

export function readCrraAssessments(model) {
  const value = model.getValue(model.getRoot())
  try {
    return normalizeCrraAssessments(
      JSON.parse(value?.nodeType === 1 ? value.getAttribute('taraCrraAssessments') || '{}' : '{}'),
    )
  } catch {
    return {}
  }
}

export function writeCrraAssessments(model, mx, assessments) {
  const root = model.getRoot()
  const current = model.getValue(root)
  const value =
    current?.nodeType === 1
      ? current.cloneNode(true)
      : mx.mxUtils.createXmlDocument().createElement('object')
  value.setAttribute('taraCrraAssessments', JSON.stringify(normalizeCrraAssessments(assessments)))
  model.setValue(root, value)
}

export function updateCrraAssessment(model, mx, schema, draft) {
  if (!schema || schema !== readDiagramSchema(model))
    throw new Error('The diagram language has changed. Reopen CRRA before saving.')
  const saved = readCrraAssessments(model)
  const next = createCrraDraft(draft)
  if (JSON.stringify(saved[schema]) !== JSON.stringify(next)) {
    writeCrraAssessments(model, mx, { ...saved, [schema]: next })
  }
}
