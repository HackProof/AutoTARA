-- Run with psql from db/data (the image WORKDIR). HEADER MATCH detects CSV drift.
-- tail skips the three-byte UTF-8 BOM in the supplied CSV headers that have it.
-- ICS techniques use EUC_KR; PostgreSQL converts them into the UTF-8 database.
SET LOCAL datestyle = 'ISO, MDY';
SET LOCAL lc_time = 'C';

ALTER TABLE vehicle_lang_source.mitre_techniques ALTER COLUMN csv_file SET DEFAULT 'mitre-attack/ics-attack-v20.0-techniques.csv';
\copy vehicle_lang_source.mitre_techniques ("ID", "STIX ID", "name", "description", "url", "created", "last modified", "domain", "version", "tactics", "platforms", "contributors", "relationship citations") FROM 'mitre-attack/ics-attack-v20.0-techniques.csv' WITH (FORMAT csv, HEADER MATCH, ENCODING 'EUC_KR');
ALTER TABLE vehicle_lang_source.mitre_techniques ALTER COLUMN csv_file SET DEFAULT 'mitre-attack/enterprise-attack-v20.0-techniques.csv';
\copy vehicle_lang_source.mitre_techniques ("ID", "STIX ID", "name", "description", "url", "created", "last modified", "domain", "version", "tactics", "platforms", "is sub-technique", "sub-technique of", "contributors", "supports remote", "impact type", "relationship citations") FROM PROGRAM 'tail -c +4 mitre-attack/enterprise-attack-v20.0-techniques.csv' WITH (FORMAT csv, HEADER MATCH, ENCODING 'UTF8');

ALTER TABLE vehicle_lang_source.mitre_mitigations ALTER COLUMN csv_file SET DEFAULT 'mitre-attack/ics-attack-v20.0-mitigations.csv';
\copy vehicle_lang_source.mitre_mitigations ("ID", "STIX ID", "name", "description", "url", "created", "last modified", "domain", "version", "relationship citations") FROM PROGRAM 'tail -c +4 mitre-attack/ics-attack-v20.0-mitigations.csv' WITH (FORMAT csv, HEADER MATCH, ENCODING 'UTF8');
ALTER TABLE vehicle_lang_source.mitre_mitigations ALTER COLUMN csv_file SET DEFAULT 'mitre-attack/enterprise-attack-v20.0-mitigations.csv';
\copy vehicle_lang_source.mitre_mitigations ("ID", "STIX ID", "name", "description", "url", "created", "last modified", "domain", "version", "relationship citations") FROM PROGRAM 'tail -c +4 mitre-attack/enterprise-attack-v20.0-mitigations.csv' WITH (FORMAT csv, HEADER MATCH, ENCODING 'UTF8');

ALTER TABLE vehicle_lang_source.mitre_mitigation_techniques ALTER COLUMN csv_file SET DEFAULT 'mitre-attack/ics-attack-v20.0-mitigations-techniques_addressed.csv';
\copy vehicle_lang_source.mitre_mitigation_techniques ("source ID", "source name", "source ref", "source type", "mapping type", "target ID", "target name", "target ref", "target type", "STIX ID", "created", "last modified", "mapping description") FROM 'mitre-attack/ics-attack-v20.0-mitigations-techniques_addressed.csv' WITH (FORMAT csv, HEADER MATCH, ENCODING 'UTF8');
ALTER TABLE vehicle_lang_source.mitre_mitigation_techniques ALTER COLUMN csv_file SET DEFAULT 'mitre-attack/enterprise-attack-v20.0-mitigations-techniques_addressed.csv';
\copy vehicle_lang_source.mitre_mitigation_techniques ("source ID", "source name", "source ref", "source type", "mapping type", "target ID", "target name", "target ref", "target type", "mapping description", "STIX ID", "created", "last modified") FROM PROGRAM 'tail -c +4 mitre-attack/enterprise-attack-v20.0-mitigations-techniques_addressed.csv' WITH (FORMAT csv, HEADER MATCH, ENCODING 'UTF8');

