const db = require('../config/db');

const tableConfigs = {
    dfd_techniques: {
        table: 'mitre.dfd_techniques',
        primaryKey: ['id'],
        identityColumns: ['id'],
        orderBy: 'id',
        searchColumns: ['category', 'asset', 'parent', 'step_name', 'inferred_tactic', 'technique_id', 'technique_name'],
        columns: [
            { name: 'id', sql: 'id', type: 'number', readonly: true },
            { name: 'category', sql: 'category', required: true },
            { name: 'asset', sql: 'asset', required: true },
            { name: 'parent', sql: 'parent', emptyAsNull: false },
            { name: 'step_name', sql: 'step_name', required: true },
            { name: 'inferred_tactic_id', sql: 'inferred_tactic_id' },
            { name: 'inferred_tactic', sql: 'inferred_tactic' },
            { name: 'technique_id', sql: 'technique_id', required: true },
            { name: 'technique_name', sql: 'technique_name', required: true },
            { name: 'technique_tactics', sql: 'technique_tactics' },
            { name: 'created_at', sql: 'created_at', type: 'datetime', readonly: true },
            { name: 'updated_at', sql: 'updated_at', type: 'datetime', readonly: true }
        ]
    },
    techniques: {
        table: 'mitre.techniques',
        aliases: ['technique'],
        primaryKey: ['id'],
        orderBy: 'id',
        searchColumns: ['id', 'name', 'description'],
        columns: [
            { name: 'id', sql: 'id', required: true },
            { name: 'name', sql: 'name', required: true },
            { name: 'description', sql: 'description', type: 'textarea' },
            { name: 'created_at', sql: 'created_at', type: 'datetime', readonly: true },
            { name: 'updated_at', sql: 'updated_at', type: 'datetime', readonly: true }
        ]
    },
    mitigations: {
        table: 'mitre.mitigations',
        aliases: ['mitigation'],
        primaryKey: ['id'],
        orderBy: 'id',
        searchColumns: ['id', 'name', 'description'],
        columns: [
            { name: 'id', sql: 'id', required: true },
            { name: 'name', sql: 'name', required: true },
            { name: 'description', sql: 'description', type: 'textarea' },
            { name: 'created_at', sql: 'created_at', type: 'datetime', readonly: true },
            { name: 'updated_at', sql: 'updated_at', type: 'datetime', readonly: true }
        ]
    },
    mitigation_technique: {
        table: 'mitre.mitigation_technique',
        primaryKey: ['mitigation_id', 'technique_id'],
        orderBy: 'mitigation_id, technique_id',
        searchColumns: ['mitigation_id', 'technique_id', 'm_description'],
        columns: [
            { name: 'mitigation_id', sql: 'mitigation_id', required: true },
            { name: 'technique_id', sql: 'technique_id', required: true },
            { name: 'm_description', sql: 'm_description', type: 'textarea' },
            { name: 'created_at', sql: 'created_at', type: 'datetime', readonly: true }
        ]
    },
    ttp_scoring: {
        table: 'mitre.ttp_scoring',
        primaryKey: ['technique_id'],
        orderBy: 'technique_id',
        searchColumns: ['technique_id'],
        columns: [
            { name: 'technique_id', sql: 'technique_id', required: true },
            { name: 'Proximity', sql: '"Proximity"', type: 'number' },
            { name: 'Locality', sql: '"Locality"', type: 'number' },
            { name: 'Restoration Costs', sql: '"Restoration Costs"', type: 'number' },
            { name: 'Impact_C', sql: '"Impact_C"', type: 'number' },
            { name: 'Impact_I', sql: '"Impact_I"', type: 'number' },
            { name: 'Impact_A', sql: '"Impact_A"', type: 'number' },
            { name: 'Prior Use', sql: '"Prior Use"', type: 'number' },
            { name: 'Required Skills', sql: '"Required Skills"', type: 'number' },
            { name: 'Required Resources', sql: '"Required Resources"', type: 'number' },
            { name: 'Stealth', sql: '"Stealth"', type: 'number' },
            { name: 'Attribution', sql: '"Attribution"', type: 'number' },
            { name: 'created_at', sql: 'created_at', type: 'datetime', readonly: true },
            { name: 'updated_at', sql: 'updated_at', type: 'datetime', readonly: true }
        ]
    },
    ttp_scoring_reason: {
        table: 'mitre.ttp_scoring_reason',
        primaryKey: ['technique_id'],
        orderBy: 'technique_id',
        searchColumns: ['technique_id', 'reason_proximity', 'reason_locality', 'reason_restoration_costs', 'reason_impact_c', 'reason_impact_i', 'reason_impact_a', 'reason_prior_use', 'reason_required_skills', 'reason_required_resources', 'reason_stealth', 'reason_attribution'],
        columns: [
            { name: 'technique_id', sql: 'technique_id', required: true },
            { name: 'reason_proximity', sql: 'reason_proximity', type: 'textarea' },
            { name: 'reason_locality', sql: 'reason_locality', type: 'textarea' },
            { name: 'reason_restoration_costs', sql: 'reason_restoration_costs', type: 'textarea' },
            { name: 'reason_impact_c', sql: 'reason_impact_c', type: 'textarea' },
            { name: 'reason_impact_i', sql: 'reason_impact_i', type: 'textarea' },
            { name: 'reason_impact_a', sql: 'reason_impact_a', type: 'textarea' },
            { name: 'reason_prior_use', sql: 'reason_prior_use', type: 'textarea' },
            { name: 'reason_required_skills', sql: 'reason_required_skills', type: 'textarea' },
            { name: 'reason_required_resources', sql: 'reason_required_resources', type: 'textarea' },
            { name: 'reason_stealth', sql: 'reason_stealth', type: 'textarea' },
            { name: 'reason_attribution', sql: 'reason_attribution', type: 'textarea' },
            { name: 'created_at', sql: 'created_at', type: 'datetime', readonly: true },
            { name: 'updated_at', sql: 'updated_at', type: 'datetime', readonly: true }
        ]
    }
};

