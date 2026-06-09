import { v4 as uuidv4 } from 'uuid';
import { ports } from '@/service/x6/ports.js';
import defaultProperties from '@/service/entity/default-properties.js';
import {
    createLangGraphAssetData,
    findAssociationsFromField,
    findAssociationMatches,
    findAssociationsBetween,
    getConcreteAssets
} from '@/service/langGraph/languageGraph.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

const getLanguageAsset = (languageGraph, assetType) => {
    return getConcreteAssets(languageGraph).find((asset) => asset.name === assetType);
};

const getPosition = (cell) => {
    if (typeof cell.position === 'function') return cell.position();
    if (typeof cell.getPosition === 'function') return cell.getPosition();
    if (cell.position) return cell.position;
    return { x: 0, y: 0 };
};

const getCellData = (cell) => {
    if (typeof cell.getData === 'function') return cell.getData();
    return cell.data || {};
};

const getNodeCells = (diagramOrGraph) => {
    if (diagramOrGraph?.getNodes) return diagramOrGraph.getNodes();
    return (diagramOrGraph?.cells || []).filter((cell) => !cell.source && !cell.target);
};

const getEdgeCells = (diagramOrGraph) => {
    if (diagramOrGraph?.getEdges) return diagramOrGraph.getEdges();
    return (diagramOrGraph?.cells || []).filter((cell) => cell.source && cell.target);
};

const getCellId = (cell) => cell.id;

const getSourceCellId = (edge) => {
    if (typeof edge.getSourceCellId === 'function') return edge.getSourceCellId();
    return edge.source?.cell;
};

const getTargetCellId = (edge) => {
    if (typeof edge.getTargetCellId === 'function') return edge.getTargetCellId();
    return edge.target?.cell;
};

const getAssetId = (usedIds, fallbackIndex) => {
    let nextId = String(fallbackIndex);
    while (usedIds.has(nextId)) {
        fallbackIndex += 1;
        nextId = String(fallbackIndex);
    }

    usedIds.add(nextId);
    return nextId;
};

const getAssociationFieldMax = (languageGraph, ownerAssetType, associatedAssetType, fieldName) => {
    const association = findAssociationsFromField(
        languageGraph,
        ownerAssetType,
        associatedAssetType,
        fieldName
    )[0];

    if (!association) return null;

    const field = association.left?.fieldname === fieldName
        ? association.left
        : association.right?.fieldname === fieldName
            ? association.right
            : null;
    const max = Number(field?.max ?? field?.maximum);
    return Number.isFinite(max) && max > 0 ? max : Infinity;
};

const getModelMetadata = (threatModel) => {
    const languageGraphMetadata = threatModel.languageGraph?.metadata || {};
    const modelInfo = threatModel.modelInfo || {};

    return {
        name: modelInfo.title || 'AutoTARA_Model',
        langVersion: modelInfo.version || languageGraphMetadata.version || threatModel.version || '',
        langID: languageGraphMetadata.id || 'org.mal-lang.vehicleLang',
        malVersion: '0.1.0-SNAPSHOT',
        'MAL-Toolbox Version': '2.8.1',
        info: 'Created by AutoTARA.'
    };
};

