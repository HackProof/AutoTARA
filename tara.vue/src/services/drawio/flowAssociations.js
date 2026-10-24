import { createAssociationMatcher } from '../associations.js'
import { getCellProperties } from './properties.js'

export function configureFlowAssociations(graph, mx, languageGraph, onChoose) {
  if (!languageGraph) return null
  const model = graph.getModel()
  const matcher = createAssociationMatcher(languageGraph)
  const listeners = []
  let disposed = false
  let request = 0

  function savedId(edge) {
    const value = model.getValue(edge)
    return value?.nodeType === 1 ? value.getAttribute('malAssociationId') || '' : ''
  }
  function getProperties(edge) {
    if (!edge || !model.contains(edge) || !model.isEdge(edge)) return null
    const source = getCellProperties(graph, model.getTerminal(edge, true))
    const target = getCellProperties(graph, model.getTerminal(edge, false))
    const options = matcher.getAssociations(
      source?.dfdShape ? source.assetType : '',
      target?.dfdShape ? target.assetType : '',
    )
    const id = savedId(edge)
    return {
      id: options.some((option) => option.id === id) ? id : '',
      options,
      sourceLabel: source?.label || 'Missing source',
      targetLabel: target?.label || 'Missing target',
    }
  }

  function writeAssociation(edge, association) {
    const label = association?.name || ''
    const id = association?.id || ''
    if (savedId(edge) === id && graph.convertValueToString(edge) === label) return
    const current = model.getValue(edge)
    const value =
      current?.nodeType === 1
        ? current.cloneNode(true)
        : mx.mxUtils.createXmlDocument().createElement('object')
    value.setAttribute('label', label)
    value.setAttribute('malAssociationId', id)
    model.beginUpdate()
    try {
      model.setValue(edge, value)
      graph.setCellStyles('html', '0', [edge])
    } finally {
      model.endUpdate()
    }
  }

  function updateAssociation(edge, id) {
    const association = getProperties(edge)?.options.find((option) => option.id === id)
    if (!association) throw new Error('Choose a valid association for the connected MAL assets.')
    writeAssociation(edge, association)
  }

  function choose(edge, onlyIfUnassigned = false) {
    const currentRequest = ++request
    // Let the native handler commit, select the edge and release the pointer
    // before a dialog takes focus. Ignore stale requests after undo or disposal.
    queueMicrotask(() => {
      if (disposed || currentRequest !== request) return
      const properties = getProperties(edge)
      if (!properties?.options.length || (onlyIfUnassigned && properties.id)) return
      onChoose?.(edge.id)
    })
  }

  function synchronize(edge) {
    const properties = getProperties(edge)
    if (!properties) return
    const association =
      properties.options.find((option) => option.id === properties.id) ||
      (properties.options.length === 1 ? properties.options[0] : null)
    if (association) writeAssociation(edge, association)
    else {
      if (savedId(edge)) writeAssociation(edge, null)
      if (properties.options.length > 1) choose(edge, true)
    }
  }
  function listen(target, event, handler) {
    target.addListener(event, handler)
    listeners.push(() => target.removeListener(handler))
  }
  // Both events fire within the native transaction, so an automatic name and
  // an endpoint change are undone/redone together.
  listen(graph.connectionHandler, mx.mxEvent.CONNECT, (_, event) =>
    synchronize(event.getProperty('cell')),
  )
  listen(graph, mx.mxEvent.CONNECT_CELL, (_, event) => synchronize(event.getProperty('edge')))

  const startEditing = graph.startEditingAtCell
  graph.startEditingAtCell = function (cell, event) {
    const target = cell || this.getSelectionCell()
    if (target && model.isEdge(target)) {
      this.stopEditing(false)
      choose(target)
      return
    }
    return startEditing.call(this, cell, event)
  }

  return {
    getProperties,
    updateAssociation,
    destroy() {
      disposed = true
      request += 1
      for (const dispose of listeners) dispose()
      graph.startEditingAtCell = startEditing
    },
  }
}