const tableAliasMap = Object.entries(tableConfigs).reduce((acc, [key, config]) => {
    acc[key] = key;
    (config.aliases || []).forEach((alias) => {
        acc[alias] = key;
    });
    return acc;
}, {});

const resolveTableConfig = (tableName) => {
    const key = tableAliasMap[String(tableName || '').trim()];
    if (!key) {
        const error = new Error('Unsupported MITRE table');
        error.status = 400;
        throw error;
    }

    return { key, ...tableConfigs[key] };
};

const selectList = (config) =>
    config.columns.map((column) => `${column.sql} AS "${column.name}"`).join(', ');

const getColumn = (config, columnName) =>
    config.columns.find((column) => column.name === columnName);

const mutableColumns = (config, { includePrimaryKey = false } = {}) =>
    config.columns.filter((column) => {
        if (column.readonly) return false;
        if (config.identityColumns?.includes(column.name)) return false;
        if (!includePrimaryKey && config.primaryKey.includes(column.name)) return false;
        return true;
    });

const normalizeValue = (value, column) => {
    if (value === undefined) return undefined;
    if (value === '') return column.emptyAsNull === false ? '' : null;
    return value;
};

const appendWhereByKey = (config, key, values, startIndex = 1) => {
    const clauses = [];
    let index = startIndex;

    for (const keyName of config.primaryKey) {
        const column = getColumn(config, keyName);
        if (!column || key?.[keyName] === undefined || key?.[keyName] === null || key?.[keyName] === '') {
            const error = new Error(`Missing primary key field: ${keyName}`);
            error.status = 400;
            throw error;
        }

        clauses.push(`${column.sql} = $${index}`);
        values.push(key[keyName]);
        index += 1;
    }

    return clauses.join(' AND ');
};

const validateRequiredFields = (config, values) => {
    for (const column of config.columns) {
        if (!column.required) continue;
        if (column.readonly || config.identityColumns?.includes(column.name)) continue;
        if (values?.[column.name] === undefined || values?.[column.name] === null || values?.[column.name] === '') {
            const error = new Error(`Missing required field: ${column.name}`);
            error.status = 400;
            throw error;
        }
    }
};

const getAdminTableDefinitions = () => {
    return Object.entries(tableConfigs).map(([key, config]) => ({
        key,
        primaryKey: config.primaryKey,
        columns: config.columns
    }));
};

const listAdminTableRows = async (tableName, options = {}) => {
    const config = resolveTableConfig(tableName);
    const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 500);
    const offset = Math.max(Number(options.offset) || 0, 0);
    const values = [];
    const where = [];

    if (options.search && config.searchColumns?.length) {
        values.push(`%${options.search}%`);
        where.push(`(${config.searchColumns.map((columnName) => {
            const column = getColumn(config, columnName);
            return `${column.sql}::TEXT ILIKE $1`;
        }).join(' OR ')})`);
    }

    values.push(limit);
    const limitIndex = values.length;
    values.push(offset);
    const offsetIndex = values.length;

    const query = `
        SELECT ${selectList(config)}
        FROM ${config.table}
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY ${config.orderBy}
        LIMIT $${limitIndex}
        OFFSET $${offsetIndex}
    `;

    const countQuery = `
        SELECT COUNT(*)::INT AS count
        FROM ${config.table}
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    `;

    const [rowsResult, countResult] = await Promise.all([
        db.query(query, values),
        db.query(countQuery, values.slice(0, values.length - 2))
    ]);

    return {
        table: config.key,
        limit,
        offset,
        total: countResult.rows[0]?.count || 0,
        rows: rowsResult.rows
    };
};

