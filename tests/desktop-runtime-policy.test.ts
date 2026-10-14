import { describe, expect, it } from 'vitest';
import {
  classifyApiListener,
  classifyDatabaseListener,
  computeWindowGeometry,
  isLoopbackOnly,
  mayStopOwnedProcess,
  parseEnvironmentText,
  resolveDataPaths,
  validateDesktopConfig,
  validateExistingCluster,
  validateExternalUrl,
} from '../desktop/runtime-policy.cjs';

describe('desktop runtime safety policy', () => {
  it('resolves all persistent paths beneath the selected data root', () => {
    expect(resolveDataPaths('F:/Projects/NineGridData')).toEqual({
      root: 'F:/Projects/NineGridData',
      postgres: 'F:/Projects/NineGridData/postgres',
      uploads: 'F:/Projects/NineGridData/uploads',
      backups: 'F:/Projects/NineGridData/backups',
      logs: 'F:/Projects/NineGridData/logs',
    });
  });

  it('reuses a database listener only when cluster path and major version match', () => {
    expect(classifyDatabaseListener(true, { running: true, dataDirectory: 'F:/Projects/NineGridData/postgres', major: '18' }, 'F:/Projects/NineGridData/postgres'))
      .toEqual({ action: 'reuse', ownsProcess: false });
    expect(classifyDatabaseListener(true, { running: true, dataDirectory: 'C:/OtherProject/postgres', major: '18' }, 'F:/Projects/NineGridData/postgres').action)
      .toBe('refuse');
    expect(classifyDatabaseListener(true, { running: true, dataDirectory: 'F:/Projects/NineGridData/postgres', major: '17' }, 'F:/Projects/NineGridData/postgres').action)
      .toBe('refuse');
  });

  it('reuses an API listener only when it identifies a compatible NineGrid runtime', () => {
    const expected = { host: '127.0.0.1', port: 5433, database: 'ninegrid_dev' };
    const status = {
      application: 'ninegrid-learning', version: '0.1.0', commit: 'abc123', workingTreeModified: false,
      environment: 'production', runtimeMode: 'accounts', accounts: true,
      databaseIdentity: expected, dataDirectory: 'F:/Projects/NineGridData',
    };
    expect(classifyApiListener(true, status, expected, 'F:/Projects/NineGridData', { version: '0.1.0', commit: 'abc123' }))
      .toEqual({ action: 'reuse', ownsProcess: false });
    expect(classifyApiListener(true, { ...status, commit: 'old123' }, expected, 'F:/Projects/NineGridData', { version: '0.1.0', commit: 'abc123' }).action)
      .toBe('refuse');
    expect(classifyApiListener(true, { ...status, workingTreeModified: true }, expected, 'F:/Projects/NineGridData', { version: '0.1.0', commit: 'abc123' }).action)
      .toBe('refuse');
    expect(classifyApiListener(true, { application: 'other-project' }, expected, 'F:/Projects/NineGridData').action)
      .toBe('refuse');
  });

  it('stops only process handles launched by this application instance', () => {
    expect(mayStopOwnedProcess({ owned: true, pid: 42 })).toBe(true);
    expect(mayStopOwnedProcess({ owned: false, pid: 42 })).toBe(false);
  });

  it('accepts only http and https external URLs', () => {
    expect(validateExternalUrl('https://www.youtube.com/watch?v=abc')).toBe(true);
    expect(validateExternalUrl('http://localhost:8787/')).toBe(true);
    expect(validateExternalUrl('file:///C:/secret.txt')).toBe(false);
    expect(validateExternalUrl('javascript:alert(1)')).toBe(false);
    expect(validateExternalUrl('not a url')).toBe(false);
  });

  it('accepts only loopback PostgreSQL listeners', () => {
    expect(isLoopbackOnly('127.0.0.1, ::1, localhost')).toBe(true);
    expect(isLoopbackOnly('*')).toBe(false);
    expect(isLoopbackOnly('0.0.0.0')).toBe(false);
  });

  it('keeps the initial desktop window within the actual work area', () => {
    const geometry = computeWindowGeometry({ width: 1365, height: 768 });
    expect(geometry.width).toBeLessThanOrEqual(1365);
    expect(geometry.height).toBeLessThanOrEqual(768);
    expect(geometry.minWidth).toBeLessThanOrEqual(geometry.width);
    expect(geometry.minHeight).toBeLessThanOrEqual(geometry.height);
  });

  it('requires an existing PostgreSQL 18 cluster and never accepts an empty path as a new database', () => {
    expect(validateExistingCluster({ rootExists: true, pgVersion: '18' })).toEqual({ ok: true });
    expect(validateExistingCluster({ rootExists: true, pgVersion: '17' })).toMatchObject({ ok: false, code: 'version_mismatch' });
    expect(validateExistingCluster({ rootExists: false, pgVersion: null })).toMatchObject({ ok: false, code: 'cluster_missing' });
  });

  it('parses selected configuration privately and validates required account settings without echoing values', () => {
    const parsed = parseEnvironmentText('DATABASE_URL="postgresql://u:p@127.0.0.1:5433/ninegrid_dev"\nDATABASE_ADMIN_URL="postgresql://admin:p@127.0.0.1:5433/postgres"\nSESSION_SECRET=12345678901234567890123456789012\nDEEPSEEK_API_KEY=sk-private # comment\n');
    expect(parsed.DEEPSEEK_API_KEY).toBe('sk-private');
    expect(validateDesktopConfig(parsed)).toEqual({ ok: true });
    expect(validateDesktopConfig({ DATABASE_URL: parsed.DATABASE_URL, DATABASE_ADMIN_URL: parsed.DATABASE_ADMIN_URL, SESSION_SECRET: 'short' }))
      .toMatchObject({ ok: false, code: 'invalid_required_config' });
    expect(validateDesktopConfig({ DATABASE_URL: parsed.DATABASE_URL, SESSION_SECRET: parsed.SESSION_SECRET }))
      .toMatchObject({ ok: false, code: 'invalid_required_config' });
    expect(validateDesktopConfig({ ...parsed, DATABASE_URL: 'postgresql://u:p@127.0.0.1:5433/ninegrid%27%3Bdrop%20table%20x' }))
      .toMatchObject({ ok: false, code: 'invalid_required_config' });
  });
});
