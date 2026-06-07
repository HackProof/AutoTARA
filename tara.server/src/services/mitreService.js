const mitreRepository = require('../repositories/mitreRepository');

const getAdminTableDefinitions = async () => {
    return mitreRepository.getAdminTableDefinitions();
};

const listAdminTableRows = async (tableName, options) => {
    return mitreRepository.listAdminTableRows(tableName, options);
};

const createAdminTableRow = async (tableName, values) => {
    return mitreRepository.createAdminTableRow(tableName, values);
};

const updateAdminTableRow = async (tableName, key, values) => {
    return mitreRepository.updateAdminTableRow(tableName, key, values);
};

const deleteAdminTableRow = async (tableName, key) => {
    return mitreRepository.deleteAdminTableRow(tableName, key);
};

const stripMalComments = (content) => {
    let result = '';
    let inBlockComment = false;
    let inString = false;

    for (let index = 0; index < content.length; index += 1) {
        const char = content[index];
        const next = content[index + 1];

        if (inBlockComment) {
            if (char === '*' && next === '/') {
                inBlockComment = false;
                index += 1;
            }
            continue;
        }

        if (!inString && char === '/' && next === '*') {
            inBlockComment = true;
            index += 1;
            continue;
        }

        if (!inString && char === '/' && next === '/') {
            while (index < content.length && content[index] !== '\n') {
                index += 1;
            }
            result += '\n';
            continue;
        }

        if (char === '"' && content[index - 1] !== '\\') {
            inString = !inString;
        }

        result += char;
    }

    return result;
};

const countChar = (value, char) => (value.match(new RegExp(`\\${char}`, 'g')) || []).length;

const parseMalAttackSteps = (content) => {
    const cleaned = stripMalComments(content || '');
    const lines = cleaned.split(/\r?\n/);
    const assets = [];
    let currentCategory = '';
    let pendingAsset = null;
    let activeAsset = null;
    let assetBraceDepth = 0;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const categoryMatch = trimmed.match(/^category\s+([A-Za-z_][\w]*)\s*\{/);
        if (!activeAsset && categoryMatch) {
            currentCategory = categoryMatch[1];
            continue;
        }

        if (!activeAsset) {
            const assetMatch = trimmed.match(/^(?:abstract\s+)?asset\s+([A-Za-z_][\w]*)(?:\s+extends\s+([A-Za-z_][\w]*))?/);
            if (assetMatch) {
                pendingAsset = {
                    category: currentCategory,
                    asset: assetMatch[1],
                    parent: assetMatch[2] || '',
                    attackSteps: []
                };
            }

            if (pendingAsset && trimmed.includes('{')) {
                activeAsset = pendingAsset;
                pendingAsset = null;
                assetBraceDepth = countChar(trimmed, '{') - countChar(trimmed, '}');
                if (assetBraceDepth <= 0) {
                    assets.push(activeAsset);
                    activeAsset = null;
                }
            }

            continue;
        }

        const stepMatch = trimmed.match(/^[|&#]\s*([A-Za-z_][\w]*)/);
        if (stepMatch) {
            activeAsset.attackSteps.push({
                step_name: stepMatch[1],
                kind: trimmed[0],
                hidden: /\s@hidden\b/.test(trimmed)
            });
        }

        assetBraceDepth += countChar(trimmed, '{') - countChar(trimmed, '}');
        if (assetBraceDepth <= 0) {
            assets.push(activeAsset);
            activeAsset = null;
            assetBraceDepth = 0;
        }
    }

    if (activeAsset) {
        assets.push(activeAsset);
    }

    return assets.map((asset) => ({
        ...asset,
        attackSteps: asset.attackSteps.filter((step, index, allSteps) =>
            allSteps.findIndex((candidate) => candidate.step_name === step.step_name) === index
        )
    }));
};

const parseMalFile = async ({ originalName, buffer }) => {
    if (!buffer) {
        const error = new Error('MAL file is required');
        error.status = 400;
        throw error;
    }

    const content = buffer.toString('utf8');
    const assets = parseMalAttackSteps(content);

    return {
        fileName: originalName || 'uploaded.mal',
        assetCount: assets.length,
        attackStepCount: assets.reduce((sum, asset) => sum + asset.attackSteps.length, 0),
        assets
    };
};

const getMitreTechniques = async () => {
    return await mitreRepository.getMitreTechniques();
};

const getMitreCountermeasures = async () => {
    const rows =  await mitreRepository.getMitreCountermeasures();
    return rows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description
    }));
}

const getTechniqueMappingByAttackStep = async (assetType, stepName) => {
    return await mitreRepository.getTechniqueMappingByAttackStep({ assetType, stepName });
}

const getMitreTechniqueById = async (id) => {
    return await mitreRepository.getMitreTechniqueById(id);
}

const searchMitreThreatsByStencil = async (stencilId) => {
    return await mitreRepository.searchMitreThreatsByStencil(stencilId);
}

const getMitigationsByTechniqueId = async (techniqueId) => {
    return await mitreRepository.getMitigationsByTechniqueId(techniqueId);
}

const getTtpScoringReasonByTechniqueId = async (techniqueId) => {
    return await mitreRepository.getTtpScoringReasonByTechniqueId(techniqueId);
}

module.exports = {
    getAdminTableDefinitions,
    listAdminTableRows,
    createAdminTableRow,
    updateAdminTableRow,
    deleteAdminTableRow,
    parseMalFile,
    getMitreTechniques,
    getMitreCountermeasures,
    getTechniqueMappingByAttackStep,
    getMitreTechniqueById,
    searchMitreThreatsByStencil,
    getMitigationsByTechniqueId,
    getTtpScoringReasonByTechniqueId
}