export const createMalModelFromDiagram = (threatModel, diagramOrGraph) => {
    const nodes = getNodeCells(diagramOrGraph);
    const edges = getEdgeCells(diagramOrGraph);
    const languageGraph = threatModel.languageGraph || null;
    const usedAssetIds = new Set();
    const cellIdToAssetId = new Map();
    const assets = {};

    nodes.forEach((cell, index) => {
        const data = getCellData(cell);
        const assetType = data.malInfo?.assetType;
        if (!assetType) return;

        const assetId = getAssetId(usedAssetIds, index);
        const position = getPosition(cell);

        cellIdToAssetId.set(getCellId(cell), assetId);
        assets[assetId] = {
            name: data.name || assetType,
            type: assetType,
            associated_assets: {},
            extras: {
                position: {
                    x: Number(position.x || 0),
                    y: Number(position.y || 0)
                }
            }
        };

        if (data.malInfo?.defenses && Object.keys(data.malInfo.defenses).length > 0) {
            assets[assetId].defenses = data.malInfo.defenses;
        }
    });

    edges.forEach((edge) => {
        const sourceCellId = getSourceCellId(edge);
        const targetCellId = getTargetCellId(edge);
        const sourceAssetId = cellIdToAssetId.get(sourceCellId);
        const targetAssetId = cellIdToAssetId.get(targetCellId);
        if (!sourceAssetId || !targetAssetId) return;

        const edgeData = getCellData(edge);
        const ownerId = edgeData.malInfo?.associationOwner === 'target' ? targetAssetId : sourceAssetId;
        const associatedId = edgeData.malInfo?.associationOwner === 'target' ? sourceAssetId : targetAssetId;
        const fieldName = edgeData.malInfo?.fieldName;
        if (!fieldName || !assets[ownerId] || !assets[associatedId]) return;

        if (!assets[ownerId].associated_assets[fieldName]) {
            assets[ownerId].associated_assets[fieldName] = {};
        }

        const fieldMax = getAssociationFieldMax(
            languageGraph,
            assets[ownerId].type,
            assets[associatedId].type,
            fieldName
        );
        if (fieldMax === null) {
            console.warn(`[modelTransform] Skipping invalid association field: ${assets[ownerId].type}.${fieldName} -> ${assets[associatedId].type}`);
            return;
        }
        if (Object.keys(assets[ownerId].associated_assets[fieldName]).length >= fieldMax) {
            console.warn(`[modelTransform] Skipping association over max cardinality: ${assets[ownerId].name}.${fieldName}`);
            return;
        }

        assets[ownerId].associated_assets[fieldName][associatedId] = assets[associatedId].name;
    });

    return {
        metadata: getModelMetadata(threatModel),
        assets
    };
};

const calculateFallbackPosition = (index) => ({
    x: 120 + (index % 4) * 220,
    y: 80 + Math.floor(index / 4) * 180
});

const typeByDfdShape = {
    actor: 'tm.Actor',
    process: 'tm.Process',
    store: 'tm.Store'
};

const dfdShapeByType = {
    'tm.Actor': 'actor',
    'tm.Process': 'process',
    'tm.Store': 'store'
};

const getDfdShape = (languageAsset, baseData) => (
    languageAsset?.dfdShape
    || baseData?.malInfo?.dfdShape
    || dfdShapeByType[baseData?.type]
    || 'process'
);

const getDefaultNodeProps = (dfdShape) => (
    defaultProperties.defaultEntity(typeByDfdShape[dfdShape] || 'tm.Process')
);

