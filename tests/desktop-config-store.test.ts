import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { persistSecureConfiguration } from '../desktop/secure-config-store.cjs';

const config = {
  DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5433/ninegrid_dev',
  DATABASE_ADMIN_URL: 'postgresql://admin:pass@127.0.0.1:5433/postgres',
  SESSION_SECRET: 's'.repeat(48),
};

function dependencies(decrypt: (bytes: Uint8Array) => string = bytes => Buffer.from(bytes).toString('utf8')) {
  return {
    encrypt: async (text: string) => Buffer.from(text, 'utf8'),
    decrypt: async (bytes: Uint8Array) => decrypt(bytes),
    validate: (value: Record<string, string>) => ({ ok: Boolean(value.DATABASE_URL && value.DATABASE_ADMIN_URL && value.SESSION_SECRET?.length >= 32) }),
  };
}

describe('desktop secure configuration persistence', () => {
  it('verifies the file after atomic replacement before reporting success', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'ninegrid-config-'));
    const filePath = path.join(directory, 'secure-config.bin');
    const stages: string[] = [];
    try {
      const result = await persistSecureConfiguration({ filePath, values: config, ...dependencies(), onStage: stage => stages.push(stage) });

      expect(result).toEqual({ ok: true, values: config });
      expect(JSON.parse((await readFile(filePath)).toString('utf8'))).toEqual(config);
      expect(stages).toEqual(['write-started', 'temporary-file-written', 'temporary-file-verified', 'file-replaced', 'readback-verified']);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('restores the previous bytes when target readback verification fails', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'ninegrid-config-'));
    const filePath = path.join(directory, 'secure-config.bin');
    const oldBytes = Buffer.from('previous-good-config');
    await writeFile(filePath, oldBytes);
    const readFileFromDisk = vi.fn(async (target: string) => readFile(target));
    readFileFromDisk.mockImplementationOnce(async () => oldBytes);
    readFileFromDisk.mockImplementationOnce(async target => readFile(target));
    readFileFromDisk.mockImplementationOnce(async () => { throw Object.assign(new Error('readback failed'), { code: 'EIO' }); });
    try {
      await expect(persistSecureConfiguration({
        filePath,
        values: config,
        ...dependencies(),
        readFile: readFileFromDisk,
      })).rejects.toThrow('读回校验失败');

      expect(await readFile(filePath)).toEqual(oldBytes);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
