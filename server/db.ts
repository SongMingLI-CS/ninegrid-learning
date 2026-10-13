import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { Pool as PgPool } from 'pg';

const MIGRATION_DIRECTORY = fileURLToPath(new URL('./migrations/', import.meta.url));

export async function runMigrations(pool: Pool, directory = MIGRATION_DIRECTORY): Promise<void> {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const files = (await readdir(directory)).filter(name => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort();
  for (const name of files) {
    const exists = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
    if (exists.rowCount) continue;
    const sql = await readFile(join(directory, name), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
}

export function createPool(connectionString = process.env.DATABASE_URL): Pool {
  if (!connectionString) throw new Error('DATABASE_URL is required when account persistence is enabled');
  return new PgPool({ connectionString, max: 12, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
}
