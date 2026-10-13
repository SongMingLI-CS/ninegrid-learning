import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import express, { type Express, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { csrfSync } from 'csrf-sync';
import type { Pool } from 'pg';
import { z } from 'zod';

declare module 'express-session' {
  interface SessionData { userId?: string }
}

const credentialsSchema = z.object({
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  password: z.string().min(12).max(128),
}).strict();
const { generateToken, csrfSynchronisedProtection } = csrfSync();
export const protectStateChangeWithCsrf = csrfSynchronisedProtection;

export interface AuthOptions { pool: Pool }

function invalid(res: Response): void { res.status(400).json({ error: 'INVALID_REQUEST' }); }
function publicUser(row: { id: string; email: string; created_at: Date | string }) {
  return { id: row.id, email: row.email, createdAt: new Date(row.created_at).toISOString() };
}

export function requireAuthenticated(req: Request, res: Response, next: express.NextFunction): void {
  if (!req.session.userId) { res.status(401).json({ error: 'AUTH_REQUIRED' }); return; }
  next();
}

export function mountAuthRoutes(app: Express, { pool }: AuthOptions): void {
  const router = express.Router();
  const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'RATE_LIMITED' } });
  router.get('/csrf', (req, res) => res.json({ token: generateToken(req) }));
  router.use(csrfSynchronisedProtection);

  router.post('/register', loginLimiter, async (req, res, next) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) { invalid(res); return; }
    try {
      const passwordHash = await argon2.hash(parsed.data.password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
      const id = randomUUID();
      const result = await pool.query<{ id: string; email: string; created_at: Date | string }>(
        'INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email, created_at',
        [id, parsed.data.email, passwordHash],
      );
      req.session.regenerate(error => {
        if (error) { next(error); return; }
        req.session.userId = id;
        req.session.save(saveError => {
          if (saveError) { next(saveError); return; }
          res.status(201).json({ user: publicUser(result.rows[0]) });
        });
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') { res.status(409).json({ error: 'ACCOUNT_EXISTS' }); return; }
      next(error);
    }
  });

  router.post('/login', loginLimiter, async (req, res, next) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) { invalid(res); return; }
    try {
      const result = await pool.query<{ id: string; email: string; password_hash: string; created_at: Date | string }>(
        'SELECT id, email, password_hash, created_at FROM users WHERE email = $1', [parsed.data.email],
      );
      const row = result.rows[0];
      const valid = row ? await argon2.verify(row.password_hash, parsed.data.password).catch(() => false) : false;
      if (!valid || !row) { res.status(401).json({ error: 'INVALID_CREDENTIALS' }); return; }
      req.session.regenerate(error => {
        if (error) { next(error); return; }
        req.session.userId = row.id;
        req.session.save(saveError => {
          if (saveError) { next(saveError); return; }
          res.json({ user: publicUser(row) });
        });
      });
    } catch (error) { next(error); }
  });

  router.get('/me', async (req, res, next) => {
    if (!req.session.userId) { res.status(200).json({ user: null }); return; }
    try {
      const result = await pool.query<{ id: string; email: string; created_at: Date | string }>(
        'SELECT id, email, created_at FROM users WHERE id = $1', [req.session.userId],
      );
      if (!result.rows[0]) { req.session.destroy(() => undefined); res.status(200).json({ user: null }); return; }
      res.json({ user: publicUser(result.rows[0]) });
    } catch (error) { next(error); }
  });

  router.post('/logout', (req, res, next) => {
    req.session.destroy(error => {
      if (error) { next(error); return; }
      res.clearCookie('ninegrid.sid', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
      res.status(204).end();
    });
  });
  app.use('/api/auth', router);
  app.use('/api/auth', (error: unknown, _req: Request, res: Response, next: express.NextFunction) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EBADCSRFTOKEN') { res.status(403).json({ error: 'CSRF_INVALID' }); return; }
    next(error);
  });
}
