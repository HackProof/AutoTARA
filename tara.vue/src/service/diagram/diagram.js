import graphFactory from '@/service/x6/graph/graph.js';

const loadEditDiagram = (container, diagram) => {
    const graph = graphFactory.getEditGraph(container);
    graph.fromJSON(diagram);    // load the diagram into the graph
    return graph;
}

export default {
    loadEditDiagram
}