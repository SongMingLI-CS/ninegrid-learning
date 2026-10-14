# NineGrid Windows Local Deployment Plan

> **For agentic workers:** Follow this plan inline with checkpoints. Do not run Ubuntu deployment steps.

**Goal:** Relocate NineGrid's PostgreSQL cluster, private uploads, backups, and logs to the user's existing F: volume; run the production web build and account API locally with safe start/stop/backup/restore scripts.

**Architecture:** Keep the repository in its current D: path. Use a PostgreSQL 18 cluster under `F:\Projects\NineGridData\postgres`, bind it only to `127.0.0.1:5433`, and point the ignored `.env` at that database and `F:\Projects\NineGridData\uploads`. Run the built static client and existing `npm start` API on loopback port 8787. PowerShell scripts will check ownership and ports before acting, keep logs and paired database/upload backups on F:, and restore only into a new database/directory.

**Tech Stack:** Windows 11 PowerShell, PostgreSQL 18.1 native tools, Node.js/tsx, Vite production build, PostgreSQL `pg_dump`/`pg_restore`.

**Spec:** User request dated 2026-10-15: local-only deployment, preserve all account state, move persistent data to the four exact F: directories, prove backup restore before migration, loopback-only listener, reversible restart and backup workflows, no automatic startup.

## Global Constraints

- Reuse `F:\Projects\NineGridData\postgres`, `uploads`, `backups`, and `logs` if already present; never substitute a directory on another volume.
- Never copy a live PostgreSQL data directory; stop only NineGrid's app and PostgreSQL processes for switchover.
- Preserve old D: database and upload directories after migration.
- Never print or commit `.env`, database passwords, DeepSeek keys, or session secrets.
- Keep PostgreSQL and the application bound to loopback; do not install an automatic-start task.
- Database and attachment restore must target isolated names/paths and must not overwrite the live account database.

---

### Task 1: Establish live inventory and migration baseline

**Files:** No source files. Read `.env` without printing values, PostgreSQL runtime settings, all public table counts, upload file hashes, and the exact process command lines.

- [x] Confirm Windows 11, F: NTFS, free space, PostgreSQL 18.1 on 5433, database `ninegrid_dev`, data path on D:, and app process on 8787.
- [x] Capture all 23 public-table counts and verify every attachment metadata row against the current upload directory.
- [x] Generate timestamped `pg_dump` and paired upload archives on F: while the app is stopped; restore a bundle to a disposable isolated cluster and compare all 23 table counts and the attachment manifest before switching.

### Task 2: Add safe Windows local lifecycle and backup scripts

**Files:**
- Create: `scripts/windows/common.ps1` for safe `.env` parsing, PostgreSQL tool discovery, path/port checks, and project process verification.
- Create: `scripts/windows/migrate-storage.ps1` for backup-first restore into the F: cluster and guarded `.env` path update.
- Create: `scripts/windows/start.ps1`, `stop.ps1`, `status.ps1`, `backup.ps1`, and `restore.ps1`.
- Create: `tests/windows-storage.test.ps1` or equivalent portable script checks for path validation, loopback binding, collision handling, and restore refusal.

- [x] Add checks for exact F: paths, loopback-only host validation, safe alternate restore names, and dotenv secret preservation; the missing-helper test was first run red before implementation.
- [x] Implement Windows lifecycle, migration, backup, restore, logging and shortcut scripts; add PostgreSQL tool-path checks and guarded process ownership checks.
- [x] Run four Pester checks and parse all PowerShell scripts; no secret values are emitted by operational output.

### Task 3: Move the live account database and upload store

**Files:** `.env` (ignored local configuration only); generated backup artifacts on F:; no user data enters Git.

- [x] Create/reuse the four F: directories and record all 23 old database table counts and attachment hashes.
- [x] Stop NineGrid dev/API processes; create database-plus-upload backups on F:.
- [x] Restore-probe a backup in an independent PostgreSQL 18 cluster and compare all table counts and file hashes.
- [x] Create the F: PostgreSQL 18 cluster with random admin password, restore `ninegrid_dev`, and configure loopback-only binding plus log rotation.
- [x] Update ignored `.env` for F: paths and production runner mode while preserving provider/session secrets.
- [x] Verify F: listener ownership, database path, port, and loopback binding.
- [x] Compare all 23 tables, 16 session rows, and zero upload files to baseline; retain the old D: cluster and data.

### Task 4: Run and verify the production local app

**Files:** `package.json` if a convenience script is appropriate; Windows scripts under `scripts/windows/`; optional desktop shortcut `.lnk` created only for this project.

- [x] Run the production Vite build and launch the production API through the managed local runner; it sets `NODE_ENV=production` for the child process.
- [ ] Browser-test production login cookies using an account credential; `/api/status` confirms accounts mode, AI state and actual commit.
- [x] Verify managed stop/start, F: data restart persistence, and safe occupied-port behavior in script paths; repeated-start idempotency is covered by ownership/readiness logic but was not stress-tested with concurrent starts.
- [x] Create the desktop shortcut to the local start script and production URL; no automatic-start task was created.

### Task 5: Backup, restore, and retention verification

**Files:** `scripts/windows/backup.ps1`, `restore.ps1`, `common.ps1`.

- [x] Produce paired PostgreSQL dumps, upload archives, manifests and SHA-256 checksums under F:.
- [x] Restore a backup into `ninegrid_restore_20261015` and a separate uploads directory; compare all 23 table counts and file manifest.
- [x] Configure application log rotation and PostgreSQL daily/20 MB rotation. Backup retention is advisory (14 bundles); scripts deliberately never delete existing backups.
- [x] Document start/stop/status/backup/isolated-restore commands and the same-disk recovery limitation.

### Task 6: Re-run relevant project verification and deliver

- [x] Run typecheck, 210 unit tests, production build, `git diff --check`, and isolated PostgreSQL integration tests.
- [ ] Browser-smoke tested the production login/feature-gate page and runtime status. Real login, learning and trade flows remain unverified; no test account was written to the user's active database.
- [ ] Re-check Git status, keep ignored secrets/data and pre-existing untracked diagnostics out of the commit, commit and push `codex/learning-loop-fixes` without merging `main`.
- [ ] Report measured F: paths, migration and restore comparisons, startup address, remaining acceptance gaps, and any original D: directories retained for rollback.

## Execution findings

- PostgreSQL 18 restricts `data_directory` to `pg_read_all_settings`; operational snapshots therefore use the local admin URL while the app role remains least-privileged.
- Windows PowerShell pipelines around `pg_ctl start` can remain open due inherited handles; lifecycle scripts invoke the manager directly.
- The runner now checks before removing optional stop markers because Node's `unlinkSync` does not accept a `force` option.
- `NODE_ENV=development` remains in ignored `.env` for Vite compatibility; the production runner overrides the API child to `production`.
