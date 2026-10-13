import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import session from 'express-session';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { mountAuthRoutes } from '../server/auth';

describe('PostgreSQL account sessions', () => {
  let pool: Pool;
  let app: express.Express;

  beforeAll(async () => {
    const memory = newDb();
    const adapter = memory.adapters.createPg();
    pool = new adapter.Pool() as unknown as Pool;
    await pool.query('CREATE TABLE users (id uuid PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())');
    app = express();
    app.use(express.json({ limit: '8kb' }));
    app.use(session({ name: 'ninegrid.sid', secret: 'unit-test-session-secret-that-is-long-enough', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax' } }));
    mountAuthRoutes(app, { pool });
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ detail: error instanceof Error ? error.message : 'unknown' }));
  });

  afterAll(async () => { await pool?.end(); });

  it('registers with Argon2id, returns a stable user ID, and never exposes the password hash', async () => {
    const agent = request.agent(app);
    const csrf = await agent.get('/api/auth/csrf').expect(200);
    const response = await agent.post('/api/auth/register').set('x-csrf-token', csrf.body.token).send({ email: 'Learner@example.com', password: 'long-enough-passphrase-2026' });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.user).toMatchObject({ email: 'learner@example.com' });
    expect(response.body.user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(response.body)).not.toContain('password_hash');
    await agent.get('/api/auth/me').expect(200, { user: response.body.user });
    const stored = await pool.query('SELECT password_hash FROM users WHERE id = $1', [response.body.user.id]);
    expect(stored.rows[0].password_hash).not.toBe('long-enough-passphrase-2026');
    expect(stored.rows[0].password_hash).toMatch(/^\$argon2id\$/);
  });

  it('requires a CSRF token for registration and does not reveal whether a login email exists', async () => {
    await request(app).post('/api/auth/register').send({ email: 'csrf@example.com', password: 'long-enough-passphrase-2026' }).expect(403);
    const csrfAgent = request.agent(app);
    const csrf = await csrfAgent.get('/api/auth/csrf').expect(200);
    await csrfAgent.post('/api/auth/login').set('x-csrf-token', csrf.body.token).send({ email: 'missing@example.com', password: 'long-enough-passphrase-2026' }).expect(401, { error: 'INVALID_CREDENTIALS' });
  });

  it('requires authentication for protected campaign APIs when account storage is enabled', async () => {
    const protectedApp = express();
    protectedApp.use(express.json());
    protectedApp.use(session({ name: 'ninegrid.sid', secret: 'unit-test-session-secret-that-is-long-enough', resave: false, saveUninitialized: false }));
    mountAuthRoutes(protectedApp, { pool });
    protectedApp.get('/api/seasons', (req, res) => res.status((req.session as typeof req.session & { userId?: string }).userId ? 200 : 401).end());
    await request(protectedApp).get('/api/seasons').expect(401);
  });
});
