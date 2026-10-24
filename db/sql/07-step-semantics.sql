-- The updated CSV supplies category and source only; removed reasons remain NULL.
SELECT pg_advisory_xact_lock(817155, 192);
INSERT INTO vehicle_lang.attack_step_semantics
    (attack_step_id, semantic_category, classification_source, mapping_status_at_review)
SELECT s.attack_step_id, s.semantic_category, s.classification_source,
       CASE WHEN EXISTS (SELECT FROM vehicle_lang.technique_mapping m WHERE m.attack_step_id = s.attack_step_id)
            THEN 'mapped' ELSE 'unmapped' END
FROM vehicle_lang_source.mal_attack_steps s
ON CONFLICT (attack_step_id) DO NOTHING;
