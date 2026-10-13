#!/usr/bin/env sh
set -eu

backup_dir="${1:-./backups}"
mkdir -p "$backup_dir"
umask 077
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
database="$backup_dir/ninegrid-$stamp.dump"
attachments="$backup_dir/ninegrid-$stamp.attachments.tar.gz"
manifest="$backup_dir/ninegrid-$stamp.sha256"
temporary="$database.tmp"
temporary_attachments="$attachments.tmp"
trap 'rm -f "$temporary" "$temporary_attachments"' EXIT HUP INT TERM

docker compose exec -T db sh -c 'pg_dump --format=custom --no-owner --username="$POSTGRES_USER" "$POSTGRES_DB"' > "$temporary"
docker compose exec -T app sh -c 'tar -czf - -C "$UPLOAD_DIR" .' > "$temporary_attachments"
mv "$temporary" "$database"
mv "$temporary_attachments" "$attachments"
(cd "$backup_dir" && sha256sum "$(basename "$database")" "$(basename "$attachments")" > "$(basename "$manifest")")
printf 'Database backup: %s\nPrivate attachment backup: %s\nChecksums: %s\n' "$database" "$attachments" "$manifest"
