-- Raw CSV values stay text; typed tables below enforce the API contract.
CREATE SCHEMA vehicle_lang;
CREATE SCHEMA vehicle_lang_source;

CREATE TABLE vehicle_lang_source.mitre_techniques (
    source_row bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    csv_file text NOT NULL,
    "ID" text,
    "STIX ID" text,
    "name" text,
    "description" text,
    "url" text,
    "created" text,
    "last modified" text,
    "domain" text,
    "version" text,
    "tactics" text,
    "platforms" text,
    "contributors" text,
    "relationship citations" text,
    "is sub-technique" text,
    "sub-technique of" text,
    "supports remote" text,
    "impact type" text
 );

CREATE TABLE vehicle_lang_source.mitre_mitigations (
    source_row bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    csv_file text NOT NULL,
    "ID" text,
    "STIX ID" text,
    "name" text,
    "description" text,
    "url" text,
    "created" text,
    "last modified" text,
    "domain" text,
    "version" text,
    "relationship citations" text
 );

CREATE TABLE vehicle_lang_source.mitre_mitigation_techniques (
    source_row bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    csv_file text NOT NULL,
    "source ID" text,
    "source name" text,
    "source ref" text,
    "source type" text,
    "mapping type" text,
    "target ID" text,
    "target name" text,
    "target ref" text,
    "target type" text,
    "STIX ID" text,
    "created" text,
    "last modified" text,
    "mapping description" text
 );

CREATE TABLE vehicle_lang_source.mitre_detection_relationships (
    source_row bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    csv_file text NOT NULL,
    "source ID" text,
    "source name" text,
    "source ref" text,
    "source type" text,
    "mapping type" text,
    "target ID" text,
    "target name" text,
    "target ref" text,
    "target type" text,
    "STIX ID" text,
    "created" text,
    "last modified" text,
    "mapping description" text
 );

CREATE TABLE vehicle_lang_source.un_r155_part_a (
    source_row bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    csv_file text NOT NULL,
    "attack_method_id" text,
    "category_id" text,
    "category_description" text,
    "part" text,
    "threat_id" text,
    "threat_description" text,
    "attack_method" text
 );

CREATE TABLE vehicle_lang_source.un_r155_mitigations (
    source_row bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    csv_file text NOT NULL,
    "attack_method_id" text,
    "part" text,
    "table_id" text,
    "table_description" text,
    "mitigation_id" text,
    "mitigation" text
 );

CREATE TABLE vehicle_lang_source.mal_attack_steps (
    source_row bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    csv_file text NOT NULL,
    "attack_step_id" text,
    "asset_id" text,
    "language_key" text,
    "language" text,
    "category" text,
    "asset" text,
    "extends" text,
    "name" text,
    "qualified_name" text,
    "attack_step_type" text,
    "hidden" text,
    "auxiliary" text,
    "definition" text,
    "definition_source" text,
    "source_file" text,
    "asset_source_file" text,
    "source_line" text,
    "semantic_category" text,
    "classification_source" text
 );

CREATE TABLE vehicle_lang_source.mal_attack_step_defenses (
    source_row bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    csv_file text NOT NULL,
    "attack_step_id" text,
    "attack_step" text,
    "language" text,
    "defense_id" text,
    "defense" text,
    "mapping_type" text,
    "defense_default_state" text,
    "defense_source_file" text,
    "defense_source_line" text,
    "effect" text,
    "confidence" text,
    "cost" text,
    "reason" text
 );

CREATE TABLE vehicle_lang_source.technique_mappings (
    source_row bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    csv_file text NOT NULL,
    "language" text,
    "abstract" text,
    "asset" text,
    "attack_step" text,
    "step_key" text,
    "semantic_category" text,
    "mitre_technique_id" text,
    "un_r155_attack_id" text,
    "un_r155_category_id" text,
    "un_r155_threat_id" text,
    "inherited" text,
    "mapping_snapshot_date" text,
    "mitre_attack_domain" text,
    "mitre_attack_version" text,
    "reason" text,
    "mitre_technique_name" text,
    "mitre_mapping_status" text,
    "mitre_mapping_relation" text,
    "mitre_mapping_reason" text,
    "mitre_candidate_technique_id" text,
    "mitre_mapping_source" text,
    "mitre_mapping_date" text,
    "un_r155_mapping_status" text,
    "un_r155_mapping_reason" text,
    "un_r155_mapping_source" text,
    "un_r155_mapping_date" text
 );

CREATE TABLE vehicle_lang_source.mitre_effects (
    source_row bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    csv_file text NOT NULL,
    "ID" text,
    "STIX ID" text,
    "name" text,
    "effect" text,
    "confidence" text,
    "cost" text,
    "reason" text
 );

