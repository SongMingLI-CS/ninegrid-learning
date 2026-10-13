import { describe, expect, it } from 'vitest';
import { DataType, newDb } from 'pg-mem';
import { randomUUID } from 'node:crypto';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import type { Pool } from 'pg';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { mountArchiveRoutes, persistEvaluation } from '../server/archive';
import { mountAttachmentRoutes } from '../server/attachments';
import { mountGenerationDraftRoutes } from '../server/generationDrafts';
import { COLLECTION_CATALOG, CATALOG_RARITY_COUNTS } from '../shared/catalog';
import { DEMO_CAMPAIGN } from '../src/lib/demo';
import { NUMPY_DEMO_CAMPAIGN } from '../src/lib/numpyDemo';
import { createProgressForCampaign } from '../src/lib/engine';
import { completeTask, markSelfChecked, setEvidence, setEvaluation } from '../src/lib/engine';
import type { LearningState } from '../shared/types';

async function fixture() {
  const memory = newDb();
  memory.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, implementation: randomUUID });
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool() as unknown as Pool;
  await pool.query('CREATE TABLE users (id uuid PRIMARY KEY)');
  await pool.query("INSERT INTO users (id) VALUES ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002')");
  await pool.query('CREATE TABLE seasons (id uuid PRIMARY KEY, owner_user_id uuid NOT NULL, campaign_id text NOT NULL, title text NOT NULL, revision integer NOT NULL DEFAULT 1, state jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_user_id,campaign_id))');
  await pool.query('CREATE TABLE reward_ledger (id uuid PRIMARY KEY, user_id uuid NOT NULL, season_id uuid NOT NULL, task_id text NOT NULL, kind text NOT NULL, idempotency_key text NOT NULL, reward jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,idempotency_key))');
  await pool.query('CREATE TABLE wallets (user_id uuid NOT NULL, currency text NOT NULL, balance bigint NOT NULL DEFAULT 0, PRIMARY KEY(user_id,currency))');
  await pool.query('CREATE TABLE inventory_items (user_id uuid NOT NULL, item_id text NOT NULL, definition jsonb NOT NULL, quantity integer NOT NULL DEFAULT 0, acquired_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,item_id))');
  await pool.query('CREATE TABLE inventory_item_preferences (user_id uuid NOT NULL,item_id text NOT NULL,is_locked boolean NOT NULL DEFAULT false,is_showcased boolean NOT NULL DEFAULT false,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,item_id))');
  await pool.query('CREATE TABLE inventory_sales (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,operation_id uuid NOT NULL,items jsonb NOT NULL,coins bigint NOT NULL CHECK(coins>0),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,operation_id))');
  await pool.query('CREATE TABLE task_evaluations (id uuid PRIMARY KEY, owner_user_id uuid NOT NULL, season_id uuid NOT NULL, task_id text NOT NULL, evidence_sha256 text NOT NULL, evaluation jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_user_id,season_id,task_id,evidence_sha256))');
  await pool.query("CREATE TABLE legacy_imports (id uuid PRIMARY KEY, owner_user_id uuid NOT NULL, source_sha256 text NOT NULL, season_ids uuid[] NOT NULL DEFAULT '{}', imported_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_user_id,source_sha256))");
  await pool.query('CREATE TABLE attachments (id uuid PRIMARY KEY, owner_user_id uuid NOT NULL, season_id uuid NOT NULL, task_id text NOT NULL, storage_key text UNIQUE NOT NULL, mime_type text NOT NULL, byte_size integer NOT NULL, width integer NOT NULL, height integer NOT NULL, sha256 text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())');
  await pool.query("CREATE TABLE generation_drafts (id uuid PRIMARY KEY, owner_user_id uuid NOT NULL, input_fingerprint text NOT NULL, input jsonb NOT NULL, rules_version integer NOT NULL, outline jsonb, batches jsonb NOT NULL DEFAULT '{}'::jsonb, status text NOT NULL, progress jsonb NOT NULL DEFAULT '{}'::jsonb, failure jsonb, final_campaign jsonb, activated_season_id uuid, revision integer NOT NULL DEFAULT 1, expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_user_id,input_fingerprint))");
  const app = express(); app.use(express.json({ limit: '10mb' }));
  app.use(session({ secret: 'archive-test-secret-that-is-long-enough', resave: false, saveUninitialized: true }));
  app.use((req, _res, next) => { (req.session as typeof req.session & { userId?: string }).userId = req.header('x-test-user') ?? '00000000-0000-4000-8000-000000000001'; next(); });
  mountArchiveRoutes(app, { pool });
  mountGenerationDraftRoutes(app, { pool });
  const directory = await mkdtemp(join(tmpdir(), 'ninegrid-attachments-'));
  mountAttachmentRoutes(app, { pool, directory, apiKey: 'vision-test-only', fetchImpl: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const message = body.messages[1].content;
    expect(message.some((part: { type: string; image_url?: { url?: string } }) => part.type === 'image_url' && part.image_url?.url?.startsWith('data:image/webp;base64,'))).toBe(true);
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ recognizedText: 'shape', analysis: 'The image illustrates array dimensions.', uncertainties: [], nextStep: 'Explain the dimensions without looking.' }) } }] }), { status: 200 });
  } });
  return { app, pool, directory };
}

