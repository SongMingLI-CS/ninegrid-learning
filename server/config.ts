export function sessionCookieIsSecure(production: boolean, appOrigin: string | undefined): boolean {
  if (!production) return false;
  if (!appOrigin) throw new Error('APP_ORIGIN must be configured in production');
  let origin: URL;
  try { origin = new URL(appOrigin); } catch { throw new Error('APP_ORIGIN must be a valid origin'); }
  if (origin.protocol === 'https:') return true;
  if (origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) return false;
  throw new Error('Production APP_ORIGIN must use HTTPS; only loopback HTTP is allowed for isolated tests');
}