const createAdminTableRow = async (tableName, values = {}) => {
    const config = resolveTableConfig(tableName);
    validateRequiredFields(config, values);

    const columns = mutableColumns(config, { includePrimaryKey: true })
        .filter((column) => values[column.name] !== undefined);

    if (!columns.length) {
        const error = new Error('No writable fields supplied');
        error.status = 400;
        throw error;
    }

    const queryValues = columns.map((column) => normalizeValue(values[column.name], column));
    const query = `
        INSERT INTO ${config.table} (${columns.map((column) => column.sql).join(', ')})
        VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})
        RETURNING ${selectList(config)}
    `;

    const { rows } = await db.query(query, queryValues);
    return rows[0];
};

const updateAdminTableRow = async (tableName, key, values = {}) => {
    const config = resolveTableConfig(tableName);
    const columns = mutableColumns(config)
        .filter((column) => values[column.name] !== undefined);

    if (!columns.length) {
        const error = new Error('No writable fields supplied');
        error.status = 400;
        throw error;
    }

    const queryValues = columns.map((column) => normalizeValue(values[column.name], column));
    const assignments = columns.map((column, index) => `${column.sql} = $${index + 1}`);
    const updatedAtColumn = getColumn(config, 'updated_at');

    if (updatedAtColumn) {
        assignments.push(`${updatedAtColumn.sql} = CURRENT_TIMESTAMP`);
    }

    const where = appendWhereByKey(config, key, queryValues, queryValues.length + 1);
    const query = `
        UPDATE ${config.table}
        SET ${assignments.join(', ')}
        WHERE ${where}
        RETURNING ${selectList(config)}
    `;

    const { rows } = await db.query(query, queryValues);
    return rows[0] || null;
};

const deleteAdminTableRow = async (tableName, key) => {
    const config = resolveTableConfig(tableName);
    const queryValues = [];
    const where = appendWhereByKey(config, key, queryValues);
    const query = `
        DELETE FROM ${config.table}
        WHERE ${where}
        RETURNING ${selectList(config)}
    `;

    const { rows } = await db.query(query, queryValues);
    return rows[0] || null;
};

const getMitreTechniques = async () => {
    const query = `select id, name from mitre.techniques`
    const { rows } = await db.query(query);
    return rows;
}

const getMitreCountermeasures = async () => {
    const query = `select id, name, description from mitre.mitigations`
    const { rows } = await db.query(query);
    return rows;
}

const getTechniqueMappingByAttackStep = async ({ assetType, stepName }) => {
    const query = `
        WITH RECURSIVE asset_lineage AS (
            SELECT
                $1::TEXT AS asset,
                0 AS depth

            UNION

            SELECT DISTINCT
                dt.parent AS asset,
                al.depth + 1 AS depth
            FROM
                asset_lineage al
                JOIN mitre.dfd_techniques dt
                    ON dt.asset = al.asset
            WHERE
                NULLIF(dt.parent, '') IS NOT NULL
                AND dt.parent <> al.asset
                AND al.depth < 10
        )
        SELECT
            dt.id,
            dt.category,
            dt.asset,
            dt.parent,
            dt.step_name,
            dt.inferred_tactic_id,
            dt.inferred_tactic,
            dt.technique_id,
            dt.technique_name,
            dt.technique_tactics,
            al.depth AS inheritance_depth
        FROM
            asset_lineage al
            JOIN mitre.dfd_techniques dt
                ON dt.asset = al.asset
        WHERE
            dt.step_name = $2
        ORDER BY
            al.depth ASC,
            dt.id ASC,
            dt.technique_id ASC
    `;
    const { rows } = await db.query(query, [assetType, stepName]);
    return rows;
}

