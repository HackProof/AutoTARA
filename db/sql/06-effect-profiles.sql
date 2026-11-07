-- Re-seeding the same snapshot preserves later edits. Refresh rebuilds CSV defaults.
SELECT pg_advisory_xact_lock(817155, 192);
INSERT INTO vehicle_lang.mitre_mitigation_effect_profile
    (mitigation_id, effect_types, confidence, cost, basis, policy_id, policy_definitions,
     classification_source, source_name, source_description_md5, source_version,
     source_url, source_row)
SELECT c.mitigation_id, ARRAY[e.effect], e.confidence, e.cost::smallint, e.reason, 'csv-effect-v20.0',
       '{"P":"Prevent", "D":"Detect", "R":"Recover"}'::jsonb,
       e.csv_file, s.name,
       md5(s.description), '20.0', s.url, e.source_row
FROM vehicle_lang_source.mitre_effects e
JOIN vehicle_lang.mitre_mitigation_alias a ON a.source_mitigation_id = e."ID"
JOIN vehicle_lang.mitre_mitigation c USING (mitigation_id)
JOIN vehicle_lang_source.mitre_mitigations s ON s.source_row = a.source_row
-- Seed only the representative source; reruns preserve existing reviewed defaults.
WHERE e.effect IS NOT NULL AND e."ID" = c.mitigation_id
ON CONFLICT (mitigation_id) DO NOTHING;
INSERT INTO vehicle_lang.un_r155_mitigation_effect_profile
    (source_row, effect, confidence, cost, reason, effect_source_row)
SELECT r.source_row, e.effect, e.confidence, e.cost::smallint, e.reason, e.source_row
FROM vehicle_lang_source.un_r155_effects e
JOIN vehicle_lang_source.un_r155_mitigations s
  USING (attack_method_id, part, table_id, table_description, mitigation_id, mitigation)
JOIN vehicle_lang.un_r155_attack_method_mitigation r ON r.source_row = s.source_row
ON CONFLICT (source_row) DO NOTHING;
