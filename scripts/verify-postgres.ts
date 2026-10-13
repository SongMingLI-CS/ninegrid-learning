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
import { persistEvaluation, taskEvidence } from '../server/archive';
import { NUMPY_DEMO_CAMPAIGN } from '../src/lib/numpyDemo';
import { createProgressForCampaign } from '../src/lib/engine';
import type { LearningState } from '../shared/types';
import { COLLECTION_CATALOG } from '../shared/catalog';

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
  async createDatabase(name: string) { const admin = new Pool({ connectionString: url('postgres') }); try { await admin.query(`CREATE DATABASE ${name}`); } finally { await admin.end(); } },
};
const results: string[] = [];
let pool: Pool;
let visualBytes = false;
let testServer: Server | undefined;
const sessionSecret = randomBytes(32).toString('hex');
const provider: typeof fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body));
  const content = body.messages[1].content;
  visualBytes = Array.isArray(content) && content.some((item: { type?: string; image_url?: { url?: string } }) => item.type === 'image_url' && item.image_url?.url?.startsWith('data:image/webp;base64,'));
  return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ recognizedText: '2 × 3', analysis: 'Two rows and three columns.', uncertainties: [], nextStep: 'Predict a new shape.' }) } }] }), { status: 200 });
};
function newState(campaign = NUMPY_DEMO_CAMPAIGN): LearningState {
  return { version: 2, campaign: structuredClone(campaign), progress: createProgressForCampaign(campaign), reviews: [], notes: {}, wallet: { currency: 'learning-coin', balance: 0 }, inventory: {}, rewardLedger: [] };
}
function appFor(currentPool: Pool) {
  return createApp({ apiKey: 'mock-provider-no-real-api-call', fetchImpl: provider, auth: { pool: currentPool, sessionSecret, secureCookie: false } });
}
try {
  await pg.initialise(); await pg.start(); await pg.createDatabase('ninegrid_test'); await pg.createDatabase('ninegrid_restore');
  pool = new Pool({ connectionString: url('ninegrid_test'), max: 6 }); await runMigrations(pool); await runMigrations(pool);
  results.push('real PostgreSQL migrations applied and repeatable');
  process.env.UPLOAD_DIR = join(root, 'uploads');
  const app = appFor(pool);
  testServer = app.listen(0, '127.0.0.1'); await new Promise<void>(done => testServer!.once('listening', done));
  const a = request.agent(testServer); const b = request.agent(testServer);
  const csrf = async (agent: typeof a) => (await agent.get('/api/auth/csrf').expect(200)).body.token as string;
  const register = async (agent: typeof a, email: string) => { const token = await csrf(agent); return (await agent.post('/api/auth/register').set('x-csrf-token', token).send({ email, password: 'independent-test-passphrase-2026' }).expect(201)).body.user; };
  const userA = await register(a, 'integration-a@example.com'); await register(b, 'integration-b@example.com');
  const created = await a.post('/api/seasons').set('x-csrf-token', await csrf(a)).send({ state: newState() }).expect(201);
  const draftInput = { goal: NUMPY_DEMO_CAMPAIGN.goal, level: '已学 ndarray、shape、dtype', days: 28, dailyMinutes: 30, ultimateReward: '完成可验证的数据处理作品' };
  const draftResponse = await a.post('/api/generation-drafts').set('x-csrf-token', await csrf(a)).send({ input: draftInput, rulesVersion: 4 }).expect(201);
  const draftId = draftResponse.body.draft.id as string;
  await b.get('/api/generation-drafts').expect(200).then(response => assert.equal(response.body.drafts.some((item: { id: string }) => item.id === draftId), false));
  const draftCampaign = { ...structuredClone(NUMPY_DEMO_CAMPAIGN), id: randomUUID() };
  const waitingDraft = await a.patch(`/api/generation-drafts/${draftId}`).set('x-csrf-token', await csrf(a)).send({ revision: draftResponse.body.draft.revision, finalCampaign: draftCampaign, status: 'awaiting-confirmation' }).expect(200);
  const activated = await a.post(`/api/generation-drafts/${draftId}/activate`).set('x-csrf-token', await csrf(a)).send({}).expect(201);
  const activatedAgain = await a.post(`/api/generation-drafts/${draftId}/activate`).set('x-csrf-token', await csrf(a)).send({}).expect(200);
  assert.equal(activated.body.season.id, activatedAgain.body.season.id);
  assert.equal(activatedAgain.body.idempotent, true);
  assert.equal(waitingDraft.body.draft.status, 'awaiting-confirmation');
  const compactDraft = await pool.query('SELECT status,activated_season_id,final_campaign,outline,batches,input FROM generation_drafts WHERE id=$1', [draftId]);
  assert.equal(compactDraft.rows[0].status, 'activated'); assert.equal(compactDraft.rows[0].activated_season_id, activated.body.season.id);
  assert.equal(compactDraft.rows[0].final_campaign, null); assert.deepEqual(compactDraft.rows[0].batches, {}); assert.equal(compactDraft.rows[0].input.activated, true);
  results.push('account-scoped generation drafts persist in PostgreSQL and repeated activation creates one season');
  const capacityToken = await csrf(a);
  const capacityPosts = await Promise.all(Array.from({ length: 4 }, (_, index) => a.post('/api/generation-drafts').set('x-csrf-token', capacityToken).send({ input: { ...draftInput, goal: `练习 NumPy 数据整理目标 ${index + 1}` }, rulesVersion: 4 })));
  assert.deepEqual(capacityPosts.map(response => response.status).sort(), [201, 201, 201, 429]);
  results.push('PostgreSQL account row lock enforces the three-active-draft limit during concurrent creates');
  const collectible = COLLECTION_CATALOG[0];
  await pool.query('INSERT INTO inventory_items(user_id,item_id,definition,quantity) VALUES($1,$2,$3,2)', [userA.id, collectible.id, JSON.stringify(collectible)]);
  const saleOperation = randomUUID(); const saleToken = await csrf(a);
  const firstSale = await a.post('/api/inventory/sell').set('x-csrf-token', saleToken).send({ operationId: saleOperation, items: [{ itemId: collectible.id, quantity: 1 }] }).expect(200);
  const saleRetry = await a.post('/api/inventory/sell').set('x-csrf-token', saleToken).send({ operationId: saleOperation, items: [{ itemId: collectible.id, quantity: 1 }] }).expect(200);
  assert.equal(Number(firstSale.body.sale.coins), collectible.sellPrice); assert.equal(saleRetry.body.idempotent, true);
  assert.equal((await pool.query('SELECT quantity FROM inventory_items WHERE user_id=$1 AND item_id=$2', [userA.id, collectible.id])).rows[0].quantity, 1);
  assert.equal(Number((await pool.query("SELECT balance FROM wallets WHERE user_id=$1 AND currency='learning-coin'", [userA.id])).rows[0].balance), collectible.sellPrice);
  assert.equal((await b.get('/api/inventory').expect(200)).body.items.length, 0);
  const competingSales = await Promise.all([0, 1].map(() => a.post('/api/inventory/sell').set('x-csrf-token', saleToken).send({ operationId: randomUUID(), items: [{ itemId: collectible.id, quantity: 1 }] })));
  assert.deepEqual(competingSales.map(response => response.status).sort(), [200, 409]);
  const winningSale = competingSales.find(response => response.status === 200)!;
  const winningOperation = winningSale.body.sale.operation_id;
  const concurrentRetry = await a.post('/api/inventory/sell').set('x-csrf-token', saleToken).send({ operationId: winningOperation, items: [{ itemId: collectible.id, quantity: 1 }] }).expect(200);
  assert.equal(concurrentRetry.body.idempotent, true);
  assert.equal(Number((await pool.query('SELECT quantity FROM inventory_items WHERE user_id=$1 AND item_id=$2', [userA.id, collectible.id])).rows[0].quantity), 0);
  assert.equal(Number((await pool.query("SELECT balance FROM wallets WHERE user_id=$1 AND currency='learning-coin'", [userA.id])).rows[0].balance), collectible.sellPrice * 2);
  results.push('PostgreSQL inventory sale commits one fixed-price credit, one quantity debit and one idempotent sale ledger row; accounts stay isolated');
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
  const anotherBrowser = request.agent(testServer);
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
  await pool.end(); await pg.stop(); await pg.start(); pool = new Pool({ connectionString: url('ninegrid_test') });
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
  const restored = new Pool({ connectionString: url('ninegrid_restore') });
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
