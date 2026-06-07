import {
    Graph, Clipboard, Export, History, Keyboard, Scroller, Shape, Selection, Snapline, Transform
} from '@antv/x6';
import events from './events.js';
import keys from './keys.js';
import { useThreatModelStore } from '@/stores/threatModelStore.js';
import { hasAssociationBetween } from '@/service/langGraph/languageGraph.js';

const hasExistingEdgeBetween = (graph, sourceCell, targetCell) => {
    return graph.getEdges().some((edge) => {
        const sourceId = edge.getSourceCellId?.() || edge.getSource?.()?.cell;
        const targetId = edge.getTargetCellId?.() || edge.getTarget?.()?.cell;

        return (sourceId === sourceCell.id && targetId === targetCell.id)
            || (sourceId === targetCell.id && targetId === sourceCell.id);
    });
};

const getEditGraph = (container, ctor = Graph) => {
    const graph = new ctor({
        container: container,
        autoResize: true,
        grid: {
            size: 10, // default value
            visible: true
        },
        mousewheel: {
            enabled: true,
            global: true,
            modifiers: ['ctrl', 'meta']
        },
        panning: {
            enabled: false // use Scroller plugin instead
        },
        scaling: {
            // mousewheel + ctrl/meta/command key zooms in and out
            min: 0.1, // default value is 0.01
            max: 3.2 // default value is 16
        },
        preventDefaultContextMenu: false,
        connecting: {
            allowBlank: false,
            allowLoop: true, // loops do not make sense in a threat model diagram, but allow anyway
            allowMulti: true, // multiple edges on the same node/port (default is false)
            allowNode: true, // default to attaching edges to nodes
            // allowPort: false, // attach edge anywhere on boundary, not just ports
            connector: {
                name: 'rounded',
                args: {
                    radius: 8
                }
            },
            anchor: 'center',
            connectionPoint: 'boundary',
            snap: {
                radius: 50
            },
            createEdge() {
                return new Shape.Edge({
                    attrs: {
                        line: { // probably need stroke to be black for federal reports
                            strokeWidth: 2,
                            sourceMarker: null,
                            targetMarker: null
                        }
                    },
                    zIndex: 0
                });
            },
            validateConnection({ sourceCell, targetCell, targetMagnet }) {
                if (!targetMagnet || !sourceCell || !targetCell || sourceCell.id === targetCell.id) {
                    return false;
                }

                if (hasExistingEdgeBetween(graph, sourceCell, targetCell)) {
                    return false;
                }

                const tmStore = useThreatModelStore();
                const languageGraph = tmStore.data.languageGraph;
                if (!languageGraph) return true;

                const sourceType = sourceCell.getData?.()?.malInfo?.assetType;
                const targetType = targetCell.getData?.()?.malInfo?.assetType;
                if (!sourceType || !targetType) return false;

                return hasAssociationBetween(languageGraph, sourceType, targetType);
            }
        }
    });
    graph
        .use(new Clipboard())
        .use(
            new History({
                enabled: true,
                beforeAddCommand: beforeAddCommand
            })
        )
        .use(
            new Keyboard({
                enabled: true,
                global: true
            })
        )
        .use(
            new Scroller({
                enabled: true,
                modifiers: ['shift'],
                pageVisible: true,
                pageBreak: false,
                pannable:  true
            })
        )
        .use(
            new Selection({
                enabled: true,
                content: null,
                eventTypes: ['leftMouseDown', 'mouseWheelDown'],
                movable: true,
                multiple: true,
                multipleSelectionModifiers: ['ctrl', 'meta'],
                pointerEvents: 'auto',
                rubberband: true,
                rubberNode: true,
                rubberEdge: true, // not documented in v2.x docs but needed for rubberbanding TB curves
                strict: true, // need strict select otherwise data flows select other elements
                showNodeSelectionBox: true,
                showEdgeSelectionBox: true
            })
        )
        .use(
            new Snapline({
                enabled: true,
                sharp: true
            })
        )
        .use(
            new Transform({
                resizing: {
                    enabled: true,
                    isEnabled({ node }) {
                        return node?.shape !== 'td-text-block';
                    },
                    allowReverse: true,
                    autoScroll: true,
                    minWidth: 50,
                    minHeight: 50,
                    maxWidth: Number.MAX_SAFE_INTEGER, // probably needs a more sane value
                    maxHeight: Number.MAX_SAFE_INTEGER, // same goes for this
                    orthogonal: true,
                    preserveAspectRatio: false,
                    restrict: false
                },
                rotating: true
            })
        )
        .use(new Export());

    events.listen(graph);
    keys.bind(graph);

    return graph;
};

const getReadonlyGraph = (container, ctor = Graph) => {
    const graph = new ctor({
        container: container,
        autoResize: true,
        preventDefaultContextMenu: false,
        interacting: false
    });
    graph.use(
        new History({
            enabled: false
        })
    );

    return graph;
};

export const beforeAddCommand = (_event, args) => {
    // Showing and hiding the tools on mouseover events
    // gets added to the history stack.
    // Ignore those events since that is not a "user" action
    return args.key !== 'tools';
};

export default {
    getEditGraph,
    getReadonlyGraph
};
