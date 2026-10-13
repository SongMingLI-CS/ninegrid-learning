import { describe, expect, it } from 'vitest';
import { sessionCookieIsSecure } from '../server/config';

describe('deployment origin cookie policy', () => {
  it('requires Secure session cookies for HTTPS production and permits loopback-only HTTP tests', () => {
    expect(sessionCookieIsSecure(true, 'https://learn.example')).toBe(true);
    expect(sessionCookieIsSecure(true, 'http://localhost:18787')).toBe(false);
    expect(sessionCookieIsSecure(false, undefined)).toBe(false);
    expect(() => sessionCookieIsSecure(true, 'http://learn.example')).toThrow(/HTTPS/);
  });
});
