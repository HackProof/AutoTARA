import { listLangSchemas } from "./catalog.service.js";

// ATT&CK relationships identify candidates. Separate AutoTARA CM profiles
// supply P/D/R, confidence and implementation cost defaults. P/R weights default to one.
export async function getCountermeasures(database, schema, techniqueIds) {
  if (
    !(await listLangSchemas(database)).some((entry) => entry.schema === schema)
  ) {
    throw Object.assign(
      new Error("The selected language schema is not available."),
      { status: 404 },
    );
  }
  const { rows: tables } = await database.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = $1 AND table_name IN ('mitre_mitigation', 'mitre_technique_mitigation', 'mitre_mitigation_effect_profile', 'mitre_mitigation_alias', 'technique_mapping', 'un_r155_attack_method_mitigation', 'un_r155_mitigation')`,
    [schema],
  );
  const base = {
    schema,
    weights: { P: 1, R: 1 },
    missingFields: [],
  };
  const tableNames = new Set(tables.map((row) => row.table_name));
  const hasProfiles = tableNames.has("mitre_mitigation_effect_profile");
  const hasAliases = tableNames.has('mitre_mitigation_alias')
  const hasUnR155 = ['technique_mapping', 'un_r155_attack_method_mitigation', 'un_r155_mitigation']
    .every((name) => tableNames.has(name))
  if (
    !tableNames.has("mitre_mitigation") ||
    !tableNames.has("mitre_technique_mitigation")
  ) {
    return {
      ...base,
      countermeasures: [],
      mappingAvailable: false,
      unmappedAvIds: techniqueIds,
    };
  }
  const identifier = `"${schema.replaceAll('"', '""')}"`;
  const { rows } = await database.query(
    `${hasUnR155 ? `WITH un_r155_refs AS (
       SELECT tm.mitre_technique_id,
              jsonb_agg(DISTINCT jsonb_build_object(
                'attackStepId', tm.attack_step_id,
                'part', u.part, 'id', u.mitigation_id,
                'variantNo', u.variant_no, 'description', m.mitigation
              )) AS refs
       FROM ${identifier}.technique_mapping tm
       JOIN ${identifier}.technique_mapping ur USING (attack_step_id)
       JOIN ${identifier}.un_r155_attack_method_mitigation u
         ON u.attack_method_id = ur.un_r155_attack_id
       JOIN ${identifier}.un_r155_mitigation m USING (mitigation_id, variant_no)
       WHERE tm.mitre_technique_id = ANY($1::text[]) AND u.part IN ('B', 'C')
       GROUP BY tm.mitre_technique_id
     )` : ''}
     SELECT c.mitigation_id, c.name, c.description, c.url, t.domain,
            ${hasAliases ? `ARRAY(
              SELECT a.source_mitigation_id FROM ${identifier}.mitre_mitigation_alias a
              WHERE a.mitigation_id = c.mitigation_id ORDER BY a.source_mitigation_id
            )` : 'ARRAY[c.mitigation_id]'} AS source_ids,
            r.technique_id, r.relationship_id, r.description AS mapping_description,
            r.source_row, r.modified_on,
            ${hasUnR155 ? "COALESCE(u.refs, '[]'::jsonb)" : "'[]'::jsonb"} AS un_r155_refs,
            ${hasProfiles ? "to_jsonb(p)" : "NULL::jsonb"} AS effect_profile
     FROM ${identifier}.mitre_technique_mitigation r
     JOIN ${identifier}.mitre_mitigation c USING (mitigation_id)
     JOIN ${identifier}.mitre_technique t USING (technique_id)
     ${hasUnR155 ? 'LEFT JOIN un_r155_refs u ON u.mitre_technique_id = r.technique_id' : ''}
     ${hasProfiles ? `LEFT JOIN ${identifier}.mitre_mitigation_effect_profile p USING (mitigation_id)` : ""}
     WHERE r.technique_id = ANY($1::text[])
     ORDER BY c.mitigation_id, r.technique_id`,
    [techniqueIds],
  );
  const candidates = new Map();
  const mapped = new Set();
  const missingEffectCmIds = new Set();
  let missingConfidence = false;
  for (const row of rows) {
    const profile = row.effect_profile;
    const effects = Array.isArray(profile?.effect_types)
      ? profile.effect_types.map((type) => ({
          type,
          level: profile.confidence ?? "",
        }))
      : null;
    if (effects === null) missingEffectCmIds.add(row.mitigation_id);
    if (effects === null || effects.some((effect) => !effect.level))
      missingConfidence = true;
    if (!candidates.has(row.mitigation_id)) {
      const cost = profile?.cost;
      candidates.set(row.mitigation_id, {
        id: row.mitigation_id,
        sourceIds: row.source_ids?.length ? row.source_ids : [row.mitigation_id],
        name: row.name,
        description: row.description,
        url: row.url,
        defaultEffects: effects,
        effectProfile: profile
          ? {
              scope: "countermeasure",
              status: profile.classification_status,
              basis: profile.basis,
              source: profile.classification_source,
              policyId: profile.policy_id,
              policyDefinitions: profile.policy_definitions,
              sourceUrl: profile.source_url,
              sourceVersion: profile.source_version,
              confidence: profile.confidence ?? null,
              relationshipEvidence: profile.relationship_evidence,
            }
          : null,
        cost: Number.isInteger(cost) && cost >= 1 && cost <= 5 ? cost : null,
        costBasis: "",
        mappings: [],
      });
    }
    mapped.add(row.technique_id);
    candidates.get(row.mitigation_id).mappings.push({
      avId: row.technique_id,
      unR155Refs: row.un_r155_refs || [],
      effects,
      ...(profile
        ? {
            basis: profile.basis,
            source: "CM default (AutoTARA classification)",
            effectScope: "countermeasure",
          }
        : {}),
      evidence: {
        source: row.domain === "enterprise-attack"
          ? "MITRE ATT&CK Enterprise"
          : "MITRE ATT&CK ICS",
        relationshipId: row.relationship_id,
        description: row.mapping_description,
        sourceRow: row.source_row,
        modifiedOn: row.modified_on,
      },
    });
  }
  const countermeasures = [...candidates.values()];
  return {
    ...base,
    mappingAvailable: true,
    effectDefaultsAvailable: hasProfiles,
    missingEffectCmIds: [...missingEffectCmIds],
    missingFields: [
      ...(missingEffectCmIds.size || !hasProfiles
        ? ["P/D/R classification"]
        : []),
      ...(missingConfidence ? ["effect level / confidence"] : []),
      ...(countermeasures.some((cm) => cm.cost === null) ? ["cost score"] : []),
    ],
    countermeasures,
    unmappedAvIds: techniqueIds.filter((id) => !mapped.has(id)),
  };
}