function state(): LearningState {
  return { version: 2, campaign: structuredClone(DEMO_CAMPAIGN), progress: createProgressForCampaign(DEMO_CAMPAIGN), reviews: [], notes: {}, wallet: { currency: 'learning-coin', balance: 0 }, inventory: {}, rewardLedger: [] };
}

describe('server-owned learning archives', () => {
  it('defines the complete catalog by distinct rarity counts, separate from owned inventory', () => {
    expect(COLLECTION_CATALOG).toHaveLength(155);
    expect(CATALOG_RARITY_COUNTS).toEqual({ 'small-purple': 45, 'small-gold': 35, 'large-gold': 15, 'small-red': 35, 'large-red': 25 });
    expect(new Set(COLLECTION_CATALOG.map(item => item.id)).size).toBe(155);
    expect(COLLECTION_CATALOG.every(item => item.displayValue > item.sellPrice && item.imageKey && item.version === 1)).toBe(true);
  });

  it('settles account warehouse sales atomically, honors lock, and deduplicates operation IDs', async () => {
    const { app, pool, directory } = await fixture();
    const owner = '00000000-0000-4000-8000-000000000001';
    const other = '00000000-0000-4000-8000-000000000002';
    const item = COLLECTION_CATALOG[0];
    await pool.query('INSERT INTO inventory_items(user_id,item_id,definition,quantity) VALUES($1,$2,$3,1)', [owner, item.id, JSON.stringify(item)]);
    await pool.query('INSERT INTO inventory_items(user_id,item_id,definition,quantity) VALUES($1,$2,$3,1)', [other, item.id, JSON.stringify(item)]);
    const preferences = (user: string, locked: boolean) => request(app).post('/api/inventory/preferences').set('x-test-user', user).send({ items: [{ itemId: item.id, locked, showcased: false }] });
    await preferences(owner, true).expect(200);
    const op = '10000000-0000-4000-8000-000000000001';
    const lockedResponse = await request(app).post('/api/inventory/sell').set('x-test-user', owner).send({ operationId: op, items: [{ itemId: item.id, quantity: 1 }] });
    expect(lockedResponse.status, lockedResponse.text).toBe(409);
    expect(lockedResponse.body.error).toBe('ITEM_LOCKED');
    await preferences(owner, false).expect(200);
    const sale = () => request(app).post('/api/inventory/sell').set('x-test-user', owner).send({ operationId: op, items: [{ itemId: item.id, quantity: 1 }] });
    const first = await sale().expect(200);
    expect(first.body.sale.coins).toBe(item.sellPrice);
    const repeated = await sale(); expect(repeated.status, repeated.text).toBe(200); expect(repeated.body.idempotent).toBe(true);
    await request(app).post('/api/inventory/sell').set('x-test-user', owner).send({ operationId: '20000000-0000-4000-8000-000000000002', items: [{ itemId: item.id, quantity: 1 }] }).expect(409);
    const [held, wallet, sales, otherHeld] = await Promise.all([
      pool.query('SELECT quantity FROM inventory_items WHERE user_id=$1 AND item_id=$2', [owner, item.id]),
      pool.query("SELECT balance FROM wallets WHERE user_id=$1 AND currency='learning-coin'", [owner]),
      pool.query('SELECT count(*)::int AS count FROM inventory_sales WHERE user_id=$1', [owner]),
      pool.query('SELECT quantity FROM inventory_items WHERE user_id=$1 AND item_id=$2', [other, item.id]),
    ]);
    expect(Number(held.rows[0].quantity)).toBe(0);
    expect(Number(wallet.rows[0].balance)).toBe(item.sellPrice);
    expect(sales.rows[0].count).toBe(1);
    expect(Number(otherHeld.rows[0].quantity)).toBe(1);
    await pool.end(); await rm(directory, { recursive: true, force: true });
  });
  it('isolates server generation drafts by owner and activates one finalized season idempotently', async () => {
    const { app, pool, directory } = await fixture();
    const owner = '00000000-0000-4000-8000-000000000001';
    const other = '00000000-0000-4000-8000-000000000002';
    const campaign = structuredClone(NUMPY_DEMO_CAMPAIGN);
    const input = { goal: campaign.goal, level: campaign.level, days: campaign.days, dailyMinutes: campaign.dailyMinutes, ultimateReward: campaign.ultimateReward, desiredArtifact: campaign.desiredArtifact, language: campaign.language };
    const created = await request(app).post('/api/generation-drafts').set('x-test-user', owner).send({ input, rulesVersion: 4, apiKey: 'must-not-be-saved' }).expect(201);
    expect(JSON.stringify(created.body)).not.toContain('must-not-be-saved');
    const id = created.body.draft.id;
    expect((await request(app).get('/api/generation-drafts').set('x-test-user', other)).body.drafts).toHaveLength(0);
    await request(app).get('/api/generation-drafts').set('x-test-user', owner).expect(200).then(res => expect(res.body.drafts[0].id).toBe(id));
    await request(app).patch(`/api/generation-drafts/${id}`).set('x-test-user', other).send({ revision: 1, status: 'failed' }).expect(404);
    await request(app).patch(`/api/generation-drafts/${id}`).set('x-test-user', owner).send({ status: 'generating' }).expect(400).then(res => expect(res.body.code).toBe('DRAFT_REVISION_REQUIRED'));
    await request(app).patch(`/api/generation-drafts/${id}`).set('x-test-user', owner).send({ revision: '1', status: 'generating' }).expect(400).then(res => expect(res.body.code).toBe('DRAFT_REVISION_REQUIRED'));
    const firstDevice = await request(app).patch(`/api/generation-drafts/${id}`).set('x-test-user', owner).send({ revision: created.body.draft.revision, status: 'generating' }).expect(200);
    await request(app).patch(`/api/generation-drafts/${id}`).set('x-test-user', owner).send({ revision: created.body.draft.revision, status: 'partial' }).expect(409).then(res => expect(res.body.code).toBe('DRAFT_REVISION_CONFLICT'));
    const ready = await request(app).patch(`/api/generation-drafts/${id}`).set('x-test-user', owner).send({ revision: firstDevice.body.draft.revision, status: 'awaiting-confirmation', finalCampaign: campaign }).expect(200);
    expect(ready.body.draft.status).toBe('awaiting-confirmation');
    const first = await request(app).post(`/api/generation-drafts/${id}/activate`).set('x-test-user', owner).expect(201);
    const again = await request(app).post(`/api/generation-drafts/${id}/activate`).set('x-test-user', owner).expect(200);
    expect(again.body.idempotent).toBe(true);
    expect(again.body.season.id).toBe(first.body.season.id);
    expect((await pool.query('SELECT id FROM seasons WHERE owner_user_id=$1', [owner])).rows).toHaveLength(1);
    await pool.end(); await rm(directory, { recursive: true, force: true });
  });

  it('rejects a merged oversized draft atomically while preserving the saved revision and batches', async () => {
    const { app, pool, directory } = await fixture();
    const owner = '00000000-0000-4000-8000-000000000001';
    const campaign = structuredClone(NUMPY_DEMO_CAMPAIGN);
    const input = { goal: campaign.goal, level: campaign.level, days: campaign.days, dailyMinutes: campaign.dailyMinutes, ultimateReward: campaign.ultimateReward, desiredArtifact: campaign.desiredArtifact, language: campaign.language };
    const created = await request(app).post('/api/generation-drafts').set('x-test-user', owner).send({ input, rulesVersion: 4 }).expect(201);
    const id = created.body.draft.id;
    await pool.query("UPDATE generation_drafts SET batches=$1::jsonb WHERE id=$2", [JSON.stringify({ prior: 'x'.repeat(1_930_000) }), id]);
    const response = await request(app).patch(`/api/generation-drafts/${id}`).set('x-test-user', owner).send({ revision: created.body.draft.revision, batch: { stageId: 's', chainId: 'main', batchKey: '1', tasks: ['y'.repeat(100_000)] } }).expect(413);
    expect(response.body.code).toBe('DRAFT_TOO_LARGE');
    const stored = await pool.query('SELECT revision,batches FROM generation_drafts WHERE id=$1', [id]);
    expect(stored.rows[0].revision).toBe(created.body.draft.revision);
    expect(stored.rows[0].batches).toEqual({ prior: 'x'.repeat(1_930_000) });
    await pool.end(); await rm(directory, { recursive: true, force: true });
  });

  it('creates, lists, reads, and updates only the signed-in owner archive using revision checks', async () => {
    const { app, pool, directory } = await fixture();
    const owner = '00000000-0000-4000-8000-000000000001';
    const initial = state(); const initialTaskId = initial.campaign.stages[0].tasks[0].id;
    initial.progress[initialTaskId].evaluation = { passed: true, score: 100, feedback: 'client claim', gaps: [], nextStep: 'none' };
    initial.progress[initialTaskId].evaluationSource = 'ai'; initial.progress[initialTaskId].verification = 'ai';
    initial.progress[initialTaskId].evaluationEvidence = 'fabricated evidence';
    const created = await request(app).post('/api/seasons').send({ state: initial }).expect(201);
    const id = created.body.season.id;
    expect(created.body.season.state.progress[initialTaskId].evaluation).toBeUndefined();
    expect(created.body.season.ownerUserId).toBeUndefined();
    expect((await request(app).get('/api/seasons').set('x-test-user', owner)).body.seasons).toHaveLength(1);
    const other = '00000000-0000-4000-8000-000000000002';
    await request(app).get(`/api/seasons/${id}`).set('x-test-user', other).expect(404);
    const submitted = structuredClone(created.body.season.state) as LearningState;
    submitted.notes['python-response'] = 'saved remotely';
    submitted.wallet!.balance = 999;
    submitted.progress['python-response'].status = 'completed';
    submitted.rewardLedger = [{ id: '00000000-0000-4000-8000-000000000099', campaignId: submitted.campaign.id, taskId: 'python-response', at: new Date().toISOString(), reward: { xp: 999, coins: 999, items: [] }, kind: 'mission', idempotencyKey: '00000000-0000-4000-8000-000000000098' }];
    const updated = await request(app).put(`/api/seasons/${id}`).send({ revision: 1, state: submitted });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.season.state.notes['python-response']).toBe('saved remotely');
    expect(updated.body.season.state.wallet.balance).toBe(0);
    expect(updated.body.season.state.progress['python-response'].status).toBe('idle');
    expect(updated.body.season.state.rewardLedger).toEqual([]);
    await request(app).put(`/api/seasons/${id}`).send({ revision: 1, state: submitted }).expect(409);
    await pool.end(); await rm(directory, { recursive: true, force: true });
  });

  it('settles eligible self-check rewards once despite concurrent retries', async () => {
    const { app, pool, directory } = await fixture();
    const user = '00000000-0000-4000-8000-000000000001';
    const created = await request(app).post('/api/seasons').send({ state: state() }).expect(201);
    const { id, revision, state: archive } = created.body.season;
    const task = archive.campaign.stages[0].tasks[0];
    const editable = structuredClone(archive) as LearningState;
    editable.progress[task.id].evidence = 'I created and ran the requested example; here are the output and explanation.';
    editable.progress[task.id].selfChecked = true;
    const saved = await request(app).put(`/api/seasons/${id}`).send({ revision, state: editable }).expect(200);
    const settle = () => request(app).post(`/api/seasons/${id}/settle`).send({ revision: saved.body.season.revision, taskId: task.id });
    const results = await Promise.all([settle(), settle()]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    const ledger = await pool.query('SELECT idempotency_key FROM reward_ledger WHERE user_id=$1', [user]);
    expect(ledger.rows.length).toBeGreaterThan(0);
    const keys = ledger.rows.map((row: { idempotency_key: string }) => row.idempotency_key);
    expect(new Set(keys).size).toBe(keys.length);
    await pool.end(); await rm(directory, { recursive: true, force: true });
  });

  it('binds AI evaluation to the saved evidence and removes it when the evidence changes', async () => {
    const { app, pool, directory } = await fixture();
    const user = '00000000-0000-4000-8000-000000000001';
    const created = await request(app).post('/api/seasons').send({ state: state() }).expect(201);
    const { id, revision, state: archive } = created.body.season;
    const taskId = archive.campaign.stages[0].tasks[0].id;
    const evidence = 'I ran this task, observed the result, and can explain why the output follows from the code.';
    const editable = structuredClone(archive) as LearningState; editable.progress[taskId].evidence = evidence;
    const saved = await request(app).put(`/api/seasons/${id}`).send({ revision, state: editable }).expect(200);
    await persistEvaluation(pool, user, id, taskId, evidence, { passed: true, score: 85, feedback: 'Clear evidence.', gaps: [], nextStep: 'Proceed.' });
    const evaluated = await request(app).get(`/api/seasons/${id}`).expect(200);
    expect(evaluated.body.season.state.progress[taskId].evaluation.score).toBe(85);
    const changed = structuredClone(evaluated.body.season.state) as LearningState; changed.progress[taskId].evidence += ' Changed.';
    const updated = await request(app).put(`/api/seasons/${id}`).send({ revision: evaluated.body.season.revision, state: changed }).expect(200);
    expect(updated.body.season.state.progress[taskId].evaluation).toBeUndefined();
    await pool.end(); await rm(directory, { recursive: true, force: true });
  });

  it('allows a self-completed task to upgrade through a server-bound AI evaluation without repeating the mission reward', async () => {
    const { app, pool, directory } = await fixture();
    const user = '00000000-0000-4000-8000-000000000001';
    const created = await request(app).post('/api/seasons').send({ state: state() }).expect(201);
    const { id, revision, state: archive } = created.body.season; const taskId = archive.campaign.stages[0].tasks[0].id;
    const evidence = 'I ran the example and recorded the output. I can explain each step and the observed result.';
    const editable = structuredClone(archive) as LearningState; editable.progress[taskId].evidence = evidence; editable.progress[taskId].selfChecked = true;
    const saved = await request(app).put(`/api/seasons/${id}`).send({ revision, state: editable }).expect(200);
    const first = await request(app).post(`/api/seasons/${id}/settle`).send({ revision: saved.body.season.revision, taskId, verification: 'self' }).expect(200);
    const ledgerBefore = await pool.query('SELECT id,kind FROM reward_ledger WHERE user_id=$1', [user]);
    const afterSelf = await request(app).get(`/api/seasons/${id}`).expect(200);
    const supplement = structuredClone(afterSelf.body.season.state) as LearningState;
    supplement.progress[taskId].supplementalEvidence = 'A further independent example with its output.';
    const supplemented = await request(app).put(`/api/seasons/${id}`).send({ revision: afterSelf.body.season.revision, state: supplement }).expect(200);
    expect(supplemented.body.season.state.progress[taskId].completedAt).toBe(first.body.season.state.progress[taskId].completedAt);
    await persistEvaluation(pool, user, id, taskId, `${evidence}\n\n补充证据：\n${supplement.progress[taskId].supplementalEvidence}`, { passed: true, score: 90, feedback: 'Independent evidence is clear.', gaps: [], nextStep: 'Continue.' });
    const afterEvaluation = await request(app).get(`/api/seasons/${id}`).expect(200);
    const upgraded = await request(app).post(`/api/seasons/${id}/settle`).send({ revision: afterEvaluation.body.season.revision, taskId, verification: 'ai' }).expect(200);
    expect(upgraded.body.alreadyCompleted).toBe(false);
    expect(upgraded.body.season.state.progress[taskId].verification).toBe('ai');
    const ledgerAfter = await pool.query('SELECT id,kind FROM reward_ledger WHERE user_id=$1', [user]);
    expect(ledgerAfter.rows.length).toBeGreaterThanOrEqual(ledgerBefore.rows.length);
    expect(ledgerAfter.rows.filter((row: { kind: string }) => row.kind === 'mission').length).toBe(ledgerBefore.rows.filter((row: { kind: string }) => row.kind === 'mission').length);
    expect(first.body.season.state.progress[taskId].verification).toBe('self'); expect(afterSelf.body.season.state.progress[taskId].verification).toBe('self');
    await pool.end(); await rm(directory, { recursive: true, force: true });
  });

  it('keeps image attachments private and sends actual image bytes to the configured visual model', async () => {
    const { app, pool, directory } = await fixture();
    const user = '00000000-0000-4000-8000-000000000001';
    const created = await request(app).post('/api/seasons').send({ state: state() }).expect(201);
    const taskId = created.body.season.state.campaign.stages[0].tasks[0].id;
    const png = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#336699' } }).png().toBuffer();
    const uploaded = await request(app).post(`/api/seasons/${created.body.season.id}/tasks/${taskId}/attachments`).attach('image', png, 'lesson.png').expect(201);
    const id = uploaded.body.attachment.id;
    await request(app).get(`/api/seasons/${created.body.season.id}/tasks/${taskId}/attachments`).expect(200).expect(response => expect(response.body.attachments[0].id).toBe(id));
    await request(app).get(`/api/attachments/${id}`).set('x-test-user', '00000000-0000-4000-8000-000000000002').expect(404);
    await request(app).post(`/api/attachments/${id}/analyze`).send({ question: 'explain' }).expect(200).expect(response => expect(response.body.masteryVerified).toBe(false));
    await request(app).delete(`/api/attachments/${id}`).expect(204);
    await pool.end(); await rm(directory, { recursive: true, force: true });
  });

  it('imports a validated local archive once, strips old rewards and AI claims, and keeps supported progress', async () => {
    const { app, pool, directory } = await fixture();
    const original = state(); const taskId = original.campaign.stages[0].tasks[0].id;
    let oldArchive = setEvidence(original, taskId, 'I ran the task and recorded the output. I can explain what happened.');
    oldArchive = markSelfChecked(oldArchive, taskId);
    oldArchive = completeTask(oldArchive, taskId, 'self');
    oldArchive = setEvaluation(oldArchive, taskId, { passed: true, score: 99, feedback: 'legacy mark', gaps: [], nextStep: 'none' }, 'ai');
    oldArchive = completeTask(oldArchive, taskId, 'ai');
    const rawBackup = JSON.stringify([oldArchive]);
    const first = await request(app).post('/api/legacy-import').send({ archives: [oldArchive] }).expect(201);
    expect(first.body).toMatchObject({ imported: true, duplicate: false, count: 1 });
    const imported = await request(app).get(`/api/seasons/${first.body.seasonIds[0]}`).expect(200);
    expect(imported.body.season.state.progress[taskId]).toMatchObject({ status: 'completed', verification: 'self', selfChecked: true });
    expect(imported.body.season.state.progress[taskId].evaluation).toBeUndefined();
    expect(imported.body.season.state.rewardLedger).toEqual([]);
    expect(imported.body.season.state.wallet.balance).toBe(0);
    await request(app).post('/api/legacy-import').send({ archives: [oldArchive] }).expect(200).expect(response => expect(response.body.duplicate).toBe(true));
    expect(JSON.stringify(oldArchive)).toBe(rawBackup.slice(1, -1));
    await pool.end(); await rm(directory, { recursive: true, force: true });
  });
});
