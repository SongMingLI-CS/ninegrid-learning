#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  printf 'Usage: %s path/to/ninegrid-backup.dump\n' "$0" >&2
  exit 2
fi
printf 'This replaces objects in the configured NineGrid database. Confirm a recent backup exists.\n'
docker compose exec -T db sh -c 'pg_restore --clean --if-exists --no-owner --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' < "$1"
printf 'Restore finished. Verify accounts, seasons, ledger balances, and attachment metadata before reopening traffic.\n'
