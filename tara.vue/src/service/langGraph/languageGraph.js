import { v4 as uuidv4 } from 'uuid';

const RESERVED_KEYS = new Set(['metadata']);

const asArray = (value) => {
    if (!value) return [];
    return Array.isArray(value) ? value : Object.values(value);
};

const getInfoText = (info = {}) => {
    return info.user || info.modeler || info.developer || '';
};

const getTtcValue = (ttc) => {
    if (!ttc) return 0;

    if (typeof ttc === 'number') return ttc;

    if (ttc.type === 'function' && ttc.name === 'Exponential') {
        const rate = Number(ttc.arguments?.[0]);
        if (Number.isFinite(rate) && rate > 0) return 1 / rate;
    }

    return 0;
};

const normalizeAssociation = (fieldName, association = {}) => ({
    fieldName,
    name: association.name || fieldName,
    info: association.info || {},
    description: getInfoText(association.info) || association.description || '',
    left: association.left || null,
    right: association.right || null
});

const normalizeAssociations = (associations = {}) => {
    if (Array.isArray(associations)) {
        return associations.map((association) => (
            normalizeAssociation(association.fieldName || association.name, association)
        ));
    }

    return Object.entries(associations).map(([fieldName, association]) => (
        normalizeAssociation(fieldName, association)
    ));
};

const normalizeAttackStep = (stepName, step = {}, assetName) => ({
    name: step.name || stepName,
    type: step.type || '',
    asset: step.asset || assetName,
    ttc: step.ttc || null,
    info: step.info || {},
    description: getInfoText(step.info) || step.description || '',
    tags: step.tags || [],
    own_children: step.own_children || step.ownChildren || {},
    own_parents: step.own_parents || step.ownParents || {},
    overrides: step.overrides === true,
    inherits: step.inherits || null,
    requires: step.requires || [],
    detectors: step.detectors || {}
});

const normalizeAttackSteps = (attackSteps = {}, assetName) => {
    if (Array.isArray(attackSteps)) {
        return attackSteps.map((step) => (
            normalizeAttackStep(step.name, step, step.asset || assetName)
        ));
    }

    return Object.entries(attackSteps).map(([stepName, step]) => (
        normalizeAttackStep(stepName, step, assetName)
    ));
};

const normalizeAsset = (assetName, asset = {}) => {
    const associations = normalizeAssociations(asset.associations || {});
    const attackSteps = normalizeAttackSteps(
        asset.attack_steps || asset.attackSteps || [],
        asset.name || assetName
    );

    return {
        name: asset.name || assetName,
        info: asset.info || {},
        description: getInfoText(asset.info) || asset.description || '',
        isAbstract: asset.is_abstract === true || asset.isAbstract === true,
        superAsset: asset.super_asset || asset.superAsset || '',
        subAssets: asset.sub_assets || asset.subAssets || [],
        variables: asset.variables || {},
        dfdShape: asset.dfdShape || 'process',
        associations,
        attackSteps
    };
};

const normalizeFromTopLevelAssets = (languageGraph) => {
    if (Array.isArray(languageGraph.assets)) {
        return languageGraph.assets.map((asset) => normalizeAsset(asset.name, asset));
    }

    if (languageGraph.assets && typeof languageGraph.assets === 'object') {
        return Object.entries(languageGraph.assets).map(([assetName, asset]) => normalizeAsset(assetName, asset));
    }

    return Object.entries(languageGraph)
        .filter(([key, value]) => !RESERVED_KEYS.has(key) && value && typeof value === 'object')
        .filter(([, value]) => value.associations || value.attack_steps || value.attackSteps)
        .map(([assetName, asset]) => normalizeAsset(assetName, asset));
};

