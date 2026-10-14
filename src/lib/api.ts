let accountMode: Promise<boolean> | undefined;

async function accountsEnabled(): Promise<boolean> {
  accountMode ??= fetch('/api/status', { credentials: 'same-origin' }).then(async response => {
    if (!response.ok) throw new Error(`/api/status returned HTTP ${response.status}`);
    const status = await response.json() as { accounts?: unknown };
    return status.accounts === true;
  }).catch(error => {
    accountMode = undefined;
    throw new Error(`Cannot determine server account mode: ${error instanceof Error ? error.message : 'connection failed'}`);
  });
  return accountMode;
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && await accountsEnabled()) {
    const csrf = await fetch('/api/auth/csrf', { credentials: 'same-origin', signal: init.signal });
    if (csrf.ok) {
      const payload = await csrf.json() as { token?: unknown };
      if (typeof payload.token !== 'string' || !payload.token) throw new Error('CSRF token response was invalid');
      headers.set('x-csrf-token', payload.token);
    }
  }
  return fetch(input, { ...init, headers, credentials: 'same-origin' });
}
