// A separate, read-only mxGraph. Tree navigation never touches the editor's
// model, serialization, selection history, or undo manager.
export function createAttackTreeDiagram({ container, runtime: mx, onSelect, onToggle, onZoom }) {
  const graph = new mx.mxGraph(container)
  graph.setConnectable(false)
  graph.setCellsEditable(false)
  graph.setCellsMovable(false)
  graph.setCellsResizable(false)
  graph.setCellsDeletable(false)
  graph.setCellsDisconnectable(false)
  graph.setCellsBendable(false)
  graph.setPanning(true)
  graph.setTooltips(false)
  graph.setHtmlLabels(true)
  graph.foldingEnabled = false
  graph.isCellSelectable = (cell) => graph.model.isVertex(cell)
  graph.convertValueToString = (cell) => cell.value?.htmlLabel || ''
  graph.panningHandler.useLeftButtonForPanning = true
  graph.panningHandler.ignoreCell = false
  graph.setAutoSizeCells(false)
  const cells = new Map()
  let rootId = null
  const selection = () => onSelect?.(graph.getSelectionCell()?.value?.item || null)
  graph.getSelectionModel().addListener(mx.mxEvent.CHANGE, selection)
  const doubleClick = (_, event) => {
    const item = event.getProperty('cell')?.value?.item
    if (item?.children.length) onToggle?.(item.id)
    event.consume()
  }
  graph.addListener(mx.mxEvent.DOUBLE_CLICK, doubleClick)
  const scaled = () => onZoom?.(Math.round(graph.view.scale * 100))
  graph.view.addListener(mx.mxEvent.SCALE, scaled)
  graph.view.addListener(mx.mxEvent.SCALE_AND_TRANSLATE, scaled)
  function zoom(factor) {
    graph.zoomTo(Math.max(0.05, Math.min(2, graph.view.scale * factor)))
  }
  const wheel = (event) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    zoom(event.deltaY < 0 ? 1.2 : 1 / 1.2)
  }
  const preventMenu = (event) => event.preventDefault()
  container.addEventListener('wheel', wheel, { passive: false })
  container.addEventListener('contextmenu', preventMenu)
  const observer = new ResizeObserver(() => graph.sizeDidChange())
  observer.observe(container)
  function focusRoot() {
    const root = cells.get(rootId)
    if (root) graph.scrollCellToVisible(root, true)
  }
  return {
    render(layout, selectedId = null) {
      graph.model.beginUpdate()
      try {
        // removeCells respects the read-only deletion flag. Replace this view's
        // disposable model root directly so old path cells cannot accumulate.
        graph.clearSelection()
        graph.model.clear()
        cells.clear()
        rootId = layout.nodes[0]?.item.id || null
        for (const placed of layout.nodes) {
          const item = placed.item
          const reference = ['earlier', 'entry', 'reference', 'route-reference'].includes(
            item.terminal,
          )
          const cycle = item.terminal === 'cycle'
          const stroke =
            item.feasibility === 'infeasible'
              ? '#dc3545'
              : item.feasibility === 'unresolved'
                ? '#a56900'
                : cycle
                  ? '#6c757d'
                  : reference
                    ? '#198754'
                    : item.isTarget
                      ? '#6f42c1'
                      : item.role === 'primary'
                        ? '#0d6efd'
                        : '#a56900'
          const fill =
            item.feasibility === 'infeasible'
              ? '#fff0f0'
              : item.feasibility === 'unresolved'
                ? '#fff8e5'
                : cycle
                  ? '#f8f9fa'
                  : reference
                    ? '#eaf7ef'
                    : item.isTarget
                      ? '#f0eafb'
                      : item.role === 'primary'
                        ? '#eaf2ff'
                        : '#fff8e5'
          const style = `rounded=1;arcSize=8;whiteSpace=wrap;html=1;fontSize=13;fontColor=#172b4d;strokeWidth=2;spacing=10;align=center;verticalAlign=middle;fillColor=${fill};strokeColor=${stroke};${['earlier', 'reference', 'route-reference'].includes(item.terminal) || cycle ? 'dashed=1;' : ''}`
          const cell = graph.insertVertex(
            graph.getDefaultParent(),
            item.id,
            { item, label: placed.label, htmlLabel: placed.htmlLabel },
            placed.x,
            placed.y,
            placed.width,
            placed.height,
            style,
          )
          cells.set(item.id, cell)
        }
        for (const edge of layout.edges)
          graph.insertEdge(
            graph.getDefaultParent(),
            null,
            '',
            cells.get(edge.source),
            cells.get(edge.target),
            `edgeStyle=orthogonalEdgeStyle;rounded=1;endArrow=block;endFill=1;strokeWidth=2;strokeColor=${edge.role === 'primary' ? '#0d6efd' : '#a56900'};exitX=0.5;exitY=0;entryX=0.5;entryY=1;`,
          )
      } finally {
        graph.model.endUpdate()
      }
      const selected = cells.get(selectedId) || cells.get(rootId)
      graph.setSelectionCell(selected)
      if (selectedId && selected) graph.scrollCellToVisible(selected, true)
    },
    fit() {
      if (!cells.size || !container.clientWidth || !container.clientHeight) return
      graph.fit(24)
      graph.zoomTo(Math.min(1, graph.view.scale))
      graph.center(true, true)
    },
    home() {
      graph.zoomTo(1)
      focusRoot()
    },
    initialView() {
      graph.fit(24)
      graph.zoomTo(Math.min(1, Math.max(0.55, graph.view.scale)))
      focusRoot()
    },
    zoomIn: () => zoom(1.2),
    zoomOut: () => zoom(1 / 1.2),
    resize: () => graph.sizeDidChange(),
    destroy() {
      observer.disconnect()
      container.removeEventListener('wheel', wheel)
      container.removeEventListener('contextmenu', preventMenu)
      graph.getSelectionModel().removeListener(selection)
      graph.removeListener(doubleClick)
      graph.view.removeListener(scaled)
      graph.destroy()
    },
  }
}
