import { getCellProperties, updateCellProperties } from './properties.js'

export function createEditorHistory(graph, mx) {
  const history = new mx.mxUndoManager(100)
  const assetTypes = new Map()
  const geometryTypes = new WeakMap()
  let ignoreEdits = false
  const record = (_, event) => {
    if (ignoreEdits) return
    const edit = event.getProperty('edit')
    for (const change of edit.changes) {
      if (change instanceof mx.mxGeometryChange) {
        geometryTypes.set(change, assetTypes.get(change.cell))
      }
    }
    history.undoableEditHappened(edit)
  }
  graph.model.addListener(mx.mxEvent.UNDO, record)

  function withoutHistory(action) {
    const previous = ignoreEdits
    ignoreEdits = true
    try {
      action()
    } finally {
      ignoreEdits = previous
    }
  }

  function replay(action) {
    withoutHistory(() => {
      const sizes = new Map(
        Array.from(assetTypes.keys(), (cell) => [cell, graph.model.getGeometry(cell)]),
      )
      const currentTypeGeometry = new Set()
      const capture = (_, event) => {
        for (const change of event.getProperty('edit').changes) {
          if (
            change instanceof mx.mxGeometryChange &&
            geometryTypes.get(change) === assetTypes.get(change.cell)
          )
            currentTypeGeometry.add(change.cell)
        }
      }
      history.addListener(action === 'undo' ? mx.mxEvent.UNDO : mx.mxEvent.REDO, capture)
      try {
        history[action]()
      } finally {
        history.removeListener(capture)
      }
      graph.model.beginUpdate()
      try {
        // Old snapshots must not restore the previous type or its dimensions.
        // Resizing performed after the current type choice remains undoable.
        for (const [cell, { dfdShape }] of assetTypes) {
          if (!graph.model.contains(cell)) continue
          const previous = sizes.get(cell)
          const geometry = graph.model.getGeometry(cell)
          if (
            previous &&
            geometry &&
            !currentTypeGeometry.has(cell) &&
            (previous.width !== geometry.width || previous.height !== geometry.height)
          ) {
            const resized = geometry.clone()
            resized.width = previous.width
            resized.height = previous.height
            graph.model.setGeometry(cell, resized)
          }
          updateCellProperties(graph, mx, cell, { dfdShape }, { resetAssetSize: false })
        }
      } finally {
        graph.model.endUpdate()
      }
    })
  }

  return {
    history,
    undo: () => replay('undo'),
    redo: () => replay('redo'),
    updateProperties(cell, changes) {
      if (!cell || !graph.model.contains(cell)) return
      const { dfdShape, ...otherChanges } = changes
      if (dfdShape !== undefined) {
        const previousType = getCellProperties(graph, cell).dfdShape
        withoutHistory(() => updateCellProperties(graph, mx, cell, { dfdShape }))
        if (previousType !== dfdShape) assetTypes.set(cell, { dfdShape })
      }
      updateCellProperties(graph, mx, cell, otherChanges)
    },
    destroy() {
      graph.model.removeListener(record)
      assetTypes.clear()
      history.clear()
    },
  }
}
