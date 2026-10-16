import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { buildSnapshotConnectionString } = require('../desktop/snapshot-connection.cjs') as {
  buildSnapshotConnectionString: (applicationConnectionString: string, adminConnectionString?: string) => string;
};

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

describe('desktop database snapshots', () => {
  it('uses admin credentials while targeting the application database', async () => {
    const result = buildSnapshotConnectionString(
      'postgresql://ninegrid_app:app-password@127.0.0.1:5433/ninegrid_dev',
      'postgresql://ninegrid_admin:admin-password@127.0.0.1:5433/postgres?sslmode=disable',
    );
    const parsed = new URL(result);

    expect(parsed.username).toBe('ninegrid_admin');
    expect(parsed.password).toBe('admin-password');
    expect(parsed.pathname).toBe('/ninegrid_dev');
    expect(parsed.searchParams.get('sslmode')).toBe('disable');
  });

  it('falls back to the application connection when no admin connection is configured', async () => {
    const appUrl = 'postgresql://ninegrid_app:app-password@127.0.0.1:5433/ninegrid_dev';
    expect(buildSnapshotConnectionString(appUrl, undefined)).toBe(appUrl);
  });

  it('rejects non-PostgreSQL snapshot connection URLs', () => {
    expect(() => buildSnapshotConnectionString('https://db.invalid/ninegrid', 'postgresql://admin@localhost/postgres'))
      .toThrow('NineGrid snapshot connections must use PostgreSQL URLs.');
  });

  it('uses the admin connection for pre-migration snapshots', async () => {
    const main = await read('../desktop/main.cjs');
    const runSnapshot = main.slice(main.indexOf('async function runSnapshot'), main.indexOf('async function createBackupBundle'));
    const createBackup = main.slice(main.indexOf('async function createBackupBundle'), main.indexOf('async function stopOwnedServices'));
    const backupScript = await read('../scripts/windows/backup.ps1');

    expect(runSnapshot).toContain('buildSnapshotConnectionString(db.connectionString, secrets.DATABASE_ADMIN_URL)');
    expect(createBackup).toContain('const dumpDb = db.admin ?? db');
    expect(createBackup).toContain('PGPASSWORD: dumpDb.password');
    expect(backupScript).toContain('$dumpDb = if ($config.ContainsKey(\'DATABASE_ADMIN_URL\')');
  });
});
