import { parseMalModel } from '../malModelImport.js'
import { assetShapes } from './palette.js'
import { dataFlowStyle } from './flows.js'
import { createDrawioFile, readDiagramModel } from './xml.js'
import { initializeDiagramSchema, writeDiagramSchema } from './diagramMetadata.js'
import { writeCrraAssessments } from './crraMetadata.js'
import { fillImportedCtsaValues } from './importCtsa.js'
import { catalogErrorMessage } from '../threatCatalog.js'

export function convertMalModelToDrawio(text, languageGraph, mx) {
  const snapshot = parseMalModel(text, languageGraph)
  const model = new mx.mxGraphModel()
  if (typeof snapshot.metadata?.threatCatalogSchema === 'string') {
    writeDiagramSchema(model, mx, snapshot.metadata.threatCatalogSchema)
  }
  const parent = model.getChildAt(model.getRoot(), 0)
  if (snapshot.metadata?.crra) writeCrraAssessments(model, mx, snapshot.metadata.crra)
  const document = mx.mxUtils.createXmlDocument()
  const cells = new Map()
  function value(attributes) {
    const node = document.createElement('object')
    for (const [key, text] of Object.entries(attributes)) node.setAttribute(key, text)
    return node
  }
  model.beginUpdate()
  try {
    for (const vertex of snapshot.vertices) {
      const shape = assetShapes.find((shape) => shape.id === vertex.dfdShape)
      const cell = new mx.mxCell(
        value({
          label: vertex.label,
          description: vertex.description,
          taraKind: 'asset',
          taraShape: `mal:${vertex.assetType}`,
          assetType: vertex.assetType,
          dfdShape: vertex.dfdShape,
          ...(vertex.defenses ? { taraDefenseStates: JSON.stringify(vertex.defenses) } : {}),
          ...(vertex.threatAssessments
            ? { taraTtpAssessments: JSON.stringify(vertex.threatAssessments) }
            : {}),
          ...(vertex.attackEndpoints
            ? { taraAttackEndpoints: JSON.stringify(vertex.attackEndpoints) }
            : {}),
        }),
        new mx.mxGeometry(vertex.position.x, vertex.position.y, shape.width, shape.height),
        shape.style,
      )
      cell.setId(vertex.id)
      cell.setVertex(true)
      model.add(parent, cell)
      cells.set(vertex.id, cell)
    }
    for (const edge of snapshot.edges) {
      const cell = new mx.mxCell(
        value({
          label: edge.label,
          ...(edge.associationId ? { malAssociationId: edge.associationId } : {}),
        }),
        new mx.mxGeometry(),
        `${dataFlowStyle}html=0;`,
      )
      cell.setId(edge.id)
      cell.setEdge(true)
      cell.geometry.relative = true
      model.add(parent, cell)
      model.setTerminal(cell, cells.get(edge.source), true)
      model.setTerminal(cell, cells.get(edge.target), false)
    }
  } finally {
    model.endUpdate()
  }
  return createDrawioFile(model, snapshot.title, mx)
}

// Detect the actual content so XML and YAML also work with renamed extensions.
export function readDiagramFile(text, languageGraph, mx) {
  const content = text.trimStart()
  return readDiagramModel(
    content.startsWith('<') ? content : convertMalModelToDrawio(content, languageGraph, mx),
    mx,
  )
}

export async function prepareDiagramFile(
  text,
  languageGraph,
  mx,
  { fallbackSchema = '', load, signal } = {},
) {
  signal?.throwIfAborted()
  const model = readDiagramFile(text, languageGraph, mx)
  initializeDiagramSchema(model, mx, fallbackSchema)
  let ctsaError = ''
  if (text.trimStart().startsWith('<')) {
    try {
      await fillImportedCtsaValues(model, languageGraph, { load, signal })
    } catch (error) {
      signal?.throwIfAborted()
      ctsaError = `The diagram was imported, but DB CTSA values could not be loaded. ${catalogErrorMessage(error)}`
    }
  }
  signal?.throwIfAborted()
  return { model, ctsaError }
}
