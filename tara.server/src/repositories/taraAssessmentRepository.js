const db = require('../config/db');

const createAssessment = async (data) => {
    const query = `
        INSERT INTO tara.tara_assessments
            (session_id, entry_asset, target_asset, cia_attribute, damage_scenario,
             impact_category, threat_scenario, attack_path, attack_feasibility,
             impact_rating, risk_treatment, cal_rating)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
    `;
    const values = [
        data.session_id,
        data.entry_asset,
        data.target_asset,
        data.cia_attribute,
        data.damage_scenario,
        data.impact_category,
        data.threat_scenario,
        JSON.stringify(data.attack_path),
        data.attack_feasibility || null,
        data.impact_rating || null,
        data.risk_treatment || null,
        data.cal_rating || null
    ];
    const { rows } = await db.query(query, values);
    return rows[0];
};

const createAssessments = async (assessments) => {
    const results = [];
    for (const data of assessments) {
        const result = await createAssessment(data);
        results.push(result);
    }
    return results;
};

const getAllAssessments = async () => {
    const query = `
        SELECT * FROM tara.tara_assessments
        ORDER BY created_at DESC
    `;
    const { rows } = await db.query(query);
    return rows;
};

const getAssessmentsBySessionId = async (sessionId) => {
    const query = `
        SELECT * FROM tara.tara_assessments
        WHERE session_id = $1
        ORDER BY id ASC
    `;
    const { rows } = await db.query(query, [sessionId]);
    return rows;
};

const getAssessmentById = async (id) => {
    const query = `SELECT * FROM tara.tara_assessments WHERE id = $1`;
    const { rows } = await db.query(query, [id]);
    return rows[0];
};

const updateAssessment = async (id, data) => {
    const query = `
        UPDATE tara.tara_assessments
        SET attack_feasibility = COALESCE($1, attack_feasibility),
            impact_rating = COALESCE($2, impact_rating),
            risk_treatment = COALESCE($3, risk_treatment),
            cal_rating = COALESCE($4, cal_rating),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $5
        RETURNING *
    `;
    const values = [
        data.attack_feasibility,
        data.impact_rating,
        data.risk_treatment,
        data.cal_rating,
        id
    ];
    const { rows } = await db.query(query, values);
    return rows[0];
};

const updateAssessmentAttackPath = async (id, attackPath) => {
    const query = `
        UPDATE tara.tara_assessments
        SET attack_path = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *
    `;
    const values = [
        JSON.stringify(attackPath),
        id
    ];
    const { rows } = await db.query(query, values);
    return rows[0];
};

const deleteAssessment = async (id) => {
    const query = `DELETE FROM tara.tara_assessments WHERE id = $1 RETURNING *`;
    const { rows } = await db.query(query, [id]);
    return rows[0];
};

const deleteAssessmentsBySessionId = async (sessionId) => {
    const query = `DELETE FROM tara.tara_assessments WHERE session_id = $1 RETURNING *`;
    const { rows } = await db.query(query, [sessionId]);
    return rows;
};

module.exports = {
    createAssessment,
    createAssessments,
    getAllAssessments,
    getAssessmentsBySessionId,
    getAssessmentById,
    updateAssessment,
    updateAssessmentAttackPath,
    deleteAssessment,
    deleteAssessmentsBySessionId
};
