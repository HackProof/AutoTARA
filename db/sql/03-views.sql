-- Preserve independent Attack Step -> MITRE and Attack Step -> UN R155 edges.
CREATE VIEW vehicle_lang.v_technique_mapping AS
SELECT m.attack_step_id, s.step_key, a.language_key, a.name AS asset,
       m.mitre_technique_id, t.name AS mitre_technique_name,
       t.description AS mitre_technique_description, t.url AS mitre_technique_url,
       m.un_r155_attack_id, u.attack_method AS un_r155_attack_method,
       u.category_id AS un_r155_category_id,
       u.category_description AS un_r155_category_description,
       u.threat_id AS un_r155_threat_id,
       u.threat_description AS un_r155_threat_description,
       m.inherited, m.snapshot_date, m.mitre_attack_domain, m.mitre_attack_version,
       m.source_row
FROM vehicle_lang.technique_mapping m
JOIN vehicle_lang.mal_attack_step s USING (attack_step_id)
JOIN vehicle_lang.mal_asset a USING (asset_id)
LEFT JOIN vehicle_lang.mitre_technique t ON t.technique_id = m.mitre_technique_id
LEFT JOIN vehicle_lang.un_r155_attack_method u ON u.attack_method_id = m.un_r155_attack_id;

-- A UNION prevents multiplication of independent mitigation/defense lists.
-- Evidence retains the exact mapping path behind each selectable option.
CREATE VIEW vehicle_lang.v_mitigation_candidates AS
SELECT m.attack_step_id,
       CASE c.domain WHEN 'ics-attack' THEN 'mitre_attack_ics' ELSE 'mitre_attack_enterprise' END AS framework,
       'mitre:' || c.mitigation_id AS option_key,
       c.mitigation_id, c.name AS title, c.description, c.url,
       NULL::text AS default_state, NULL::text AS source_file,
       NULL::integer AS source_line,
       jsonb_build_object(
           'mitre_technique_id', m.mitre_technique_id,
           'un_r155_attack_id', m.un_r155_attack_id,
           'technique_mapping_source_row', m.source_row,
           'inherited', m.inherited, 'snapshot_date', m.snapshot_date,
           'mitre_attack_domain', m.mitre_attack_domain,
           'mitre_attack_version', m.mitre_attack_version,
           'relationship_id', r.relationship_id,
           'mapping_type', r.mapping_type,
           'mapping_description', r.description,
           'mitigation_mapping_source_row', r.source_row,
           'effect', p.effect_types[1], 'confidence', p.confidence, 'reason', p.basis
       ) AS evidence
FROM vehicle_lang.technique_mapping m
JOIN vehicle_lang.mitre_technique_mitigation r ON r.technique_id = m.mitre_technique_id
JOIN vehicle_lang.mitre_mitigation c USING (mitigation_id)
LEFT JOIN vehicle_lang.mitre_mitigation_effect_profile p USING (mitigation_id)
UNION ALL
SELECT m.attack_step_id,
       CASE r.part WHEN 'B' THEN 'un_r155_part_b' ELSE 'un_r155_part_c' END,
       'un_r155:' || CASE r.part WHEN 'B' THEN '' ELSE 'c:' END || c.mitigation_id || ':' || c.variant_no,
       c.mitigation_id, c.mitigation_id, c.mitigation, NULL::text,
       NULL::text, NULL::text, NULL::integer,
       jsonb_build_object(
           'mitre_technique_id', m.mitre_technique_id,
           'un_r155_attack_id', m.un_r155_attack_id,
           'technique_mapping_source_row', m.source_row,
           'inherited', m.inherited, 'snapshot_date', m.snapshot_date,
           'variant_no', c.variant_no,
           'table_id', r.table_id, 'table_description', r.table_description,
           'part', r.part,
           'mitigation_mapping_source_row', r.source_row,
           'effect', p.effect, 'confidence', p.confidence, 'reason', p.reason
       )
FROM vehicle_lang.technique_mapping m
JOIN vehicle_lang.un_r155_attack_method_mitigation r
  ON r.attack_method_id = m.un_r155_attack_id
