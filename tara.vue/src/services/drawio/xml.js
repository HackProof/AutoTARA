import { createAssetCtsaMetadata } from '../ttpScoring.js'
import { readThreatAssessments } from './threatAssessments.js'

function parseDocument(text, runtime) {
  if (!text.trim() || /<!DOCTYPE|<!ENTITY/i.test(text)) {
    throw new Error('Select a valid draw.io XML file.')
  }
  const doc = runtime.mxUtils.parseXml(text)
  if (!doc.documentElement || doc.getElementsByTagName('parsererror').length) {
    throw new Error('The diagram file contains invalid XML.')
  }
  return doc
}

export function decompressDiagramText(text, runtime) {
  try {
    const bytes = Uint8Array.from(runtime.atob(text.trim()), (char) => char.charCodeAt(0))
    return decodeURIComponent(runtime.pako.inflateRaw(bytes, { to: 'string' }))
  } catch {
    throw new Error('The compressed draw.io diagram could not be read.')
  }
}

export function readDiagramModel(text, runtime) {
  let node = parseDocument(text, runtime).documentElement
  if (node.nodeName === 'mxfile') {
    const pages = Array.from(node.childNodes).filter((child) => child.nodeName === 'diagram')
    if (pages.length !== 1) {
      throw new Error('Open a single-page draw.io file. Multiple pages are not supported yet.')
    }
    node = pages[0]
  }
  if (node.nodeName === 'diagram') {
    const model = Array.from(node.childNodes).find((child) => child.nodeName === 'mxGraphModel')
    if (model) {
      node = model
    } else {
      node = parseDocument(
        decompressDiagramText(node.textContent, runtime),
        runtime,
      ).documentElement
    }
  }
  if (node.nodeName !== 'mxGraphModel' || !node.getElementsByTagName('root').length) {
    throw new Error('This file does not contain a draw.io graph model.')
  }

  // Decode into a separate model so a rejected import cannot erase the current diagram.
  const model = new runtime.mxGraphModel()
  const emptyRoot = model.getRoot()
  new runtime.mxCodec(node.ownerDocument).decode(node, model)
  const root = model.getRoot()
  const layer = model.getChildAt(root, 0)
  if (
    root === emptyRoot ||
    !layer ||
    model.isVertex(root) ||
    model.isEdge(root) ||
    model.isVertex(layer) ||
    model.isEdge(layer)
  ) {
    throw new Error('The diagram is missing a valid root layer.')
  }
  for (const cell of model.filterDescendants((cell) => model.isVertex(cell))) {
    const shape = /(?:^|;)shape=([^;]+)/.exec(model.getStyle(cell) || '')?.[1]
    if (
      shape &&
      !runtime.mxCellRenderer.defaultShapes[shape] &&
      !runtime.mxStencilRegistry.getStencil(shape)
    ) {
      throw new Error(`The shape "${shape}" requires a draw.io library that is not available yet.`)
    }
  }
  return model
}

export function serializeModel(model, runtime) {
  return runtime.mxUtils.getXml(new runtime.mxCodec().encode(model))
}

export function createDrawioFile(model, title, runtime) {
  const doc = runtime.mxUtils.createXmlDocument()
  const file = doc.createElement('mxfile')
  file.setAttribute('host', 'AutoTARA')
  const page = doc.createElement('diagram')
  page.setAttribute('id', 'autotara-diagram')
  page.setAttribute('name', title || 'Diagram')
  const encoded = new runtime.mxCodec(doc).encode(model)
  // Enrich the detached export, including files made before score snapshots
  // were introduced. Exporting must not edit the live model or its history.
  for (const node of Array.from(encoded.getElementsByTagName('*'))) {
    if (node.hasAttribute('taraTtpAssessments')) {
      node.setAttribute(
        'taraTtpAssessments',
        JSON.stringify(createAssetCtsaMetadata(readThreatAssessments(node))),
      )
    }
  }
  page.appendChild(encoded)
  file.appendChild(page)
  doc.appendChild(file)
  return runtime.mxUtils.getXml(doc)
}

export function downloadFile(content, filename, mimeType) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename.replace(/[\\/:*?"<>|]/g, '_')
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
