\set ON_ERROR_STOP on
-- Use scripts/refresh.sh, which creates a backup before running this transaction.
SELECT pg_advisory_xact_lock(817155, 192);
DROP SCHEMA IF EXISTS vehicle_lang CASCADE;
DROP SCHEMA IF EXISTS vehicle_lang_source CASCADE;
\ir 00-bootstrap.sql