ALTER TABLE vehicle_lang_source.mitre_detection_relationships ALTER COLUMN csv_file SET DEFAULT 'mitre-attack/ics-attack-v20.0-techniques-detectionstrategies.csv';
\copy vehicle_lang_source.mitre_detection_relationships ("source ID", "source name", "source ref", "source type", "mapping type", "target ID", "target name", "target ref", "target type", "STIX ID", "created", "last modified", "mapping description") FROM PROGRAM 'tail -c +4 mitre-attack/ics-attack-v20.0-techniques-detectionstrategies.csv' WITH (FORMAT csv, HEADER MATCH, ENCODING 'UTF8');
ALTER TABLE vehicle_lang_source.mitre_detection_relationships ALTER COLUMN csv_file SET DEFAULT 'mitre-attack/enterprise-attack-v20.0-techniques-detectionstrategies.csv';
\copy vehicle_lang_source.mitre_detection_relationships ("source ID", "source name", "source ref", "source type", "mapping type", "target ID", "target name", "target ref", "target type", "mapping description", "STIX ID", "created", "last modified") FROM PROGRAM 'tail -c +4 mitre-attack/enterprise-attack-v20.0-techniques-detectionstrategies.csv' WITH (FORMAT csv, HEADER MATCH, ENCODING 'UTF8');

ALTER TABLE vehicle_lang_source.un_r155_part_a ALTER COLUMN csv_file SET DEFAULT 'un-r155/UN_R155_Annex5-PART-A_threats.csv';
\copy vehicle_lang_source.un_r155_part_a ("attack_method_id", "category_id", "category_description", "part", "threat_id", "threat_description", "attack_method") FROM 'un-r155/UN_R155_Annex5-PART-A_threats.csv' WITH (FORMAT csv, HEADER MATCH, ENCODING 'UTF8');

ALTER TABLE vehicle_lang_source.un_r155_mitigations ALTER COLUMN csv_file SET DEFAULT 'un-r155/UN_R155_Annex5-PART-B-C_mitigations.csv';
\copy vehicle_lang_source.un_r155_mitigations ("attack_method_id", "part", "table_id", "table_description", "mitigation_id", "mitigation") FROM 'un-r155/UN_R155_Annex5-PART-B-C_mitigations.csv' WITH (FORMAT csv, HEADER MATCH, ENCODING 'UTF8');

ALTER TABLE vehicle_lang_source.mal_attack_steps ALTER COLUMN csv_file SET DEFAULT 'coreLang-AttackSteps.csv';
\copy vehicle_lang_source.mal_attack_steps ("attack_step_id", "asset_id", "language_key", "language", "category", "asset", "extends", "name", "qualified_name", "attack_step_type", "hidden", "auxiliary", "definition", "definition_source", "source_file", "asset_source_file", "source_line", "semantic_category", "classification_source") FROM PROGRAM 'tail -c +4 coreLang-AttackSteps.csv' WITH (FORMAT csv, HEADER MATCH, ENCODING 'UTF8');
ALTER TABLE vehicle_lang_source.mal_attack_steps ALTER COLUMN csv_file SET DEFAULT 'vehicleLang-AttackSteps.csv';
\copy vehicle_lang_source.mal_attack_steps ("attack_step_id", "asset_id", "language_key", "language", "category", "asset", "extends", "name", "qualified_name", "attack_step_type", "hidden", "auxiliary", "definition", "definition_source", "source_file", "asset_source_file", "source_line", "semantic_category", "classification_source") FROM PROGRAM 'tail -c +4 vehicleLang-AttackSteps.csv' WITH (FORMAT csv, HEADER MATCH, ENCODING 'UTF8');

