#!/usr/bin/env bash
# Merge equal-name ATT&CK mitigations, preserving all technique relationships.
set -euo pipefail
umask 077
db_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$db_dir"
compose=(docker compose --project-directory "$db_dir" -f "$db_dir/docker-compose.yml")
mode=${1:-apply}
if [[ $# -gt 1 || ( "$mode" != apply && "$mode" != --check ) ]]; then
  echo 'Usage: bash scripts/merge-mitigations.sh [--check]' >&2
  exit 2
fi

if [[ "$mode" == apply ]]; then
  backup_dir=${BACKUP_DIR:-"$db_dir/backups"}
  mkdir -p "$backup_dir"
  partial=$(mktemp "$backup_dir/catalog-mitigations-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX.dump.partial")
  if ! "${compose[@]}" exec -T db sh -c \
    'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -n vehicle_lang -n vehicle_lang_source' > "$partial"; then
    rm -f -- "$partial"
    exit 1
  fi
  backup=${partial%.partial}
  mv -- "$partial" "$backup"
  echo "Catalog backup: $backup"
fi

work_dir=$("${compose[@]}" exec -T db mktemp -d /tmp/autotara-mitigations.XXXXXX)
cleanup() { "${compose[@]}" exec -T db rm -rf -- "$work_dir"; }
trap cleanup EXIT
"${compose[@]}" exec -T db mkdir -p "$work_dir/sql" "$work_dir/tests"
for sql_file in 03-views.sql 06-effect-profiles.sql 12-merge-mitigations.sql; do
  "${compose[@]}" cp "$db_dir/sql/$sql_file" "db:$work_dir/sql/"
done
if [[ "$mode" == --check ]]; then
  "${compose[@]}" cp "$db_dir/tests/mitigations.sql" "db:$work_dir/tests/"
  "${compose[@]}" exec -T db sh -c \
    'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$1/tests/mitigations.sql"' \
    sh "$work_dir"
  echo 'Mitigation merge checks passed; all test changes were rolled back.'
else
  "${compose[@]}" exec -T db sh -c \
    'exec psql -X -v ON_ERROR_STOP=1 -1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$1/sql/12-merge-mitigations.sql" -f "$1/sql/03-views.sql"' \
    sh "$work_dir"
  echo 'MITRE mitigations merged; all original IDs and technique relationships were preserved.'
fi
