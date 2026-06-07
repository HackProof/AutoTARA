const taraService = require('../services/taraService');

const getAssetDescription = async (req, res) => {
    try {
        const { id } = req.params;
        const description = await taraService.getAssetDescription(id);
        if (description) {
            res.json({ id, description });
        } else {
            res.status(404).json({ message: 'Asset not found' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error' });
    }
}

module.exports = {
    getAssetDescription
}