JOIN vehicle_lang.un_r155_mitigation c USING (mitigation_id, variant_no)
LEFT JOIN vehicle_lang.un_r155_mitigation_effect_profile p ON p.source_row = r.source_row
UNION ALL
SELECT r.attack_step_id,
       'mal_defense', 'mal:' || d.defense_id,
       d.defense_id, d.name, NULL::text, NULL::text,
       d.default_state, d.source_file, d.source_line,
       jsonb_build_object(
           'mapping_type', r.mapping_type,
           'defense_asset_id', d.asset_id,
           'mitigation_mapping_source_row', r.source_row,
           'effect', r.effect, 'confidence', r.confidence, 'reason', r.reason
       )
FROM vehicle_lang.mal_attack_step_defense r
JOIN vehicle_lang.mal_defense d USING (defense_id);

CREATE VIEW vehicle_lang.v_mitigation_options AS
SELECT attack_step_id, framework, option_key, mitigation_id, title, description,
       url, default_state, source_file, source_line,
       jsonb_agg(DISTINCT evidence ORDER BY evidence) AS mapping_evidence
FROM vehicle_lang.v_mitigation_candidates
GROUP BY attack_step_id, framework, option_key, mitigation_id, title, description,
         url, default_state, source_file, source_line;

-- One row per supplied step, including unmapped and hidden/auxiliary steps.
CREATE VIEW vehicle_lang.v_attack_step_catalog AS
SELECT a.language_key, a.language, a.name AS asset, a.category, a.extends_name,
       s.*,
       COALESCE(tm.items, '[]'::jsonb) AS technique_mappings,
       COALESCE(mo.items, '[]'::jsonb) AS mitigation_options,
       COALESCE(ub.items, '[]'::jsonb) AS un_r155_without_part_b,
       COALESCE(tm.item_count, 0) > 0 AS has_technique_mapping,
       COALESCE(mo.has_mitre, false) AS has_mitre_mitigation_mapping,
       COALESCE(mo.has_un_r155, false) AS has_un_r155_mitigation_mapping,
       COALESCE(mo.has_mal, false) AS has_mal_defense_mapping,
       a.abstract,
       to_jsonb(ctsa) - 'attack_step_id' - 'asset_id' - 'source_row' AS ctsa,
       COALESCE(um.items, '[]'::jsonb) AS un_r155_without_mitigation
FROM vehicle_lang.mal_attack_step s
JOIN vehicle_lang.mal_asset a USING (asset_id)
LEFT JOIN vehicle_lang.attack_step_ctsa ctsa USING (attack_step_id, asset_id)
LEFT JOIN LATERAL (
    SELECT jsonb_agg(
               to_jsonb(m) - 'attack_step_id' - 'step_key' - 'language_key' - 'asset'
               ORDER BY m.mitre_technique_id, m.un_r155_attack_id
           ) AS items, count(*) AS item_count
    FROM vehicle_lang.v_technique_mapping m WHERE m.attack_step_id = s.attack_step_id
) tm ON true
LEFT JOIN LATERAL (
    SELECT jsonb_agg(to_jsonb(o) - 'attack_step_id' ORDER BY o.framework, o.option_key) AS items,
           bool_or(o.framework IN ('mitre_attack_ics', 'mitre_attack_enterprise')) AS has_mitre,
           bool_or(o.framework IN ('un_r155_part_b','un_r155_part_c')) AS has_un_r155,
           bool_or(o.framework = 'mal_defense') AS has_mal
    FROM vehicle_lang.v_mitigation_options o WHERE o.attack_step_id = s.attack_step_id
) mo ON true
LEFT JOIN LATERAL (
    SELECT jsonb_agg(DISTINCT m.un_r155_attack_id ORDER BY m.un_r155_attack_id) AS items
    FROM vehicle_lang.technique_mapping m
    WHERE m.attack_step_id = s.attack_step_id
      AND m.un_r155_attack_id IS NOT NULL
      AND NOT EXISTS (
          SELECT FROM vehicle_lang.un_r155_attack_method_mitigation b
          WHERE b.attack_method_id = m.un_r155_attack_id AND b.part = 'B'
      )
) ub ON true
LEFT JOIN LATERAL (
    SELECT jsonb_agg(DISTINCT m.un_r155_attack_id ORDER BY m.un_r155_attack_id) AS items
    FROM vehicle_lang.technique_mapping m
    WHERE m.attack_step_id = s.attack_step_id AND m.un_r155_attack_id IS NOT NULL
      AND NOT EXISTS (SELECT FROM vehicle_lang.un_r155_attack_method_mitigation r
                      WHERE r.attack_method_id = m.un_r155_attack_id)
) um ON true;

