\set ON_ERROR_STOP on
-- Use scripts/migrate-step-semantics.sh to supply the current local mapping CSVs.
-- Run with psql --single-transaction from the directory containing those CSVs.
SELECT pg_advisory_xact_lock(817155, 192);

CREATE TEMP TABLE semantic_category_mappings
    (LIKE vehicle_lang_source.technique_mappings INCLUDING DEFAULTS INCLUDING IDENTITY)
    ON COMMIT DROP;
ALTER TABLE semantic_category_mappings
    ADD CHECK (semantic_category IN
        ('Attack behavior','State / Condition','Auxiliary step','abstract asset'));
CREATE UNIQUE INDEX ON semantic_category_mappings (language, attack_step);

ALTER TABLE semantic_category_mappings ALTER COLUMN csv_file SET DEFAULT 'coreLang-mitre-UN_R155-mapping.csv';
\copy semantic_category_mappings ("language", "abstract", "asset", "attack_step", "step_key", "semantic_category", "mitre_technique_id", "un_r155_attack_id", "un_r155_category_id", "un_r155_threat_id", "inherited", "mapping_snapshot_date", "mitre_attack_domain", "mitre_attack_version", "reason", "mitre_technique_name", "mitre_mapping_status", "mitre_mapping_relation", "mitre_mapping_reason", "mitre_candidate_technique_id", "mitre_mapping_source", "mitre_mapping_date", "un_r155_mapping_status", "un_r155_mapping_reason", "un_r155_mapping_source", "un_r155_mapping_date") FROM PROGRAM 'tail -c +4 coreLang-mitre-UN_R155-mapping.csv' WITH (FORMAT csv, HEADER MATCH, ENCODING 'UTF8');
ALTER TABLE semantic_category_mappings ALTER COLUMN csv_file SET DEFAULT 'vehicleLang-mitre-UN_R155-mapping.csv';
\copy semantic_category_mappings ("language", "abstract", "asset", "attack_step", "step_key", "semantic_category", "mitre_technique_id", "un_r155_attack_id", "un_r155_category_id", "un_r155_threat_id", "inherited", "mapping_snapshot_date", "mitre_attack_domain", "mitre_attack_version", "reason", "mitre_technique_name", "mitre_mapping_status", "mitre_mapping_relation", "mitre_mapping_reason", "mitre_candidate_technique_id", "mitre_mapping_source", "mitre_mapping_date", "un_r155_mapping_status", "un_r155_mapping_reason", "un_r155_mapping_source", "un_r155_mapping_date") FROM PROGRAM 'tail -c +4 vehicleLang-mitre-UN_R155-mapping.csv' WITH (FORMAT csv, HEADER MATCH, ENCODING 'UTF8');

-- Abort before updating anything if the local files do not cover this catalog.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM semantic_category_mappings) OR EXISTS (
        SELECT FROM vehicle_lang.mal_attack_step s
        FULL JOIN semantic_category_mappings m
          ON s.step_key = m.language || ':' || m.attack_step
        WHERE s.attack_step_id IS NULL OR m.source_row IS NULL
           OR m.semantic_category IS NULL
    ) THEN RAISE EXCEPTION 'Semantic category CSV coverage mismatch'; END IF;
    IF (SELECT count(*) FROM vehicle_lang_source.technique_mappings) <>
       (SELECT count(*) FROM semantic_category_mappings) OR EXISTS (
        SELECT FROM vehicle_lang_source.technique_mappings s
        FULL JOIN semantic_category_mappings m USING (language, attack_step)
        WHERE s.source_row IS NULL OR m.source_row IS NULL
    ) THEN RAISE EXCEPTION 'Source mapping coverage mismatch'; END IF;
    IF EXISTS (
        SELECT FROM vehicle_lang.mal_attack_step s
        FULL JOIN vehicle_lang.attack_step_semantics p USING (attack_step_id)
        WHERE s.attack_step_id IS NULL OR p.attack_step_id IS NULL
    ) THEN RAISE EXCEPTION 'Existing semantic classification coverage mismatch'; END IF;
END $$;

ALTER TABLE vehicle_lang.attack_step_semantics
    DROP CONSTRAINT IF EXISTS attack_step_semantics_semantic_category_check;

UPDATE vehicle_lang_source.technique_mappings s
SET semantic_category = m.semantic_category
FROM semantic_category_mappings m
WHERE s.language = m.language AND s.attack_step = m.attack_step
  AND s.semantic_category IS DISTINCT FROM m.semantic_category;

UPDATE vehicle_lang.attack_step_semantics p
SET semantic_category = m.semantic_category
FROM vehicle_lang.mal_attack_step s
JOIN semantic_category_mappings m
  ON s.step_key = m.language || ':' || m.attack_step
WHERE p.attack_step_id = s.attack_step_id
  AND p.semantic_category IS DISTINCT FROM m.semantic_category;

ALTER TABLE vehicle_lang.attack_step_semantics
    ADD CONSTRAINT attack_step_semantics_semantic_category_check
    CHECK (semantic_category IN
        ('Attack behavior','State / Condition','Auxiliary step','abstract asset'));