export const normalizeLanguageGraph = (languageGraph, fileName = '') => {
    if (!languageGraph) {
        return {
            fileName,
            metadata: {},
            assets: []
        };
    }

    const assetMap = new Map(
        normalizeFromTopLevelAssets(languageGraph).map((asset) => [asset.name, asset])
    );

    const getRootCategory = (asset) => {
        let current = asset;
        const visited = new Set([asset.name]);

        while (
            current?.superAsset
            && assetMap.has(current.superAsset)
            && !visited.has(current.superAsset)
        ) {
            visited.add(current.superAsset);
            current = assetMap.get(current.superAsset);
        }

        return current?.name || asset.name;
    };

    const assets = Array.from(assetMap.values())
        .map((asset) => ({
            ...asset,
            category: getRootCategory(asset)
        }))
        .sort((left, right) => left.name.localeCompare(right.name));

    return {
        fileName,
        metadata: languageGraph.metadata || {},
        assets
    };
};

const isSerializedLanguageGraph = (languageGraph) => {
    if (!languageGraph || typeof languageGraph !== 'object') return false;
    if (Array.isArray(languageGraph.assets)) return false;
    return Object.values(languageGraph).some((value) =>
        value
        && typeof value === 'object'
        && (value.attack_steps || value.attackSteps || value.associations)
    );
};

const infoFromDescription = (description) => (
    description ? { user: description } : {}
);

const normalizeSerializedAssociationField = (field = {}) => ({
    asset: field.asset || '',
    fieldname: field.fieldname || field.fieldName || field.name || '',
    min: Number.isFinite(Number(field.min ?? field.minimum)) ? Number(field.min ?? field.minimum) : 0,
    max: Number.isFinite(Number(field.max ?? field.maximum)) ? Number(field.max ?? field.maximum) : 1
});

const serializeAssociationForMalsim = (association) => {
    if (!association?.left?.asset || !association?.right?.asset) return null;
    return {
        name: association.name || association.fieldName || association.fieldname || '',
        info: association.info || infoFromDescription(association.description),
        left: normalizeSerializedAssociationField(association.left),
        right: normalizeSerializedAssociationField(association.right)
    };
};

const serializeAttackStepForMalsim = (step, assetName) => {
    const stepName = step.name || step.attackStep || '';
    if (!stepName) return null;
    return {
        name: stepName,
        type: step.type || 'or',
        asset: step.asset || assetName,
        ttc: step.ttc || {},
        own_children: step.own_children || step.ownChildren || {},
        own_parents: step.own_parents || step.ownParents || {},
        info: step.info || infoFromDescription(step.description),
        overrides: step.overrides === true,
        inherits: step.inherits || null,
        tags: step.tags || [],
        detectors: step.detectors || {}
    };
};

export const createLanguageGraphSourceForMalsim = (languageGraph) => {
    if (!languageGraph) return null;
    if (isSerializedLanguageGraph(languageGraph)) return languageGraph;

    const normalized = normalizeLanguageGraph(languageGraph, languageGraph.fileName || '');
    if (!normalized.assets.length) return null;

    return normalized.assets.reduce((serialized, asset) => {
        const associations = {};
        (asset.associations || []).forEach((association) => {
            const serializedAssociation = serializeAssociationForMalsim(association);
            if (!serializedAssociation?.left?.fieldname || !serializedAssociation?.right?.fieldname) return;
            associations[association.fieldName || association.fieldname || serializedAssociation.name] = serializedAssociation;
        });

        const attackSteps = {};
        (asset.attackSteps || []).forEach((step) => {
            const serializedStep = serializeAttackStepForMalsim(step, asset.name);
            if (!serializedStep) return;
            attackSteps[serializedStep.name] = serializedStep;
        });

        serialized[asset.name] = {
            name: asset.name,
            associations,
            attack_steps: attackSteps,
            info: asset.info || infoFromDescription(asset.description),
            super_asset: asset.superAsset || '',
            sub_assets: asset.subAssets || [],
            variables: asset.variables || {},
            is_abstract: asset.isAbstract === true
        };

        return serialized;
    }, { metadata: normalized.metadata || {} });
};

export const getConcreteAssets = (languageGraph) => {
    return asArray(languageGraph?.assets).filter((asset) => !asset.isAbstract);
};

export const getAssets = (languageGraph) => asArray(languageGraph?.assets);

