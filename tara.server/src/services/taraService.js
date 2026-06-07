const taraRepository = require('../repositories/taraRepository');

const getAssetDescription = async (assetName) => {
    return await taraRepository.getAssetDescription(assetName);
};

module.exports = {
    getAssetDescription,
}