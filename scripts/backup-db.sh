#!/usr/bin/env sh
set -eu

backup_dir="${1:-./backups}"
mkdir -p "$backup_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
destination="$backup_dir/ninegrid-$stamp.dump"
docker compose exec -T db sh -c 'pg_dump --format=custom --no-owner --username="$POSTGRES_USER" "$POSTGRES_DB"' > "$destination"
printf 'Database backup written to %s\n' "$destination"
printf 'Remember to back up the ninegrid-uploads volume separately; it contains private image evidence.\n'
