\set ON_ERROR_STOP on
-- Run in one transaction via scripts/merge-mitigations.sh, which backs up first.
SELECT pg_advisory_xact_lock(817155, 192);
LOCK TABLE vehicle_lang.mitre_mitigation,
           vehicle_lang.mitre_technique_mitigation,
           vehicle_lang.mitre_mitigation_effect_profile IN ACCESS EXCLUSIVE MODE;
LOCK TABLE vehicle_lang_source.mitre_mitigations IN SHARE MODE;

CREATE TEMP TABLE mitigation_merge_map ON COMMIT DROP AS
SELECT "ID" AS source_mitigation_id,
       first_value("ID") OVER (
           PARTITION BY lower(btrim(name))
           ORDER BY (split_part(domain, ',', 1) = 'enterprise-attack') DESC, "ID"
       ) AS mitigation_id, source_row
FROM vehicle_lang_source.mitre_mitigations;
ALTER TABLE mitigation_merge_map ADD PRIMARY KEY (source_mitigation_id);
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM mitigation_merge_map) OR EXISTS (
        SELECT FROM mitigation_merge_map m
        LEFT JOIN vehicle_lang.mitre_mitigation c USING (mitigation_id)
        WHERE c.mitigation_id IS NULL
    ) THEN RAISE EXCEPTION 'Missing representative MITRE mitigation; import the source catalog first'; END IF;
END $$;

-- Shared mitigations have no single STIX object, domain, URL, or version.
ALTER TABLE vehicle_lang.mitre_mitigation
    ALTER COLUMN stix_id DROP NOT NULL,
    ALTER COLUMN description DROP NOT NULL,
    ALTER COLUMN url DROP NOT NULL,
    ALTER COLUMN created_on DROP NOT NULL,
    ALTER COLUMN modified_on DROP NOT NULL,
    ALTER COLUMN domain DROP NOT NULL,
    ALTER COLUMN object_version DROP NOT NULL;
CREATE TABLE IF NOT EXISTS vehicle_lang.mitre_mitigation_alias (
    source_mitigation_id text PRIMARY KEY CHECK (source_mitigation_id ~ '^M[0-9]{4}$'),
    mitigation_id text NOT NULL REFERENCES vehicle_lang.mitre_mitigation,
    source_row bigint NOT NULL UNIQUE REFERENCES vehicle_lang_source.mitre_mitigations
);
CREATE INDEX IF NOT EXISTS mitre_mitigation_alias_canonical_idx ON vehicle_lang.mitre_mitigation_alias (mitigation_id);
COMMENT ON TABLE vehicle_lang.mitre_mitigation_alias IS 'Original MITRE IDs mapped to one mitigation per normalized name. Original metadata remains in vehicle_lang_source.mitre_mitigations.';
INSERT INTO vehicle_lang.mitre_mitigation_alias
SELECT source_mitigation_id, mitigation_id, source_row FROM mitigation_merge_map
ON CONFLICT (source_mitigation_id) DO UPDATE
SET mitigation_id = excluded.mitigation_id, source_row = excluded.source_row;

-- Keep the Enterprise representative profile, including manual edits. The backup
-- preserves former alias profiles; original CSV defaults remain in the source schema.
DELETE FROM vehicle_lang.mitre_mitigation_effect_profile p
USING mitigation_merge_map m
WHERE p.mitigation_id = m.source_mitigation_id AND p.mitigation_id <> m.mitigation_id;

-- Do not recreate edges: preserve relationship IDs, evidence, and source rows.
UPDATE vehicle_lang.mitre_technique_mitigation r
SET mitigation_id = m.mitigation_id
FROM mitigation_merge_map m
WHERE r.mitigation_id = m.source_mitigation_id AND r.mitigation_id <> m.mitigation_id;
DELETE FROM vehicle_lang.mitre_mitigation c
USING mitigation_merge_map m
WHERE c.mitigation_id = m.source_mitigation_id AND c.mitigation_id <> m.mitigation_id;
UPDATE vehicle_lang.mitre_mitigation c
SET stix_id = NULL, description = NULL, url = NULL, created_on = NULL,
    modified_on = NULL, domain = NULL, object_version = NULL, relationship_citations = NULL
WHERE (SELECT count(*) FROM vehicle_lang.mitre_mitigation_alias a
       WHERE a.mitigation_id = c.mitigation_id) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS mitre_mitigation_name_idx ON vehicle_lang.mitre_mitigation (lower(btrim(name)));
-- If a representative profile was missing, initialize it from its own source,
-- never from the other domain's differing effect or implementation cost.
\ir 06-effect-profiles.sql

DO $$
BEGIN
    IF (SELECT count(*) FROM vehicle_lang.mitre_mitigation) <>
       (SELECT count(DISTINCT mitigation_id) FROM mitigation_merge_map)
       OR (SELECT count(*) FROM vehicle_lang.mitre_mitigation_alias) <>
          (SELECT count(*) FROM mitigation_merge_map)
       OR EXISTS (
           SELECT FROM vehicle_lang_source.mitre_mitigation_techniques s
           FULL JOIN vehicle_lang.mitre_technique_mitigation r USING (source_row)
           LEFT JOIN vehicle_lang.mitre_mitigation_alias a ON a.source_mitigation_id = s."source ID"
           WHERE r.relationship_id IS DISTINCT FROM s."STIX ID"
              OR r.mitigation_id IS DISTINCT FROM a.mitigation_id
              OR r.technique_id IS DISTINCT FROM s."target ID"
       ) THEN RAISE EXCEPTION 'MITRE mitigation merge lost an identity or technique relationship'; END IF;
END $$;
DROP TABLE mitigation_merge_map;
