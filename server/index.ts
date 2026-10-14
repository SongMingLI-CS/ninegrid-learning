import 'dotenv/config';
import { createServer } from 'node:http';
import { createApp } from './app';
import { createPool, runMigrations } from './db';
import { sessionCookieIsSecure } from './config';

const port = Number(process.env.PORT ?? 8787);
const production = process.env.NODE_ENV === 'production';
const host = process.env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1');

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a valid TCP port');
}

async function start() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (production && !databaseUrl) throw new Error('DATABASE_URL is required in production; refusing to start without persistent account storage');
  const sessionSecret = process.env.SESSION_SECRET?.trim();
  if (production && (!sessionSecret || sessionSecret.length < 32)) throw new Error('SESSION_SECRET must be at least 32 characters in production');
  const appOrigin = process.env.APP_ORIGIN?.trim();
  const secureCookie = sessionCookieIsSecure(production, appOrigin);
  const pool = databaseUrl ? createPool(databaseUrl) : undefined;
  if (pool) await runMigrations(pool);
  const accountUnavailableReason = !databaseUrl && !sessionSecret
    ? 'missing_database_and_session_secret'
    : !databaseUrl ? 'missing_database'
      : !sessionSecret || sessionSecret.length < 32 ? 'missing_session_secret' : 'enabled';
  const app = createApp({
    ...(process.env.DEEPSEEK_API_KEY ? { apiKey: process.env.DEEPSEEK_API_KEY } : {}),
    ...(process.env.YOUTUBE_API_KEY ? { youtubeApiKey: process.env.YOUTUBE_API_KEY } : {}),
    accountUnavailableReason,
    ...(pool && sessionSecret ? { auth: { pool, sessionSecret, secureCookie, appOrigin } } : {}),
  });
  const trustProxy = process.env.TRUST_PROXY?.trim();
  if (trustProxy === '1') app.set('trust proxy', 1);
  else if (trustProxy && trustProxy !== '0') throw new Error('TRUST_PROXY accepts only 0 or 1; configure the exact proxy hop count');
  const server = createServer(app).listen(port, host, () => console.log(`NineGrid API listening on ${host}:${port}`));
  const close = () => server.close(() => { void pool?.end(); });
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
}

void start().catch(error => {
  console.error(error instanceof Error ? error.message : 'Server startup failed');
  process.exitCode = 1;
});
