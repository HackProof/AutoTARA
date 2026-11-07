\set ON_ERROR_STOP on
-- Use scripts/refresh-ctsa.sh to load the current local CSVs in one transaction.
SELECT pg_advisory_xact_lock(817155, 192);

CREATE TEMP TABLE ctsa_import
    (LIKE vehicle_lang_source.attack_step_ctsa INCLUDING DEFAULTS INCLUDING IDENTITY)
    ON COMMIT DROP;
ALTER TABLE ctsa_import ADD PRIMARY KEY (attack_step_id);

ALTER TABLE ctsa_import ALTER COLUMN csv_file SET DEFAULT 'coreLang-AttackSteps_CTSA_Score.csv';
\copy ctsa_import ("attack_step_id", "asset_id", "proximity", "locality", "recovery_time", "restoration_costs", "impact_confidentiality", "impact_integrity", "impact_availability", "prior_use", "required_skills", "required_resources", "stealth", "attribution", "ctsa_score") FROM PROGRAM 'tail -c +4 coreLang-AttackSteps_CTSA_Score.csv' WITH (FORMAT csv, HEADER MATCH, ENCODING 'UTF8');
ALTER TABLE ctsa_import ALTER COLUMN csv_file SET DEFAULT 'vehicleLang-AttackSteps_CTSA_Score.csv';
\copy ctsa_import ("attack_step_id", "asset_id", "proximity", "locality", "recovery_time", "restoration_costs", "impact_confidentiality", "impact_integrity", "impact_availability", "prior_use", "required_skills", "required_resources", "stealth", "attribution", "ctsa_score") FROM PROGRAM 'tail -c +4 vehicleLang-AttackSteps_CTSA_Score.csv' WITH (FORMAT csv, HEADER MATCH, ENCODING 'UTF8');

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM ctsa_import) OR EXISTS (
        SELECT FROM vehicle_lang.mal_attack_step s
        FULL JOIN ctsa_import i USING (attack_step_id)
        WHERE s.attack_step_id IS NULL OR i.attack_step_id IS NULL
           OR s.asset_id IS DISTINCT FROM i.asset_id
    ) THEN RAISE EXCEPTION 'CTSA CSV step/asset coverage mismatch'; END IF;
    IF EXISTS (
        SELECT FROM vehicle_lang_source.attack_step_ctsa
        GROUP BY attack_step_id HAVING count(*) <> 1
    ) OR EXISTS (
        SELECT FROM vehicle_lang_source.attack_step_ctsa s
        LEFT JOIN ctsa_import i USING (attack_step_id)
        WHERE i.attack_step_id IS NULL
    ) THEN RAISE EXCEPTION 'Existing CTSA source identity mismatch'; END IF;
END $$;

-- Keep source_row identifiers stable while replacing the supplied text values.
UPDATE vehicle_lang_source.attack_step_ctsa s
SET (csv_file, asset_id, proximity, locality, recovery_time, restoration_costs, impact_confidentiality, impact_integrity, impact_availability, prior_use, required_skills, required_resources, stealth, attribution, ctsa_score) =
    (i.csv_file, i.asset_id, i.proximity, i.locality, i.recovery_time, i.restoration_costs, i.impact_confidentiality, i.impact_integrity, i.impact_availability, i.prior_use, i.required_skills, i.required_resources, i.stealth, i.attribution, i.ctsa_score)
FROM ctsa_import i
WHERE s.attack_step_id = i.attack_step_id
  AND (s.csv_file, s.asset_id, s.proximity, s.locality, s.recovery_time, s.restoration_costs, s.impact_confidentiality, s.impact_integrity, s.impact_availability, s.prior_use, s.required_skills, s.required_resources, s.stealth, s.attribution, s.ctsa_score) IS DISTINCT FROM
      (i.csv_file, i.asset_id, i.proximity, i.locality, i.recovery_time, i.restoration_costs, i.impact_confidentiality, i.impact_integrity, i.impact_availability, i.prior_use, i.required_skills, i.required_resources, i.stealth, i.attribution, i.ctsa_score);

