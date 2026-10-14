const path = require('node:path');

function normalizeWindowsPath(value) {
  return path.win32.resolve(value).replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
}

function resolveDataPaths(root) {
  const normalizedRoot = path.win32.resolve(root).replaceAll('\\', '/').replace(/\/$/, '');
  return {
    root: normalizedRoot,
    postgres: `${normalizedRoot}/postgres`,
    uploads: `${normalizedRoot}/uploads`,
    backups: `${normalizedRoot}/backups`,
    logs: `${normalizedRoot}/logs`,
  };
}

function classifyDatabaseListener(inUse, probe, expectedDataDirectory) {
  if (!inUse) return { action: 'start', ownsProcess: true };
  const matches = probe?.running === true && probe.major === '18' &&
    normalizeWindowsPath(probe.dataDirectory ?? '') === normalizeWindowsPath(expectedDataDirectory);
  return matches
    ? { action: 'reuse', ownsProcess: false }
    : { action: 'refuse', ownsProcess: false, reason: 'database_listener_not_matching_ninegrid_cluster' };
}

function classifyApiListener(inUse, status, expectedDatabase, expectedDataDirectory) {
  if (!inUse) return { action: 'start', ownsProcess: true };
  const actual = status?.databaseIdentity;
  const matches = status?.application === 'ninegrid-learning' && status.environment === 'production' &&
    status.runtimeMode === 'accounts' && status.accounts === true &&
    actual?.host === expectedDatabase?.host && Number(actual?.port) === Number(expectedDatabase?.port) &&
    actual?.database === expectedDatabase?.database &&
    (!expectedDataDirectory || normalizeWindowsPath(status?.dataDirectory ?? '') === normalizeWindowsPath(expectedDataDirectory));
  return matches
    ? { action: 'reuse', ownsProcess: false }
    : { action: 'refuse', ownsProcess: false, reason: 'api_listener_not_matching_ninegrid_runtime' };
}

function mayStopOwnedProcess(processHandle) {
  return processHandle?.owned === true && Number.isInteger(processHandle.pid) && processHandle.pid > 0;
}

function validateExternalUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isLoopbackOnly(value) {
  const addresses = String(value ?? '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
  return addresses.length > 0 && addresses.every(address => ['127.0.0.1', '::1', 'localhost'].includes(address));
}

function computeWindowGeometry(available) {
  const width = Math.max(Math.min(980, Math.max(320, available.width - 40)), Math.min(1440, Math.floor(available.width * 0.82)));
  const height = Math.max(Math.min(660, Math.max(300, available.height - 48)), Math.min(940, Math.floor(available.height * 0.88)));
  return { width: Math.min(width, available.width), height: Math.min(height, available.height), minWidth: Math.min(980, width, available.width), minHeight: Math.min(660, height, available.height) };
}

function validateExistingCluster({ rootExists, pgVersion }) {
  if (!rootExists) return { ok: false, code: 'cluster_missing' };
  if (String(pgVersion ?? '').trim() !== '18') return { ok: false, code: 'version_mismatch' };
  return { ok: true };
}

function parseEnvironmentText(text) {
  const allowed = new Set(['DATABASE_URL', 'DATABASE_ADMIN_URL', 'SESSION_SECRET', 'DEEPSEEK_API_KEY', 'YOUTUBE_API_KEY']);
  const values = {};
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match || !allowed.has(match[1])) continue;
    let value = match[2].trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') value = value.replaceAll('\\n', '\n').replaceAll('\\r', '\r');
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    values[match[1]] = value;
  }
  return values;
}

function validateDesktopConfig(values) {
  try {
    const required = ['DATABASE_URL', 'DATABASE_ADMIN_URL', 'SESSION_SECRET'];
    if (required.some(key => !String(values?.[key] ?? '').trim())) return { ok: false, code: 'invalid_required_config' };
    if (String(values.SESSION_SECRET).trim().length < 32) return { ok: false, code: 'invalid_required_config' };
    const parsedUrls = {};
    for (const key of ['DATABASE_URL', 'DATABASE_ADMIN_URL']) {
      const url = new URL(values[key]);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
        return { ok: false, code: 'invalid_required_config' };
      }
      const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
      if (Number(url.port || 5432) !== 5433 || !/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(database) || !url.username || !url.password) return { ok: false, code: 'invalid_required_config' };
      parsedUrls[key] = url;
    }
    if (parsedUrls.DATABASE_URL.hostname !== parsedUrls.DATABASE_ADMIN_URL.hostname || parsedUrls.DATABASE_URL.port !== parsedUrls.DATABASE_ADMIN_URL.port) return { ok: false, code: 'invalid_required_config' };
    return { ok: true };
  } catch {
    return { ok: false, code: 'invalid_required_config' };
  }
}

module.exports = {
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
};