ALTER TABLE vehicle_lang_source.mal_attack_step_defenses ALTER COLUMN csv_file SET DEFAULT 'coreLang-AttackStep_Defenses.csv';
\copy vehicle_lang_source.mal_attack_step_defenses ("attack_step_id", "attack_step", "language", "defense_id", "defense", "mapping_type", "defense_default_state", "defense_source_file", "defense_source_line", "effect", "confidence", "cost", "reason") FROM PROGRAM 'tail -c +4 coreLang-AttackStep_Defenses.csv' WITH (FORMAT csv, HEADER MATCH, ENCODING 'UTF8');
ALTER TABLE vehicle_lang_source.mal_attack_step_defenses ALTER COLUMN csv_file SET DEFAULT 'vehicleLang-AttackStep_Defenses.csv';
\copy vehicle_lang_source.mal_attack_step_defenses ("attack_step_id", "attack_step", "language", "defense_id", "defense", "mapping_type", "defense_default_state", "defense_source_file", "defense_source_line", "effect", "confidence", "cost", "reason") FROM PROGRAM 'tail -c +4 vehicleLang-AttackStep_Defenses.csv' WITH (FORMAT csv, HEADER MATCH, ENCODING 'UTF8');

ALTER TABLE vehicle_lang_source.technique_mappings ALTER COLUMN csv_file SET DEFAULT 'coreLang-mitre-UN_R155-mapping.csv';
\copy vehicle_lang_source.technique_mappings ("language", "abstract", "asset", "attack_step", "step_key", "semantic_category", "mitre_technique_id", "un_r155_attack_id", "un_r155_category_id", "un_r155_threat_id", "inherited", "mapping_snapshot_date", "mitre_attack_domain", "mitre_attack_version", "reason", "mitre_technique_name", "mitre_mapping_status", "mitre_mapping_relation", "mitre_mapping_reason", "mitre_candidate_technique_id", "mitre_mapping_source", "mitre_mapping_date", "un_r155_mapping_status", "un_r155_mapping_reason", "un_r155_mapping_source", "un_r155_mapping_date") FROM PROGRAM 'tail -c +4 coreLang-mitre-UN_R155-mapping.csv' WITH (FORMAT csv, HEADER MATCH, ENCODING 'UTF8');
ALTER TABLE vehicle_lang_source.technique_mappings ALTER COLUMN csv_file SET DEFAULT 'vehicleLang-mitre-UN_R155-mapping.csv';
\copy vehicle_lang_source.technique_mappings ("language", "abstract", "asset", "attack_step", "step_key", "semantic_category", "mitre_technique_id", "un_r155_attack_id", "un_r155_category_id", "un_r155_threat_id", "inherited", "mapping_snapshot_date", "mitre_attack_domain", "mitre_attack_version", "reason", "mitre_technique_name", "mitre_mapping_status", "mitre_mapping_relation", "mitre_mapping_reason", "mitre_candidate_technique_id", "mitre_mapping_source", "mitre_mapping_date", "un_r155_mapping_status", "un_r155_mapping_reason", "un_r155_mapping_source", "un_r155_mapping_date") FROM PROGRAM 'tail -c +4 vehicleLang-mitre-UN_R155-mapping.csv' WITH (FORMAT csv, HEADER MATCH, ENCODING 'UTF8');

ALTER TABLE vehicle_lang_source.mitre_effects ALTER COLUMN csv_file SET DEFAULT 'mapping_table/ics-attack-v20.0-mitigation_effect-mapping.csv';
\copy vehicle_lang_source.mitre_effects ("ID", "STIX ID", "name", "effect", "confidence", "cost", "reason") FROM 'mapping_table/ics-attack-v20.0-mitigation_effect-mapping.csv' WITH (FORMAT csv, HEADER MATCH, ENCODING 'UTF8');
ALTER TABLE vehicle_lang_source.mitre_effects ALTER COLUMN csv_file SET DEFAULT 'mapping_table/enterprise-attack-v20.0-mitigations-effect-mapping.csv';
\copy vehicle_lang_source.mitre_effects ("ID", "STIX ID", "name", "effect", "confidence", "cost", "reason") FROM PROGRAM 'tail -c +4 mapping_table/enterprise-attack-v20.0-mitigations-effect-mapping.csv' WITH (FORMAT csv, HEADER MATCH, ENCODING 'UTF8');

