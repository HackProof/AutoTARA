-- Mapping CSVs supply the current categories; MAL CSVs retain definition provenance.
SELECT pg_advisory_xact_lock(817155, 192);
INSERT INTO vehicle_lang.attack_step_semantics
    (attack_step_id, semantic_category, classification_source, mapping_status_at_review)
SELECT s.attack_step_id, m.semantic_category, s.classification_source,
       CASE WHEN EXISTS (SELECT FROM vehicle_lang.technique_mapping m WHERE m.attack_step_id = s.attack_step_id)
            THEN 'mapped' ELSE 'unmapped' END
FROM vehicle_lang_source.mal_attack_steps s
JOIN vehicle_lang_source.technique_mappings m
  ON m.language = s.language_key AND m.attack_step = s.qualified_name
ON CONFLICT (attack_step_id) DO NOTHING;