CREATE TABLE vehicle_lang_source.un_r155_effects (
    source_row bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    csv_file text NOT NULL,
    "attack_method_id" text,
    "part" text,
    "table_id" text,
    "table_description" text,
    "mitigation_id" text,
    "mitigation" text,
    "effect" text,
    "confidence" text,
    "cost" text,
    "reason" text
 );

CREATE TABLE vehicle_lang_source.attack_step_ctsa (
    source_row bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    csv_file text NOT NULL,
    "attack_step_id" text,
    "asset_id" text,
    "proximity" text,
    "locality" text,
    "recovery_time" text,
    "restoration_costs" text,
    "impact_confidentiality" text,
    "impact_integrity" text,
    "impact_availability" text,
    "prior_use" text,
    "required_skills" text,
    "required_resources" text,
    "stealth" text,
    "attribution" text,
    "ctsa_score" text
 );

CREATE TABLE vehicle_lang.mal_asset (
    asset_id text PRIMARY KEY,
    language_key text NOT NULL CHECK (language_key IN ('vehiclelang', 'corelang')),
    language text NOT NULL CHECK (lower(language) = language_key),
    name text NOT NULL,
    category text,
    extends_name text,
    source_file text NOT NULL,
    abstract boolean,
    UNIQUE (language_key, name),
    CHECK (asset_id = language || ':' || name)
);
CREATE TABLE vehicle_lang.mal_attack_step (
    attack_step_id text PRIMARY KEY,
    asset_id text NOT NULL REFERENCES vehicle_lang.mal_asset,
    step_key text NOT NULL UNIQUE,
    name text NOT NULL,
    qualified_name text NOT NULL,
    attack_step_type text NOT NULL CHECK (attack_step_type IN ('OR', 'AND')),
    hidden boolean NOT NULL,
    auxiliary boolean NOT NULL,
    definition text,
    definition_source text,
    source_file text NOT NULL,
    source_line integer CHECK (source_line > 0),
    UNIQUE (asset_id, name),
    source_row bigint NOT NULL UNIQUE REFERENCES vehicle_lang_source.mal_attack_steps
);
CREATE TABLE vehicle_lang.mitre_technique (
    technique_id text PRIMARY KEY CHECK (technique_id ~ '^T[0-9]{4}(\.[0-9]{3})?$'),
    stix_id text NOT NULL UNIQUE,
    name text NOT NULL,
    description text NOT NULL,
    url text NOT NULL,
    created_on date NOT NULL,
    modified_on date NOT NULL,
    domain text NOT NULL CHECK (domain IN ('ics-attack', 'enterprise-attack')),
    object_version text NOT NULL,
    tactics text NOT NULL,
    platforms text,
    contributors text,
    relationship_citations text
);
CREATE TABLE vehicle_lang.mitre_mitigation (
    mitigation_id text PRIMARY KEY CHECK (mitigation_id ~ '^M[0-9]{4}$'),
    stix_id text NOT NULL UNIQUE,
    name text NOT NULL,
    description text NOT NULL,
    url text NOT NULL,
    created_on date NOT NULL,
    modified_on date NOT NULL,
    domain text NOT NULL CHECK (domain IN ('ics-attack', 'enterprise-attack')),
    object_version text NOT NULL,
    relationship_citations text
);
CREATE TABLE vehicle_lang.mitre_technique_mitigation (
    relationship_id text PRIMARY KEY,
    mitigation_id text NOT NULL REFERENCES vehicle_lang.mitre_mitigation,
    technique_id text NOT NULL REFERENCES vehicle_lang.mitre_technique,
    mapping_type text NOT NULL CHECK (mapping_type = 'mitigates'),
    description text,
    created_on date NOT NULL,
    modified_on date NOT NULL,
    source_row bigint NOT NULL UNIQUE REFERENCES vehicle_lang_source.mitre_mitigation_techniques,
    UNIQUE (mitigation_id, technique_id)
);
CREATE TABLE vehicle_lang.un_r155_attack_method (
    -- These are textual identifiers: 12.10 must never become numeric 12.1.
    attack_method_id text PRIMARY KEY,
    category_id text NOT NULL,
    category_description text NOT NULL,
    part text NOT NULL CHECK (part = 'A'),
    threat_id text NOT NULL,
    threat_description text NOT NULL,
    attack_method text NOT NULL
);
CREATE TABLE vehicle_lang.un_r155_mitigation (
    mitigation_id text NOT NULL,
    variant_no integer NOT NULL CHECK (variant_no > 0),
    mitigation text NOT NULL,
    PRIMARY KEY (mitigation_id, variant_no),
    UNIQUE (mitigation_id, mitigation)
);
CREATE TABLE vehicle_lang.un_r155_attack_method_mitigation (
    attack_method_id text,
    original_attack_method_id text NOT NULL,
    mitigation_id text NOT NULL,
    variant_no integer NOT NULL,
    part text NOT NULL CHECK (part IN ('B', 'C')),
    table_id text NOT NULL,
    table_description text NOT NULL,
    source_row bigint PRIMARY KEY REFERENCES vehicle_lang_source.un_r155_mitigations,
    FOREIGN KEY (attack_method_id) REFERENCES vehicle_lang.un_r155_attack_method,
    FOREIGN KEY (mitigation_id, variant_no) REFERENCES vehicle_lang.un_r155_mitigation
);
CREATE TABLE vehicle_lang.mal_defense (
    defense_id text PRIMARY KEY,
    asset_id text NOT NULL REFERENCES vehicle_lang.mal_asset,
    name text NOT NULL,
    default_state text NOT NULL CHECK (default_state IN ('Enabled', 'Disabled', 'Unspecified')),
    source_file text NOT NULL,
    source_line integer NOT NULL CHECK (source_line > 0),
    UNIQUE (asset_id, name),
    CHECK (defense_id = asset_id || '.' || name)
);
CREATE TABLE vehicle_lang.mal_attack_step_defense (
    attack_step_id text NOT NULL REFERENCES vehicle_lang.mal_attack_step,
    defense_id text NOT NULL REFERENCES vehicle_lang.mal_defense,
    mapping_type text NOT NULL CHECK (mapping_type IN ('direct', 'inherited_direct')),
    effect text NOT NULL CHECK (effect IN ('P','D','R')),
    confidence text NOT NULL CHECK (confidence IN ('L','M','H')),
    cost smallint NOT NULL CHECK (cost BETWEEN 1 AND 5),
    reason text NOT NULL CHECK (length(trim(reason)) > 0),
    source_row bigint NOT NULL UNIQUE REFERENCES vehicle_lang_source.mal_attack_step_defenses,
    PRIMARY KEY (attack_step_id, defense_id)
);
-- Independent framework edges: the CSV does not pair its two ID lists.
CREATE TABLE vehicle_lang.technique_mapping (
    mapping_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    attack_step_id text NOT NULL REFERENCES vehicle_lang.mal_attack_step,
    mitre_technique_id text REFERENCES vehicle_lang.mitre_technique,
    un_r155_attack_id text REFERENCES vehicle_lang.un_r155_attack_method,
    inherited boolean,
    snapshot_date date NOT NULL,
    mitre_attack_domain text NOT NULL CHECK (mitre_attack_domain IN ('ICS', 'enterprise')),
    mitre_attack_version text NOT NULL,
    source_row bigint NOT NULL REFERENCES vehicle_lang_source.technique_mappings,
    CHECK (num_nonnulls(mitre_technique_id, un_r155_attack_id) = 1),
    UNIQUE NULLS NOT DISTINCT (attack_step_id, mitre_technique_id, un_r155_attack_id)
);