CREATE VIEW vehicle_lang.v_mapping_coverage AS
SELECT language_key, asset, count(*) AS attack_step_count,
       count(*) FILTER (WHERE has_technique_mapping) AS technique_mapped_step_count,
       count(*) FILTER (WHERE has_mitre_mitigation_mapping) AS mitre_mitigated_step_count,
       count(*) FILTER (WHERE has_un_r155_mitigation_mapping) AS un_r155_mitigated_step_count,
       count(*) FILTER (WHERE has_mal_defense_mapping) AS defense_mapped_step_count
FROM vehicle_lang.v_attack_step_catalog
GROUP BY language_key, asset;

CREATE VIEW vehicle_lang.v_un_r155_coverage AS
SELECT u.*,
       EXISTS (
           SELECT FROM vehicle_lang.un_r155_attack_method_mitigation b
           WHERE b.attack_method_id = u.attack_method_id AND b.part = 'B'
       ) AS has_part_b_mitigation,
       EXISTS (SELECT FROM vehicle_lang.un_r155_attack_method_mitigation r
               WHERE r.attack_method_id = u.attack_method_id AND r.part = 'C') AS has_part_c_mitigation,
       EXISTS (SELECT FROM vehicle_lang.un_r155_attack_method_mitigation r
               WHERE r.attack_method_id = u.attack_method_id) AS has_mitigation,
       (SELECT count(DISTINCT m.attack_step_id) FROM vehicle_lang.technique_mapping m
        WHERE m.un_r155_attack_id = u.attack_method_id) AS mapped_attack_step_count
FROM vehicle_lang.un_r155_attack_method u;

CREATE FUNCTION vehicle_lang.get_asset_mitigation_catalog(
    p_language text, p_asset text, p_attack_step text DEFAULT NULL
)
RETURNS SETOF vehicle_lang.v_attack_step_catalog
LANGUAGE sql STABLE AS $$
    SELECT c.* FROM vehicle_lang.v_attack_step_catalog c
    WHERE c.language_key = lower(p_language) AND c.asset = p_asset
      AND (p_attack_step IS NULL OR c.name = p_attack_step
           OR c.qualified_name = p_attack_step OR c.attack_step_id = p_attack_step)
    ORDER BY c.name;
$$;

CREATE VIEW vehicle_lang.v_un_r155_mitigation_mapping AS
SELECT r.*, c.mitigation, p.effect, p.confidence, p.reason
FROM vehicle_lang.un_r155_attack_method_mitigation r
JOIN vehicle_lang.un_r155_mitigation c USING (mitigation_id, variant_no)
JOIN vehicle_lang.un_r155_mitigation_effect_profile p USING (source_row);
CREATE VIEW vehicle_lang.un_r155_part_c_mitigation AS
SELECT source_row, original_attack_method_id AS attack_method_id,
       attack_method_id AS part_a_attack_method_id, mitigation_id, variant_no,
       part, table_id, table_description
FROM vehicle_lang.un_r155_attack_method_mitigation WHERE part = 'C';
CREATE VIEW vehicle_lang.v_attack_step_semantics AS
SELECT c.*, p.semantic_category, p.classification_reason, p.classification_source,
       p.classification_version, p.mapping_status_at_review,
       CASE WHEN c.has_technique_mapping THEN 'mapped' ELSE 'unmapped' END AS mapping_status,
       p.mitre_unmapped_reason_code, p.mitre_unmapped_reason
FROM vehicle_lang.v_attack_step_catalog c
JOIN vehicle_lang.attack_step_semantics p USING (attack_step_id);

-- Preserve review-only candidates, explanations, and threat-level UN mappings
-- without turning them into confirmed technique or attack-method edges.
CREATE VIEW vehicle_lang.v_attack_step_mapping_review AS
SELECT s.attack_step_id, m.*
FROM vehicle_lang_source.technique_mappings m
JOIN vehicle_lang.mal_attack_step s ON s.step_key = m.language || ':' || m.attack_step;

CREATE VIEW vehicle_lang.v_mitre_detection_mapping AS
SELECT r.*, t.name AS technique_name, t.domain, s.csv_file
FROM vehicle_lang.mitre_technique_detection r
JOIN vehicle_lang.mitre_technique t USING (technique_id)
JOIN vehicle_lang_source.mitre_detection_relationships s USING (source_row);
