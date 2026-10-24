-- Any loss, invalid reference, or malformed value aborts the complete import.
DO $$
DECLARE src bigint; dst bigint; pair record;
BEGIN
    FOR pair IN SELECT * FROM (VALUES
        ('mitre_techniques','mitre_technique'),
        ('mitre_mitigations','mitre_mitigation'),
        ('mitre_mitigation_techniques','mitre_technique_mitigation'),
        ('mitre_detection_relationships','mitre_technique_detection'),
        ('un_r155_part_a','un_r155_attack_method'),
        ('un_r155_mitigations','un_r155_attack_method_mitigation'),
        ('mal_attack_steps','mal_attack_step'),
        ('mal_attack_step_defenses','mal_attack_step_defense'),
        ('attack_step_ctsa','attack_step_ctsa'),
        ('un_r155_effects','un_r155_mitigation_effect_profile'),
        ('mal_attack_steps','attack_step_semantics')
    ) p(source_name,target_name) LOOP
        EXECUTE format('SELECT count(*) FROM vehicle_lang_source.%I', pair.source_name) INTO src;
        EXECUTE format('SELECT count(*) FROM vehicle_lang.%I', pair.target_name) INTO dst;
        IF src = 0 OR src <> dst THEN
            RAISE EXCEPTION 'Row loss: % (%) -> % (%)', pair.source_name, src, pair.target_name, dst;
        END IF;
    END LOOP;
    IF EXISTS (
        SELECT FROM vehicle_lang_source.mal_attack_steps s
        WHERE s.qualified_name IS DISTINCT FROM s.asset || '.' || s.name
           OR s.attack_step_id IS DISTINCT FROM s.language || ':' || s.qualified_name
           OR s.asset_id IS DISTINCT FROM s.language || ':' || s.asset
           OR s.language_key IS DISTINCT FROM lower(s.language)
           OR s.hidden IS NULL OR s.hidden NOT IN ('TRUE','FALSE')
           OR s.auxiliary IS NULL OR s.auxiliary NOT IN ('TRUE','FALSE')
    ) THEN RAISE EXCEPTION 'MAL identity/boolean metadata mismatch'; END IF;
    IF (SELECT count(*) FROM vehicle_lang_source.technique_mappings) <>
       (SELECT count(*) FROM vehicle_lang.mal_attack_step)
       OR EXISTS (
        SELECT FROM vehicle_lang_source.technique_mappings m
        FULL JOIN vehicle_lang_source.mal_attack_steps s
          ON s.language_key = m.language AND s.qualified_name = m.attack_step
        WHERE s.attack_step_id IS NULL OR m.source_row IS NULL
           OR lower(split_part(m.step_key, ':', 1)) || ':' || split_part(m.step_key, ':', 2)
              IS DISTINCT FROM s.language_key || ':' || s.qualified_name
           OR m.asset IS DISTINCT FROM s.asset
           OR m.abstract NOT IN ('TRUE','FALSE') OR m.inherited NOT IN ('TRUE','FALSE')
       ) OR EXISTS (
        SELECT FROM vehicle_lang_source.technique_mappings
        GROUP BY language, attack_step HAVING count(*) <> 1
    ) THEN RAISE EXCEPTION 'Mapping coverage/step metadata mismatch'; END IF;

    SELECT sum(COALESCE(cardinality(string_to_array(mitre_technique_id, ';')), 0)
             + COALESCE(cardinality(string_to_array(un_r155_attack_id, ';')), 0))
    INTO src FROM vehicle_lang_source.technique_mappings;
    IF src <> (SELECT count(*) FROM vehicle_lang.technique_mapping) THEN
        RAISE EXCEPTION 'Mapping edge loss'; END IF;
    IF EXISTS (
        SELECT FROM vehicle_lang_source.technique_mappings
        WHERE (mitre_mapping_status = 'mapped') IS DISTINCT FROM (mitre_technique_id IS NOT NULL)
    ) THEN RAISE EXCEPTION 'Unconfirmed MITRE technique must not become a mapping'; END IF;
    -- Category/threat lists are sets, not positional pairs: a CSV row may have
    -- three attack IDs sharing just two category/threat IDs.
    IF EXISTS (
        SELECT FROM vehicle_lang_source.technique_mappings m
        CROSS JOIN LATERAL unnest(string_to_array(m.un_r155_attack_id, ';')) id
        JOIN vehicle_lang.un_r155_attack_method a ON a.attack_method_id = id
        WHERE NOT (a.category_id = ANY(string_to_array(m.un_r155_category_id, ';')))
           OR NOT (a.threat_id = ANY(string_to_array(m.un_r155_threat_id, ';')))
    ) THEN RAISE EXCEPTION 'UN R155 category/threat metadata mismatch'; END IF;
    IF EXISTS (
        SELECT FROM vehicle_lang_source.mitre_mitigation_techniques r
        JOIN vehicle_lang.mitre_mitigation m ON m.mitigation_id = r."source ID"
        JOIN vehicle_lang.mitre_technique t ON t.technique_id = r."target ID"
        WHERE r."source name" IS DISTINCT FROM m.name OR r."source ref" IS DISTINCT FROM m.stix_id
           OR (r."target name" IS DISTINCT FROM t.name
               AND right(t.name, length(r."target name") + 2) IS DISTINCT FROM ': ' || r."target name")
           OR r."target ref" IS DISTINCT FROM t.stix_id
           OR r."source type" IS DISTINCT FROM 'mitigation' OR r."target type" IS DISTINCT FROM 'technique'
    ) THEN RAISE EXCEPTION 'MITRE mitigation name/STIX/type mismatch'; END IF;
    IF EXISTS (
        SELECT FROM vehicle_lang_source.mitre_detection_relationships r
        JOIN vehicle_lang.mitre_technique t ON t.technique_id = r."target ID"
        WHERE (r."target name" IS DISTINCT FROM t.name
               AND right(t.name, length(r."target name") + 2) IS DISTINCT FROM ': ' || r."target name")
           OR r."target ref" IS DISTINCT FROM t.stix_id
           OR r."source type" IS DISTINCT FROM 'detectionstrategy'
           OR r."target type" IS DISTINCT FROM 'technique'
    ) THEN RAISE EXCEPTION 'MITRE detection name/STIX/type mismatch'; END IF;
    IF EXISTS (
        SELECT FROM vehicle_lang_source.mitre_effects e
        JOIN vehicle_lang.mitre_mitigation c ON c.mitigation_id = e."ID"
        WHERE e."STIX ID" IS DISTINCT FROM c.stix_id OR e.name IS DISTINCT FROM c.name
    ) OR (SELECT count(*) FROM vehicle_lang.mitre_mitigation_effect_profile) <>
         (SELECT count(*) FROM vehicle_lang_source.mitre_effects WHERE effect IS NOT NULL)
    THEN RAISE EXCEPTION 'MITRE effect coverage/name/STIX mismatch'; END IF;
    IF EXISTS (
        SELECT FROM vehicle_lang.mitre_mitigation_effect_profile p
        JOIN vehicle_lang_source.mitre_effects s ON s.source_row = p.source_row
        WHERE p.cost IS DISTINCT FROM s.cost::smallint
    ) OR EXISTS (
        SELECT FROM vehicle_lang.un_r155_mitigation_effect_profile p
        JOIN vehicle_lang_source.un_r155_effects s ON s.source_row = p.effect_source_row
        WHERE p.cost IS DISTINCT FROM s.cost::smallint
    ) OR EXISTS (
        SELECT FROM vehicle_lang.mal_attack_step_defense d
        JOIN vehicle_lang_source.mal_attack_step_defenses s ON s.source_row = d.source_row
        WHERE d.cost IS DISTINCT FROM s.cost::smallint
    ) THEN RAISE EXCEPTION 'Countermeasure cost differs from source CSV'; END IF;
    IF EXISTS (
        SELECT FROM vehicle_lang.un_r155_attack_method_mitigation r
        WHERE r.attack_method_id IS NULL AND NOT (r.part = 'C' AND r.table_id = 'C3'
          AND r.original_attack_method_id IN ('30.1','30.2','30.3'))
    ) THEN RAISE EXCEPTION 'Unexpected UN mitigation without Part A endpoint'; END IF;
    IF EXISTS (
        SELECT FROM vehicle_lang.attack_step_ctsa c JOIN vehicle_lang.mal_attack_step s USING (attack_step_id)
        WHERE c.asset_id <> s.asset_id
    ) THEN RAISE EXCEPTION 'CTSA asset mismatch'; END IF;
    IF (SELECT count(*) FROM vehicle_lang.v_attack_step_catalog) <>
       (SELECT count(*) FROM vehicle_lang.mal_attack_step)
    THEN RAISE EXCEPTION 'Catalog must contain exactly one row per Attack Step'; END IF;
END $$;
ANALYZE vehicle_lang.mal_asset;
ANALYZE vehicle_lang.mal_attack_step;
ANALYZE vehicle_lang.technique_mapping;
ANALYZE vehicle_lang.mitre_technique_mitigation;
ANALYZE vehicle_lang.mitre_technique_detection;
ANALYZE vehicle_lang.un_r155_attack_method_mitigation;