const getMitreTechniqueById = async (id) => {
    const query = `
        SELECT
        -- [Technique 테이블]
        t.id,
        t.name,
        t.description,
        
        -- [TTP Scoring 테이블] (created, modified 제외)
        json_build_array(
                json_build_object('key', 'proximity',          'value', COALESCE(ts."Proximity", 0),          'weight', 0.1),
                json_build_object('key', 'locality',           'value', COALESCE(ts."Locality", 0),           'weight', 0.1),
                json_build_object('key', 'restorationCosts',   'value', COALESCE(ts."Restoration Costs", 0),  'weight', 0.1),
                json_build_object('key', 'Impact_C',           'value', COALESCE(ts."Impact_C", 0),           'weight', 0.1),
                json_build_object('key', 'Impact_I',           'value', COALESCE(ts."Impact_I", 0),           'weight', 0.1),
                json_build_object('key', 'Impact_A',           'value', COALESCE(ts."Impact_A", 0),           'weight', 0.1),
                json_build_object('key', 'Prior Use',          'value', COALESCE(ts."Prior Use", 0),          'weight', 0.1),
                json_build_object('key', 'Required Skills',    'value', COALESCE(ts."Required Skills", 0),    'weight', 0.1),
                json_build_object('key', 'Required Resources', 'value', COALESCE(ts."Required Resources", 0), 'weight', 0.1),
                json_build_object('key', 'Stealth',            'value', COALESCE(ts."Stealth", 0),            'weight', 0.1),
                json_build_object('key', 'Attribution',        'value', COALESCE(ts."Attribution", 0),        'weight', 0.1)
        ) AS ttp_scoring
    
    FROM
        mitre.techniques t
    LEFT JOIN
        mitre.ttp_scoring ts ON t.id = ts.technique_id
    WHERE
        t.id ILIKE $1;
    `
    const { rows } = await db.query(query, [id]);
    return rows[0];
}

const searchMitreThreatsByStencil = async (stencilId) => {
    const query = `
        SELECT
            t.id,
            t.name,
            t.description,
            json_build_array(
                    json_build_object('key', 'proximity',          'value', COALESCE(ts."Proximity", 0),          'weight', 0.1),
                    json_build_object('key', 'locality',           'value', COALESCE(ts."Locality", 0),           'weight', 0.1),
                    json_build_object('key', 'restorationCosts',   'value', COALESCE(ts."Restoration Costs", 0),  'weight', 0.1),
                    json_build_object('key', 'Impact_C',           'value', COALESCE(ts."Impact_C", 0),           'weight', 0.1),
                    json_build_object('key', 'Impact_I',           'value', COALESCE(ts."Impact_I", 0),           'weight', 0.1),
                    json_build_object('key', 'Impact_A',           'value', COALESCE(ts."Impact_A", 0),           'weight', 0.1),
                    json_build_object('key', 'Prior Use',          'value', COALESCE(ts."Prior Use", 0),          'weight', 0.1),
                    json_build_object('key', 'Required Skills',    'value', COALESCE(ts."Required Skills", 0),    'weight', 0.1),
                    json_build_object('key', 'Required Resources', 'value', COALESCE(ts."Required Resources", 0), 'weight', 0.1),
                    json_build_object('key', 'Stealth',            'value', COALESCE(ts."Stealth", 0),            'weight', 0.1),
                    json_build_object('key', 'Attribution',        'value', COALESCE(ts."Attribution", 0),        'weight', 0.1)
            ) AS ttp_scoring
        FROM
            mitre.dfds d
                JOIN
            mitre.dfd_technique dt ON d.id = dt.dfd_id
                JOIN
            mitre.techniques t ON dt.technique_id = t.id
                LEFT JOIN
            mitre.ttp_scoring ts ON t.id = ts.technique_id
        WHERE
            d.name ILIKE $1;
    `;
    const { rows } = await db.query(query, [stencilId]);
    return rows;
}

const getMitigationsByTechniqueId = async (techniqueId) => {
    const query = `
        SELECT
            mt.mitigation_id AS id,
            m.name,
            mt.m_description AS description
        FROM
            mitre.mitigation_technique mt
                JOIN
            mitre.mitigations m ON mt.mitigation_id = m.id
        WHERE
            mt.technique_id = $1
    `;

    const { rows } = await db.query(query, [techniqueId]);
    return rows;
};

const getTtpScoringReasonByTechniqueId = async (techniqueId) => {
    const query = `
        SELECT 
            reason_proximity AS "proximity",
            reason_locality AS "locality",
            reason_restoration_costs AS "restorationCosts",
            reason_impact_c AS "Impact_C",
            reason_impact_i AS "impact_I",
            reason_impact_a AS "impact_A",
            reason_prior_use AS "Prior Use",
            reason_required_skills AS "Required Skills",
            reason_required_resources AS "Required Resources",
            reason_stealth AS "Stealth",
            reason_attribution AS "Attribution"
        FROM 
            mitre.ttp_scoring_reason
        WHERE 
            technique_id = $1
    `;

    const { rows } = await db.query(query, [techniqueId]);

    // 결과가 있으면 첫 번째 객체 반환, 없으면 null
    return rows.length > 0 ? rows[0] : null;
};

module.exports = {
    getAdminTableDefinitions,
    listAdminTableRows,
    createAdminTableRow,
    updateAdminTableRow,
    deleteAdminTableRow,
    getMitreTechniques,
    getMitreCountermeasures,
    getTechniqueMappingByAttackStep,
    getMitreTechniqueById,
    searchMitreThreatsByStencil,
    getMitigationsByTechniqueId,
    getTtpScoringReasonByTechniqueId
};
