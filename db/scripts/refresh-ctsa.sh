#!/usr/bin/env bash
# Synchronize CTSA inputs and supplied scores without rebuilding the catalog.
set -euo pipefail
db_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$db_dir"
compose=(docker compose --project-directory "$db_dir" -f "$db_dir/docker-compose.yml")
mode=${1:-apply}
if [[ $# -gt 1 || ( "$mode" != apply && "$mode" != --check ) ]]; then
  echo 'Usage: bash scripts/refresh-ctsa.sh [--check]' >&2
  exit 2
fi

work_dir=$("${compose[@]}" exec -T db mktemp -d /tmp/autotara-ctsa.XXXXXX)
cleanup() { "${compose[@]}" exec -T db rm -rf -- "$work_dir"; }
trap cleanup EXIT
"${compose[@]}" exec -T db mkdir -p "$work_dir/data" "$work_dir/sql" "$work_dir/tests"
for language in coreLang vehicleLang; do
  "${compose[@]}" cp "$db_dir/data/$language-AttackSteps_CTSA_Score.csv" "db:$work_dir/data/"
done
"${compose[@]}" cp "$db_dir/sql/10-refresh-ctsa.sql" "db:$work_dir/sql/"

if [[ "$mode" == --check ]]; then
  "${compose[@]}" cp "$db_dir/tests/ctsa.sql" "db:$work_dir/tests/"
  "${compose[@]}" exec -T db sh -c \
    'cd "$1/data"; exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$1/tests/ctsa.sql"' \
    sh "$work_dir"
  echo 'CTSA checks passed; test data changes were rolled back.'
else
  "${compose[@]}" exec -T db sh -c \
    'cd "$1/data"; exec psql -X -v ON_ERROR_STOP=1 -1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$1/sql/10-refresh-ctsa.sql"' \
    sh "$work_dir"
  echo 'CTSA inputs and supplied scores synchronized with the local CSVs.'
fi