-- Reverse navigation as well as asset -> step -> mitigation lookup.
CREATE INDEX mal_attack_step_asset_idx ON vehicle_lang.mal_attack_step (asset_id);
CREATE INDEX mitre_technique_mitigation_technique_idx ON vehicle_lang.mitre_technique_mitigation (technique_id);
CREATE INDEX un_r155_attack_method_mitigation_reverse_idx ON vehicle_lang.un_r155_attack_method_mitigation (mitigation_id, variant_no);
CREATE INDEX mal_attack_step_defense_reverse_idx ON vehicle_lang.mal_attack_step_defense (defense_id);
CREATE INDEX technique_mapping_mitre_idx ON vehicle_lang.technique_mapping (mitre_technique_id);
CREATE INDEX technique_mapping_un_r155_idx ON vehicle_lang.technique_mapping (un_r155_attack_id);

COMMENT ON TABLE vehicle_lang.technique_mapping IS 'Independent Attack Step to framework edges. Semicolon lists are expanded without inferring MITRE to UN R155 pairs.';
COMMENT ON TABLE vehicle_lang.un_r155_mitigation IS 'Preserves distinct supplied wordings per M ID. variant_no is local to this dataset snapshot.';
COMMENT ON COLUMN vehicle_lang.mal_asset.extends_name IS 'Original parent name. Parent language/import declarations are absent, so cross-language inheritance is not inferred.';
COMMENT ON COLUMN vehicle_lang.mal_defense.default_state IS 'MAL model default, not the activation state of a deployed asset.';

