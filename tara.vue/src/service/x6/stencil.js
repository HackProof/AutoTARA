import shapes from '@/service/x6/shapes/generics';
import { Stencil as DefaultStencil } from '@antv/x6';
import {
    createLangGraphAssetData,
    getAssetCategoryGroups,
    hasAssociationBetween
} from '@/service/langGraph/languageGraph.js';

const CONNECTABLE_CLASS = 'association-connectable';
const CONNECTABLE_GROUP_CLASS = 'association-connectable-group';
const HIGHLIGHT_ACTIVE_CLASS = 'association-highlight-active';

const getStencilConfig = (target, languageGraphGroups = []) => ({
    title: 'Entities',
    target: target,
    collapsable: true,
    stencilGraphWidth: 300,
    stencilGraphHeight: 0,
    groups: [
        ...languageGraphGroups.map((group, index) => ({
            name: group.name,
            title: group.title,
            collapsed: true,
            collapsable: true
        })),
        {
            name: 'generics',
            title: 'Generic',
            collapsed: true,
            collapsable: true
        },
        {
            name: 'boundaries',
            title: 'Boundaries',
            collapsed: true,
            collapsable: true
        },
        {
            name: 'metadata',
            title: 'Metadata',
            collapsed: true,
            collapsable: true
        }
    ],
    layoutOptions: {
        columns: 1,
        center: true,
        resizeToFit: true,
    },
});

const shapeClassByDfdShape = {
    actor: shapes.ActorShape,
    process: shapes.ProcessShape,
    store: shapes.StoreShape
};

const getLangGraphStencilAttrs = (asset) => {
    const commonAttrs = {
        label: {
            text: asset.name
        },
        text: {
            text: asset.name
        },
        body: {
            stroke: '#333333',
            strokeWidth: 1.5,
            strokeDasharray: null
        }
    };

    if (asset.dfdShape === 'store') {
        return {
            ...commonAttrs,
            topLine: {
                stroke: '#333333',
                strokeWidth: 1.5,
                strokeDasharray: null
            },
            bottomLine: {
                stroke: '#333333',
                strokeWidth: 1.5,
                strokeDasharray: null
            }
        };
    }

    return {
        ...commonAttrs,
        body: {
            ...commonAttrs.body,
            fill: '#FFFFFF'
        }
    };
};

const createLangGraphStencilNode = (asset) => {
    const ShapeClass = shapeClassByDfdShape[asset.dfdShape] || shapes.ProcessShape;

    return new ShapeClass({
        label: asset.name,
        data: createLangGraphAssetData(asset, false),
        attrs: getLangGraphStencilAttrs(asset)
    });
};

const getAssetType = (cell) => cell?.getData?.()?.malInfo?.assetType || cell?.data?.malInfo?.assetType || '';

const getStencilGraphs = (stencil) => Object.entries(stencil?.graphs || {});

const getStencilGroups = (stencil) => stencil?.groups || {};

const removeNodeClass = (graph, node, className) => {
    const view = graph?.renderer?.findViewByCell?.(node);
    view?.removeClass?.(className);
};

const addNodeClass = (graph, node, className) => {
    const view = graph?.renderer?.findViewByCell?.(node);
    view?.addClass?.(className);
};

const clearAssociationHighlights = (stencil) => {
    stencil?.container?.classList?.remove(HIGHLIGHT_ACTIVE_CLASS);

    getStencilGraphs(stencil).forEach(([, graph]) => {
        graph.getNodes().forEach((node) => removeNodeClass(graph, node, CONNECTABLE_CLASS));
    });

    Object.values(getStencilGroups(stencil)).forEach((group) => {
        group.classList.remove(CONNECTABLE_GROUP_CLASS);
    });
};

const highlightConnectableStencilNodes = (stencil, selectedCell, languageGraph) => {
    clearAssociationHighlights(stencil);

    const selectedAssetType = getAssetType(selectedCell);
    if (!languageGraph || !selectedCell?.isNode?.() || !selectedAssetType) return;

    const groupsWithMatches = new Set();

    getStencilGraphs(stencil).forEach(([groupName, graph]) => {
        graph.getNodes().forEach((node) => {
            const stencilAssetType = getAssetType(node);
            if (!stencilAssetType) return;

            if (hasAssociationBetween(languageGraph, selectedAssetType, stencilAssetType)) {
                addNodeClass(graph, node, CONNECTABLE_CLASS);
                groupsWithMatches.add(groupName);
            }
        });
    });

    if (!groupsWithMatches.size) return;

    stencil.container.classList.add(HIGHLIGHT_ACTIVE_CLASS);

    const groups = getStencilGroups(stencil);
    groupsWithMatches.forEach((groupName) => {
        groups[groupName]?.classList.add(CONNECTABLE_GROUP_CLASS);
    });
};

const listenForAssociationHighlights = (target, stencil, languageGraph) => {
    if (!target || !stencil || !languageGraph) return () => {};

    const updateFromCurrentSelection = () => {
        const selectedCell = target.getSelectedCells?.()
            ?.find((cell) => cell?.isNode?.() && getAssetType(cell));

        if (selectedCell) {
            highlightConnectableStencilNodes(stencil, selectedCell, languageGraph);
        } else {
            clearAssociationHighlights(stencil);
        }
    };
    const updateFromSelection = ({ cell }) => {
        highlightConnectableStencilNodes(stencil, cell, languageGraph);
    };
    const clear = () => clearAssociationHighlights(stencil);

    target.on('cell:selected', updateFromSelection);
    target.on('cell:unselected', updateFromCurrentSelection);
    target.on('cell:removed', clear);
    target.on('blank:click', clear);
    target.on('blank:mousedown', clear);

    return () => {
        target.off('cell:selected', updateFromSelection);
        target.off('cell:unselected', updateFromCurrentSelection);
        target.off('cell:removed', clear);
        target.off('blank:click', clear);
        target.off('blank:mousedown', clear);
        clear();
    };
};

const get = (target, container, StencilClass = DefaultStencil, languageGraph = null) => {
    const languageGraphGroups = getAssetCategoryGroups(languageGraph);
    const stencil = new StencilClass(getStencilConfig(target, languageGraphGroups));

    languageGraphGroups.forEach((group) => {
        stencil.load(
            group.assets.map(createLangGraphStencilNode),
            group.name
        );
    });

    stencil.load(
        [
            new shapes.ProcessShape({data: { name: 'Process', description: '' }}),
            new shapes.StoreShape({data: { name: 'Store', description: '' }}),
            new shapes.ActorShape({data: { name: 'Actor', description: '' }}),
            new shapes.FlowStencil(),
        ],
        'generics'
    );

    stencil.load(
        [
            new shapes.TrustBoundaryBox({
                width: 160,
                height: 75,
                zIndex: 10,
                attrs: {
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
                        text: 'Trust Boundary',
                        fill: '#dc3545',
                        fontWeight: 700,
                        textAnchor: 'start',
                        textVerticalAnchor: 'top',
                        refX: 14,
                        refY: 12,
                        pointerEvents: 'none'
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
                }
            }),
            new shapes.TrustBoundaryCurveStencil(),
        ],
        'boundaries'
    );

    stencil.load([new shapes.TextBlock()], 'metadata');

    container.appendChild(stencil.container);

    return {
        stencil,
        dispose: listenForAssociationHighlights(target, stencil, languageGraph)
    };
};

export default {
    get,
};
