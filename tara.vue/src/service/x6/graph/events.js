/**
 * @name events
 * @description Event listeners for the graph
 */
import dataChanged from './data-changed.js';
import shapes from '@/service/x6/shapes/generics/index.js';

import { useThreatModelStore } from '@/stores/threatModelStore.js';
import { useCellStore } from "@/stores/cellStore.js";
import {
    applyAssociationToEdge,
    buildThreatsFromAttackSteps
} from '@/service/langGraph/languageGraph.js';

const showPorts = (show) => {
    const container = document.getElementById('graph_container');
    const ports = container.querySelectorAll('.x6-port-body');
    for (let i = 0, len = ports.length; i < len; i += 1) {
        ports[i].style.visibility = show ? 'visible' : 'hidden';
    }
};

const SIMULATION_MARKER_TOOL_IDS = new Set([
    'entry-marker-tool',
    'target-marker-tool'
]);

const getToolItems = (cell) => {
    const tools = cell.getTools?.();
    return Array.isArray(tools) ? tools : (tools?.items || []);
};

const removeHoverTools = (cell) => {
    const persistentTools = getToolItems(cell)
        .filter((tool) => SIMULATION_MARKER_TOOL_IDS.has(tool?.id));

    if (persistentTools.length > 0) {
        cell.setTools({ items: persistentTools });
    } else {
        cell.removeTools();
    }
};

const canvasResized = ({ width, height }) => {
    console.debug('canvas resized to width ', width, ' height ', height);
    showPorts(false);
};

const edgeChangeVertices = () => ({ edge }) => {
    if (edge.constructor.name === 'Edge') {
        console.debug('vertex for unformatted edge/flow');
    }
};

const edgeConnected = (graph) => ({ edge }) => {
    const tmStore = useThreatModelStore();

    if (edge.constructor.name === 'Edge') {
        console.debug('connected unformatted edge/flow');
        const flow = shapes.Flow.fromEdge(edge);
        graph.addEdge(flow);
        edge.remove();
        edge = flow;
        edge.setName(edge.getData?.()?.name || edge.data?.name || 'Data Flow');
    }

    if (tmStore.data.languageGraph) {
        applyAssociationToEdge(edge, graph, tmStore.data.languageGraph);
    }
};

// 모든 cell의 hover tools를 정리하는 헬퍼 함수
const clearAllHoverTools = (graph) => {
    if (!graph) return;

    const cells = graph.getCells();
    cells.forEach(cell => {
        // 모든 hover 관련 tools 제거
        removeHoverTools(cell);
    });
    showPorts(false);
};

const mouseLeave = ({ cell }) => {
    // Entry/Target markers are persistent tools, so only transient hover tools are removed.
    removeHoverTools(cell);

    // [중요] 여기서는 entry-marker-tool과 target-marker-tool을 지우지 않습니다.
    // 따라서 마우스가 떠나도 마커는 계속 남아있게 됩니다.

    showPorts(false);
};

const mouseEnter = ({ cell }) => {
    const tools = ['boundary', 'button-remove'];
    // both 'node-editor' and 'edge-editor' tools seem to drop the text very easily, so do not use (yet)
    if (!cell.isNode()) {
        tools.push('vertices');
        tools.push('source-arrowhead');
        tools.push('target-arrowhead');
    }
    cell.addTools(tools);

    showPorts(true);
};

const isTrustBoundaryBoxCell = (cell) => {
    const cellData = cell.getData?.() || cell.data;
    return cell.shape === 'trust-boundary-box'
        || cell.type === 'tm.BoundaryBox'
        || cellData?.type === 'tm.BoundaryBox';
};

const normalizeTrustBoundaryBox = (graph, cell) => {
    if (!isTrustBoundaryBoxCell(cell) || cell.__trustBoundaryBoxNormalized) {
        return cell;
    }

    const position = cell.position?.() || { x: 0, y: 0 };
    const size = cell.size?.() || cell.getSize?.() || { width: 500, height: 400 };
    const data = {
        ...(cell.getData?.() || cell.data || {}),
        type: 'tm.BoundaryBox',
        name: (cell.getData?.() || cell.data || {}).name || 'Trust Boundary',
        isTrustBoundary: true,
        hasOpenThreats: false
    };

    const normalized = new shapes.TrustBoundaryBox({
        id: cell.id,
        x: position.x,
        y: position.y,
        width: size.width || 500,
        height: size.height || 400,
        zIndex: 10,
        data
    });
    normalized.__trustBoundaryBoxNormalized = true;

    cell.remove({ skipSelection: true });
    return graph.addNode(normalized, { skipSelection: true });
};