export const getAssetByName = (languageGraph, assetType) => {
    return getAssets(languageGraph).find((asset) => asset.name === assetType);
};

export const getAssetLineage = (languageGraph, assetType) => {
    const assets = new Map(getAssets(languageGraph).map((asset) => [asset.name, asset]));
    const lineage = [];
    let current = assets.get(assetType);
    const visited = new Set();

    while (current && !visited.has(current.name)) {
        lineage.push(current);
        visited.add(current.name);
        current = current.superAsset ? assets.get(current.superAsset) : null;
    }

    return lineage;
};

const toGroupName = (category) => {
    const slug = category
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase();

    return `langgraph-${slug || 'assets'}`;
};

export const getAssetCategoryGroups = (languageGraph) => {
    const grouped = getConcreteAssets(languageGraph).reduce((result, asset) => {
        const category = asset.category || asset.superAsset || asset.name;
        if (!result.has(category)) {
            result.set(category, []);
        }
        result.get(category).push(asset);
        return result;
    }, new Map());

    return Array.from(grouped.entries())
        .map(([category, assets]) => ({
            name: toGroupName(category),
            title: category,
            assets: assets.sort((left, right) => left.name.localeCompare(right.name))
        }))
        .sort((left, right) => left.title.localeCompare(right.title));
};

export const buildThreatsFromAttackSteps = (asset) => {
    return asArray(asset?.attackSteps)
        .filter((step) => step.type !== 'defense')
        .map((step, index) => ({
            id: uuidv4(),
            number: index + 1,
            attackStep: step.name,
            mitre_id: '',
            mitre_name: '',
            technique: step.name,
            status: 'open',
            description: step.description,
            riskScore: '3.3',
            new: false,
            ttc: getTtcValue(step.ttc),
            ttp_score: [],
            cve: [],
            selectedCMs: [],
            source: asset.name
        }));
};

export const createLangGraphAssetData = (asset, includeThreats = true) => {
    const threats = includeThreats ? buildThreatsFromAttackSteps(asset) : [];
    const dfdShape = asset.dfdShape || 'process';
    const typeByShape = {
        actor: 'tm.Actor',
        process: 'tm.Process',
        store: 'tm.Store'
    };

    return {
        type: typeByShape[dfdShape] || 'tm.Process',
        name: asset.name,
        description: asset.description || `${asset.name} asset`,
        isTrustBoundary: false,
        isEntry: false,
        isTarget: false,
        outOfScope: false,
        reasonOutOfScope: '',
        hasOpenThreats: threats.length > 0,
        threats,
        malInfo: {
            source: 'LanguageGraph',
            assetType: asset.name,
            dfdShape,
            associations: asset.associations,
            category: asset.category,
            attackSteps: asset.attackSteps.map((step) => ({
                name: step.name,
                type: step.type,
                ttc: step.ttc,
                description: step.description,
                tags: step.tags
            })),
            subAssets: asset.subAssets
        }
    };
};

const getAssociationField = (association) => {
    return association.left?.fieldname === association.fieldName
        ? association.left
        : association.right?.fieldname === association.fieldName
            ? association.right
            : null;
};

const associationTargetsLineage = (association, targetLineageNames) => {
    const field = getAssociationField(association);

    if (field) {
        return targetLineageNames.has(field.asset);
    }

    return targetLineageNames.has(association.left?.asset)
        || targetLineageNames.has(association.right?.asset);
};

export const findAssociationsBetween = (languageGraph, sourceAssetType, targetAssetType) => {
    const sourceLineage = getAssetLineage(languageGraph, sourceAssetType);
    const targetLineageNames = new Set(
        getAssetLineage(languageGraph, targetAssetType).map((asset) => asset.name)
    );

    if (!sourceLineage.length || !targetLineageNames.size) return [];

    return sourceLineage.flatMap((asset) => {
        return asset.associations
            .filter((association) => associationTargetsLineage(association, targetLineageNames))
            .map((association) => ({
                ...association,
                inheritedFrom: asset.name === sourceAssetType ? null : asset.name
            }));
    });
};

