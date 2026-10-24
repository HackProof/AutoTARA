#!/usr/bin/env bash
# Replace only the two managed catalog schemas; preserve a restorable dump first.
set -euo pipefail
umask 077
db_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$db_dir"
compose=(docker compose --project-directory "$db_dir" -f "$db_dir/docker-compose.yml")
backup_dir=${BACKUP_DIR:-"$db_dir/backups"}
mkdir -p "$backup_dir"
partial=$(mktemp "$backup_dir/catalog-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX.dump.partial")
if ! "${compose[@]}" exec -T db sh -c \
  'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -n vehicle_lang -n vehicle_lang_source' > "$partial"; then
  rm -f -- "$partial"
  exit 1
fi
backup=${partial%.partial}
mv -- "$partial" "$backup"
echo "Catalog backup: $backup"

work_dir=$("${compose[@]}" exec -T db mktemp -d /tmp/autotara-import.XXXXXX)
cleanup() { "${compose[@]}" exec -T db rm -rf -- "$work_dir"; }
trap cleanup EXIT
"${compose[@]}" cp "$db_dir/data" "db:$work_dir/data"
"${compose[@]}" cp "$db_dir/sql" "db:$work_dir/sql"
"${compose[@]}" exec -T db sh -c \
  'cd "$1/data"; exec psql -X -v ON_ERROR_STOP=1 -1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$1/sql/08-refresh.sql"' \
  sh "$work_dir"
echo 'Catalog refreshed and validated. Other database schemas were preserved.'
