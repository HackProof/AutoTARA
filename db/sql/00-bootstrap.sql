\set ON_ERROR_STOP on
-- Call with psql --single-transaction. Serialize initialization and refresh.
SELECT pg_advisory_xact_lock(817155, 192);
\ir 01-schema.sql
\ir 02-load.sql
\ir 06-effect-profiles.sql
\ir 07-step-semantics.sql
\ir 03-views.sql
\ir 04-validate.sql
\echo 'AutoTARA CSV catalog initialized and validated.'