export const isAssetTypeAssignableTo = (languageGraph, assetType, expectedType) => {
    return getAssetLineage(languageGraph, assetType).some((asset) => asset.name === expectedType);
};

export const findAssociationsFromField = (languageGraph, ownerAssetType, targetAssetType, fieldName) => {
    return findAssociationsBetween(languageGraph, ownerAssetType, targetAssetType).filter((association) => {
        if (association.fieldName !== fieldName) return false;
        const field = association.left?.fieldname === association.fieldName
            ? association.left
            : association.right?.fieldname === association.fieldName
                ? association.right
                : null;

        return !field || isAssetTypeAssignableTo(languageGraph, targetAssetType, field.asset);
    });
};

export const findAssociationMatches = (languageGraph, sourceAssetType, targetAssetType) => {
    const forward = findAssociationsBetween(languageGraph, sourceAssetType, targetAssetType).map((association) => ({
        ...association,
        associationOwner: 'source'
    }));

    const reverse = findAssociationsBetween(languageGraph, targetAssetType, sourceAssetType).map((association) => ({
        ...association,
        associationOwner: 'target'
    }));

    return [...forward, ...reverse];
};

export const hasAssociationBetween = (languageGraph, sourceAssetType, targetAssetType) => {
    return findAssociationMatches(languageGraph, sourceAssetType, targetAssetType).length > 0;
};

export const applyAssociationToEdge = (edge, graph, languageGraph) => {
    const sourceId = edge.getSourceCellId?.() || edge.getSource()?.cell;
    const targetId = edge.getTargetCellId?.() || edge.getTarget()?.cell;
    if (!sourceId || !targetId) return false;

    const source = graph.getCellById(sourceId);
    const target = graph.getCellById(targetId);
    const sourceType = source?.getData()?.malInfo?.assetType;
    const targetType = target?.getData()?.malInfo?.assetType;
    if (!sourceType || !targetType) return false;

    const candidates = findAssociationMatches(languageGraph, sourceType, targetType);
    if (!candidates.length) return false;

    const selected = candidates[0];
    const ownerType = selected.associationOwner === 'source' ? sourceType : targetType;
    const associatedType = selected.associationOwner === 'source' ? targetType : sourceType;
    const edgeData = {
        ...edge.getData(),
        name: selected.name,
        description: selected.description || `${ownerType}.${selected.fieldName} -> ${associatedType}`,
        malInfo: {
            source: 'LanguageGraph',
            associationType: 'association',
            associationName: selected.name,
            fieldName: selected.fieldName,
            associationOwner: selected.associationOwner,
            sourceAssetType: sourceType,
            targetAssetType: targetType,
            possibleAssociations: candidates
        }
    };

    edge.setData(edgeData);
    if (edge.setName) {
        edge.setName(selected.name);
    } else {
        edge.setLabels([selected.name]);
    }

    return true;
};

export const createEmptyThreatModelFromLanguageGraph = (form, languageGraph, fileName = '') => ({
    version: form.version || languageGraph?.metadata?.version || '1.0.0',
    modelInfo: {
        title: form.title,
        version: form.version || languageGraph?.metadata?.version || '',
        template: languageGraph ? 'langgraph' : 'manual',
        description: form.description
    },
    diagrams: {
        cells: []
    },
    threatCounter: 0,
    languageGraph: languageGraph ? normalizeLanguageGraph(languageGraph, fileName) : null,
    languageGraphSource: languageGraph || null
});

export default {
    normalizeLanguageGraph,
    getConcreteAssets,
    getAssets,
    getAssetByName,
    getAssetLineage,
    getAssetCategoryGroups,
    buildThreatsFromAttackSteps,
    createLangGraphAssetData,
    findAssociationsBetween,
    findAssociationsFromField,
    findAssociationMatches,
    hasAssociationBetween,
    isAssetTypeAssignableTo,
    applyAssociationToEdge,
    createEmptyThreatModelFromLanguageGraph,
    createLanguageGraphSourceForMalsim
};
