#!/usr/bin/env bash
set -euo pipefail

# Normalize BOM-stripped CSV copies before loading them into Postgres.
sanitize_csv() {
  local source_file="$1"
  local target_file="$2"
  sed '1s/^\xEF\xBB\xBF//' "$source_file" > "$target_file"
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

techniques_csv="$tmp_dir/techniques.csv"
mitigations_csv="$tmp_dir/mitigations.csv"
mitigation_mapping_csv="$tmp_dir/mitigation_mapping.csv"
dfd_mapping_csv="$tmp_dir/dfd_mapping.csv"

sanitize_csv /data/ics-attack-v18.1-techniques.csv "$techniques_csv"
sanitize_csv /data/ics-attack-v18.1-mitigations.csv "$mitigations_csv"
sanitize_csv /data/ics-attack-v18.1-techniques-mitigation.csv "$mitigation_mapping_csv"
sanitize_csv /data/vehiclelang_attackstep_to_mitre_attack_ics_mapping.csv "$dfd_mapping_csv"

echo "Loading MITRE ATT&CK ICS CSV data into $POSTGRES_DB"

psql -v ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" <<SQL
CREATE TEMP TABLE staging_techniques (
    "ID" TEXT,
    "STIX ID" TEXT,
    name TEXT,
    description TEXT,
    url TEXT,
    created TEXT,
    "last modified" TEXT,
    domain TEXT,
    version TEXT,
    tactics TEXT,
    detection TEXT,
    platforms TEXT,
    contributors TEXT,
    "relationship citations" TEXT
);

\copy staging_techniques FROM '$techniques_csv' WITH (FORMAT csv, HEADER true)

INSERT INTO mitre.techniques (id, name, description)
SELECT
    "ID",
    name,
    NULLIF(description, '')
FROM staging_techniques
WHERE NULLIF("ID", '') IS NOT NULL
ON CONFLICT (id) DO UPDATE
SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    updated_at = CURRENT_TIMESTAMP;

CREATE TEMP TABLE staging_mitigations (
    "ID" TEXT,
    "STIX ID" TEXT,
    name TEXT,
    description TEXT,
    url TEXT,
    created TEXT,
    "last modified" TEXT,
    domain TEXT,
    version TEXT,
    "relationship citations" TEXT
);

\copy staging_mitigations FROM '$mitigations_csv' WITH (FORMAT csv, HEADER true)

INSERT INTO mitre.mitigations (id, name, description)
SELECT
    "ID",
    name,
    NULLIF(description, '')
FROM staging_mitigations
WHERE NULLIF("ID", '') IS NOT NULL
ON CONFLICT (id) DO UPDATE
SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    updated_at = CURRENT_TIMESTAMP;

CREATE TEMP TABLE staging_mitigation_technique (
    "source ID" TEXT,
    "source name" TEXT,
    "source ref" TEXT,
    "source type" TEXT,
    "mapping type" TEXT,
    "target ID" TEXT,
    "target name" TEXT,
    "target ref" TEXT,
    "target type" TEXT,
    "mapping description" TEXT,
    "STIX ID" TEXT,
    created TEXT,
    "last modified" TEXT
);

\copy staging_mitigation_technique FROM '$mitigation_mapping_csv' WITH (FORMAT csv, HEADER true)

INSERT INTO mitre.mitigation_technique (mitigation_id, technique_id, m_description)
SELECT
    "source ID",
    "target ID",
    NULLIF("mapping description", '')
FROM staging_mitigation_technique
WHERE NULLIF("source ID", '') IS NOT NULL
  AND NULLIF("target ID", '') IS NOT NULL
ON CONFLICT (mitigation_id, technique_id) DO UPDATE
SET
    m_description = EXCLUDED.m_description;

CREATE TEMP TABLE staging_dfd_techniques (
    category TEXT,
    asset TEXT,
    parent TEXT,
    step_name TEXT,
    inferred_tactic_id TEXT,
    inferred_tactic TEXT,
    technique_id TEXT,
    technique_name TEXT,
    technique_tactics TEXT
);

\copy staging_dfd_techniques FROM '$dfd_mapping_csv' WITH (FORMAT csv, HEADER true)

INSERT INTO mitre.dfd_techniques (
    category,
    asset,
    parent,
    step_name,
    inferred_tactic_id,
    inferred_tactic,
    technique_id,
    technique_name,
    technique_tactics
)
SELECT
    category,
    asset,
    COALESCE(parent, ''),
    step_name,
    NULLIF(inferred_tactic_id, ''),
    NULLIF(inferred_tactic, ''),
    technique_id,
    technique_name,
    NULLIF(technique_tactics, '')
FROM staging_dfd_techniques
WHERE NULLIF(asset, '') IS NOT NULL
  AND NULLIF(step_name, '') IS NOT NULL
  AND NULLIF(technique_id, '') IS NOT NULL
ON CONFLICT (category, asset, parent, step_name, technique_id) DO UPDATE
SET
    inferred_tactic_id = EXCLUDED.inferred_tactic_id,
    inferred_tactic = EXCLUDED.inferred_tactic,
    technique_name = EXCLUDED.technique_name,
    technique_tactics = EXCLUDED.technique_tactics,
    updated_at = CURRENT_TIMESTAMP;
SQL

echo "MITRE ATT&CK ICS data load finished."
