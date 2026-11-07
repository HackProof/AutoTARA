\set ON_ERROR_STOP on
-- Use scripts/refresh-mappings.sh; apply all changes in one transaction.
-- Reuse mapping CSV loading, identity checks, and semantic category synchronization.
\ir 09-migrate-state-condition.sql

-- Explicit ID columns define relations, independently of retained review statuses.
CREATE TEMP TABLE desired_technique_mappings ON COMMIT DROP AS
SELECT s.attack_step_id, e.mitre_technique_id, e.un_r155_attack_id,
       m.inherited::boolean AS inherited, m.mapping_snapshot_date::date AS snapshot_date,
       m.mitre_attack_domain, m.mitre_attack_version, r.source_row
FROM semantic_category_mappings m
JOIN vehicle_lang_source.technique_mappings r USING (language, attack_step)
JOIN vehicle_lang.mal_attack_step s ON s.step_key = m.language || ':' || m.attack_step
CROSS JOIN LATERAL (
    SELECT x AS mitre_technique_id, NULL::text AS un_r155_attack_id
    FROM unnest(string_to_array(m.mitre_technique_id, ';')) x
    UNION ALL
    SELECT NULL::text, x FROM unnest(string_to_array(m.un_r155_attack_id, ';')) x
) e;
ALTER TABLE desired_technique_mappings
    ADD UNIQUE NULLS NOT DISTINCT (attack_step_id, mitre_technique_id, un_r155_attack_id);
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM desired_technique_mappings d
        LEFT JOIN vehicle_lang.mitre_technique t ON t.technique_id = d.mitre_technique_id
        LEFT JOIN vehicle_lang.un_r155_attack_method u ON u.attack_method_id = d.un_r155_attack_id
        WHERE (d.mitre_technique_id IS NOT NULL AND t.technique_id IS NULL)
           OR (d.un_r155_attack_id IS NOT NULL AND u.attack_method_id IS NULL)
    ) THEN RAISE EXCEPTION 'Mapping CSV contains an unknown MITRE or UN R155 ID'; END IF;
END $$;

-- Keep source row identities and preserve all review metadata exactly as supplied.
UPDATE vehicle_lang_source.technique_mappings r
SET (
    csv_file, abstract, asset, step_key, semantic_category, mitre_technique_id, un_r155_attack_id,
    un_r155_category_id, un_r155_threat_id, inherited, mapping_snapshot_date, mitre_attack_domain,
    mitre_attack_version, reason, mitre_technique_name, mitre_mapping_status,
    mitre_mapping_relation, mitre_mapping_reason, mitre_candidate_technique_id,
    mitre_mapping_source, mitre_mapping_date, un_r155_mapping_status, un_r155_mapping_reason,
    un_r155_mapping_source, un_r155_mapping_date
) = (
    m.csv_file, m.abstract, m.asset, m.step_key, m.semantic_category, m.mitre_technique_id,
    m.un_r155_attack_id, m.un_r155_category_id, m.un_r155_threat_id, m.inherited,
    m.mapping_snapshot_date, m.mitre_attack_domain, m.mitre_attack_version, m.reason,
    m.mitre_technique_name, m.mitre_mapping_status, m.mitre_mapping_relation,
    m.mitre_mapping_reason, m.mitre_candidate_technique_id, m.mitre_mapping_source,
    m.mitre_mapping_date, m.un_r155_mapping_status, m.un_r155_mapping_reason,
    m.un_r155_mapping_source, m.un_r155_mapping_date
)
FROM semantic_category_mappings m
WHERE r.language = m.language AND r.attack_step = m.attack_step
  AND (
      r.csv_file, r.abstract, r.asset, r.step_key, r.semantic_category, r.mitre_technique_id,
      r.un_r155_attack_id, r.un_r155_category_id, r.un_r155_threat_id, r.inherited,
      r.mapping_snapshot_date, r.mitre_attack_domain, r.mitre_attack_version, r.reason,
      r.mitre_technique_name, r.mitre_mapping_status, r.mitre_mapping_relation,
      r.mitre_mapping_reason, r.mitre_candidate_technique_id, r.mitre_mapping_source,
      r.mitre_mapping_date, r.un_r155_mapping_status, r.un_r155_mapping_reason,
      r.un_r155_mapping_source, r.un_r155_mapping_date
  ) IS DISTINCT FROM (
      m.csv_file, m.abstract, m.asset, m.step_key, m.semantic_category, m.mitre_technique_id,
      m.un_r155_attack_id, m.un_r155_category_id, m.un_r155_threat_id, m.inherited,
      m.mapping_snapshot_date, m.mitre_attack_domain, m.mitre_attack_version, m.reason,
      m.mitre_technique_name, m.mitre_mapping_status, m.mitre_mapping_relation,
      m.mitre_mapping_reason, m.mitre_candidate_technique_id, m.mitre_mapping_source,
      m.mitre_mapping_date, m.un_r155_mapping_status, m.un_r155_mapping_reason,
      m.un_r155_mapping_source, m.un_r155_mapping_date
  );

-- Preserve mapping_id for every retained relationship.
DELETE FROM vehicle_lang.technique_mapping m
WHERE NOT EXISTS (
    SELECT FROM desired_technique_mappings d
    WHERE d.attack_step_id = m.attack_step_id
      AND d.mitre_technique_id IS NOT DISTINCT FROM m.mitre_technique_id
      AND d.un_r155_attack_id IS NOT DISTINCT FROM m.un_r155_attack_id
);
UPDATE vehicle_lang.technique_mapping m
SET (inherited, snapshot_date, mitre_attack_domain, mitre_attack_version, source_row) =
    (d.inherited, d.snapshot_date, d.mitre_attack_domain, d.mitre_attack_version, d.source_row)
FROM desired_technique_mappings d
WHERE m.attack_step_id = d.attack_step_id
  AND m.mitre_technique_id IS NOT DISTINCT FROM d.mitre_technique_id
  AND m.un_r155_attack_id IS NOT DISTINCT FROM d.un_r155_attack_id
  AND (m.inherited, m.snapshot_date, m.mitre_attack_domain, m.mitre_attack_version, m.source_row) IS DISTINCT FROM
      (d.inherited, d.snapshot_date, d.mitre_attack_domain, d.mitre_attack_version, d.source_row);

INSERT INTO vehicle_lang.technique_mapping (
    attack_step_id, mitre_technique_id, un_r155_attack_id,
    inherited, snapshot_date, mitre_attack_domain, mitre_attack_version, source_row
)
SELECT d.attack_step_id, d.mitre_technique_id, d.un_r155_attack_id,
       d.inherited, d.snapshot_date, d.mitre_attack_domain, d.mitre_attack_version, d.source_row
FROM desired_technique_mappings d
WHERE NOT EXISTS (
    SELECT FROM vehicle_lang.technique_mapping m
    WHERE m.attack_step_id = d.attack_step_id
      AND m.mitre_technique_id IS NOT DISTINCT FROM d.mitre_technique_id
      AND m.un_r155_attack_id IS NOT DISTINCT FROM d.un_r155_attack_id
);

\ir 04-validate.sql

SELECT a.language_key, count(m.mitre_technique_id) AS mitre_relations,
       count(m.un_r155_attack_id) AS un_r155_relations, count(*) AS total_relations
FROM vehicle_lang.technique_mapping m
JOIN vehicle_lang.mal_attack_step s USING (attack_step_id)
JOIN vehicle_lang.mal_asset a USING (asset_id)
GROUP BY a.language_key ORDER BY a.language_key;
