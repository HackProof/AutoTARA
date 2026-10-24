// Only expose schemas containing the attack-step catalog contract. Source and
// unrelated application schemas never appear as language choices.
export async function findLangSchemas(database) {
  const { rows } = await database.query(`
    SELECT c.table_schema AS schema,
           EXISTS (
             SELECT FROM information_schema.columns p
             WHERE p.table_schema = c.table_schema AND p.table_name = 'attack_step_semantics'
               AND p.column_name IN ('attack_step_id', 'semantic_category', 'classification_reason',
                 'classification_source', 'classification_version', 'mapping_status_at_review',
                 'mitre_unmapped_reason_code', 'mitre_unmapped_reason')
             GROUP BY p.table_schema HAVING count(DISTINCT p.column_name) = 8
           ) AS has_step_semantics
    FROM information_schema.columns c
    WHERE table_name = 'v_attack_step_catalog'
      AND table_schema NOT IN ('pg_catalog', 'information_schema')
      AND column_name IN ('attack_step_id', 'asset', 'language', 'language_key',
                          'name', 'qualified_name', 'attack_step_type',
                          'hidden', 'auxiliary', 'definition', 'technique_mappings', 'extends_name')
    GROUP BY table_schema
    HAVING count(DISTINCT column_name) = 12
    ORDER BY table_schema
  `)
  return rows
}

function quoteIdentifier(schema) {
  return `"${schema.replaceAll('"', '""')}"`
}

export async function findAssetParents(database, schema) {
  const { rows } = await database.query(`
    SELECT DISTINCT asset, language_key, extends_name
    FROM ${quoteIdentifier(schema)}.v_attack_step_catalog
    ORDER BY asset, language_key
  `)
  return rows
}

export async function findAttackSteps(database, schema, assetTypes, includeSemantics = false) {
  // SQL identifiers cannot be parameters. Quote the discovered identifier;
  // asset names remain bound values, including MAL's case-sensitive names.
  const identifier = quoteIdentifier(schema)
  const { rows } = await database.query(
    `
    SELECT c.attack_step_id, c.asset, c.language, c.language_key, c.name, c.qualified_name,
           c.attack_step_type, c.hidden, c.auxiliary, c.definition, c.technique_mappings,
           to_jsonb(c)->'ctsa' AS ctsa, to_jsonb(c)->'abstract' AS abstract
           ${includeSemantics ? `, p.semantic_category, p.classification_reason,
             p.classification_source, p.classification_version, p.mapping_status_at_review,
             CASE WHEN jsonb_array_length(c.technique_mappings) = 0
               THEN p.mitre_unmapped_reason_code END AS mitre_unmapped_reason_code,
             CASE WHEN jsonb_array_length(c.technique_mappings) = 0
               THEN p.mitre_unmapped_reason END AS mitre_unmapped_reason` : ''}
    FROM ${identifier}.v_attack_step_catalog c
    ${includeSemantics ? `LEFT JOIN ${identifier}.attack_step_semantics p USING (attack_step_id)` : ''}
    WHERE c.asset = ANY($1::text[])
    ORDER BY c.asset, c.language_key, c.name
  `,
    [assetTypes],
  )
  return rows
}
