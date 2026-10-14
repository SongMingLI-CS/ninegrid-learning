import { describe, expect, it } from 'vitest';
import { decryptStoredText } from '../desktop/secure-config.cjs';

describe('Electron DPAPI configuration decoding', () => {
  it('extracts the async safeStorage result object instead of parsing it as a string', async () => {
    const value = await decryptStoredText(Buffer.from('encrypted'), {
      decryptStringAsync: async () => ({ result: '{"DATABASE_URL":"postgresql://local"}', shouldReEncrypt: false }),
    });
    expect(value).toBe('{"DATABASE_URL":"postgresql://local"}');
  });

  it('retries once when safeStorage reports key rotation', async () => {
    let calls = 0;
    const value = await decryptStoredText(Buffer.from('encrypted'), {
      decryptStringAsync: async () => {
        calls += 1;
        return calls === 1
          ? { result: 'old-value', shouldReEncrypt: true }
          : { result: 'new-value', shouldReEncrypt: false };
      },
    });
    expect(value).toBe('new-value');
    expect(calls).toBe(2);
  });
});