ALTER TABLE vehicle_lang_source.un_r155_effects ALTER COLUMN csv_file SET DEFAULT 'mapping_table/UN_R155_Annex5-PART_B-C_effect-mapping.csv';
\copy vehicle_lang_source.un_r155_effects ("attack_method_id", "part", "table_id", "table_description", "mitigation_id", "mitigation", "effect", "confidence", "cost", "reason") FROM 'mapping_table/UN_R155_Annex5-PART_B-C_effect-mapping.csv' WITH (FORMAT csv, HEADER MATCH, ENCODING 'UTF8');

ALTER TABLE vehicle_lang_source.attack_step_ctsa ALTER COLUMN csv_file SET DEFAULT 'coreLang-AttackSteps_CTSA_Score.csv';
\copy vehicle_lang_source.attack_step_ctsa ("attack_step_id", "asset_id", "proximity", "locality", "recovery_time", "restoration_costs", "impact_confidentiality", "impact_integrity", "impact_availability", "prior_use", "required_skills", "required_resources", "stealth", "attribution", "ctsa_score") FROM PROGRAM 'tail -c +4 coreLang-AttackSteps_CTSA_Score.csv' WITH (FORMAT csv, HEADER MATCH, ENCODING 'UTF8');
ALTER TABLE vehicle_lang_source.attack_step_ctsa ALTER COLUMN csv_file SET DEFAULT 'vehicleLang-AttackSteps_CTSA_Score.csv';
\copy vehicle_lang_source.attack_step_ctsa ("attack_step_id", "asset_id", "proximity", "locality", "recovery_time", "restoration_costs", "impact_confidentiality", "impact_integrity", "impact_availability", "prior_use", "required_skills", "required_resources", "stealth", "attribution", "ctsa_score") FROM PROGRAM 'tail -c +4 vehicleLang-AttackSteps_CTSA_Score.csv' WITH (FORMAT csv, HEADER MATCH, ENCODING 'UTF8');

INSERT INTO vehicle_lang.mitre_technique
SELECT "ID", "STIX ID", name, description, url, to_date(created, 'DD FMMonth YYYY'),
       to_date("last modified", 'DD FMMonth YYYY'), domain, version, tactics,
       NULLIF(platforms, 'None'), contributors, "relationship citations"
FROM vehicle_lang_source.mitre_techniques;
INSERT INTO vehicle_lang.mitre_mitigation
SELECT "ID", "STIX ID", name, description, url, to_date(created, 'DD FMMonth YYYY'),
       to_date("last modified", 'DD FMMonth YYYY'), split_part(domain, ',', 1), version, "relationship citations"
FROM vehicle_lang_source.mitre_mitigations;
INSERT INTO vehicle_lang.mitre_technique_mitigation
SELECT "STIX ID", "source ID", "target ID", "mapping type", "mapping description",
       to_date(created, 'DD FMMonth YYYY'), to_date("last modified", 'DD FMMonth YYYY'), source_row
FROM vehicle_lang_source.mitre_mitigation_techniques;
INSERT INTO vehicle_lang.un_r155_attack_method
SELECT attack_method_id, category_id, category_description, part, threat_id, threat_description, attack_method
FROM vehicle_lang_source.un_r155_part_a;
INSERT INTO vehicle_lang.un_r155_mitigation
SELECT mitigation_id, row_number() OVER (PARTITION BY mitigation_id ORDER BY mitigation COLLATE "C"), mitigation
FROM (SELECT DISTINCT mitigation_id, mitigation FROM vehicle_lang_source.un_r155_mitigations) v;
INSERT INTO vehicle_lang.un_r155_attack_method_mitigation
SELECT a.attack_method_id, r.attack_method_id, r.mitigation_id, v.variant_no,
       r.part, r.table_id, r.table_description, r.source_row
FROM vehicle_lang_source.un_r155_mitigations r
JOIN vehicle_lang.un_r155_mitigation v USING (mitigation_id, mitigation)
LEFT JOIN vehicle_lang.un_r155_attack_method a USING (attack_method_id);
INSERT INTO vehicle_lang.mal_asset
SELECT s.asset_id, s.language_key, s.language, s.asset, s.category, s.extends,
       s.asset_source_file, bool_or(m.abstract::boolean)
