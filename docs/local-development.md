# Local account development

This setup is for the isolated development copy on this Mac. It does not point at production or another project's database.

## Start

1. Keep `.env` in the repository root. It is Git-ignored and mode `0600`; it contains this machine's random database password and session secret. Do not paste it into logs or commit it. Do not replace an existing `DEEPSEEK_API_KEY` while editing it.
2. Start the persistent local PostgreSQL cluster:

   ```sh
   /Library/PostgreSQL/18/bin/pg_ctl \
     -D data/ninegrid-dev-postgres/cluster \
     -l data/ninegrid-dev-postgres/postgres.log \
     -o "-p 55432 -h 127.0.0.1 -k $PWD/data/ninegrid-dev-postgres/socket -c max_connections=40 -c shared_buffers=128MB" \
     start
   ```

3. Apply migrations and start the API plus Vite:

   ```sh
   npm run db:migrate
   npm run dev
   ```

   Open <http://127.0.0.1:5173/>. Vite proxies `/api` to `127.0.0.1:8787`. `/api/status` reports the runtime commit, branch, dirty-worktree flag, startup time, account mode, and AI configuration without revealing secrets.

The cluster is stored at `data/ninegrid-dev-postgres/cluster`; app data survives stopping the processes. The database is `ninegrid_dev`, owned by the restricted local app role configured in `.env`. PostgreSQL listens only on loopback port `55432`.

## Stop and restart

Stop the `npm run dev` terminal with Ctrl+C, then stop PostgreSQL cleanly:

```sh
/Library/PostgreSQL/18/bin/pg_ctl -D data/ninegrid-dev-postgres/cluster -m fast -w stop
```

Restart with the Start steps. A normal stop does not remove the cluster or account data.

## Backup and restore

Create a private, dated custom-format backup. This uses the configured account URL without printing it:

```sh
mkdir -p backups
set -a
. ./.env
set +a
umask 077
pg_dump "$DATABASE_URL" --format=custom --file="backups/ninegrid-dev-$(date +%Y%m%d-%H%M%S).dump"
unset DATABASE_URL SESSION_SECRET DEEPSEEK_API_KEY
```

Restore into a separate, empty development database so the existing cluster is not overwritten. Use the local PostgreSQL administrator account to create the destination, then the same app URL credentials with the database name changed in a private shell variable. Verify `/api/status` and account login against the restored copy before switching `.env`. Never restore this development dump to production.

## Limits

- `.env`, `data/`, `backups/`, `dist/`, and logs are ignored by Git.
- Keep the local cluster bound to `127.0.0.1`; do not expose it to a LAN.
- This account environment currently has no configured DeepSeek key. AI requests must show a clear unavailable state; mock-provider tests are not real-model verification.
- The demo test account is disposable and separate from browser local archives. Do not import a user's local archive unless they explicitly review and confirm the migration preview.
