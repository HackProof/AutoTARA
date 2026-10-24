import { configureDataFlows } from './flows.js'
import { configureVertexHandles } from './vertexHandles.js'
import { configureAttackEndpointMarkers } from './endpointMarkers.js'

export function configureGraphBehavior(graph, mx) {
  const model = graph.getModel()
  configureAttackEndpointMarkers(graph, mx)

  // The draw.io fork calls these Graph.js extensions from its native drag and
  // connection handlers. Bare mxGraph does not implement them.
  graph.getCompositeParent = function (cell) {
    while (cell && String(this.getCurrentCellStyle(cell).part) === '1') {
      const parent = model.getParent(cell)
      if (!model.isVertex(parent)) break
      cell = parent
    }
    return cell
  }
  graph.getReferenceTerminal = function (terminal) {
    if (this.getCellGeometry(terminal)?.relative) terminal = model.getParent(terminal)
    if (model.isEdge(terminal)) terminal = model.getParent(terminal)
    return this.getCompositeParent(terminal)
  }

  // common.css positions the editor relatively for the full draw.io UI. This
  // integration appends it directly to the graph's positioned, scrolling container.
  const initEditor = graph.cellEditor.init
  graph.cellEditor.init = function () {
    initEditor.call(this)
    this.textarea.style.position = 'absolute'
    this.textarea.style.boxSizing = 'content-box'
  }
  graph.cellEditor.blurEnabled = true
  graph.setEnterStopsCellEditing(true)

  // Redraw the actual cells and their incident edges while dragging. The core
  // defaults to maxLivePreview=0, which only moves a dashed bounding box.
  graph.graphHandler.allowLivePreview = true
  graph.graphHandler.maxLivePreview = Number.POSITIVE_INFINITY

  // Cardinal directions and the four diagonals. Native perimeter projection
  // puts these at 45-degree intervals on circles and at rectangle corners/midpoints.
  const ports = [
    ['north', 0.5, 0],
    ['north-east', 1, 0],
    ['east', 1, 0.5],
    ['south-east', 1, 1],
    ['south', 0.5, 1],
    ['south-west', 0, 1],
    ['west', 0, 0.5],
    ['north-west', 0, 0],
  ].map(([name, x, y]) => new mx.mxConnectionConstraint(new mx.mxPoint(x, y), true, name))

  graph.getAllConnectionConstraints = (state) => {
    const cell = state?.cell
    const kind = cell?.value?.nodeType === 1 ? cell.value.getAttribute('taraKind') : ''
    return cell &&
      model.isVertex(cell) &&
      graph.isCellConnectable(cell) &&
      !['boundary', 'annotation'].includes(kind)
      ? ports
      : null
  }

  configureVertexHandles(graph, mx)

  const connection = graph.connectionHandler
  connection.createTarget = false
  connection.connectImage = null
  configureDataFlows(graph, mx)
  connection.isConnectableCell = (cell) => !!graph.getAllConnectionConstraints({ cell })?.length
  connection.constraintHandler.pointImage = new mx.mxImage(
    'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><circle cx="4" cy="4" r="3" fill="white" stroke="black"/></svg>',
      ),
    8,
    8,
  )
  // Body drags move the asset. Only the eight ports start a Data Flow.
  connection.isStartEvent = function (event) {
    return (
      !mx.mxEvent.isPopupTrigger(event.getEvent()) &&
      this.constraintHandler.currentFocus != null &&
      this.constraintHandler.currentConstraint != null
    )
  }
  const mouseDown = connection.mouseDown
  connection.mouseDown = function (sender, event) {
    if (!event.isConsumed() && !this.isConnecting()) {
      // Touch/pointer presses need not be preceded by a hover event.
      this.constraintHandler.update(event, true)
    }
    mouseDown.call(this, sender, event)
  }

  const updateCurrentState = connection.updateCurrentState
  connection.updateCurrentState = function (event, point) {
    updateCurrentState.call(this, event, point)
    // Dropping on the body snaps to its nearest port instead of creating a
    // floating endpoint. Explicitly hovered ports retain the user's choice.
    if (this.first && this.currentState && !this.constraintHandler.currentConstraint) {
      const constraints = graph.getAllConnectionConstraints(this.currentState)
      if (!constraints?.length) return
      const cursor = point || new mx.mxPoint(event.getGraphX(), event.getGraphY())
      const closest = constraints
        .map((constraint) => ({
          constraint,
          point: graph.getConnectionPoint(this.currentState, constraint),
        }))
        .sort(
          (a, b) =>
            Math.hypot(a.point.x - cursor.x, a.point.y - cursor.y) -
            Math.hypot(b.point.x - cursor.x, b.point.y - cursor.y),
        )[0]
      this.constraintHandler.setFocus(event, this.currentState, false)
      this.constraintHandler.currentConstraint = closest.constraint
      this.constraintHandler.currentPoint = closest.point
    }
  }
}