const cellAdded = (graph) => ({ cell }) => {
    const cellStore = useCellStore();
    console.log('cell added with shape: ', cell.shape);
    // ensure selection of other components is removed
    graph.resetSelection();

    // Flow and trust boundary stencils need to be converted
    if (cell.convertToEdge) {
        let edge = cell;
        const position = cell.position();
        const config = {
            source: position,
            target: {
                x: position.x + 100,
                y: position.y + 100
            },
            data: cell.getData()
        };

        if (cell.type === shapes.FlowStencil.prototype.type) {
            edge = graph.addEdge(new shapes.Flow(config));
        } else if (cell.type === shapes.TrustBoundaryCurveStencil.prototype.type) {
            edge = graph.addEdge(new shapes.TrustBoundaryCurve(config));
        } else {
            console.warn('Unknown edge stencil');
        }
        cell.remove();
        cell = edge;
        cell.setName(cell.data.name);
    }

    cell = normalizeTrustBoundaryBox(graph, cell);
    mouseLeave({ cell });

    const cellData = cell.getData?.() || cell.data;
    const isTrustBoundaryBox = isTrustBoundaryBoxCell(cell);

    if (isTrustBoundaryBox) {
        cell.setZIndex(10);
        cell.attr({
            body: {
                stroke: '#dc3545',
                strokeWidth: 3,
                strokeDasharray: '10 5',
                fill: 'transparent',
                fillOpacity: 0,
                opacity: 1,
                pointerEvents: 'visiblePainted'
            },
            label: {
                text: cellData?.name || 'Trust Boundary',
                fill: '#dc3545',
                fontWeight: 700
            },
            hitArea: {
                refWidth: '100%',
                refHeight: '100%',
                fill: '#ffffff',
                fillOpacity: 0,
                stroke: 'transparent',
                strokeWidth: 12,
                pointerEvents: 'all'
            }
        });
    }

    if (
        cell.isNode?.()
        && cellData?.malInfo?.source === 'LanguageGraph'
        && Array.isArray(cellData.malInfo.attackSteps)
        && (!Array.isArray(cellData.threats) || cellData.threats.length === 0)
    ) {
        const threats = buildThreatsFromAttackSteps({
            name: cellData.malInfo.assetType,
            attackSteps: cellData.malInfo.attackSteps
        });
        cell.setData({
            ...cellData,
            threats,
            hasOpenThreats: threats.length > 0
        }, { skipSelection: true });
    }

    cellStore.select(cell);

    dataChanged.updateProperties(cell);
    dataChanged.updateStyleAttrs(cell);
    // dataChanged.updateAssetDescription(cell)

    if (cell.shape === 'edge') {
        console.debug('added new edge (flow parent)');
    }

    // do not select new data flows or trust boundaries: it surprises the user
    if (cell.shape !== 'path'
        && cell.shape !== 'edge'
        && cell.shape !== 'flow'
        && cell.shape !== 'trust-boundary-curve') {
        graph.select(cell);
    }
};

const cellDeleted = () => {
    const tmStore = useThreatModelStore();

    console.debug('cell deleted');
    tmStore.setModified();
};

const cellSelected = (graph) => ({ cell }) => {
    console.log(cell)
    const cellStore = useCellStore();
    // try and get the cell name
    if (cell.data) {
        if (cell.data.name) {
            console.debug('Cell selected: ' + JSON.stringify(cell.data));
        } else if (cell.getLabels) {
            const labels = cell.getLabels();
            if (labels.length && labels[0].attrs.label) {
                cell.data.name = labels[0].attrs.label.text;
                console.debug('Cell selected with label: ' + cell.data.name);
            }
        } else {
            console.warn('Cell selected with no name');
        }
    } else {
        console.warn('cell selected with no data');
    }

    if (cell.shape === 'edge') {
        console.debug('selected unformatted edge/flow');
        const flow = shapes.Flow.fromEdge(cell);
        graph.addEdge(flow);
        cell.remove();
        cell = flow;
        cell.setName(cell.data.name);
    }

    cellStore.select(cell);
    dataChanged.updateProperties(cell);
    dataChanged.updateStyleAttrs(cell);
    dataChanged.setType(cell);
};

const cellUnselected = ({ cell }) => {
    const cellStore = useCellStore();
    console.debug('cell unselected');
    mouseLeave({ cell });
    cellStore.unselect();
};

const cellDataChanged = ({ cell, options }) => {
    const cellStore = useCellStore();
    const tmStore = useThreatModelStore();

    // 2. [핵심] 'skipSelection' 옵션이 있을 때는 선택을 변경하지 않습니다!
    // 이 줄이 있어야 백그라운드 업데이트 시 선택이 튀는 것을 막습니다.
    if (!options || !options.skipSelection) {
        cellStore.select(cell);
    }

    // 스타일 업데이트는 항상 수행
    dataChanged.updateStyleAttrs(cell);
    tmStore.setModified();
};

const listen = (graph) => {
    graph.on('resize', canvasResized);
    graph.on('edge:change:vertices', edgeChangeVertices(graph));
    graph.on('edge:connected', edgeConnected(graph));
    graph.on('edge:dblclick', cellSelected);
    graph.on('edge:move', cellSelected);
    graph.on('cell:mouseleave', mouseLeave);
    graph.on('cell:mouseenter', mouseEnter);
    graph.on('cell:added', cellAdded(graph));
    graph.on('cell:removed', cellDeleted);
    graph.on('cell:change:data', cellDataChanged);
    graph.on('cell:selected', cellSelected(graph));
    graph.on('cell:unselected', cellUnselected);
    graph.on('node:move', cellSelected);

    // 빈 공간 클릭/마우스다운 시 모든 hover tools 정리
    graph.on('blank:click', () => clearAllHoverTools(graph));
    graph.on('blank:mousedown', () => clearAllHoverTools(graph));
};

const removeListeners = (graph) => {
    graph.off('resize', canvasResized);
    graph.off('edge:change:vertices', edgeChangeVertices(graph));
    graph.off('edge:connected', edgeConnected(graph));
    graph.off('edge:dblclick', cellSelected);
    graph.off('edge:move', cellSelected);
    graph.off('cell:mouseleave', mouseLeave);
    graph.off('cell:mouseenter', mouseEnter);
    graph.off('cell:added', cellAdded(graph));
    graph.off('cell:removed', cellDeleted);
    graph.off('cell:change:data', cellDataChanged);
    graph.off('cell:selected', cellSelected(graph));
    graph.off('cell:unselected', cellUnselected);
    graph.off('node:move', cellSelected);

    // 빈 공간 이벤트 제거
    graph.off('blank:click');
    graph.off('blank:mousedown');
};

export default {
    listen,
    removeListeners
};
