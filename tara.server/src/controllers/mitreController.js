const mitreService = require('../services/mitreService');

const handleError = (res, err) => {
    console.error(err);
    res.status(err.status || 500).json({ message: err.message || 'Server Error' });
};

const getAdminTableDefinitions = async (req, res) => {
    try {
        const data = await mitreService.getAdminTableDefinitions();
        res.json(data);
    } catch (err) {
        handleError(res, err);
    }
};

const listAdminTableRows = async (req, res) => {
    const { table } = req.params;
    try {
        const data = await mitreService.listAdminTableRows(table, req.query);
        res.json(data);
    } catch (err) {
        handleError(res, err);
    }
};

const createAdminTableRow = async (req, res) => {
    const { table } = req.params;
    try {
        const data = await mitreService.createAdminTableRow(table, req.body || {});
        res.status(201).json(data);
    } catch (err) {
        handleError(res, err);
    }
};

const updateAdminTableRow = async (req, res) => {
    const { table } = req.params;
    const { key, values } = req.body || {};

    try {
        const data = await mitreService.updateAdminTableRow(table, key, values);
        if (!data) {
            res.status(404).json({ message: 'Record not found' });
            return;
        }
        res.json(data);
    } catch (err) {
        handleError(res, err);
    }
};

const deleteAdminTableRow = async (req, res) => {
    const { table } = req.params;
    const { key } = req.body || {};

    try {
        const data = await mitreService.deleteAdminTableRow(table, key);
        if (!data) {
            res.status(404).json({ message: 'Record not found' });
            return;
        }
        res.json(data);
    } catch (err) {
        handleError(res, err);
    }
};

const parseMalFile = async (req, res) => {
    try {
        const data = await mitreService.parseMalFile({
            originalName: req.file?.originalname,
            buffer: req.file?.buffer
        });
        res.json(data);
    } catch (err) {
        handleError(res, err);
    }
};

const getMitreTechniques = async (req, res) => {
    try {
        const data = await mitreService.getMitreTechniques();
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error' });
    }
}

const getMitreCountermeasures = async (req, res) => {
    try {
        const data = await mitreService.getMitreCountermeasures();
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error' });
    }
}

const getTechniqueMappingByAttackStep = async (req, res) => {
    const { assetType, stepName } = req.query;

    if (!assetType || !stepName) {
        res.status(400).json({ message: 'assetType and stepName are required' });
        return;
    }

    try {
        const data = await mitreService.getTechniqueMappingByAttackStep(assetType, stepName);
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error' });
    }
}

const getMitreTechniqueById = async (req, res) => {
    const { id } = req.params;
    try {
        const data = await mitreService.getMitreTechniqueById(id);
        if (data) {
            res.json(data);
        } else {
            res.status(404).json({ message: 'Technique not found' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error' });
    }
}

const searchMitreThreatsByStencil = async (req, res) => {
    const { id } = req.params;
    try {
        const data = await mitreService.searchMitreThreatsByStencil(id);
        if (data) {
            res.json(data);
        } else {
            res.status(404).json({ message: 'No threats found for the given stencil ID' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error' });
    }
}

const getMitigationsByTechniqueId = async (req, res) => {
    const { id } = req.params;
    try {
        const data = await mitreService.getMitigationsByTechniqueId(id);
        if (data) {
            res.json(data);
        } else {
            res.status(404).json({message: 'No mitigations found for the given technique ID'});
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error' });
    }
}

const getTtpScoringReasonByTechniqueId = async (req, res) => {
    const { id } = req.params;
    try {
        const data = await mitreService.getTtpScoringReasonByTechniqueId(id);
        if (data) {
            res.json(data);
        } else {
            res.status(404).json({ message: 'No TTP score reasons found for the given technique ID' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error' });
    }
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
