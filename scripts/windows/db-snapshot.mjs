import 'dotenv/config';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const connectionString = process.env.NINEGRID_DATABASE_URL || process.env.DATABASE_URL;
const uploadDirectory = path.resolve(process.env.NINEGRID_UPLOAD_DIR || process.env.UPLOAD_DIR || 'data/uploads');
if (!connectionString) throw new Error('DATABASE_URL is required for a NineGrid snapshot.');

async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function listFiles(root) {
  if (!existsSync(root)) return [];
  const result = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(fullPath));
    else if (entry.isFile()) result.push(fullPath);
  }
  return result;
}

const pool = new Pool({ connectionString, application_name: 'ninegrid-local-admin' });
try {
  const runtime = (await pool.query(`SELECT current_database() AS database,
    current_setting('server_version') AS server_version,
    current_setting('data_directory') AS data_directory,
    inet_server_addr()::text AS listen_address,
    inet_server_port() AS listen_port,
    pg_size_pretty(pg_database_size(current_database())) AS database_size`)).rows[0];
  const tables = (await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`)).rows.map(row => row.tablename);
  const counts = {};
  for (const table of tables) {
    const quoted = `"${table.replaceAll('"', '""')}"`;
    counts[table] = Number((await pool.query(`SELECT count(*)::bigint AS count FROM public.${quoted}`)).rows[0].count);
  }
  const attachments = (await pool.query('SELECT storage_key, byte_size, sha256 FROM attachments ORDER BY storage_key')).rows;
  const actualFiles = new Map();
  for (const file of listFiles(uploadDirectory)) actualFiles.set(path.relative(uploadDirectory, file).replaceAll(path.sep, '/'), file);
  const uploadManifest = [];
  const mismatches = [];
  for (const [name, file] of actualFiles) {
    const stat = statSync(file);
    uploadManifest.push({ key: name, bytes: stat.size, sha256: await hashFile(file) });
  }
  uploadManifest.sort((left, right) => left.key.localeCompare(right.key, 'en'));
  const uploadByName = new Map(uploadManifest.map(file => [file.key, file]));
  for (const attachment of attachments) {
    const file = uploadByName.get(attachment.storage_key);
    if (!file) { mismatches.push({ key: attachment.storage_key, issue: 'missing' }); continue; }
    if (file.bytes !== Number(attachment.byte_size) || file.sha256 !== attachment.sha256) mismatches.push({ key: attachment.storage_key, issue: 'metadata_mismatch' });
  }
  const known = new Set(attachments.map(row => row.storage_key));
  const unreferencedUploadCount = [...actualFiles.keys()].filter(name => !known.has(name)).length;
  console.log(JSON.stringify({ runtime, tableCount: tables.length, counts, uploadDirectory, uploadFileCount: actualFiles.size, attachmentCount: attachments.length, uploadManifest, attachmentMismatchCount: mismatches.length, attachmentMismatches: mismatches, unreferencedUploadCount }, null, 2));
  if (mismatches.length) process.exitCode = 2;
} finally {
  await pool.end();
}