CREATE DOMAIN vehicle_lang.ctsa_rating AS smallint CHECK (VALUE BETWEEN 1 AND 5);
CREATE TABLE vehicle_lang.attack_step_ctsa (
    attack_step_id text PRIMARY KEY REFERENCES vehicle_lang.mal_attack_step,
    asset_id text NOT NULL REFERENCES vehicle_lang.mal_asset,
    proximity vehicle_lang.ctsa_rating, locality vehicle_lang.ctsa_rating,
    recovery_time vehicle_lang.ctsa_rating, restoration_costs vehicle_lang.ctsa_rating,
    impact_confidentiality vehicle_lang.ctsa_rating, impact_integrity vehicle_lang.ctsa_rating,
    impact_availability vehicle_lang.ctsa_rating, prior_use vehicle_lang.ctsa_rating,
    required_skills vehicle_lang.ctsa_rating, required_resources vehicle_lang.ctsa_rating,
    stealth vehicle_lang.ctsa_rating, attribution vehicle_lang.ctsa_rating,
    ctsa_score numeric CHECK (ctsa_score BETWEEN 1 AND 5),
    source_row bigint NOT NULL UNIQUE REFERENCES vehicle_lang_source.attack_step_ctsa
);
CREATE TABLE vehicle_lang.un_r155_mitigation_effect_profile (
    source_row bigint PRIMARY KEY REFERENCES vehicle_lang.un_r155_attack_method_mitigation,
    effect text NOT NULL CHECK (effect IN ('P','D','R')),
    confidence text NOT NULL CHECK (confidence IN ('L','M','H')),
    cost smallint NOT NULL CHECK (cost BETWEEN 1 AND 5),
    reason text NOT NULL CHECK (length(trim(reason)) > 0),
    effect_source_row bigint NOT NULL UNIQUE REFERENCES vehicle_lang_source.un_r155_effects
);
CREATE TABLE vehicle_lang.mitre_mitigation_effect_profile (
    mitigation_id text PRIMARY KEY REFERENCES vehicle_lang.mitre_mitigation,
    effect_types text[] NOT NULL CHECK (cardinality(effect_types) = 1
        AND array_position(effect_types, NULL) IS NULL AND effect_types[1] IN ('P','D','R')),
    confidence text NOT NULL CHECK (confidence IN ('L','M','H')),
    cost smallint NOT NULL CHECK (cost BETWEEN 1 AND 5),
    classification_status text NOT NULL DEFAULT 'classified' CHECK (classification_status = 'classified'),
    basis text NOT NULL CHECK (length(trim(basis)) > 0),
    policy_id text NOT NULL, policy_definitions jsonb NOT NULL,
    classification_source text NOT NULL, source_name text NOT NULL,
    source_description_md5 text NOT NULL, source_version text NOT NULL,
    source_url text NOT NULL, relationship_evidence jsonb NOT NULL DEFAULT '[]',
    source_row bigint NOT NULL UNIQUE REFERENCES vehicle_lang_source.mitre_effects,
    initialized_at timestamptz NOT NULL DEFAULT current_timestamp
);
COMMENT ON COLUMN vehicle_lang.mal_attack_step_defense.cost IS 'Relative implementation cost from CSV: 1 (very low) to 5 (very high).';
COMMENT ON COLUMN vehicle_lang.un_r155_mitigation_effect_profile.cost IS 'Relative implementation cost from CSV: 1 (very low) to 5 (very high).';
COMMENT ON COLUMN vehicle_lang.mitre_mitigation_effect_profile.cost IS 'Relative implementation cost from CSV: 1 (very low) to 5 (very high).';
CREATE TABLE vehicle_lang.attack_step_semantics (
    attack_step_id text PRIMARY KEY REFERENCES vehicle_lang.mal_attack_step,
    semantic_category text NOT NULL CHECK (semantic_category IN
        ('attack_behavior','acquired_or_induced_state','attack_attempt','auxiliary_step')),
    classification_source text NOT NULL CHECK (length(trim(classification_source)) > 0),
    classification_reason text, classification_version text,
    mapping_status_at_review text NOT NULL CHECK (mapping_status_at_review IN ('mapped','unmapped')),
    mitre_unmapped_reason_code text, mitre_unmapped_reason text
);

-- Detection strategy bodies are not supplied as CSV; retain relationship names/STIX IDs.
CREATE TABLE vehicle_lang.mitre_technique_detection (
    relationship_id text PRIMARY KEY,
    detection_strategy_id text NOT NULL,
    detection_strategy_name text NOT NULL,
    detection_strategy_stix_id text NOT NULL,
    technique_id text NOT NULL REFERENCES vehicle_lang.mitre_technique,
    mapping_type text NOT NULL CHECK (mapping_type = 'detects'),
    description text,
    created_on date NOT NULL,
    modified_on date NOT NULL,
    source_row bigint NOT NULL UNIQUE REFERENCES vehicle_lang_source.mitre_detection_relationships,
    UNIQUE (detection_strategy_id, technique_id)
);
CREATE INDEX mitre_technique_detection_technique_idx ON vehicle_lang.mitre_technique_detection (technique_id);
