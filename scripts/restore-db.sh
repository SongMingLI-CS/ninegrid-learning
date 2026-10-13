#!/usr/bin/env sh
set -eu

if [ "$#" -ne 2 ] || [ ! -f "$1" ] || [ ! -f "$2" ]; then
  printf 'Usage: RESTORE_DB=ninegrid_restore %s path/to/database.dump path/to/attachments.tar.gz\n' "$0" >&2
  exit 2
fi
restore_db="${RESTORE_DB:-}"
case "$restore_db" in
  ''|*[!a-zA-Z0-9_]*) printf 'Set RESTORE_DB to a new, safe database name.\n' >&2; exit 2 ;;
esac
if [ "$restore_db" = "${POSTGRES_DB:-ninegrid}" ]; then
  printf 'Refusing to restore over the configured application database.\n' >&2
  exit 2
fi
restore_uploads="/var/lib/ninegrid/uploads/restore-$restore_db"

docker compose exec -T db sh -ec 'createdb --username "$POSTGRES_USER" "$1"' sh "$restore_db"
docker compose exec -T db sh -ec 'pg_restore --no-owner --username "$POSTGRES_USER" --dbname "$1"' sh "$restore_db" < "$1"
docker compose exec -T app sh -ec 'mkdir -m 700 "$1"' sh "$restore_uploads"
docker compose exec -T app sh -ec 'tar -xzf - -C "$1"' sh "$restore_uploads" < "$2"
docker compose exec -T db sh -ec 'psql --username "$POSTGRES_USER" --dbname "$1" --tuples-only --no-align --command "SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM seasons), (SELECT count(*) FROM reward_ledger), (SELECT count(*) FROM attachments);"' sh "$restore_db"
printf 'Restored to isolated database %s and attachment directory %s. The live database and uploads were not changed.\n' "$restore_db" "$restore_uploads"
