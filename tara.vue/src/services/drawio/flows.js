export const dataFlowStyle =
  'edgeStyle=orthogonalEdgeStyle;curved=1;rounded=0;endArrow=block;endFill=1;strokeColor=#000000;strokeWidth=2;fontColor=#000000;fontSize=12;labelBackgroundColor=#ffffff;'

export function configureDataFlows(graph, mx) {
  const stylesheet = graph.getStylesheet()
  Object.assign(stylesheet.getDefaultEdgeStyle(), stylesheet.getCellStyle(dataFlowStyle, {}))

  const connection = graph.connectionHandler
  // Use the same routed curve while dragging a connection and after releasing it.
  // Collinear route points remain a straight line; bends become quadratic curves.
  connection.livePreview = true
  connection.createEdgeState = () => {
    const edge = graph.createEdge(null, null, '', null, null, dataFlowStyle)
    return new mx.mxCellState(graph.view, edge, graph.getCellStyle(edge))
  }
  const insertEdge = connection.insertEdge
  connection.insertEdge = function (parent, id, value, source, target, style) {
    // Persist the rendering style in XML as well as in the graph's defaults.
    return insertEdge.call(this, parent, id, value, source, target, style || dataFlowStyle)
  }
}
