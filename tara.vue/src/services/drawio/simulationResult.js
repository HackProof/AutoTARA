import {
  arrangeSimulationAssets,
  getSimulationCtsaScore,
  simulationCtsaScoreTitle,
  simulationStepHeight,
} from '../simulationResult.js'
import { routeSimulationConnection } from '../simulationRouting.js'
import { riskScoreClass, riskScoreLabel } from '../ttpScoring.js'

const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  )

// Layout edits belong only to this result view, never to the original diagram.
export function createSimulationResultDiagram({
  container,
  runtime: mx,
  onSelect,
  onSelectAsset,
  onToggleAsset,
  onZoom,
}) {
  const graph = new mx.mxGraph(container)
  graph.setConnectable(false)
  graph.setCellsEditable(false)
  graph.setCellsMovable(true)
  graph.setCellsResizable(true)
  graph.setCellsDeletable(false)
  graph.setCellsDisconnectable(false)
  graph.setCellsBendable(true)
  graph.setCellsCloneable(false)
  graph.setDropEnabled(false)
  graph.setAllowDanglingEdges(false)
  graph.setConstrainChildren(true)
  graph.setPanning(true)
  graph.setCellsSelectable(true)
  graph.setTooltips(false)
  graph.setHtmlLabels(true)
  graph.foldingEnabled = false
  graph.resetViewOnRootChange = false
  graph.panningHandler.useLeftButtonForPanning = true
  // These extensions are expected by the shipped draw.io drag handlers. Result
  // cells have no ports or composite parts, so each cell is its own drag target.
  graph.getCompositeParent = (cell) => cell
  graph.getReferenceTerminal = (cell) => cell
  graph.graphHandler.removeCellsFromParent = false
  graph.graphHandler.isPropagateSelectionCell = () => false
  const delayedSelection = graph.graphHandler.isDelayedSelection
  graph.graphHandler.isDelayedSelection = function (cell, event) {
    return graph.isCellSelected(cell) && delayedSelection.call(this, cell, event)
  }
  graph.graphHandler.allowLivePreview = true
  graph.graphHandler.maxLivePreview = Number.POSITIVE_INFINITY
  const consumeMouseEvent = graph.graphHandler.consumeMouseEvent
  graph.graphHandler.consumeMouseEvent = function (eventName, event) {
    // Native dragging consumes mouseUp even for a stationary click. Let a
    // simple click reach the asset disclosure; actual drags stay consumed.
    if (eventName !== mx.mxEvent.MOUSE_UP || this.currentDx != null || this.currentDy != null)
      consumeMouseEvent.call(this, eventName, event)
  }
  const containmentArea = graph.getCellContainmentArea
  graph.getCellContainmentArea = function (cell) {
    const area = containmentArea.call(this, cell)
    if (area && cell.value?.node) {
      area.y += 72
      area.height = Math.max(0, area.height - 72)
    }
    return area
  }
  graph.isCellSelectable = (cell) =>
    Boolean(cell?.value?.node || cell?.value?.asset || cell?.value?.connectionKey)
  // The draw.io core gates edge-handle mouse events on isCellEditable. Allow
  // those events while keeping every result label fixed.
  graph.isCellEditable = (cell) => Boolean(cell?.value?.connectionKey)
  graph.startEditingAtCell = () => {}
  graph.convertValueToString = (cell) =>
    cell.value?.htmlLabel || escapeHtml(cell.value?.label).replace(/\n/g, '<br>')
  const cells = new Map()
  const assetCells = new Map()
  const owners = new Map()
  const assetPositions = new Map()
  const assetSizes = new Map()
  const stepGeometries = new Map()
  const defaultStepGeometries = new Map()
  const edgeGeometries = new Map()
  const routes = new Map()
  const stepGeometry = (node) => stepGeometries.get(node.id) || defaultStepGeometries.get(node.id)
  let rendering = false
  const bounds = (cell) => {
    const state = graph.view.getState(cell)
    if (state) return { x: state.x, y: state.y, width: state.width, height: state.height }
    const geometry = graph.getCellGeometry(cell)
    let x = geometry.x,
      y = geometry.y
    for (let parent = cell.parent; parent; parent = parent.parent) {
      const parentGeometry = graph.getCellGeometry(parent)
      if (parentGeometry) {
        x += parentGeometry.x
        y += parentGeometry.y
      }
    }
    const { scale, translate } = graph.view
    return {
      x: (x + translate.x) * scale,
      y: (y + translate.y) * scale,
      width: geometry.width * scale,
      height: geometry.height * scale,
    }
  }
  const routeEdge = (state, source, target, points, result) => {
    if (!source || !target) return
    if (points?.length) {
      mx.mxEdgeStyle.SegmentConnector(state, source, target, points, result)
      return
    }
    const from = state.cell.source,
      to = state.cell.target
    const owner = (cell) => (cell.value.asset ? cell : cell.parent)
    const ownAssets = new Set([owner(from), owner(to)])
    const obstacles = []
    for (const cell of assetCells.values()) {
      if (!ownAssets.has(cell)) obstacles.push(bounds(cell))
      else if (cell.value.asset.expanded) {
        obstacles.push({ ...bounds(cell), height: 64 * graph.view.scale })
        for (const node of cell.value.asset.nodes) {
          const step = cells.get(node.id)
          if (step !== from && step !== to) obstacles.push(bounds(step))
        }
      }
    }
    const a = { x: source.x, y: source.y, width: source.width, height: source.height }
    const b = { x: target.x, y: target.y, width: target.width, height: target.height }
    const key = JSON.stringify([state.cell.value.connectionKey, a, b, obstacles])
    if (!routes.has(key)) {
      if (routes.size > 2000) routes.clear()
      routes.set(
        key,
        routeSimulationConnection(a, b, obstacles, { padding: 16 * graph.view.scale }),
      )
    }
    for (const point of routes.get(key)) result.push(new mx.mxPoint(point.x, point.y))
  }
  const getEdgeStyle = graph.view.getEdgeStyle
  graph.view.getEdgeStyle = function (state, ...args) {
    return state.cell.value?.connectionKey ? routeEdge : getEdgeStyle.call(this, state, ...args)
  }
  const createEdgeHandler = graph.createEdgeHandler
  graph.createEdgeHandler = function (state, style) {
    return state.cell.value?.connectionKey
      ? this.createEdgeSegmentHandler(state)
      : createEdgeHandler.call(this, state, style)
  }
  const sizeKey = (asset) => JSON.stringify([asset.id, asset.expanded])
  const layoutChanged = (_, event) => {
    if (rendering) return
    let moved = false
    for (const change of event.getProperty('edit')?.changes || []) {
      if (!(change instanceof mx.mxGeometryChange)) continue
      const cell = change.cell
      const geometry = graph.getCellGeometry(cell)
      if (!geometry) continue
      moved = true
      if (cell.value?.asset) {
        const asset = cell.value.asset
        const previous = change.previous
        if (!previous || geometry.x !== previous.x || geometry.y !== previous.y)
          assetPositions.set(asset.id, { x: geometry.x, y: geometry.y })
        if (!previous || geometry.width !== previous.width || geometry.height !== previous.height)
          assetSizes.set(sizeKey(asset), { width: geometry.width, height: geometry.height })
      } else if (cell.value?.node) stepGeometries.set(cell.value.node.id, geometry.clone())
      else if (cell.value?.connectionKey)
        edgeGeometries.set(cell.value.connectionKey, geometry.clone())
    }
    if (moved) {
      routes.clear()
      graph.view.invalidate()
      graph.view.validate()
    }
  }
  graph.model.addListener(mx.mxEvent.CHANGE, layoutChanged)
  const selection = () => {
    if (rendering) return
    const value = graph.getSelectionCell()?.value
    onSelect?.(value?.node || null)
    onSelectAsset?.(value?.asset || owners.get(value?.node?.id) || null)
  }
  graph.getSelectionModel().addListener(mx.mxEvent.CHANGE, selection)
  const click = (_, event) => {
    if (event.isConsumed()) return
    const asset = event.getProperty('cell')?.value?.asset
    if (asset) onToggleAsset?.(asset.id)
  }
  graph.addListener(mx.mxEvent.CLICK, click)
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
  container.addEventListener('wheel', wheel, { passive: false })
  const observer = new ResizeObserver(() => graph.sizeDidChange())
  observer.observe(container)
  return {
    render(layout, { selectedNodeId = null, selectedAssetId = null, resetLayout = false } = {}) {
      if (resetLayout) {
        assetPositions.clear()
        assetSizes.clear()
        stepGeometries.clear()
        edgeGeometries.clear()
      }
      rendering = true
      graph.model.beginUpdate()
      try {
        graph.clearSelection()
        graph.model.clear()
        cells.clear()
        assetCells.clear()
        owners.clear()
        routes.clear()
        defaultStepGeometries.clear()
        for (const asset of layout.assets) {
          let y = 72
          for (const node of asset.nodes) {
            const height = simulationStepHeight(node)
            defaultStepGeometries.set(node.id, { x: 24, y, width: 272, height })
            y += height + 16
          }
        }
        const preparedAssets = layout.assets.map((asset) => {
          const savedSize = assetSizes.get(sizeKey(asset))
          const size = {
            width: savedSize?.width ?? asset.width,
            height: savedSize?.height ?? asset.height,
          }
          if (asset.expanded)
            asset.nodes.forEach((node) => {
              const geometry = stepGeometry(node)
              size.width = Math.max(size.width, geometry.x + geometry.width + 24)
              size.height = Math.max(size.height, geometry.y + geometry.height + 24)
            })
          return { ...asset, ...size }
        })
        for (const asset of arrangeSimulationAssets(preparedAssets, layout.edges)) {
          const position = assetPositions.get(asset.id) || asset
          const hasEntry = asset.nodes.some((node) => node.isEntry)
          const hasTarget = asset.nodes.some((node) => node.isTarget)
          const status = [hasEntry ? 'Entry' : '', hasTarget ? 'Target reached' : '']
            .filter(Boolean)
            .join(' · ')
          const group = graph.insertVertex(
            graph.getDefaultParent(),
            null,
            {
              asset,
              label: `${asset.expanded ? '▾' : '▸'} ${asset.name}\n${asset.type || 'Asset'} (+${asset.nodes.length} steps)${status ? `\n${status}` : ''}`,
            },
            position.x,
            position.y,
            asset.width,
            asset.height,
            `rounded=1;arcSize=5;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingTop=14;spacingLeft=16;spacingRight=16;fontSize=13;fontStyle=1;fontColor=#172b4d;fillColor=#fff5f5;strokeColor=${hasTarget ? '#6f42c1' : hasEntry ? '#198754' : '#e6a4aa'};strokeWidth=2;`,
          )
          assetCells.set(asset.id, group)
          asset.nodes.forEach((node) => {
            owners.set(node.id, asset)
            if (!asset.expanded) {
              cells.set(node.id, group)
              return
            }
            const status = [node.isEntry ? 'Entry' : '', node.isTarget ? 'Target reached' : '']
              .filter(Boolean)
              .join(' · ')
            const stroke = node.isEntry ? '#198754' : node.isTarget ? '#6f42c1' : '#dc3545'
            const fill = node.isEntry ? '#eaf7ef' : node.isTarget ? '#f0eafb' : '#ffffff'
            const geometry = stepGeometry(node)
            const score = getSimulationCtsaScore(node)
            const detail = `${node.type.toUpperCase()} · Iteration ${node.performedAt ?? '—'}${status ? ` · ${status}` : ' · Compromised'}`
            const badge = score
              ? `<br><span class="badge rounded-pill ${riskScoreClass(score.value)}" title="${escapeHtml(simulationCtsaScoreTitle(node))}" style="font-size:11px;line-height:14px;padding:2px 7px;">CTSA Score: ${riskScoreLabel(score.value)}</span>`
              : ''
            const cell = graph.insertVertex(
              group,
              null,
              {
                node,
                label: `${node.name}\n${detail}${score ? `\nCTSA Score: ${riskScoreLabel(score.value)}` : ''}`,
                htmlLabel: `<div style="line-height:17px;font-weight:400;white-space:normal;overflow-wrap:anywhere;"><strong>${escapeHtml(node.name)}</strong><br>${escapeHtml(detail)}${badge}</div>`,
              },
              geometry.x,
              geometry.y,
              geometry.width,
              geometry.height,
              `rounded=1;arcSize=8;whiteSpace=wrap;html=1;spacing=8;fontSize=12;fontColor=#172b4d;strokeWidth=2;fillColor=${fill};strokeColor=${stroke};`,
            )
            cells.set(node.id, cell)
          })
        }
        const endpoint = (cell) =>
          cell.value.node ? ['step', cell.value.node.id] : ['asset', cell.value.asset.id]
        const connections = new Map()
        for (const edge of layout.edges) {
          const source = cells.get(edge.source)
          const target = cells.get(edge.target)
          // Hidden internal steps stay inside their asset. Across assets,
          // summarize real step connections without duplicating asset arrows.
          if (source === target && source.value.asset) continue
          const key = JSON.stringify([endpoint(source), endpoint(target)])
          if (connections.has(key)) connections.get(key).count += 1
          else connections.set(key, { source, target, count: 1 })
        }
        for (const [connectionKey, { source, target, count }] of connections) {
          const summarized = source.value.asset || target.value.asset
          const cell = graph.insertEdge(
            graph.getDefaultParent(),
            null,
            { connectionKey, label: count > 1 ? `${count} connections` : '' },
            source,
            target,
            `edgeStyle=segmentEdgeStyle;orthogonal=0;rounded=1;endArrow=block;endFill=1;strokeWidth=1.5;strokeColor=#b85460;fontSize=11;labelBackgroundColor=#ffffff;${summarized ? 'dashed=1;' : ''}`,
          )
          const geometry = edgeGeometries.get(connectionKey)
          if (geometry) graph.model.setGeometry(cell, geometry.clone())
        }
      } finally {
        graph.model.endUpdate()
        rendering = false
      }
      const cell = cells.get(selectedNodeId) || assetCells.get(selectedAssetId)
      graph.setSelectionCell(cell || null)
      if (cell) graph.scrollCellToVisible(cell, true)
    },
    select(id) {
      const cell = cells.get(id)
      if (!cell) return
      if (graph.view.scale < 0.6) graph.zoomTo(0.6)
      graph.setSelectionCell(cell)
      graph.scrollCellToVisible(cell, true)
    },
    fit() {
      if (!cells.size || !container.clientWidth || !container.clientHeight) return
      graph.fit(24)
      graph.zoomTo(Math.min(1, graph.view.scale))
      graph.center(true, true)
    },
    home() {
      graph.zoomTo(1)
      const cell = graph.getSelectionCell() || cells.values().next().value
      if (cell) graph.scrollCellToVisible(cell, true)
    },
    zoomIn: () => zoom(1.2),
    zoomOut: () => zoom(1 / 1.2),
    resize: () => graph.sizeDidChange(),
    destroy() {
      observer.disconnect()
      container.removeEventListener('wheel', wheel)
      graph.getSelectionModel().removeListener(selection)
      graph.model.removeListener(layoutChanged)
      graph.removeListener(click)
      graph.view.removeListener(scaled)
      graph.destroy()
    },
  }
}