INSERT INTO vehicle_lang_source.attack_step_ctsa
    (csv_file, attack_step_id, asset_id, proximity, locality, recovery_time, restoration_costs, impact_confidentiality, impact_integrity, impact_availability, prior_use, required_skills, required_resources, stealth, attribution, ctsa_score)
SELECT i.csv_file, i.attack_step_id, i.asset_id, i.proximity, i.locality, i.recovery_time, i.restoration_costs, i.impact_confidentiality, i.impact_integrity, i.impact_availability, i.prior_use, i.required_skills, i.required_resources, i.stealth, i.attribution, i.ctsa_score
FROM ctsa_import i
WHERE NOT EXISTS (
    SELECT FROM vehicle_lang_source.attack_step_ctsa s
    WHERE s.attack_step_id = i.attack_step_id
);

-- Empty CSV cells remain NULL, including ctsa_score; no score is inferred.
INSERT INTO vehicle_lang.attack_step_ctsa AS c
    (attack_step_id, asset_id, proximity, locality, recovery_time, restoration_costs, impact_confidentiality, impact_integrity, impact_availability, prior_use, required_skills, required_resources, stealth, attribution, ctsa_score, source_row)
SELECT s.attack_step_id, s.asset_id,
       s.proximity::smallint, s.locality::smallint, s.recovery_time::smallint, s.restoration_costs::smallint, s.impact_confidentiality::smallint, s.impact_integrity::smallint, s.impact_availability::smallint, s.prior_use::smallint, s.required_skills::smallint, s.required_resources::smallint, s.stealth::smallint, s.attribution::smallint, s.ctsa_score::numeric, s.source_row
FROM vehicle_lang_source.attack_step_ctsa s
JOIN ctsa_import i USING (attack_step_id)
ON CONFLICT (attack_step_id) DO UPDATE
SET (asset_id, proximity, locality, recovery_time, restoration_costs, impact_confidentiality, impact_integrity, impact_availability, prior_use, required_skills, required_resources, stealth, attribution, ctsa_score, source_row) =
    (EXCLUDED.asset_id, EXCLUDED.proximity, EXCLUDED.locality, EXCLUDED.recovery_time, EXCLUDED.restoration_costs, EXCLUDED.impact_confidentiality, EXCLUDED.impact_integrity, EXCLUDED.impact_availability, EXCLUDED.prior_use, EXCLUDED.required_skills, EXCLUDED.required_resources, EXCLUDED.stealth, EXCLUDED.attribution, EXCLUDED.ctsa_score, EXCLUDED.source_row)
WHERE (c.asset_id, c.proximity, c.locality, c.recovery_time, c.restoration_costs, c.impact_confidentiality, c.impact_integrity, c.impact_availability, c.prior_use, c.required_skills, c.required_resources, c.stealth, c.attribution, c.ctsa_score, c.source_row) IS DISTINCT FROM
      (EXCLUDED.asset_id, EXCLUDED.proximity, EXCLUDED.locality, EXCLUDED.recovery_time, EXCLUDED.restoration_costs, EXCLUDED.impact_confidentiality, EXCLUDED.impact_integrity, EXCLUDED.impact_availability, EXCLUDED.prior_use, EXCLUDED.required_skills, EXCLUDED.required_resources, EXCLUDED.stealth, EXCLUDED.attribution, EXCLUDED.ctsa_score, EXCLUDED.source_row);

SELECT s.csv_file, count(*) AS total_rows, count(c.proximity) AS populated_input_rows,
       count(c.ctsa_score) AS populated_score_rows
FROM vehicle_lang.attack_step_ctsa c
JOIN vehicle_lang_source.attack_step_ctsa s USING (source_row)
GROUP BY s.csv_file ORDER BY s.csv_file;
