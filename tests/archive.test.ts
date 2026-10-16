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
import { curriculumOutlineSchema } from '../shared/curriculum';
import type { LearningState } from '../shared/types';

async function fixture() {
  const memory = newDb();
  memory.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, implementation: randomUUID });
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool() as unknown as Pool;
  await pool.query('CREATE TABLE users (id uuid PRIMARY KEY)');
  await pool.query("INSERT INTO users (id) VALUES ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002')");
  await pool.query("CREATE TABLE seasons (id uuid PRIMARY KEY, owner_user_id uuid NOT NULL, campaign_id text NOT NULL, title text NOT NULL, revision integer NOT NULL DEFAULT 1, state jsonb NOT NULL, lifecycle_status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_user_id,campaign_id))");
  await pool.query('CREATE TABLE user_current_seasons(user_id uuid PRIMARY KEY,season_id uuid,revision integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now())');
  await pool.query('CREATE TABLE season_goal_adjustments(id uuid PRIMARY KEY,owner_user_id uuid NOT NULL,season_id uuid NOT NULL,revision_before integer NOT NULL,revision_after integer NOT NULL,previous_goal text NOT NULL,next_goal text NOT NULL,previous_artifact text NOT NULL,next_artifact text NOT NULL,preview jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now())');
  await pool.query('CREATE TABLE reward_ledger (id uuid PRIMARY KEY, user_id uuid NOT NULL, season_id uuid NOT NULL, task_id text NOT NULL, kind text NOT NULL, idempotency_key text NOT NULL, reward jsonb NOT NULL, economy_version text NOT NULL DEFAULT \'2026-10-v1\', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,idempotency_key))');
  await pool.query('CREATE TABLE wallets (user_id uuid NOT NULL, currency text NOT NULL, balance bigint NOT NULL DEFAULT 0, PRIMARY KEY(user_id,currency))');
  await pool.query(`CREATE TABLE challenge_runs (
    id uuid PRIMARY KEY, user_id uuid NOT NULL, season_id uuid NOT NULL, task_id text NOT NULL,
    tier text NOT NULL, status text NOT NULL, entry_fee integer NOT NULL, prompt text NOT NULL,
    evidence text, evaluation jsonb, reward_item jsonb, reward_coins integer NOT NULL DEFAULT 0,
    draw_audit jsonb, pool_version text NOT NULL DEFAULT 'test', deadline_at timestamptz NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
    question_count integer NOT NULL DEFAULT 1, pass_threshold integer NOT NULL DEFAULT 1, entry_operation_id uuid,
    questions jsonb NOT NULL DEFAULT '[]', answers jsonb NOT NULL DEFAULT '[]',
    correct_answers integer NOT NULL DEFAULT 0, question_set_version text NOT NULL DEFAULT 'legacy'
  )`);
  await pool.query('CREATE TABLE challenge_question_exposures(user_id uuid NOT NULL,question_id text NOT NULL,first_run_id uuid,exposed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,question_id))');
  await pool.query('CREATE TABLE inventory_items (user_id uuid NOT NULL, item_id text NOT NULL, definition jsonb NOT NULL, quantity integer NOT NULL DEFAULT 0, acquired_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,item_id))');
  await pool.query('CREATE TABLE inventory_acquisitions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,item_id text NOT NULL,quantity integer NOT NULL,source_type text NOT NULL,source_id text NOT NULL,season_id uuid,task_id text,created_at timestamptz NOT NULL DEFAULT now())');
  await pool.query('CREATE TABLE season_collectibles (season_id uuid PRIMARY KEY,owner_user_id uuid NOT NULL,item_id text NOT NULL,reward_key text NOT NULL,definition jsonb NOT NULL,final_task_id text NOT NULL,gate_task_ids text[] NOT NULL,reward_version integer NOT NULL DEFAULT 1,claimed_at timestamptz,evidence_sha256 text,created_at timestamptz NOT NULL DEFAULT now())');
  await pool.query('CREATE TABLE season_collectible_claims (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_user_id uuid NOT NULL,season_id uuid NOT NULL,reward_key text NOT NULL,item_id text NOT NULL,evidence_sha256 text NOT NULL,reward_version integer NOT NULL DEFAULT 1,claimed_at timestamptz NOT NULL DEFAULT now(),UNIQUE(owner_user_id,reward_key),UNIQUE(owner_user_id,season_id))');
  await pool.query('CREATE TABLE inventory_item_preferences (user_id uuid NOT NULL,item_id text NOT NULL,is_locked boolean NOT NULL DEFAULT false,is_showcased boolean NOT NULL DEFAULT false,showcase_order smallint NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,item_id))');
  await pool.query('CREATE TABLE inventory_sales (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,operation_id uuid NOT NULL,items jsonb NOT NULL,coins bigint NOT NULL CHECK(coins>0),request_hash text,economy_version text NOT NULL DEFAULT \'2026-10-v1\',created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,operation_id))');
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
  it('requires an explicit preview revision before applying a season goal change and preserves the old learning/economic record', async () => {
    const { app, pool, directory } = await fixture();
    const owner = '00000000-0000-4000-8000-000000000001';
    const seasonId = randomUUID();
    const archive = state();
    archive.campaign.goal = 'Build an IELTS timer and tracking tool.';
    archive.campaign.desiredArtifact = 'A deployed study timer.';
    const finalStage = archive.campaign.stages.at(-1)!;
    const task = finalStage.tasks.find(item => (item.track ?? 'main') === 'main')!;
    finalStage.gateTaskIds = [task.id];
    task.title = '运行环境与第一个脚本'; task.brief = 'Create the timer script.'; task.steps = ['Write code and deploy a tool.'];
    archive.campaign.seasonalCollectible = { id: 'seasonal-ielts-proof', name: '雅思能力章', story: '完成阶段成果。', appearance: '深色金属章。', abilityOutcome: '完成目标相关成果。', rewardKey: 'a'.repeat(64), finalTaskId: task.id, displayValue: 1_000_000 };
    archive.progress[task.id] = { completedObjectives: [], evidence: 'Unsubmitted notes to preserve.', status: 'active' };
    await pool.query('INSERT INTO seasons(id,owner_user_id,campaign_id,title,state,revision,lifecycle_status) VALUES($1,$2,$3,$4,$5,1,\'active\')', [seasonId, owner, archive.campaign.id, archive.campaign.title, JSON.stringify(archive)]);
    await pool.query('INSERT INTO season_collectibles(season_id,owner_user_id,item_id,reward_key,definition,final_task_id,gate_task_ids) VALUES($1,$2,$3,$4,$5,$6,$7)', [seasonId, owner, archive.campaign.seasonalCollectible.id, archive.campaign.seasonalCollectible.rewardKey, JSON.stringify(archive.campaign.seasonalCollectible), task.id, [task.id]]);

    const input = { revision: 1, goal: '提升雅思听说读写能力，完成可核对的英语练习档案。', desiredArtifact: '完成包含听说读写样本、证据和复盘的雅思训练档案。' };
    const previewResponse = await request(app).post(`/api/seasons/${seasonId}/goal-preview`).set('x-test-user', owner).send(input).expect(200);
    const preview = previewResponse.body.preview;
    expect(preview.tasks.some((item: any) => item.title === '运行环境与第一个脚本' && item.action === 'replace')).toBe(true);
    const before = await pool.query('SELECT state,revision FROM seasons WHERE id=$1', [seasonId]);
    expect(before.rows[0].revision).toBe(1);

    await request(app).post(`/api/seasons/${seasonId}/goal-adjustment`).set('x-test-user', owner).send({ ...input, previewId: '00000000' }).expect(409);
    const applied = await request(app).post(`/api/seasons/${seasonId}/goal-adjustment`).set('x-test-user', owner).send({ ...input, previewId: preview.previewId }).expect(200);
    expect(applied.body.season.revision).toBe(2);
    expect(applied.body.season.state.campaign.goal).toBe(input.goal);
    const oldTask = applied.body.season.state.campaign.stages.flatMap((stage: any) => stage.tasks).find((item: any) => item.id === task.id);
    const replacementId = preview.tasks.find((item: any) => item.taskId === task.id).replacement.id;
    const replacement = applied.body.season.state.campaign.stages.flatMap((stage: any) => stage.tasks).find((item: any) => item.id === replacementId);
    expect(oldTask.track).toBe('branch');
    expect(applied.body.season.state.progress[task.id].evidence).toBe('Unsubmitted notes to preserve.');
    expect(applied.body.season.state.progress[replacement.id].status).toBe('idle');
    expect(applied.body.season.state.wallet).toEqual(archive.wallet);
    expect(applied.body.season.state.rewardLedger).toEqual(archive.rewardLedger);
    const collectibleRule = await pool.query('SELECT final_task_id,gate_task_ids FROM season_collectibles WHERE season_id=$1', [seasonId]);
    expect(collectibleRule.rows[0].final_task_id).toBe(replacement.id);
    expect(collectibleRule.rows[0].gate_task_ids).toContain(replacement.id);
    expect(collectibleRule.rows[0].gate_task_ids).not.toContain(task.id);
    expect((await pool.query('SELECT * FROM season_goal_adjustments WHERE season_id=$1', [seasonId])).rowCount).toBe(1);
    await pool.end(); await rm(directory, { recursive: true, force: true });
  });

  it('soft deletes a season without removing its evidence and only restores through the explicit restore flag', async () => {
    const { app, pool, directory } = await fixture();
    const owner = '00000000-0000-4000-8000-000000000001';
    const firstId = randomUUID(); const secondId = randomUUID();
    const first = state(); const second = state(); second.campaign.id = 'second-season';
    first.progress[first.campaign.stages[0].tasks[0].id] = { completedObjectives: [], evidence: 'Saved answers and evidence remain intact.', status: 'active' };
    for (const [id, item] of [[firstId, first], [secondId, second]] as const) await pool.query('INSERT INTO seasons(id,owner_user_id,campaign_id,title,state,revision,lifecycle_status) VALUES($1,$2,$3,$4,$5,1,\'active\')', [id, owner, item.campaign.id, item.campaign.title, JSON.stringify(item)]);
    await pool.query('INSERT INTO user_current_seasons(user_id,season_id,revision) VALUES($1,$2,1)', [owner, firstId]);
    const remove = await request(app).patch(`/api/seasons/${firstId}/lifecycle`).set('x-test-user', owner).send({ status: 'deleted', revision: 1, selectionRevision: 1 }).expect(200);
    expect(remove.body.season.lifecycleStatus).toBe('deleted');
    expect(remove.body.currentSeasonId).toBe(secondId);
    expect((await pool.query('SELECT state->\'progress\' AS progress FROM seasons WHERE id=$1', [firstId])).rows[0].progress[first.campaign.stages[0].tasks[0].id].evidence).toBe('Saved answers and evidence remain intact.');
    await request(app).put('/api/seasons/current').set('x-test-user', owner).send({ seasonId: firstId, revision: 2 }).expect(404);
    await request(app).patch(`/api/seasons/${firstId}/lifecycle`).set('x-test-user', owner).send({ status: 'active', revision: 2, selectionRevision: 2 }).expect(409);
    const restore = await request(app).patch(`/api/seasons/${firstId}/lifecycle`).set('x-test-user', owner).send({ status: 'active', revision: 2, selectionRevision: 2, restore: true }).expect(200);
    expect(restore.body.season.lifecycleStatus).toBe('active');
    expect(restore.body.currentSeasonId).toBe(secondId);
    await pool.end(); await rm(directory, { recursive: true, force: true });
  });

  it('deduplicates a retried challenge-entry request before applying another fee or drawing another set', async () => {
    const { app, pool, directory } = await fixture();
    const owner = '00000000-0000-4000-8000-000000000001';
    const seasonId = randomUUID();
    const archived = state();
    const allTasks = archived.campaign.stages.flatMap(stage => stage.tasks);
    for (const task of allTasks) archived.progress[task.id].status = 'completed';
    allTasks[0].objectives.push({ id: 'extra-one', text: 'Explain a second objective.' }, { id: 'extra-two', text: 'Explain a third objective.' });
    await pool.query('INSERT INTO seasons(id,owner_user_id,campaign_id,title,state,revision,lifecycle_status) VALUES($1,$2,$3,$4,$5,1,\'active\')', [seasonId, owner, archived.campaign.id, archived.campaign.title, JSON.stringify(archived)]);
    await pool.query("INSERT INTO wallets(user_id,currency,balance) VALUES($1,'learning-coin',500000)", [owner]);
    const operationId = '20000000-0000-4000-8000-000000000001';
    const input = { seasonId, taskId: allTasks[0].id, tier: 'ordinary', operationId };
    const first = await request(app).post('/api/challenges/enter').set('x-test-user', owner).send(input).expect(201);
    const retry = await request(app).post('/api/challenges/enter').set('x-test-user', owner).send(input).expect(200);
    expect(retry.body.challenge.id).toBe(first.body.challenge.id);
    expect(retry.body.idempotent).toBe(true);
    expect(Number(retry.body.balance)).toBe(400000);
    const wallet = await pool.query("SELECT balance FROM wallets WHERE user_id=$1 AND currency='learning-coin'", [owner]);
    expect(Number(wallet.rows[0].balance)).toBe(400000);
    await pool.end(); await rm(directory, { recursive: true, force: true });
  });

  it('offers free practice with confidential-pool one-tenth EV and unlimited versioned action entries', async () => {
    const { app, pool, directory } = await fixture();
    const owner = '00000000-0000-4000-8000-000000000001';
    const seasonId = randomUUID();
    const archived = state();
    for (const task of archived.campaign.stages.flatMap(stage => stage.tasks)) archived.progress[task.id].status = 'completed';
    for (const task of archived.campaign.stages.flatMap(stage => stage.tasks)) {
      task.objectives.push({ id: `${task.id}-extra-a`, text: `Apply ${task.title} in a second situation.` }, { id: `${task.id}-extra-b`, text: `Check a boundary for ${task.title}.` });
    }
    await pool.query('INSERT INTO seasons(id,owner_user_id,campaign_id,title,state,revision,lifecycle_status) VALUES($1,$2,$3,$4,$5,1,\'active\')', [seasonId, owner, archived.campaign.id, archived.campaign.title, JSON.stringify(archived)]);
    await pool.query("INSERT INTO wallets(user_id,currency,balance) VALUES($1,'learning-coin',1000000)", [owner]);
    const taskId = archived.campaign.stages[0].tasks[0].id;
    const modes = await request(app).get('/api/challenges').expect(200);
    expect(modes.body.tiers.map((item: any) => [item.id, item.questionCount, item.correctToPass])).toEqual([
      ['free', 5, 3], ['ordinary', 5, 3], ['confidential', 10, 7], ['top-secret', 15, 12],
    ]);
    expect(modes.body.tiers[0]).toMatchObject({ entryFee: 0, paid: false });
    expect(modes.body.tiers[0].rewardCoins).toBeGreaterThan(0);
    expect(modes.body.tiers[0].rewardExpectedRecovery).toBe(modes.body.tiers[0].rewardCoins);

    const enter = (tier: string) => request(app).post('/api/challenges/enter').set('x-test-user', owner).send({ seasonId, taskId, tier, operationId: randomUUID() });
    const free = await enter('free').expect(201);
    expect(free.body.challenge.questions).toHaveLength(5);
    expect(free.body.challenge.questions[0].hints.length).toBeGreaterThan(0);
    expect(JSON.stringify(free.body.challenge.questions)).not.toContain('referenceAnswer');
    await enter('free').expect(409);
    expect((await pool.query("SELECT balance FROM wallets WHERE user_id=$1 AND currency='learning-coin'", [owner])).rows[0].balance).toBe(1000000);
    const savedAnswers = free.body.challenge.questions.map((question: any, index: number) => ({ questionId: question.id, answer: `Saved response ${index}`, hintLevelsUsed: 0 }));
    await request(app).put(`/api/challenges/${free.body.challenge.id}/answers`).set('x-test-user', owner).send({ answers: savedAnswers }).expect(200);
    const restored = await request(app).get('/api/challenges/history').set('x-test-user', owner).expect(200);
    expect(restored.body.challenges.find((run: any) => run.id === free.body.challenge.id).answers).toEqual(savedAnswers);
    expect(restored.body.kdStats.free).toEqual({ correctAnswers: 0, settledRounds: 0, kd: null });
    await request(app).post(`/api/challenges/${free.body.challenge.id}/abandon`).set('x-test-user', owner).expect(200);
    const freeAgain = await enter('free').expect(201);
    expect(freeAgain.body.challenge.questions.every((question: any) => !free.body.challenge.questions.some((previous: any) => previous.id === question.id))).toBe(true);
    await request(app).post(`/api/challenges/${freeAgain.body.challenge.id}/abandon`).set('x-test-user', owner).expect(200);

    const ordinary = await enter('ordinary').expect(201);
    expect(ordinary.body.challenge.questions).toHaveLength(5);
    expect(ordinary.body.challenge.correctToPass).toBe(3);
    expect(ordinary.body.challenge.questions[0].requiredCriteria).toHaveLength(2);
    expect((await pool.query('SELECT question_set_version FROM challenge_runs WHERE id=$1', [ordinary.body.challenge.id])).rows[0].question_set_version).toMatch(/^delta-challenge-v4-/);
    await request(app).post(`/api/challenges/${ordinary.body.challenge.id}/abandon`).set('x-test-user', owner).expect(200);
    await enter('ordinary').expect(201);
    const balance = await pool.query("SELECT balance FROM wallets WHERE user_id=$1 AND currency='learning-coin'", [owner]);
    expect(Number(balance.rows[0].balance)).toBe(800000);
    await pool.end(); await rm(directory, { recursive: true, force: true });
  });

  it('defines the complete catalog by distinct rarity counts, separate from owned inventory', () => {
    expect(COLLECTION_CATALOG).toHaveLength(155);
    expect(CATALOG_RARITY_COUNTS).toEqual({ 'small-purple': 45, 'small-gold': 35, 'large-gold': 15, 'small-red': 35, 'large-red': 25 });
    expect(new Set(COLLECTION_CATALOG.map(item => item.id)).size).toBe(155);
    expect(COLLECTION_CATALOG.every(item => item.displayValue > item.sellPrice && item.imageKey && item.version === 2)).toBe(true);
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

  it('repairs mixed optional-branch evidence when saving a resumable legacy course outline', async () => {
    const { app, pool, directory } = await fixture();
    const owner = '00000000-0000-4000-8000-000000000001';
    const input = { goal: 'Prepare for IELTS reading', level: 'Intermediate', days: 28, dailyMinutes: 80, ultimateReward: 'Complete a reading set' };
    const stages = Array.from({ length: 4 }, (_, stageIndex) => {
      const mainline = Array.from({ length: 15 }, (_, taskIndex) => ({
        id: `s${stageIndex}-m${taskIndex}`, title: `主线任务 ${stageIndex}-${taskIndex}`, knowledgePoint: `阅读能力 ${stageIndex}-${taskIndex}`,
        minutes: 12, prerequisites: taskIndex > 0 ? [`s${stageIndex}-m${taskIndex - 1}`] : stageIndex > 0 ? [`s${stageIndex - 1}-m14`] : [],
      }));
      const branches = Array.from({ length: 3 }, (_, branchIndex) => ({
        id: `s${stageIndex}-b${branchIndex}`, title: `支线 ${stageIndex}-${branchIndex}`,
        tasks: Array.from({ length: 3 }, (_, taskIndex) => ({ id: `s${stageIndex}-b${branchIndex}-t${taskIndex}`, title: `支线练习 ${taskIndex}`, knowledgePoint: `补充练习 ${taskIndex}`, minutes: 15, prerequisites: [] })),
      }));
      return { id: `s${stageIndex}`, title: `阶段 ${stageIndex}`, description: '通过主线任务建立可独立验证的阅读能力。', gateTaskId: `s${stageIndex}-m14`, mainline, branches };
    });
    const outline = {
      title: 'IELTS reading plan', subtitle: 'A staged reading course', prerequisites: [], densityRationale: 'The schedule reserves review time and optional practice.', stages,
      seasonalCollectible: { name: '阅读成果章', story: '完成阅读成果。', appearance: '深色圆章。', abilityOutcome: '独立完成阅读任务。' },
      nineGrid: Array.from({ length: 9 }, (_, index) => ({ id: `outcome-${index}`, title: `能力格 ${index}`, ability: '定位阅读证据', value: '准确回答并解释', taskIds: [`s${index % 4}-m0`] })),
    };
    outline.nineGrid[0].taskIds.push('s0-b0-t0');
    expect(curriculumOutlineSchema.safeParse(outline).success).toBe(true);
    const created = await request(app).post('/api/generation-drafts').set('x-test-user', owner).send({ input, rulesVersion: 4 }).expect(201);
    const saved = await request(app).patch(`/api/generation-drafts/${created.body.draft.id}`).set('x-test-user', owner).send({ revision: created.body.draft.revision, outline, status: 'partial' }).expect(200);
    expect(saved.body.draft.outline.nineGrid[0].taskIds).toEqual(['s0-m0']);
    const persisted = await pool.query('SELECT outline FROM generation_drafts WHERE id=$1', [created.body.draft.id]);
    expect(persisted.rows[0].outline.nineGrid[0].taskIds).toEqual(['s0-m0']);
    await pool.end(); await rm(directory, { recursive: true, force: true });
  });

  it('binds one non-sellable season collectible to the final verified project and deduplicates regenerated targets', async () => {
    const { app, pool, directory } = await fixture();
    const owner = '00000000-0000-4000-8000-000000000001';
    const input = { goal: 'Build a practical NumPy data cleaning project', level: 'knows ndarray', days: 28, dailyMinutes: 60, ultimateReward: 'A tested data cleaning notebook', desiredArtifact: 'A tested data cleaning notebook', language: 'en' as const };
    const makeCampaign = (id: string) => {
      const campaign = structuredClone(NUMPY_DEMO_CAMPAIGN);
      campaign.id = id;
      campaign.goal = input.goal; campaign.level = input.level; campaign.days = input.days; campaign.dailyMinutes = input.dailyMinutes; campaign.ultimateReward = input.ultimateReward; campaign.desiredArtifact = input.desiredArtifact; campaign.language = input.language;
      const finalTaskId = campaign.stages.at(-1)!.gateTaskIds![0];
      campaign.seasonalCollectible = { id: 'untrusted-model-id', name: '坐标校准章', story: '记录一次独立完成的数据定位成果。', appearance: '深色金属圆章，表面刻有抽象坐标线。', abilityOutcome: '交付并解释经过验证的数据清理项目。', rewardKey: '0'.repeat(64), finalTaskId, displayValue: 1_600_000 };
      return campaign;
    };
    async function activate(campaignId: string) {
      const campaign = makeCampaign(campaignId);
      const draft = await request(app).post('/api/generation-drafts').set('x-test-user', owner).send({ input, rulesVersion: 4 }).expect(201);
      await request(app).patch(`/api/generation-drafts/${draft.body.draft.id}`).set('x-test-user', owner).send({ revision: 1, status: 'awaiting-confirmation', finalCampaign: campaign }).expect(200);
      return request(app).post(`/api/generation-drafts/${draft.body.draft.id}/activate`).set('x-test-user', owner).expect(201);
    }
    async function prepareAndSettle(season: any) {
      const learning = structuredClone(season.state) as LearningState;
      const collectible = learning.campaign.seasonalCollectible!;
      const finalTaskId = collectible.finalTaskId;
      const evidence = 'I completed the final data cleaning project and checked its output against the acceptance criteria.';
      for (const task of learning.campaign.stages.flatMap(stage => stage.tasks)) {
        const taskEvidence = task.id === finalTaskId ? evidence : `Completed and verified prerequisite output for ${task.title}.`;
        learning.progress[task.id] = { completedObjectives: task.objectives.map(objective => objective.id), evidence: taskEvidence, status: 'completed', verification: task.id === finalTaskId ? 'self' : 'ai', selfChecked: true, completedAt: new Date().toISOString(), ...(task.id === finalTaskId ? { evaluation: { passed: true, score: 92, feedback: 'Evidence supports the final project.', gaps: [], nextStep: 'Review the saved artifact.' }, evaluationSource: 'ai' as const, evaluationEvidence: evidence } : {}) };
      }
      await pool.query('UPDATE seasons SET state=$1 WHERE id=$2', [JSON.stringify(learning), season.id]);
      await pool.query('INSERT INTO task_evaluations(id,owner_user_id,season_id,task_id,evidence_sha256,evaluation) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), owner, season.id, finalTaskId, (await import('../server/archive')).evidenceHash(evidence), JSON.stringify({ passed: true, score: 92, feedback: 'Evidence supports the final project.', gaps: [], nextStep: 'Review the saved artifact.' })]);
      const result = await request(app).post(`/api/seasons/${season.id}/settle`).set('x-test-user', owner).send({ revision: season.revision, taskId: finalTaskId, verification: 'ai' });
      expect(result.status, result.text).toBe(200);
      return { result, itemId: collectible.id };
    }
    const first = await activate(randomUUID());
    const rule = await pool.query('SELECT item_id,reward_key,final_task_id,definition FROM season_collectibles WHERE season_id=$1', [first.body.season.id]);
    expect(rule.rows[0].item_id).toBe(first.body.season.state.campaign.seasonalCollectible.id);
    expect(rule.rows[0].final_task_id).toBe(first.body.season.state.campaign.stages.at(-1).gateTaskIds[0]);
    expect(rule.rows[0].definition).toMatchObject({ rarity: 'large-red', limited: true, sellable: false, sellPrice: 0, seasonId: first.body.season.id });
    const claimed = await prepareAndSettle(first.body.season);
    expect(claimed.result.body.seasonalCollectible.claimed).toBe(true);
    expect(Number((await pool.query('SELECT quantity FROM inventory_items WHERE user_id=$1 AND item_id=$2', [owner, claimed.itemId])).rows[0].quantity)).toBe(1);

    const second = await activate(randomUUID());
    expect(second.body.season.state.campaign.seasonalCollectible.id).toBe(claimed.itemId);
    const duplicate = await prepareAndSettle(second.body.season);
    expect(duplicate.result.body.seasonalCollectible?.claimed).not.toBe(true);
    expect(Number((await pool.query('SELECT quantity FROM inventory_items WHERE user_id=$1 AND item_id=$2', [owner, claimed.itemId])).rows[0].quantity)).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS count FROM season_collectible_claims WHERE owner_user_id=$1', [owner])).rows[0].count).toBe(1);
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
    editable.progress[task.id].selfCheckEvidence = editable.progress[task.id].evidence;
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

  it('rejects settlement when self-check is empty or belongs to an older answer', async () => {
    const { app, pool, directory } = await fixture();
    const created = await request(app).post('/api/seasons').send({ state: state() }).expect(201);
    const { id, revision, state: archive } = created.body.season;
    const taskId = archive.campaign.stages[0].tasks[0].id;

    const empty = structuredClone(archive) as LearningState;
    empty.progress[taskId].selfChecked = true;
    empty.progress[taskId].selfCheckEvidence = '';
    const savedEmpty = await request(app).put(`/api/seasons/${id}`).send({ revision, state: empty }).expect(200);
    await request(app).post(`/api/seasons/${id}/settle`).send({ revision: savedEmpty.body.season.revision, taskId, verification: 'self' }).expect(422);

    const revised = structuredClone(savedEmpty.body.season.state) as LearningState;
    revised.progress[taskId].evidence = 'This is a longer replacement answer with concrete work and a result.';
    revised.progress[taskId].selfChecked = true;
    revised.progress[taskId].selfCheckEvidence = 'A different earlier answer that was checked before this replacement.';
    const savedRevised = await request(app).put(`/api/seasons/${id}`).send({ revision: savedEmpty.body.season.revision, state: revised }).expect(200);
    await request(app).post(`/api/seasons/${id}/settle`).send({ revision: savedRevised.body.season.revision, taskId, verification: 'self' }).expect(422);

    const staleVersion = structuredClone(savedRevised.body.season.state) as LearningState;
    staleVersion.content = { ...(staleVersion.content ?? {}), [taskId]: {
      purpose: 'Read the passage and identify its main idea.', explanation: 'Find a claim and support it with evidence.', terms: [],
      example: { kind: 'text', prompt: 'Identify the claim.', content: 'The example passage.', walkthrough: 'Locate the supporting sentence.' },
      guidedPractice: { prompt: 'Choose a supporting sentence.', expected: 'The second paragraph.', hint: 'Look for a direct detail.' },
      challenge: { prompt: 'State the claim and evidence.', rubric: ['Give the claim.', 'Quote supporting evidence.'], referenceAnswer: 'A reference response.', hints: ['Track repeated ideas.'] },
      language: 'en', generatedAt: new Date().toISOString(), revision: 2,
    } };
    staleVersion.progress[taskId].selfChecked = true;
    staleVersion.progress[taskId].selfCheckEvidence = staleVersion.progress[taskId].evidence;
    staleVersion.progress[taskId].lessonRevision = 2;
    staleVersion.progress[taskId].selfCheckLessonRevision = 1;
    const savedVersion = await request(app).put(`/api/seasons/${id}`).send({ revision: savedRevised.body.season.revision, state: staleVersion }).expect(200);
    await request(app).post(`/api/seasons/${id}/settle`).send({ revision: savedVersion.body.season.revision, taskId, verification: 'self' }).expect(422);
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
    const editable = structuredClone(archive) as LearningState; editable.progress[taskId].evidence = evidence; editable.progress[taskId].selfChecked = true; editable.progress[taskId].selfCheckEvidence = evidence;
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
