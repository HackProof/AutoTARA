-- All Attack Steps of an asset, with independent framework mappings and all three
-- kinds of selectable mitigation. Language matching ignores case.
SELECT attack_step_id, name, hidden, auxiliary,
       technique_mappings, mitigation_options, un_r155_without_part_b
FROM vehicle_lang.get_asset_mitigation_catalog('VehicleLang', 'ECU');

-- One Attack Step as JSON, ready for an API response.
SELECT jsonb_pretty(to_jsonb(c))
FROM vehicle_lang.get_asset_mitigation_catalog('vehiclelang', 'ECU', 'changeOperationMode') c;

-- One option per row for a selection list, without duplicate options created
-- by different Technique mapping paths. mapping_evidence records every path.
SELECT o.*
FROM vehicle_lang.v_mitigation_options o
WHERE o.attack_step_id = 'VehicleLang:ECU.changeOperationMode'
ORDER BY o.framework, o.option_key;

-- Reverse lookup: only explicit framework edges from the source CSV, across all assets.
SELECT * FROM vehicle_lang.v_technique_mapping
WHERE mitre_technique_id = 'T0858'
ORDER BY language_key, asset, step_key, un_r155_attack_id;

-- Coverage gaps remain visible; [] does not assert that no mitigation exists.
SELECT * FROM vehicle_lang.v_mapping_coverage ORDER BY language_key, asset;
SELECT attack_method_id, attack_method, mapped_attack_step_count
FROM vehicle_lang.v_un_r155_coverage WHERE NOT has_part_b_mitigation
ORDER BY attack_method_id;

-- Preserve the supplied CTSA inputs and scores; no weights are inferred.
SELECT attack_step_id, ctsa FROM vehicle_lang.v_attack_step_catalog
WHERE ctsa->>'ctsa_score' IS NOT NULL;
