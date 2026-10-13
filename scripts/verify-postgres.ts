import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import type { Server } from 'node:http';
import { Pool } from 'pg';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from '../server/app';
import { runMigrations } from '../server/db';
import { evidenceHash, persistEvaluation, taskEvidence } from '../server/archive';
import { NUMPY_DEMO_CAMPAIGN } from '../src/lib/numpyDemo';
import { createProgressForCampaign } from '../src/lib/engine';
import type { LearningState } from '../shared/types';
import { COLLECTION_CATALOG } from '../shared/catalog';
import { LEGACY_CURRENCY_CONVERSION, learningCoinsForMinutes, validateEconomy } from '../shared/economy';

const root = await mkdtemp(join(tmpdir(), 'ninegrid-real-postgres-'));
const password = randomBytes(24).toString('hex');
const require = createRequire(import.meta.url);
const platform = process.platform === 'win32' ? 'windows' : process.platform;
const native = resolve(dirname(require.resolve(`@embedded-postgres/${platform}-${process.arch}`)), '..', 'native');
await cp(native, join(root, 'runtime'), { recursive: true, dereference: true });
if (process.platform === 'darwin') {
  const libraryDir = join(root, 'runtime', 'lib');
  for (const component of ['icudata', 'icui18n', 'icuuc', 'zstd', 'lz4', 'z']) {
    const entries = await readdir(libraryDir);
    const versioned = entries.find(name => name.startsWith(`lib${component}.`) && name.endsWith('.dylib'));
    const major = versioned?.match(/\.(\d+)\./)?.[1];
    if (versioned && major && !entries.includes(`lib${component}.${major}.dylib`)) {
      await symlink(versioned, join(libraryDir, `lib${component}.${major}.dylib`));
    }
    if (versioned && !entries.includes(`lib${component}.dylib`)) {
      await symlink(versioned, join(libraryDir, `lib${component}.dylib`));
    }
  }
}
const bin = join(root, 'runtime', 'bin');
const extension = process.platform === 'win32' ? '.exe' : '';
const execute = promisify(execFile);
const pgToolsDir = await (async () => {
  const candidates = [process.env.PG_TOOLS_DIR, ...(process.platform === 'win32' ? ['C:\\Program Files\\PostgreSQL\\18\\bin'] : ['/usr/bin', '/usr/local/bin'])].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try { await execute(join(candidate, `pg_dump${extension}`), ['--version']); return candidate; } catch { /* try next installed PostgreSQL client directory */ }
  }
  throw new Error('PostgreSQL backup/restore clients are required; install matching major version and set PG_TOOLS_DIR.');
})();
const listener = createServer(); await new Promise<void>(done => listener.listen(0, '127.0.0.1', done));
const port = (listener.address() as { port: number }).port; await new Promise<void>(done => listener.close(() => done()));
const url = (database: string) => `postgresql://postgres:${password}@127.0.0.1:${port}/${database}`;
let pgProcess: ChildProcess | undefined;
const pg = {
  async initialise() {
    const secretFile = join(root, 'test-password'); await writeFile(secretFile, password, { mode: 0o600 });
    try { await execute(join(bin, `initdb${extension}`), ['-D', join(root, 'cluster'), '-U', 'postgres', '--auth=scram-sha-256', '--pwfile', secretFile, '--encoding=UTF8', '--locale=C'], { cwd: root }); }
    finally { await unlink(secretFile); }
  },
  async start() {
    pgProcess = spawn(join(bin, `postgres${extension}`), ['-D', join(root, 'cluster'), '-p', String(port), '-c', 'listen_addresses=127.0.0.1', '-c', 'shared_buffers=32MB'], { cwd: root, windowsHide: true, stdio: 'ignore' });
    for (let i = 0; i < 100; i++) {
      const probe = new Pool({ connectionString: url('postgres'), connectionTimeoutMillis: 200 });
      try { await probe.query('SELECT 1'); await probe.end(); return; } catch { await probe.end(); await new Promise(done => setTimeout(done, 200)); }
    }
    throw new Error('Native PostgreSQL failed to start');
  },
  async stop() {
    if (!pgProcess) return;
    await execute(join(bin, `pg_ctl${extension}`), ['-D', join(root, 'cluster'), '-m', 'fast', '-w', 'stop'], { cwd: root }); pgProcess = undefined;
  },
  async createDatabase(name: string) { const admin = observePool(new Pool({ connectionString: url('postgres') })); try { await admin.query(`CREATE DATABASE ${name}`); } finally { await admin.end(); } },
};
const results: string[] = [];
let pool: Pool;
function observePool(target: Pool): Pool {
  target.on('error', error => console.error('PostgreSQL idle client error:', (error as Error & { code?: string }).code ?? error.message));
  return target;
}
let visualBytes = false;
let testServer: Server | undefined;
let failChallengeProvider = false;
let challengeProviderFailureCalls=0;
const sessionSecret = randomBytes(32).toString('hex');
const provider: typeof fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body));
  const content = body.messages[1].content;
  const system=String(body.messages[0].content??'');
  if(system.includes('paid, optional learning challenge')&&failChallengeProvider){challengeProviderFailureCalls++;return new Response(JSON.stringify({error:{message:'simulated provider outage'}}),{status:503});}
  visualBytes = Array.isArray(content) && content.some((item: { type?: string; image_url?: { url?: string } }) => item.type === 'image_url' && item.image_url?.url?.startsWith('data:image/webp;base64,'));
  const output=system.includes('paid, optional learning challenge')?{passed:true,score:92,feedback:'Mocked evaluation: answer explains the requested transformation and checks the resulting shape.',gaps:[],nextStep:'Try a second input.'}:system.includes('rigorous learning assessor')?{passed:true,score:92,feedback:'Mocked evidence check.',gaps:[],nextStep:'Continue.'}:{ recognizedText: '2 × 3', analysis: 'Two rows and three columns.', uncertainties: [], nextStep: 'Predict a new shape.' };
  return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] }), { status: 200 });
};
function newState(campaign = NUMPY_DEMO_CAMPAIGN): LearningState {
  return { version: 2, campaign: structuredClone(campaign), progress: createProgressForCampaign(campaign), reviews: [], notes: {}, wallet: { currency: 'learning-coin', balance: 0 }, inventory: {}, rewardLedger: [] };
}
function appFor(currentPool: Pool) {
  return createApp({ apiKey: 'mock-provider-no-real-api-call', fetchImpl: provider, auth: { pool: currentPool, sessionSecret, secureCookie: false } });
}
try {
  await pg.initialise(); await pg.start(); await pg.createDatabase('ninegrid_test'); await pg.createDatabase('ninegrid_restore'); await pg.createDatabase('ninegrid_legacy');
  const legacyPool = observePool(new Pool({ connectionString: url('ninegrid_legacy'), max: 2 }));
  const migrationFiles=(await readdir(resolve('server/migrations'))).filter(name=>/^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort();
  for(const name of migrationFiles.slice(0,5)) await legacyPool.query(await readFile(resolve('server/migrations',name),'utf8'));
  await legacyPool.query('CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  for(const name of migrationFiles.slice(0,5)) await legacyPool.query('INSERT INTO schema_migrations(name) VALUES($1)',[name]);
  const legacyOwner='30000000-0000-4000-8000-000000000001';
  await legacyPool.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[legacyOwner,'redenomination@example.test','test-hash']);
  await legacyPool.query("INSERT INTO wallets(user_id,currency,balance) VALUES($1,'learning-coin',13)",[legacyOwner]);
  const legacySeason=randomUUID(); const legacySaleOperation=randomUUID();
  await legacyPool.query("INSERT INTO seasons(id,owner_user_id,campaign_id,title,state) VALUES($1,$2,'legacy-economy','旧币值赛季','{}'::jsonb)",[legacySeason,legacyOwner]);
  await legacyPool.query("INSERT INTO reward_ledger(id,user_id,season_id,task_id,kind,idempotency_key,reward) VALUES($1,$2,$3,'legacy-task','mission','legacy-reward-key',$4::jsonb)",[randomUUID(),legacyOwner,legacySeason,JSON.stringify({coins:13})]);
  await legacyPool.query('INSERT INTO inventory_sales(user_id,operation_id,items,coins) VALUES($1,$2,$3,13)',[legacyOwner,legacySaleOperation,'[]']);
  await legacyPool.query('INSERT INTO inventory_items(user_id,item_id,definition,quantity) VALUES($1,$2,$3,2),($1,$4,$5,1),($1,$6,$7,4)',[legacyOwner,'box-small-safe-2026-10-v1',JSON.stringify({id:'box-small-safe-2026-10-v1',itemId:'box-small-safe-2026-10-v1',name:'小保险',quantity:2}),'box-large-safe-2026-10-v1',JSON.stringify({id:'box-large-safe-2026-10-v1',itemId:'box-large-safe-2026-10-v1',name:'大保险',quantity:1}),COLLECTION_CATALOG[0].id,JSON.stringify(COLLECTION_CATALOG[0])]);
  await runMigrations(legacyPool);
  const redenominationSql=await readFile(resolve('server/migrations','006_economy_redenomination.sql'),'utf8'); await legacyPool.query(redenominationSql);
  assert.equal(Number((await legacyPool.query("SELECT balance FROM wallets WHERE user_id=$1 AND currency='learning-coin'",[legacyOwner])).rows[0].balance),130000);
  assert.deepEqual((await legacyPool.query('SELECT reward,economy_version FROM reward_ledger WHERE user_id=$1',[legacyOwner])).rows[0],{reward:{coins:13},economy_version:'2026-10-v1'});
  assert.deepEqual((await legacyPool.query('SELECT coins,economy_version FROM inventory_sales WHERE user_id=$1',[legacyOwner])).rows[0],{coins:'13',economy_version:'2026-10-v1'});
  assert.equal(Number((await legacyPool.query("SELECT quantity FROM inventory_items WHERE user_id=$1 AND item_id='box-small-safe-2026-10-v2'",[legacyOwner])).rows[0].quantity),2);
  assert.equal(Number((await legacyPool.query("SELECT quantity FROM inventory_items WHERE user_id=$1 AND item_id='box-large-safe-2026-10-v2'",[legacyOwner])).rows[0].quantity),1);
  assert.equal(Number((await legacyPool.query('SELECT quantity FROM inventory_items WHERE user_id=$1 AND item_id=$2',[legacyOwner,COLLECTION_CATALOG[0].id])).rows[0].quantity),4);
  assert.equal(Number((await legacyPool.query("SELECT count(*) FROM inventory_acquisitions WHERE user_id=$1 AND source_type='migration'",[legacyOwner])).rows[0].count),2);
  assert.deepEqual((await legacyPool.query('SELECT currency_ratio,old_balance,new_balance,safe_entitlements FROM economy_migrations WHERE user_id=$1',[legacyOwner])).rows[0],{currency_ratio:String(LEGACY_CURRENCY_CONVERSION),old_balance:'13',new_balance:String(13*LEGACY_CURRENCY_CONVERSION),safe_entitlements:{'small-safe':2,'large-safe':1,safeConversionRatio:'1:1'}});
  await legacyPool.end(); results.push('isolated PostgreSQL v1→v2 migration scales wallet 10,000:1 once, converts safe entitlements 1:1, preserves collections, and records an audit row');
  pool = observePool(new Pool({ connectionString: url('ninegrid_test'), max: 6 })); await runMigrations(pool); await runMigrations(pool);
  results.push('real PostgreSQL migrations applied and repeatable');
  process.env.UPLOAD_DIR = join(root, 'uploads');
  // Keep API traffic on its own pool so direct assertion queries cannot close
  // the pool backing request handlers during the real-PostgreSQL regression.
  const appPool = observePool(new Pool({ connectionString: url('ninegrid_test'), max: 6 }));
  const app = appFor(appPool);
  testServer = app.listen(0, '127.0.0.1'); await new Promise<void>(done => testServer!.once('listening', done));
  const testAddress = testServer.address() as import('node:net').AddressInfo;
  const testOrigin = `http://127.0.0.1:${testAddress.port}`;
  const a = request.agent(testOrigin); const b = request.agent(testOrigin);
  const csrf = async (agent: typeof a) => (await agent.get('/api/auth/csrf').expect(200)).body.token as string;
  const register = async (agent: typeof a, email: string) => { const token = await csrf(agent); return (await agent.post('/api/auth/register').set('x-csrf-token', token).send({ email, password: 'independent-test-passphrase-2026' }).expect(201)).body.user; };
  const userA = await register(a, 'integration-a@example.com'); const userB=await register(b, 'integration-b@example.com');
  const economyAudit=validateEconomy(); assert(economyAudit.boxes['small-safe'].expectedRecovery<economyAudit.boxes['small-safe'].price); assert.equal(economyAudit.boxes['small-safe'].poolTotal,1); results.push('exact catalog-based expected recovery and probability validation passes before any economy route');
  const created = await a.post('/api/seasons').set('x-csrf-token', await csrf(a)).send({ state: newState() }).expect(201);
  const draftInput = { goal: NUMPY_DEMO_CAMPAIGN.goal, level: '已学 ndarray、shape、dtype', days: 28, dailyMinutes: 30, ultimateReward: '完成可验证的数据处理作品' };
  const draftResponse = await a.post('/api/generation-drafts').set('x-csrf-token', await csrf(a)).send({ input: draftInput, rulesVersion: 4 }).expect(201);
  const draftId = draftResponse.body.draft.id as string;
  await b.get('/api/generation-drafts').expect(200).then(response => assert.equal(response.body.drafts.some((item: { id: string }) => item.id === draftId), false));
  const draftCampaign = { ...structuredClone(NUMPY_DEMO_CAMPAIGN), id: randomUUID() };
  draftCampaign.seasonalCollectible = { id: 'model-proposal', name: '坐标校准章', story: '记录一次独立完成的坐标数据整理。', appearance: '深色金属徽章，表面刻有抽象网格线。', abilityOutcome: '交付并解释经过验证的数据处理项目。', rewardKey: '0'.repeat(64), finalTaskId: draftCampaign.stages.at(-1)!.gateTaskIds![0], displayValue: 1_600_000 };
  const waitingDraft = await a.patch(`/api/generation-drafts/${draftId}`).set('x-csrf-token', await csrf(a)).send({ revision: draftResponse.body.draft.revision, finalCampaign: draftCampaign, status: 'awaiting-confirmation' }).expect(200);
  const activated = await a.post(`/api/generation-drafts/${draftId}/activate`).set('x-csrf-token', await csrf(a)).send({}).expect(201);
  const activatedAgain = await a.post(`/api/generation-drafts/${draftId}/activate`).set('x-csrf-token', await csrf(a)).send({}).expect(200);
  assert.equal(activated.body.season.id, activatedAgain.body.season.id);
  assert.equal(activatedAgain.body.idempotent, true);
  assert.equal(waitingDraft.body.draft.status, 'awaiting-confirmation');
  const activatedRule = await pool.query('SELECT item_id,reward_key,final_task_id,definition FROM season_collectibles WHERE season_id=$1 AND owner_user_id=$2', [activated.body.season.id, userA.id]);
  assert.equal(activatedRule.rows[0].item_id, activated.body.season.state.campaign.seasonalCollectible.id);
  assert.equal(activatedRule.rows[0].final_task_id, activated.body.season.state.campaign.stages.at(-1).gateTaskIds[0]);
  assert.deepEqual({ rarity: activatedRule.rows[0].definition.rarity, limited: activatedRule.rows[0].definition.limited, sellable: activatedRule.rows[0].definition.sellable, sellPrice: activatedRule.rows[0].definition.sellPrice, seasonId: activatedRule.rows[0].definition.seasonId }, { rarity: 'large-red', limited: true, sellable: false, sellPrice: 0, seasonId: activated.body.season.id });
  const compactDraft = await pool.query('SELECT status,activated_season_id,final_campaign,outline,batches,input FROM generation_drafts WHERE id=$1', [draftId]);
  assert.equal(compactDraft.rows[0].status, 'activated'); assert.equal(compactDraft.rows[0].activated_season_id, activated.body.season.id);
  assert.equal(compactDraft.rows[0].final_campaign, null); assert.deepEqual(compactDraft.rows[0].batches, {}); assert.equal(compactDraft.rows[0].input.activated, true);
  async function settleFinalCollectible(season: any) {
    const state = structuredClone(season.state) as LearningState;
    const finalTaskId = state.campaign.seasonalCollectible!.finalTaskId;
    const evidence = 'I delivered the final data processing project, ran its checks, and compared the output with the acceptance criteria.';
    const now = new Date().toISOString();
    for (const task of state.campaign.stages.flatMap(stage => stage.tasks)) {
      const taskEvidenceText = task.id === finalTaskId ? evidence : `I completed and checked the prerequisite result for ${task.title}.`;
      state.progress[task.id] = { completedObjectives: task.objectives.map(objective => objective.id), evidence: taskEvidenceText, status: 'completed', verification: task.id === finalTaskId ? 'self' : 'ai', selfChecked: true, completedAt: now };
    }
    await pool.query('UPDATE seasons SET state=$1 WHERE id=$2 AND owner_user_id=$3', [JSON.stringify(state), season.id, userA.id]);
    const evaluationPool = observePool(new Pool({ connectionString: url('ninegrid_test'), max: 1 }));
    try { await persistEvaluation(evaluationPool, userA.id, season.id, finalTaskId, evidence, { passed: true, score: 94, feedback: 'Server-bound integration evaluation for the saved final artifact.', gaps: [], nextStep: 'Review the saved project.' }); }
    finally { await evaluationPool.end(); }
    const freshResponse = await a.get(`/api/seasons/${season.id}`);
    if (freshResponse.status !== 200) console.error('Season refresh failed:', freshResponse.status, freshResponse.body, 'server listening:', testServer?.listening, 'api pool ended:', (appPool as any).ended);
    assert.equal(freshResponse.status, 200);
    const fresh = freshResponse.body.season;
    return await a.post(`/api/seasons/${season.id}/settle`).set('x-csrf-token', await csrf(a)).send({ revision: fresh.revision, taskId: finalTaskId, verification: 'ai' }).expect(200);
  }
  const exclusiveFirst = await settleFinalCollectible(activated.body.season);
  assert.equal(exclusiveFirst.body.seasonalCollectible.claimed, true);
  const exclusiveId = activated.body.season.state.campaign.seasonalCollectible.id;
  assert.equal(Number((await pool.query('SELECT quantity FROM inventory_items WHERE user_id=$1 AND item_id=$2', [userA.id, exclusiveId])).rows[0].quantity), 1);
  const copiedDraft = await a.post('/api/generation-drafts').set('x-csrf-token', await csrf(a)).send({ input: draftInput, rulesVersion: 4 }).expect(201);
  const copiedCampaign = { ...structuredClone(draftCampaign), id: randomUUID() };
  await a.patch(`/api/generation-drafts/${copiedDraft.body.draft.id}`).set('x-csrf-token', await csrf(a)).send({ revision: copiedDraft.body.draft.revision, finalCampaign: copiedCampaign, status: 'awaiting-confirmation' }).expect(200);
  const copiedSeason = (await a.post(`/api/generation-drafts/${copiedDraft.body.draft.id}/activate`).set('x-csrf-token', await csrf(a)).send({}).expect(201)).body.season;
  assert.equal(copiedSeason.state.campaign.seasonalCollectible.id, exclusiveId);
  const duplicateExclusive = await settleFinalCollectible(copiedSeason);
  assert.equal(duplicateExclusive.body.seasonalCollectible.alreadyClaimed, true);
  assert.equal(Number((await pool.query('SELECT quantity FROM inventory_items WHERE user_id=$1 AND item_id=$2', [userA.id, exclusiveId])).rows[0].quantity), 1);
  assert.equal(Number((await pool.query('SELECT count(*) FROM season_collectible_claims WHERE owner_user_id=$1', [userA.id])).rows[0].count), 1);
  const seasonHonors = (await a.get('/api/profile').expect(200)).body.seasonalCollectibles;
  assert.equal(seasonHonors.length, 1);
  assert.equal(seasonHonors[0].claimed, true);
  await a.post('/api/inventory/sell').set('x-csrf-token', await csrf(a)).send({ operationId: randomUUID(), items: [{ itemId: exclusiveId, quantity: 1 }] }).expect(422);
  results.push('native PostgreSQL stores a target-bound red collectible, pays it after the final server-bound evaluation once, and prevents duplicate claims after regenerating the same target');
  results.push('account-scoped generation drafts persist in PostgreSQL and repeated activation creates one season');
  const capacityToken = await csrf(a);
  const capacityPosts = await Promise.all(Array.from({ length: 4 }, (_, index) => a.post('/api/generation-drafts').set('x-csrf-token', capacityToken).send({ input: { ...draftInput, goal: `练习 NumPy 数据整理目标 ${index + 1}` }, rulesVersion: 4 })));
  assert.deepEqual(capacityPosts.map(response => response.status).sort(), [201, 201, 201, 429]);
  results.push('PostgreSQL account row lock enforces the three-active-draft limit during concurrent creates');
  const collectible = COLLECTION_CATALOG[0];
  await pool.query('INSERT INTO inventory_items(user_id,item_id,definition,quantity) VALUES($1,$2,$3,2)', [userA.id, collectible.id, JSON.stringify(collectible)]);
  const balanceBeforeSale = Number((await pool.query("SELECT balance FROM wallets WHERE user_id=$1 AND currency='learning-coin'", [userA.id])).rows[0].balance);
  const saleOperation = randomUUID(); const saleToken = await csrf(a);
  const firstSale = await a.post('/api/inventory/sell').set('x-csrf-token', saleToken).send({ operationId: saleOperation, items: [{ itemId: collectible.id, quantity: 1 }] }).expect(200);
  const saleRetry = await a.post('/api/inventory/sell').set('x-csrf-token', saleToken).send({ operationId: saleOperation, items: [{ itemId: collectible.id, quantity: 1 }] }).expect(200);
  assert.equal(Number(firstSale.body.sale.coins), collectible.sellPrice); assert.equal(saleRetry.body.idempotent, true);
  await a.post('/api/inventory/sell').set('x-csrf-token', saleToken).send({ operationId:saleOperation,items:[{itemId:collectible.id,quantity:2}]}).expect(409);
  assert.equal((await pool.query('SELECT quantity FROM inventory_items WHERE user_id=$1 AND item_id=$2', [userA.id, collectible.id])).rows[0].quantity, 1);
  assert.equal(Number((await pool.query("SELECT balance FROM wallets WHERE user_id=$1 AND currency='learning-coin'", [userA.id])).rows[0].balance), balanceBeforeSale + collectible.sellPrice);
  assert.equal((await b.get('/api/inventory').expect(200)).body.items.length, 0);
  const competingSales = await Promise.all([0, 1].map(() => a.post('/api/inventory/sell').set('x-csrf-token', saleToken).send({ operationId: randomUUID(), items: [{ itemId: collectible.id, quantity: 1 }] })));
  assert.deepEqual(competingSales.map(response => response.status).sort(), [200, 409]);
  const winningSale = competingSales.find(response => response.status === 200)!;
  const winningOperation = winningSale.body.sale.operation_id;
  const concurrentRetry = await a.post('/api/inventory/sell').set('x-csrf-token', saleToken).send({ operationId: winningOperation, items: [{ itemId: collectible.id, quantity: 1 }] }).expect(200);
  assert.equal(concurrentRetry.body.idempotent, true);
  assert.equal(Number((await pool.query('SELECT quantity FROM inventory_items WHERE user_id=$1 AND item_id=$2', [userA.id, collectible.id])).rows[0].quantity), 0);
  assert.equal(Number((await pool.query("SELECT balance FROM wallets WHERE user_id=$1 AND currency='learning-coin'", [userA.id])).rows[0].balance), balanceBeforeSale + collectible.sellPrice * 2);
  results.push('PostgreSQL inventory sale commits one fixed-price credit, one quantity debit and one idempotent sale ledger row; accounts stay isolated');
  await pool.query("UPDATE wallets SET balance=balance+2000000 WHERE user_id=$1 AND currency='learning-coin'",[userA.id]);
  const shopToken=await csrf(a); const shopBefore=Number((await pool.query("SELECT balance FROM wallets WHERE user_id=$1 AND currency='learning-coin'",[userA.id])).rows[0].balance);const buyId=randomUUID();
  const purchase=await a.post('/api/shop/purchase').set('x-csrf-token',shopToken).send({operationId:buyId,boxId:'small-safe',quantity:3}).expect(201);
  const purchaseRetry=await a.post('/api/shop/purchase').set('x-csrf-token',shopToken).send({operationId:buyId,boxId:'small-safe',quantity:3}).expect(200);
  assert.equal(purchaseRetry.body.idempotent,true);assert.deepEqual(purchaseRetry.body.purchase,purchase.body.purchase);
  await a.post('/api/shop/purchase').set('x-csrf-token',shopToken).send({operationId:buyId,boxId:'small-safe',quantity:2}).expect(409);
  await a.post('/api/shop/purchase').set('x-csrf-token',shopToken).send({operationId:randomUUID(),boxId:'large-safe',quantity:20}).expect(409);
  assert.equal(Number((await pool.query("SELECT balance FROM wallets WHERE user_id=$1 AND currency='learning-coin'",[userA.id])).rows[0].balance),shopBefore-3*200000);
  const boxItemId='box-small-safe-2026-10-v2'; assert.equal(Number((await pool.query('SELECT quantity FROM inventory_items WHERE user_id=$1 AND item_id=$2',[userA.id,boxItemId])).rows[0].quantity),3);
  const openId=randomUUID();const opening=await a.post('/api/inventory/open').set('x-csrf-token',shopToken).send({operationId:openId,boxId:'small-safe',quantity:2}).expect(201);const openingRetry=await a.post('/api/inventory/open').set('x-csrf-token',shopToken).send({operationId:openId,boxId:'small-safe',quantity:2}).expect(200);assert.equal(openingRetry.body.idempotent,true);assert.deepEqual(openingRetry.body.opening.results,opening.body.opening.results);assert.equal(opening.body.opening.results.length,2);assert(opening.body.opening.results.every((row:any)=>row.audit.version&&row.audit.ticketScale===1_000_000_000));
  await a.post('/api/inventory/open').set('x-csrf-token',shopToken).send({operationId:openId,boxId:'small-safe',quantity:1}).expect(409);
  const competingOpens=await Promise.all([0,1].map(()=>a.post('/api/inventory/open').set('x-csrf-token',shopToken).send({operationId:randomUUID(),boxId:'small-safe',quantity:1})));assert.deepEqual(competingOpens.map(row=>row.status).sort(),[201,409]);assert.equal(Number((await pool.query('SELECT quantity FROM inventory_items WHERE user_id=$1 AND item_id=$2',[userA.id,boxItemId])).rows[0].quantity),0);
  await pool.query("UPDATE wallets SET balance=200000 WHERE user_id=$1 AND currency='learning-coin'",[userA.id]);const competingPurchases=await Promise.all([0,1].map(()=>a.post('/api/shop/purchase').set('x-csrf-token',shopToken).send({operationId:randomUUID(),boxId:'small-safe',quantity:1})));assert.deepEqual(competingPurchases.map(row=>row.status).sort(),[201,409]);assert.equal(Number((await pool.query("SELECT balance FROM wallets WHERE user_id=$1 AND currency='learning-coin'",[userA.id])).rows[0].balance),0);assert.equal(Number((await pool.query('SELECT quantity FROM inventory_items WHERE user_id=$1 AND item_id=$2',[userA.id,boxItemId])).rows[0].quantity),1);
  await pool.query('UPDATE inventory_items SET quantity=1 WHERE user_id=$1 AND item_id=$2',[userA.id,collectible.id]);const race=[a.post('/api/inventory/sell').set('x-csrf-token',shopToken).send({operationId:randomUUID(),items:[{itemId:collectible.id,quantity:1}]}),a.post('/api/inventory/open').set('x-csrf-token',shopToken).send({operationId:randomUUID(),boxId:'small-safe',quantity:1})];const raceResults=await Promise.all(race);assert.deepEqual(raceResults.map(row=>row.status).sort(),[200,201]);assert.equal(Number((await pool.query('SELECT quantity FROM inventory_items WHERE user_id=$1 AND item_id=$2',[userA.id,boxItemId])).rows[0].quantity),0);
  const profileBefore=(await a.get('/api/profile').expect(200)).body;assert.equal(profileBefore.collection.total,155);assert.equal(profileBefore.profile.is_public,false);
  await a.post('/api/profile').set('x-csrf-token',shopToken).send({nickname:'测试行动者',avatarUrl:'',bio:'本机集成验证',isPublic:false}).expect(200);await a.post('/api/profile').set('x-csrf-token',shopToken).send({nickname:'测试',avatarUrl:'javascript:alert(1)',bio:'',isPublic:false}).expect(400);assert.equal((await b.get('/api/profile').expect(200)).body.profile.nickname,'行动者');
  results.push('PostgreSQL purchase/open transactions debit atomically, enforce parameter-bound idempotency, preserve audited draws under retries and concurrent opens; profile is private and account-scoped');
  const season = created.body.season; const taskId = season.state.campaign.stages[0].tasks[0].id;
  await b.get(`/api/seasons/${season.id}`).expect(404);
  await b.put(`/api/seasons/${season.id}`).set('x-csrf-token', await csrf(b)).send({ revision: 1, state: season.state }).expect(404);
  const editable = structuredClone(season.state) as LearningState;
  editable.progress[taskId].evidence = 'For a 3 by 2 array, shape is (3, 2). axis 1 reduces columns and leaves three values; I ran the example and compared the result.';
  editable.progress[taskId].selfChecked = true;
  const saved = await a.put(`/api/seasons/${season.id}`).set('x-csrf-token', await csrf(a)).send({ revision: season.revision, state: editable }).expect(200);
  const token = await csrf(a);
  const settlements = await Promise.all([0, 1].map(() => a.post(`/api/seasons/${season.id}/settle`).set('x-csrf-token', token).send({ revision: saved.body.season.revision, taskId, verification: 'self' })));
  assert.deepEqual(settlements.map(item => item.status).sort(), [200, 409]);
  const walletBefore = (await a.get('/api/wallet').expect(200)).body;
  assert.equal(walletBefore.ledger.filter((row: { kind: string }) => row.kind === 'mission').length, 1);
  const missionLedger=walletBefore.ledger.find((row:{kind:string})=>row.kind==='mission');
  assert.equal(missionLedger.reward.coins,learningCoinsForMinutes(season.state.campaign.stages[0].tasks.find((task:any)=>task.id===taskId).minutes));
  assert.equal(missionLedger.economy_version,'2026-10-v2');
  results.push('ownership checks and concurrent settlement issue exactly one mission reward');
  const self = (await a.get(`/api/seasons/${season.id}`).expect(200)).body.season;
  await persistEvaluation(pool, userA.id, season.id, taskId, taskEvidence(self.state, taskId), { passed: true, score: 90, feedback: 'Mocked assessment for integration test.', gaps: [], nextStep: 'Continue.' });
  const evaluated = (await a.get(`/api/seasons/${season.id}`)).body.season;
  evaluated.state.progress[taskId].supplementalEvidence = 'Another independent shape example and explanation.';
  const changed = (await a.put(`/api/seasons/${season.id}`).set('x-csrf-token', await csrf(a)).send({ revision: evaluated.revision, state: evaluated.state }).expect(200)).body.season;
  assert.equal(changed.state.progress[taskId].evaluation, undefined);
  await a.post(`/api/seasons/${season.id}/settle`).set('x-csrf-token', await csrf(a)).send({ revision: changed.revision, taskId, verification: 'ai' }).expect(422);
  await persistEvaluation(pool, userA.id, season.id, taskId, taskEvidence(changed.state, taskId), { passed: true, score: 90, feedback: 'Mocked refreshed assessment.', gaps: [], nextStep: 'Continue.' });
  const verified = (await a.get(`/api/seasons/${season.id}`)).body.season;
  const upgraded = (await a.post(`/api/seasons/${season.id}/settle`).set('x-csrf-token', await csrf(a)).send({ revision: verified.revision, taskId, verification: 'ai' }).expect(200)).body.season;
  assert.equal(upgraded.state.progress[taskId].verification, 'ai');
  assert.equal((await a.get('/api/wallet')).body.ledger.filter((row: { kind: string }) => row.kind === 'mission').length, 1);
  results.push('changed evidence invalidates prior AI assessment; independent re-evaluation upgrades without base reward duplication (assessment mocked)');
  await pool.query("INSERT INTO wallets(user_id,currency,balance) VALUES($1,'learning-coin',1000000) ON CONFLICT(user_id,currency) DO UPDATE SET balance=EXCLUDED.balance",[userB.id]);
  const challengeSeason=(await b.post('/api/seasons').set('x-csrf-token',await csrf(b)).send({state:newState({...NUMPY_DEMO_CAMPAIGN,id:randomUUID()})}).expect(201)).body.season;
  const challengeTask=challengeSeason.state.campaign.stages[0].tasks[0];const challengeEntry=await b.post('/api/challenges/enter').set('x-csrf-token',await csrf(b)).send({seasonId:challengeSeason.id,taskId:challengeTask.id,tier:'ordinary'}).expect(201);const challengeAnswer='For a 3 by 2 array, summing axis 0 combines rows and returns two column totals. I checked the shape and computed values using a small concrete input.';
  const challengePass=await b.post(`/api/challenges/${challengeEntry.body.challenge.id}/submit`).set('x-csrf-token',await csrf(b)).send({evidence:challengeAnswer}).expect(200);assert.equal(challengePass.body.challenge.status,'passed');assert.equal(challengePass.body.challenge.evaluation.score,92);const wonId=challengePass.body.challenge.rewardItem.itemId;assert.equal(Number((await pool.query('SELECT quantity FROM inventory_items WHERE user_id=$1 AND item_id=$2',[userB.id,wonId])).rows[0].quantity),1);await b.post(`/api/challenges/${challengeEntry.body.challenge.id}/submit`).set('x-csrf-token',await csrf(b)).send({evidence:challengeAnswer}).expect(200);assert.equal(Number((await pool.query('SELECT quantity FROM inventory_items WHERE user_id=$1 AND item_id=$2',[userB.id,wonId])).rows[0].quantity),1);
  await pool.query("UPDATE wallets SET balance=balance+2000000 WHERE user_id=$1 AND currency='learning-coin'",[userA.id]);const techSeason=(await a.post('/api/seasons').set('x-csrf-token',await csrf(a)).send({state:newState({...NUMPY_DEMO_CAMPAIGN,id:randomUUID()})}).expect(201)).body.season;const techTask=techSeason.state.campaign.stages[0].tasks[0];const techEntry=await a.post('/api/challenges/enter').set('x-csrf-token',await csrf(a)).send({seasonId:techSeason.id,taskId:techTask.id,tier:'ordinary'}).expect(201);const balanceAfterEntry=Number((await pool.query("SELECT balance FROM wallets WHERE user_id=$1 AND currency='learning-coin'",[userA.id])).rows[0].balance);failChallengeProvider=true;const techResponse=await a.post(`/api/challenges/${techEntry.body.challenge.id}/submit`).set('x-csrf-token',await csrf(a)).send({evidence:challengeAnswer}).expect(502);failChallengeProvider=false;assert.equal(techResponse.body.code,'CHALLENGE_TECHNICAL_REFUND');assert.equal((await pool.query('SELECT status FROM challenge_runs WHERE id=$1',[techEntry.body.challenge.id])).rows[0].status,'technical_refund');assert.equal(Number((await pool.query("SELECT balance FROM wallets WHERE user_id=$1 AND currency='learning-coin'",[userA.id])).rows[0].balance),balanceAfterEntry+100000);await a.post(`/api/challenges/${techEntry.body.challenge.id}/submit`).set('x-csrf-token',await csrf(a)).send({evidence:challengeAnswer}).expect(200);assert.equal(Number((await pool.query("SELECT balance FROM wallets WHERE user_id=$1 AND currency='learning-coin'",[userA.id])).rows[0].balance),balanceAfterEntry+100000);assert.equal(Number((await pool.query('SELECT count(*) FROM challenge_runs WHERE user_id=$1 AND status=\'technical_refund\'',[userA.id])).rows[0].count),1);const recoverySeason=(await a.post('/api/seasons').set('x-csrf-token',await csrf(a)).send({state:newState({...NUMPY_DEMO_CAMPAIGN,id:randomUUID()})}).expect(201)).body.season;await a.post('/api/challenges/enter').set('x-csrf-token',await csrf(a)).send({seasonId:recoverySeason.id,taskId:recoverySeason.state.campaign.stages[0].tasks[0].id,tier:'ordinary'}).expect(201);
  results.push('PostgreSQL challenge entry fee settles once; mocked server evaluation awards one catalog item; provider failure returns one technical refund without changing campaign progress');
  const anotherBrowser = request.agent(testOrigin);
  const browserCsrf = await csrf(anotherBrowser);
  await anotherBrowser.post('/api/auth/login').set('x-csrf-token', browserCsrf).send({ email: 'integration-a@example.com', password: 'independent-test-passphrase-2026' }).expect(200);
  assert.equal((await anotherBrowser.get(`/api/seasons/${season.id}`).expect(200)).body.season.state.progress[taskId].verification, 'ai');
  results.push('independent cookie session restores same account archive');
  const png = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#369' } }).png().toBuffer();
  const attachment = (await a.post(`/api/seasons/${season.id}/tasks/${taskId}/attachments`).set('x-csrf-token', await csrf(a)).attach('image', png, 'sample.png').expect(201)).body.attachment;
  await b.get(`/api/attachments/${attachment.id}`).expect(404); await b.delete(`/api/attachments/${attachment.id}`).set('x-csrf-token', await csrf(b)).expect(404);
  await a.post(`/api/attachments/${attachment.id}/analyze`).set('x-csrf-token', await csrf(a)).send({ question: 'check' }).expect(200); assert(visualBytes);
  results.push('private attachment authorization and actual image content blocks into mocked visual API');
  const legacy = newState({ ...NUMPY_DEMO_CAMPAIGN, id: 'legacy-separate-season' });
  const imported = await a.post('/api/legacy-import').set('x-csrf-token', await csrf(a)).send({ archives: [legacy] }).expect(201);
  const repeated = await a.post('/api/legacy-import').set('x-csrf-token', await csrf(a)).send({ archives: [legacy] }).expect(200); assert.equal(repeated.body.duplicate, true);
  assert.deepEqual(repeated.body.seasonIds, imported.body.seasonIds); results.push('legacy import repeat is idempotent');
  const counts = async (p: Pool) => (await p.query('SELECT (SELECT count(*) FROM users) AS users,(SELECT count(*) FROM seasons) AS seasons,(SELECT count(*) FROM reward_ledger) AS rewards,(SELECT count(*) FROM attachments) AS attachments')).rows[0];
  const before = await counts(pool);
  await new Promise<void>(done => testServer!.close(() => done())); testServer = undefined;
  await appPool.end();
  await pool.end(); await pg.stop(); await pg.start(); pool = observePool(new Pool({ connectionString: url('ninegrid_test') }));
  assert.deepEqual(await counts(pool), before); results.push('native PostgreSQL restart preserves users, seasons, rewards and attachments');
  const dump = join(root, 'backup.dump');
  const attachmentBackup = join(root, 'backup-attachments');
  const attachmentRestore = join(root, 'restored-attachments');
  await mkdir(attachmentBackup, { recursive: true });
  await mkdir(attachmentRestore, { recursive: true });
  for (const file of await readdir(join(root, 'uploads'))) await cp(join(root, 'uploads', file), join(attachmentBackup, file));
  for (const file of await readdir(attachmentBackup)) await cp(join(attachmentBackup, file), join(attachmentRestore, file));
  const pgEnvironment = { ...process.env, PGPASSWORD: password };
  await execute(join(pgToolsDir, `pg_dump${extension}`), ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'ninegrid_test', '--format=custom', '--no-owner', '--file', dump], { env: pgEnvironment, cwd: pgToolsDir });
  await execute(join(pgToolsDir, `pg_restore${extension}`), ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'ninegrid_restore', '--no-owner', dump], { env: pgEnvironment, cwd: pgToolsDir });
  const restored = observePool(new Pool({ connectionString: url('ninegrid_restore') }));
  assert.deepEqual(await counts(restored), before);
  const files = await restored.query('SELECT storage_key,sha256 FROM attachments');
  for (const file of files.rows) assert.equal(createHash('sha256').update(await readFile(join(attachmentRestore, file.storage_key))).digest('hex'), file.sha256);
  await restored.end(); results.push('pg_dump/pg_restore into independent database and separate attachment backup preserve counts and SHA-256 correspondence');
  console.log(JSON.stringify({ database: 'native PostgreSQL', provider: 'mocked external AI', checks: results, artifacts: root }, null, 2));
  await writeFile(join(root, 'verification.json'), JSON.stringify({ checks: results, counts: before }, null, 2));
  if (process.argv.includes('--serve')) {
    process.env.NODE_ENV = 'production'; const server = appFor(pool).listen(8791, '127.0.0.1');
    console.log('Browser verification server: http://127.0.0.1:8791');
    await new Promise<void>(done => { process.once('SIGINT', () => server.close(() => done())); process.once('SIGTERM', () => server.close(() => done())); });
  }
} finally { if (testServer) await new Promise<void>(done => testServer!.close(() => done())); await pool!?.end().catch(() => undefined); await pg.stop().catch(() => undefined); }
