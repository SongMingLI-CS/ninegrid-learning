import { describe, expect, it, vi } from 'vitest';
import { readSecureConfiguration } from '../desktop/secure-config-loader.cjs';

const validConfig = {
  DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5433/ninegrid_dev',
  DATABASE_ADMIN_URL: 'postgresql://admin:pass@127.0.0.1:5433/postgres',
  SESSION_SECRET: 's'.repeat(48),
};

function dependencies(decryptedText: string) {
  const stages: string[] = [];
  return {
    stages,
    readFile: vi.fn(async () => Buffer.from('encrypted-config')),
    isEncryptionAvailable: vi.fn(async () => true),
    decrypt: vi.fn(async () => decryptedText),
    validate: vi.fn((value: Record<string, string>) => ({ ok: Boolean(value.DATABASE_URL && value.DATABASE_ADMIN_URL && value.SESSION_SECRET?.length >= 32) })),
    onStage: (stage: string, _details?: unknown) => stages.push(stage),
  };
}

describe('desktop secure configuration loading', () => {
  it('distinguishes a missing encrypted file without leaking config values', async () => {
    const deps = dependencies(JSON.stringify(validConfig));
    deps.readFile.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));

    const result = await readSecureConfiguration({ filePath: 'C:/profile/NineGrid/secure-config.bin', ...deps });

    expect(result).toEqual({ ok: false, reason: 'missing' });
    expect(deps.stages).toEqual(['file-missing']);
  });

  it('does not report a missing file when the same path still exists after ENOENT', async () => {
    const deps = dependencies(JSON.stringify(validConfig));
    const stages: Array<[string, unknown]> = [];
    deps.readFile.mockRejectedValue(Object.assign(new Error('transient path race'), { code: 'ENOENT', syscall: 'open', path: 'C:/profile/NineGrid/secure-config.bin' }));

    const result = await readSecureConfiguration({
      filePath: 'C:/profile/NineGrid/secure-config.bin',
      ...deps,
      fileExists: async () => true,
      onStage: (stage: string, details: unknown) => stages.push([stage, details]),
    });

    expect(result).toEqual({ ok: false, reason: 'read-failed' });
    expect(stages).toEqual([['file-read-failed', { code: 'ENOENT', syscall: 'open', path: 'C:/profile/NineGrid/secure-config.bin', fileStillExists: true }]]);
  });

  it('reports each successful load phase without recording decrypted values', async () => {
    const deps = dependencies(JSON.stringify(validConfig));

    const result = await readSecureConfiguration({ filePath: 'C:/profile/NineGrid/secure-config.bin', ...deps });

    expect(result).toEqual({ ok: true, values: validConfig });
    expect(deps.stages).toEqual(['file-present', 'decrypted', 'parsed', 'validated']);
  });

  it('classifies decryption, JSON and field validation failures separately', async () => {
    const decryptFailure = dependencies('');
    decryptFailure.decrypt.mockRejectedValue(new Error('opaque DPAPI error'));
    const parseFailure = dependencies('{broken json');
    const fieldFailure = dependencies(JSON.stringify({ DATABASE_URL: 'not-a-database-url' }));

    const decryptResult = await readSecureConfiguration({ filePath: 'secure-config.bin', ...decryptFailure });
    const parseResult = await readSecureConfiguration({ filePath: 'secure-config.bin', ...parseFailure });
    const fieldResult = await readSecureConfiguration({ filePath: 'secure-config.bin', ...fieldFailure });

    expect(decryptResult).toEqual({ ok: false, reason: 'decrypt-failed' });
    expect(parseResult).toEqual({ ok: false, reason: 'parse-failed' });
    expect(fieldResult).toEqual({ ok: false, reason: 'invalid-fields' });
    expect([...decryptFailure.stages, ...parseFailure.stages, ...fieldFailure.stages]).not.toContain('opaque DPAPI error');
  });
});
