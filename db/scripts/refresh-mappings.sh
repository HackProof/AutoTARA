#!/usr/bin/env bash
# Synchronize mapping CSVs, semantic categories, and independent framework relations.
set -euo pipefail
db_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$db_dir"
compose=(docker compose --project-directory "$db_dir" -f "$db_dir/docker-compose.yml")
mode=${1:-apply}
if [[ $# -gt 1 || ( "$mode" != apply && "$mode" != --check ) ]]; then
  echo 'Usage: bash scripts/refresh-mappings.sh [--check]' >&2
  exit 2
fi

work_dir=$("${compose[@]}" exec -T db mktemp -d /tmp/autotara-mappings.XXXXXX)
cleanup() { "${compose[@]}" exec -T db rm -rf -- "$work_dir"; }
trap cleanup EXIT
"${compose[@]}" exec -T db mkdir -p "$work_dir/data" "$work_dir/sql" "$work_dir/tests"
for language in coreLang vehicleLang; do
  "${compose[@]}" cp "$db_dir/data/$language-mitre-UN_R155-mapping.csv" "db:$work_dir/data/"
done
for sql_file in 04-validate.sql 09-migrate-state-condition.sql 11-refresh-mappings.sql; do
  "${compose[@]}" cp "$db_dir/sql/$sql_file" "db:$work_dir/sql/"
done

if [[ "$mode" == --check ]]; then
  "${compose[@]}" cp "$db_dir/tests/mappings.sql" "db:$work_dir/tests/"
  "${compose[@]}" exec -T db sh -c \
    'cd "$1/data"; exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$1/tests/mappings.sql"' \
    sh "$work_dir"
  echo 'Mapping checks passed; test data changes were rolled back.'
else
  "${compose[@]}" exec -T db sh -c \
    'cd "$1/data"; exec psql -X -v ON_ERROR_STOP=1 -1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$1/sql/11-refresh-mappings.sql"' \
    sh "$work_dir"
  echo 'Mapping CSVs and MITRE / UN R155 relations synchronized and validated.'
fi