FROM vehicle_lang_source.mal_attack_steps s
JOIN vehicle_lang_source.technique_mappings m
  ON m.language = s.language_key AND m.attack_step = s.qualified_name
GROUP BY s.asset_id, s.language_key, s.language, s.asset, s.category, s.extends, s.asset_source_file;
INSERT INTO vehicle_lang.mal_attack_step
SELECT attack_step_id, asset_id, language_key || ':' || qualified_name, name, qualified_name,
       attack_step_type, hidden::boolean, auxiliary::boolean, definition, definition_source,
       source_file, source_line::integer, source_row
FROM vehicle_lang_source.mal_attack_steps;
-- Only the language prefix is case-normalized; MAL asset and step names stay case-sensitive.
INSERT INTO vehicle_lang.mal_defense
SELECT DISTINCT a.asset_id || '.' || r.defense,
       a.asset_id, r.defense, r.defense_default_state, r.defense_source_file, r.defense_source_line::integer
FROM vehicle_lang_source.mal_attack_step_defenses r
JOIN vehicle_lang.mal_asset a ON a.language_key = lower(r.language)
 AND a.name = split_part(split_part(r.defense_id, ':', 2), '.', 1);
INSERT INTO vehicle_lang.mal_attack_step_defense
    (attack_step_id, defense_id, mapping_type, effect, confidence, cost, reason, source_row)
SELECT s.attack_step_id, d.defense_id, r.mapping_type, r.effect, r.confidence, r.cost::smallint, r.reason, r.source_row
FROM vehicle_lang_source.mal_attack_step_defenses r
JOIN vehicle_lang.mal_attack_step s ON s.step_key = lower(split_part(r.attack_step_id, ':', 1)) || ':' || split_part(r.attack_step_id, ':', 2)
JOIN vehicle_lang.mal_defense d ON lower(split_part(d.defense_id, ':', 1)) || ':' || split_part(d.defense_id, ':', 2)
 = lower(split_part(r.defense_id, ':', 1)) || ':' || split_part(r.defense_id, ':', 2);
INSERT INTO vehicle_lang.technique_mapping
    (attack_step_id, mitre_technique_id, un_r155_attack_id, inherited, snapshot_date,
     mitre_attack_domain, mitre_attack_version, source_row)
SELECT s.attack_step_id, e.mitre_id, e.un_id, m.inherited::boolean, m.mapping_snapshot_date::date,
       m.mitre_attack_domain, m.mitre_attack_version, m.source_row
FROM vehicle_lang_source.technique_mappings m
JOIN vehicle_lang.mal_attack_step s ON s.step_key = m.language || ':' || m.attack_step
CROSS JOIN LATERAL (
    SELECT x AS mitre_id, NULL::text AS un_id FROM unnest(string_to_array(m.mitre_technique_id, ';')) x
    UNION ALL
    SELECT NULL::text, x FROM unnest(string_to_array(m.un_r155_attack_id, ';')) x
) e;
INSERT INTO vehicle_lang.attack_step_ctsa
SELECT attack_step_id, asset_id, proximity::smallint, locality::smallint, recovery_time::smallint,
       restoration_costs::smallint, impact_confidentiality::smallint, impact_integrity::smallint,
       impact_availability::smallint, prior_use::smallint, required_skills::smallint,
       required_resources::smallint, stealth::smallint, attribution::smallint, ctsa_score::numeric, source_row
FROM vehicle_lang_source.attack_step_ctsa;

INSERT INTO vehicle_lang.mitre_technique_detection
SELECT "STIX ID", "source ID", "source name", "source ref", "target ID", "mapping type",
       "mapping description", to_date(created, 'DD FMMonth YYYY'),
       to_date("last modified", 'DD FMMonth YYYY'), source_row
FROM vehicle_lang_source.mitre_detection_relationships;
