export type PublicDatabaseIdentity = { host: string; port: number; database: string };

export function publicDatabaseIdentity(connectionString: string | undefined): PublicDatabaseIdentity | null {
  if (!connectionString?.trim()) return null;
  try {
    const parsed = new URL(connectionString);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') return null;
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    if (!parsed.hostname || !database) return null;
    return { host: parsed.hostname, port: parsed.port ? Number(parsed.port) : 5432, database };
  } catch {
    return null;
  }
}
