import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../src/lib/api';

afterEach(() => vi.unstubAllGlobals());

describe('API runtime mode detection', () => {
  it('surfaces a failed status check instead of treating the server as local mode', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiFetch('/api/seasons', { method: 'POST', body: '{}' })).rejects.toThrow(/Cannot determine server account mode/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