const getNodeAttrs = (assetName, dfdShape) => {
    const commonAttrs = {
        label: {
            text: assetName
        },
        text: {
            text: assetName
        },
        body: {
            stroke: '#333333',
            strokeWidth: 1.5,
            strokeDasharray: null
        }
    };

    if (dfdShape === 'store') {
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

const createNodeFromModelAsset = (assetId, asset, languageGraph, index) => {
    const languageAsset = getLanguageAsset(languageGraph, asset.type);
    const baseData = languageAsset
        ? createLangGraphAssetData(languageAsset, true)
        : {
            type: 'tm.Process',
            name: asset.name,
            description: `${asset.type} asset`,
            isTrustBoundary: false,
            isEntry: false,
            isTarget: false,
            outOfScope: false,
            reasonOutOfScope: '',
            hasOpenThreats: false,
            threats: [],
            malInfo: {
                source: 'LanguageGraph',
                assetType: asset.type,
                associations: [],
                attackSteps: [],
                subAssets: []
            }
        };

    const position = asset.extras?.position || calculateFallbackPosition(index);
    const dfdShape = getDfdShape(languageAsset, baseData);
    const defaultNodeProps = getDefaultNodeProps(dfdShape);

    return {
        position: {
            x: Number(position.x || 0),
            y: Number(position.y || 0)
        },
        size: defaultNodeProps.size,
        attrs: getNodeAttrs(asset.name, dfdShape),
        visible: true,
        shape: defaultNodeProps.shape,
        zIndex: index + 1,
        ports: clone(ports),
        id: uuidv4(),
        data: {
            ...baseData,
            name: asset.name,
            malInfo: {
                ...baseData.malInfo,
                assetId,
                assetType: asset.type,
                defenses: asset.defenses || {}
            }
        },
        tools: {
            items: []
        }
    };
};

const findAssociationForImport = (languageGraph, sourceType, targetType, fieldName) => {
    const sourceMatches = findAssociationsBetween(languageGraph, sourceType, targetType)
        .map((association) => ({ ...association, associationOwner: 'source' }));
    const exactSource = sourceMatches.find((association) => association.fieldName === fieldName);
    if (exactSource) return exactSource;

    const targetMatches = findAssociationMatches(languageGraph, sourceType, targetType);
    return targetMatches.find((association) => association.fieldName === fieldName) || targetMatches[0] || null;
};

const createEdge = (sourceNode, targetNode, association, fieldName) => {
    const associationName = association?.name || fieldName;

    return {
        shape: 'flow',
        id: uuidv4(),
        zIndex: 10,
        source: {
            cell: sourceNode.id
        },
        target: {
            cell: targetNode.id
        },
        attrs: {
            line: {
                stroke: '#333333',
                sourceMarker: {
                    name: ''
                },
                targetMarker: {
                    name: ''
                },
                strokeDasharray: null
            }
        },
        labels: [associationName],
        data: {
            type: 'tm.Flow',
            name: associationName,
            description: association?.description || `${sourceNode.data.malInfo.assetType}.${fieldName}`,
            outOfScope: false,
            isTrustBoundary: false,
            reasonOutOfScope: '',
            hasOpenThreats: false,
            isBidirectional: false,
            isEncrypted: false,
            isPublicNetwork: false,
            protocol: '',
            threats: [],
            malInfo: {
                source: 'LanguageGraph',
                associationType: 'association',
                associationName,
                fieldName,
                associationOwner: association?.associationOwner || 'source',
                sourceAssetType: sourceNode.data.malInfo.assetType,
                targetAssetType: targetNode.data.malInfo.assetType
            }
        },
        connector: {
            name: 'smooth',
            args: {}
        },
        width: 200,
        height: 100
    };
};

export const createDiagramFromMalModel = (malModel, languageGraph) => {
    const cells = [];
    const assetIdToNode = new Map();
    const assetEntries = Object.entries(malModel?.assets || {});

    assetEntries.forEach(([assetId, asset], index) => {
        const node = createNodeFromModelAsset(assetId, asset, languageGraph, index);
        assetIdToNode.set(assetId, node);
        cells.push(node);
    });

    const edgeKeys = new Set();

    assetEntries.forEach(([sourceAssetId, asset]) => {
        const sourceNode = assetIdToNode.get(sourceAssetId);
        if (!sourceNode || !asset.associated_assets) return;

        Object.entries(asset.associated_assets).forEach(([fieldName, linkedAssets]) => {
            Object.keys(linkedAssets || {}).forEach((targetAssetId) => {
                const targetNode = assetIdToNode.get(targetAssetId);
                if (!targetNode || sourceNode.id === targetNode.id) return;

                const edgeKey = [sourceNode.id, targetNode.id].sort().join(':');
                if (edgeKeys.has(edgeKey)) return;
                edgeKeys.add(edgeKey);

                const association = findAssociationForImport(
                    languageGraph,
                    sourceNode.data.malInfo.assetType,
                    targetNode.data.malInfo.assetType,
                    fieldName
                );

                cells.push(createEdge(sourceNode, targetNode, association, fieldName));
            });
        });
    });

    return { cells };
};

const isPlainObject = (value) => {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
};

const quoteYamlString = (value) => {
    if (value === '') return '""';
    if (/^[A-Za-z0-9_.\- /()]+$/.test(value)) return value;
    return JSON.stringify(value);
};

const formatScalar = (value) => {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return quoteYamlString(String(value));
};

const formatKey = (key) => {
    return /^[A-Za-z0-9_\-]+$/.test(String(key)) ? String(key) : JSON.stringify(String(key));
};

export const toYaml = (value, indent = 0) => {
    const prefix = ' '.repeat(indent);

    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        return value.map((item) => {
            if (isPlainObject(item) || Array.isArray(item)) {
                return `${prefix}-\n${toYaml(item, indent + 2)}`;
            }
            return `${prefix}- ${formatScalar(item)}`;
        }).join('\n');
    }

    if (isPlainObject(value)) {
        const entries = Object.entries(value);
        if (entries.length === 0) return '{}';

        return entries.map(([key, item]) => {
            if (isPlainObject(item) || Array.isArray(item)) {
                const rendered = toYaml(item, indent + 2);
                return rendered === '{}' || rendered === '[]'
                    ? `${prefix}${formatKey(key)}: ${rendered}`
                    : `${prefix}${formatKey(key)}:\n${rendered}`;
            }

            return `${prefix}${formatKey(key)}: ${formatScalar(item)}`;
        }).join('\n');
    }

    return `${prefix}${formatScalar(value)}`;
};

export default {
    createMalModelFromDiagram,
    createDiagramFromMalModel,
    toYaml
};
