const db = require('../config/db');

const getAssetDescription = async (assetName) => {
    const query = `
        SELECT description
        FROM mitre.dfds
        WHERE name ILIKE $1
        `;
    const { rows } = await db.query(query, [assetName]);
    return rows[0]?.description;
}

module.exports = {
    getAssetDescription,
};