import { fetchAttackSteps, groupAssetThreats } from '../threatCatalog.js'
import { getAssetParents } from '../languageGraph.js'
import { mergeLanguageAttackSteps } from '../languageAttackSteps.js'
import { createCtsaDraft, fillBlankCtsaValues, validTtpWeights } from '../ttpScoring.js'
import { readDiagramSchema } from './diagramMetadata.js'
import { mergeThreatAssessments, readThreatAssessments } from './threatAssessments.js'

// Enrich the detached import before replacing the live graph. Matching stays on
// each asset type and original Step ID, even when Steps share a MITRE Technique.
export async function fillImportedCtsaValues(
  model,
  languageGraph,
  { load = fetchAttackSteps, signal } = {},
) {
  signal?.throwIfAborted()
  const schema = readDiagramSchema(model)
  if (!schema) return
  const assets = []
  for (const cell of model.filterDescendants((cell) => model.isVertex(cell))) {
    const value = model.getValue(cell)
    if (value?.nodeType !== 1) continue
    const shape = value.getAttribute('taraShape') || ''
    const kind = value.getAttribute('taraKind')
    const assetType =
      value.getAttribute('assetType') || (shape.startsWith('mal:') ? shape.slice(4) : '')
    if (
      assetType &&
      !['boundary', 'annotation'].includes(kind) &&
      !['boundary', 'text'].includes(shape)
    ) {
      assets.push({ cell, assetType })
    }
  }
  const types = [...new Set(assets.map(({ assetType }) => assetType))]
  if (!types.length) return
  const rows = []
  const assetParents = getAssetParents(languageGraph)
  for (let start = 0; start < types.length; start += 1000) {
    rows.push(...(await load(schema, types.slice(start, start + 1000), { signal, assetParents })))
    signal?.throwIfAborted()
  }
  const threatsByAsset = groupAssetThreats(mergeLanguageAttackSteps(rows, languageGraph, types))
  const updates = []
  for (const { cell, assetType } of assets) {
    const previous = readThreatAssessments(model.getValue(cell))
    const draft = createCtsaDraft(threatsByAsset.get(assetType) || [], previous[schema])
    if (!validTtpWeights(draft.weights)) continue
    if (!fillBlankCtsaValues(draft).valueCount) continue
    const value = model.getValue(cell).cloneNode(true)
    value.setAttribute(
      'taraTtpAssessments',
      JSON.stringify(mergeThreatAssessments(previous, schema, draft)),
    )
    updates.push({ cell, value })
  }
  signal?.throwIfAborted()
  model.beginUpdate()
  try {
    for (const { cell, value } of updates) model.setValue(cell, value)
  } finally {
    model.endUpdate()
  }
}
