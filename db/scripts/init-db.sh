#!/usr/bin/env bash
set -euo pipefail

cd /opt/autotara/data
psql -X --set=ON_ERROR_STOP=1 --single-transaction \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --file /opt/autotara/sql/00-bootstrap.sql
