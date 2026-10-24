import { readThreatAssessments } from './threatAssessments.js'

export function readDiagramSchema(model) {
  const value = model.getValue(model.getRoot())
  return value?.nodeType === 1 && value.hasAttribute('taraCatalogSchema')
    ? value.getAttribute('taraCatalogSchema').trim()
    : null
}

export function writeDiagramSchema(model, mx, schema) {
  if (typeof schema !== 'string') throw new Error('Diagram language schema must be a string.')
  const root = model.getRoot()
  const current = model.getValue(root)
  const value =
    current?.nodeType === 1
      ? current.cloneNode(true)
      : mx.mxUtils.createXmlDocument().createElement('object')
  value.setAttribute('taraCatalogSchema', schema.trim())
  model.setValue(root, value)
}

// Bind the schema before exposing a loaded model to the editor. Explicit file
// metadata (including "no catalog") takes precedence over creation defaults.
export function initializeDiagramSchema(model, mx, fallback = '') {
  const stored = readDiagramSchema(model)
  if (stored !== null) return stored
  const schemas = new Set()
  for (const cell of model.filterDescendants((cell) => model.isVertex(cell))) {
    for (const schema of Object.keys(readThreatAssessments(model.getValue(cell))))
      schemas.add(schema)
  }
  const schema = schemas.size === 1 ? [...schemas][0] : fallback
  writeDiagramSchema(model, mx, schema)
  return schema.trim()
}
