import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { Express, Request } from 'express';
import type { Pool } from 'pg';
import { COLLECTION_CATALOG } from '../shared/catalog';
import { BOXES, CHALLENGES, ECONOMY_VERSION, chainCoinsForMinutes, learningCoinsForMinutes, poolExpectedRecovery, poolTotals, rarityBoxItem, validateEconomy, type BoxId, type ChallengeTier, type RewardPoolEntry } from '../shared/economy';
import { evaluationSchema, learningStateSchema } from '../shared/schema';
import type { LearningState, TaskProgress } from '../shared/types';
import type { Evaluation } from '../shared/types';
import { completeTask, isTaskUnlocked, rateReview, recordGridOutcome } from '../src/lib/engine';

type Row = { id: string; campaign_id: string; title: string; revision: number; state: LearningState; created_at: Date | string; updated_at: Date | string };
type Options = { pool: Pool };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ownerOf = (req: Request) => (req.session as typeof req.session & { userId?: string }).userId;
const profileAvatars=new Set(['','/assets/avatars/field.svg','/assets/avatars/compass.svg','/assets/avatars/signal.svg']);
const publicSeason = (row: Row) => ({ id: row.id, campaignId: row.campaign_id, title: row.title, revision: row.revision, state: row.state, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() });
export function taskEvidence(state: LearningState, taskId: string): string {
  const progress = state.progress[taskId];
  if (!progress) return '';
  return [progress.evidence, progress.supplementalEvidence?.trim() ? `补充证据：\n${progress.supplementalEvidence}` : ''].filter(Boolean).join('\n\n');
}
export function evidenceHash(evidence: string): string { return createHash('sha256').update(evidence, 'utf8').digest('hex'); }

function withoutClientAuthority(incoming: LearningState, existing?: LearningState): LearningState {
  const baseline = existing;
  const existingProgress = baseline?.progress ?? {};
  const progress: LearningState['progress'] = {};
  for (const task of incoming.campaign.stages.flatMap(stage => stage.tasks)) {
    const next = incoming.progress[task.id];
    const old = existingProgress[task.id];
    if (!next) { progress[task.id] = old ?? { completedObjectives: [], evidence: '', status: 'idle' }; continue; }
    const sameEvidence = old && old.evidence === next.evidence && (old.supplementalEvidence ?? '') === (next.supplementalEvidence ?? '');
    const safe: TaskProgress = {
      completedObjectives: next.completedObjectives.filter(id => task.objectives.some(objective => objective.id === id)),
      evidence: next.evidence,
      status: old?.status ?? 'idle',
      ...(old?.status === 'completed' ? { evidence: old.evidence, completedObjectives: old.completedObjectives, verification: old.verification, completedAt: old.completedAt } : {}),
      ...(next.supplementalEvidence ? { supplementalEvidence: next.supplementalEvidence } : {}),
      ...(next.selfChecked ? { selfChecked: true } : {}),
      ...(sameEvidence && old?.evaluation ? { evaluation: old.evaluation, evaluationSource: old.evaluationSource, evaluationEvidence: old.evaluationEvidence, verification: old.verification, completedAt: old.completedAt } : {}),
    };
    progress[task.id] = safe;
  }
  let result: LearningState = {
    ...incoming,
    campaign: baseline?.campaign ?? incoming.campaign,
    progress,
    wallet: baseline?.wallet ?? { currency: 'learning-coin', balance: 0 },
    inventory: baseline?.inventory ?? {},
    rewardLedger: baseline?.rewardLedger ?? [],
    history: [],
    gridOutcomes: baseline?.gridOutcomes ?? {},
  };
  if (baseline) for (const [id, outcome] of Object.entries(incoming.gridOutcomes ?? {})) {
    try { result = recordGridOutcome(result, id, outcome.artifact); } catch { /* Unverified artifacts remain in the user's evidence, never trusted grid outcomes. */ }
  }
  return result;
}

function stripClientAuthority(value: unknown, existing?: LearningState): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const raw = structuredClone(value) as Record<string, any>;
  const campaign = existing?.campaign ?? raw.campaign;
  if (!campaign || !Array.isArray(campaign.stages)) return raw;
  if (existing) raw.campaign = campaign;
  raw.wallet = existing?.wallet ?? { currency: 'learning-coin', balance: 0 };
  raw.inventory = existing?.inventory ?? {};
  raw.rewardLedger = existing?.rewardLedger ?? [];
  const safeProgress: Record<string, unknown> = {};
  for (const task of campaign.stages.flatMap((stage: any) => Array.isArray(stage.tasks) ? stage.tasks : [])) {
    const client = raw.progress?.[task.id];
    const previous = existing?.progress?.[task.id];
    if (!client) { safeProgress[task.id] = previous ?? { completedObjectives: [], evidence: '', status: 'idle' }; continue; }
    const sameEvidence = previous && previous.evidence === client.evidence && (previous.supplementalEvidence ?? '') === (client.supplementalEvidence ?? '');
    safeProgress[task.id] = {
      completedObjectives: Array.isArray(client.completedObjectives) ? client.completedObjectives : [],
      evidence: typeof client.evidence === 'string' ? client.evidence : '',
      status: previous?.status ?? 'idle',
      ...(previous?.status === 'completed' ? { evidence: previous.evidence, completedObjectives: previous.completedObjectives, verification: previous.verification, completedAt: previous.completedAt } : {}),
      ...(typeof client.supplementalEvidence === 'string' && client.supplementalEvidence ? { supplementalEvidence: client.supplementalEvidence } : {}),
      ...(client.selfChecked === true ? { selfChecked: true } : {}),
      ...(sameEvidence && previous?.evaluation ? { evaluation: previous.evaluation, evaluationSource: previous.evaluationSource, evaluationEvidence: previous.evaluationEvidence, verification: previous.verification, completedAt: previous.completedAt } : {}),
    };
  }
  raw.progress = safeProgress;
  if (existing) raw.campaign = existing.campaign;
  else normalizeCampaignRewards(campaign);
  return raw;
}

function normalizeCampaignRewards(campaign: any): void {
  for (const stage of campaign.stages) {
    for (const task of stage.tasks) {
      const xp = Math.min(200, Math.max(10, Math.ceil(task.minutes / 5) * (task.kind === 'boss' ? 8 : task.kind === 'practice' ? 6 : 4)));
      const coins = learningCoinsForMinutes(task.minutes);
      const item = task.kind === 'boss' && task.minutes >= 30 ? catalogReward(`task:${task.id}`, 'small-purple') : undefined;
      task.xp = xp;
      task.reward = { xp, coins, items: item ? [item] : [] };
    }
    stage.reward = { xp: 100, coins: 20, items: [catalogReward(`stage:${stage.id}`, 'small-gold')] };
    for (const chain of stage.chains ?? []) { const minutes=chain.taskIds.reduce((sum: number,id: string)=>sum+(stage.tasks.find((task: any)=>task.id===id)?.minutes??0),0);chain.completionReward={xp:Math.min(120,Math.floor(minutes*0.4)),coins:chainCoinsForMinutes(minutes,chain.track),items:chain.track==='main'&&minutes>=120?[catalogReward(`chain:${chain.id}`,'small-purple')]:[]}; }
  }
}
function catalogReward(seed: string, rarity: string) {
  const pool = COLLECTION_CATALOG.filter(item => item.rarity === rarity);
  const digest = createHash('sha256').update(seed).digest().readUInt32BE(0);
  const item = pool[digest % pool.length];
  return { itemId: item.id, name: item.name, description: item.description, rarity: item.rarity.includes('red') ? 'legendary' as const : 'rare' as const, icon: '✦', quantity: 1 };
}
function drawCatalogItem(pool: RewardPoolEntry[]) {
  const ticketInteger = randomInt(1_000_000_000); const ticket = ticketInteger / 1_000_000_000;
  let cursor = 0;
  const chosen = pool.find(entry => { cursor += entry.probability; return ticket < cursor; }) ?? pool.at(-1)!;
  const candidates = COLLECTION_CATALOG.filter(item => item.rarity === chosen.rarity && (!item.limited || Boolean(item.seasonId)));
  const item = candidates[randomInt(candidates.length)];
  return { item:{ itemId: item.id, name: item.name, description: item.description, rarity: item.rarity, icon: '✦', quantity: chosen.quantity }, audit:{version:ECONOMY_VERSION,ticket:ticketInteger,ticketScale:1_000_000_000,rarity:chosen.rarity,probability:chosen.probability,itemId:item.id,quantity:chosen.quantity} };
}

export function mountArchiveRoutes(app: Express, { pool }: Options): void {
  app.get('/api/wallet', async (req, res, next) => {
    try {
      const [wallet, ledger] = await Promise.all([
        pool.query('SELECT currency,balance FROM wallets WHERE user_id=$1 ORDER BY currency', [ownerOf(req)]),
        pool.query('SELECT id,season_id,task_id,kind,idempotency_key,reward,created_at FROM reward_ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT 500', [ownerOf(req)]),
      ]);
      res.json({ wallets: wallet.rows, ledger: ledger.rows });
    } catch (error) { next(error); }
  });
  app.get('/api/shop', async (req, res, next) => {
    try {
      const [wallet, operations] = await Promise.all([
        pool.query('SELECT balance FROM wallets WHERE user_id=$1 AND currency=\'learning-coin\'', [ownerOf(req)]),
        pool.query('SELECT operation_id,kind,result,pool_version,created_at FROM economy_operations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [ownerOf(req)]),
      ]);
      const boxes = Object.values(BOXES).map(box => ({ ...box, expectedRecovery: poolExpectedRecovery(box.pool), poolTotal: poolTotals(box.pool) }));
      res.json({ version: ECONOMY_VERSION, balance: Number(wallet.rows[0]?.balance ?? 0), boxes, operations: operations.rows, economyCheck: validateEconomy() });
    } catch (error) { next(error); }
  });
  app.post('/api/shop/purchase', async (req, res, next) => {
    const { operationId, boxId, quantity } = req.body ?? {};
    if (typeof operationId !== 'string' || !idPattern.test(operationId) || !Object.hasOwn(BOXES, boxId) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) { res.status(400).json({ error: 'INVALID_PURCHASE' }); return; }
    const box = BOXES[boxId as BoxId]; const total = box.price * quantity; const requestHash = createHash('sha256').update(JSON.stringify({ boxId, quantity, price: box.price, version: ECONOMY_VERSION })).digest('hex');
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerOf(req)]);
      const existing = await client.query('SELECT request_hash,result FROM economy_operations WHERE user_id=$1 AND operation_id=$2', [ownerOf(req), operationId]);
      if (existing.rows[0]) { if (existing.rows[0].request_hash !== requestHash) { await client.query('ROLLBACK'); res.status(409).json({ error: 'IDEMPOTENCY_KEY_REUSED' }); return; } await client.query('COMMIT'); res.json({ purchase: existing.rows[0].result, idempotent: true }); return; }
      const debit = await client.query(`UPDATE wallets SET balance=balance-$1 WHERE user_id=$2 AND currency='learning-coin' AND balance >= $1 RETURNING balance`, [total, ownerOf(req)]);
      if (!debit.rowCount) { await client.query('ROLLBACK'); res.status(409).json({ error: 'INSUFFICIENT_BALANCE', required: total }); return; }
      const item = rarityBoxItem(box.id); item.quantity = quantity;
      await client.query(`INSERT INTO inventory_items(user_id,item_id,definition,quantity) VALUES($1,$2,$3,$4)
        ON CONFLICT(user_id,item_id) DO UPDATE SET quantity=inventory_items.quantity+EXCLUDED.quantity`, [ownerOf(req), item.itemId, JSON.stringify(item), quantity]);
      const result = { operationId, boxId, itemId: item.itemId, title: box.title, quantity, unitPrice: box.price, total, balance: Number(debit.rows[0].balance), version: ECONOMY_VERSION };
      await client.query('INSERT INTO economy_operations(user_id,operation_id,kind,request_hash,result,pool_version) VALUES($1,$2,\'purchase\',$3,$4,$5)', [ownerOf(req), operationId, requestHash, JSON.stringify(result), ECONOMY_VERSION]);
      await client.query('INSERT INTO inventory_acquisitions(user_id,item_id,quantity,source_type,source_id) VALUES($1,$2,$3,\'purchase\',$4)', [ownerOf(req),item.itemId,quantity,operationId]);
      await client.query('COMMIT'); res.status(201).json({ purchase: result, idempotent: false });
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); next(error); } finally { client.release(); }
  });
  app.post('/api/inventory/open', async (req, res, next) => {
    const { operationId, boxId, quantity } = req.body ?? {};
    if (typeof operationId !== 'string' || !idPattern.test(operationId) || !Object.hasOwn(BOXES, boxId) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10) { res.status(400).json({ error: 'INVALID_OPENING' }); return; }
    const box = BOXES[boxId as BoxId]; const item = rarityBoxItem(box.id); const requestHash = createHash('sha256').update(JSON.stringify({ boxId, quantity, version: ECONOMY_VERSION })).digest('hex');
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerOf(req)]);
      const existing = await client.query('SELECT request_hash,result FROM economy_operations WHERE user_id=$1 AND operation_id=$2', [ownerOf(req), operationId]);
      if (existing.rows[0]) { if (existing.rows[0].request_hash !== requestHash) { await client.query('ROLLBACK'); res.status(409).json({ error: 'IDEMPOTENCY_KEY_REUSED' }); return; } await client.query('COMMIT'); res.json({ opening: existing.rows[0].result, idempotent: true }); return; }
      const stock = await client.query('SELECT quantity FROM inventory_items WHERE user_id=$1 AND item_id=$2 FOR UPDATE', [ownerOf(req), item.itemId]);
      if (!stock.rows[0] || Number(stock.rows[0].quantity) < quantity) { await client.query('ROLLBACK'); res.status(409).json({ error: 'INSUFFICIENT_BOXES', available: Number(stock.rows[0]?.quantity ?? 0) }); return; }
      await client.query('UPDATE inventory_items SET quantity=quantity-$1 WHERE user_id=$2 AND item_id=$3', [quantity, ownerOf(req), item.itemId]);
      const results = Array.from({ length: quantity }, (_, index) => ({ opening: index + 1, ...drawCatalogItem(box.pool), pool: box.pool }));
      for (const result of results) {
        const reward = result.item;
        await client.query(`INSERT INTO inventory_items(user_id,item_id,definition,quantity) VALUES($1,$2,$3,$4)
          ON CONFLICT(user_id,item_id) DO UPDATE SET quantity=inventory_items.quantity+EXCLUDED.quantity`, [ownerOf(req), reward.itemId, JSON.stringify(reward), reward.quantity]);
        await client.query('INSERT INTO inventory_acquisitions(user_id,item_id,quantity,source_type,source_id) VALUES($1,$2,$3,\'box-open\',$4)', [ownerOf(req),reward.itemId,reward.quantity,operationId]);
      }
      const data = { operationId, boxId, boxTitle: box.title, quantity, results, createdAt: new Date().toISOString() };
      await client.query('INSERT INTO economy_operations(user_id,operation_id,kind,request_hash,result,pool_version) VALUES($1,$2,\'open\',$3,$4,$5)', [ownerOf(req), operationId, requestHash, JSON.stringify(data), ECONOMY_VERSION]);
      await client.query('COMMIT'); res.status(201).json({ opening: data, idempotent: false });
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); next(error); } finally { client.release(); }
  });
  app.get('/api/challenges', async (_req, res) => {
    res.json({ version: ECONOMY_VERSION, tiers: Object.entries(CHALLENGES).map(([id, tier]) => ({ id, ...tier, rewardExpectedRecovery: poolExpectedRecovery(tier.pool), poolTotal: poolTotals(tier.pool) })) });
  });
  app.get('/api/challenges/history', async (req,res,next) => {
    try { const result=await pool.query('SELECT id,season_id,task_id,tier,status,entry_fee,prompt,evidence,evaluation,reward_item,reward_coins,draw_audit,pool_version,started_at,deadline_at,settled_at FROM challenge_runs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30',[ownerOf(req)]); res.json({challenges:result.rows}); } catch(error){next(error);}
  });
  app.post('/api/challenges/enter', async (req, res, next) => {
    const { seasonId, taskId, tier: tierId } = req.body ?? {};
    if (typeof seasonId !== 'string' || !idPattern.test(seasonId) || typeof taskId !== 'string' || taskId.length > 128 || !Object.hasOwn(CHALLENGES, tierId)) { res.status(400).json({ error: 'INVALID_CHALLENGE' }); return; }
    const tier = CHALLENGES[tierId as ChallengeTier]; const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerOf(req)]);
      const season = await client.query<Row>('SELECT id,campaign_id,title,revision,state,created_at,updated_at FROM seasons WHERE id=$1 AND owner_user_id=$2 FOR UPDATE', [seasonId, ownerOf(req)]);
      const row = season.rows[0]; const task = row?.state.campaign.stages.flatMap(stage => stage.tasks).find(item => item.id === taskId);
      if (!row || !task) { await client.query('ROLLBACK'); res.status(404).json({ error: 'TASK_NOT_FOUND' }); return; }
      if (row.state.progress[taskId]?.status === 'completed' || !isTaskUnlocked(row.state.campaign, row.state.progress, taskId)) { await client.query('ROLLBACK'); res.status(409).json({ error: 'CHALLENGE_TASK_NOT_AVAILABLE' }); return; }
      const recent = await client.query('SELECT 1 FROM challenge_runs WHERE user_id=$1 AND started_at>now()-interval \'24 hours\' AND status IN (\'active\',\'evaluating\',\'passed\',\'failed\',\'abandoned\') LIMIT 1', [ownerOf(req)]);
      if (recent.rowCount) { await client.query('ROLLBACK'); res.status(429).json({ error: 'DAILY_CHALLENGE_LIMIT' }); return; }
      const debit = await client.query(`UPDATE wallets SET balance=balance-$1 WHERE user_id=$2 AND currency='learning-coin' AND balance >= $1 RETURNING balance`, [tier.entryFee, ownerOf(req)]);
      if (!debit.rowCount) { await client.query('ROLLBACK'); res.status(409).json({ error: 'INSUFFICIENT_BALANCE', required: tier.entryFee }); return; }
      const id = randomUUID(); const deadline = new Date(Date.now() + (tier.minutes * 2 + 15) * 60_000);
      const prompt = `基于已学习任务「${task.title}」独立完成挑战。\n\n任务目标：${task.brief}\n\n提交可检查的解释、步骤或作品证据；先提交，再显示标准。`;
      await client.query('INSERT INTO challenge_runs(id,user_id,season_id,task_id,tier,status,entry_fee,prompt,deadline_at) VALUES($1,$2,$3,$4,$5,\'active\',$6,$7,$8)', [id, ownerOf(req), seasonId, taskId, tierId, tier.entryFee, prompt, deadline]);
      await client.query('COMMIT'); res.status(201).json({ challenge: { id, seasonId, taskId, tier: tierId, title: tier.title, status: 'active', entryFee: tier.entryFee, prompt, acceptance: task.acceptance, deadlineAt: deadline.toISOString(), hintLimit: tier.hintLimit }, balance: Number(debit.rows[0].balance) });
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); next(error); } finally { client.release(); }
  });
  app.post('/api/challenges/:id/abandon', async (req, res, next) => {
    if (!idPattern.test(req.params.id)) { res.status(400).json({ error: 'INVALID_CHALLENGE_ID' }); return; }
    try { const result = await pool.query(`UPDATE challenge_runs SET status='abandoned',settled_at=now() WHERE id=$1 AND user_id=$2 AND status='active' RETURNING id,status,entry_fee`, [req.params.id, ownerOf(req)]); if (!result.rowCount) { res.status(409).json({ error: 'CHALLENGE_NOT_ACTIVE' }); return; } res.json({ challenge: result.rows[0], refunded: false }); }
    catch (error) { next(error); }
  });
  app.get('/api/profile', async (req, res, next) => {
    try {
      const userId = ownerOf(req);
      const [user, profile, seasons, wallet, items, rewards, challenges] = await Promise.all([
        pool.query('SELECT email,created_at FROM users WHERE id=$1', [userId]),
        pool.query('SELECT nickname,avatar_url,bio,is_public FROM user_profiles WHERE user_id=$1', [userId]),
        pool.query<{ id:string; title:string; state:LearningState; updated_at:Date|string }>('SELECT id,title,state,updated_at FROM seasons WHERE owner_user_id=$1 ORDER BY updated_at DESC', [userId]),
        pool.query('SELECT balance FROM wallets WHERE user_id=$1 AND currency=\'learning-coin\'', [userId]),
        pool.query(`SELECT i.item_id,i.definition,i.quantity,i.acquired_at,COALESCE(p.is_showcased,false) is_showcased FROM inventory_items i LEFT JOIN inventory_item_preferences p ON p.user_id=i.user_id AND p.item_id=i.item_id WHERE i.user_id=$1 AND i.quantity>0`, [userId]),
        pool.query('SELECT reward FROM reward_ledger WHERE user_id=$1', [userId]),
        pool.query('SELECT id,tier,status,entry_fee,reward_item,reward_coins,draw_audit,pool_version,started_at,settled_at FROM challenge_runs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [userId]),
      ]);
      const kinds = items.rows.filter((item: any) => COLLECTION_CATALOG.some(entry => entry.id === item.item_id)).length;
      const profileData = profile.rows[0] ?? { nickname: '行动者', avatar_url: '', bio: '', is_public: false };
      res.json({ profile: { ...profileData, joinedAt: user.rows[0]?.created_at }, balance: Number(wallet.rows[0]?.balance ?? 0), xp: rewards.rows.reduce((sum: number, row: any) => sum + Number(row.reward?.xp ?? 0), 0), seasons: seasons.rows.map((row: any) => {const allTasks=row.state.campaign.stages.flatMap((stage:any)=>stage.tasks);const finalTask=allTasks.at(-1);return { id: row.id, title: row.title, desiredArtifact:row.state.campaign.desiredArtifact??row.state.campaign.ultimateReward, finalProjectEvidence:finalTask&&row.state.progress[finalTask.id]?.status==='completed'?row.state.progress[finalTask.id]?.evidence:null, updatedAt: row.updated_at, completed: Object.values(row.state.progress).filter((progress: any) => progress.status === 'completed').length, total: Object.keys(row.state.progress).length, stages: row.state.campaign.stages.map((stage: any) => ({ title: stage.title, completed: (stage.gateTaskIds ?? stage.mainlineTaskIds ?? []).every((id: string) => row.state.progress[id]?.status === 'completed') })), grid: (row.state.campaign.nineGrid ?? []).map((slot: any) => ({ title: slot.title, evidence: row.state.gridOutcomes?.[slot.id]?.artifact ?? null })) }}), collection: { kinds, total: COLLECTION_CATALOG.length, completion: kinds / COLLECTION_CATALOG.length, byRarity: Object.fromEntries(['small-purple','small-gold','large-gold','small-red','large-red'].map(rarity => [rarity, items.rows.filter((item: any) => COLLECTION_CATALOG.some(def=>def.id===item.item_id&&def.rarity===rarity)).length])) }, showcased: items.rows.filter((item: any) => item.is_showcased).map((item: any) => ({ ...(COLLECTION_CATALOG.find(def=>def.id===item.item_id)??item.definition), quantity: item.quantity, itemId: item.item_id })), challenges: challenges.rows, private: !profileData.is_public });
    } catch (error) { next(error); }
  });
  app.post('/api/profile', async (req, res, next) => {
    const body = req.body ?? {};
    if (typeof body.nickname !== 'string' || body.nickname.trim().length < 1 || body.nickname.trim().length > 32 || typeof body.avatarUrl !== 'string' || !profileAvatars.has(body.avatarUrl) || typeof body.bio !== 'string' || body.bio.length > 240 || body.isPublic !== false) { res.status(400).json({ error: 'INVALID_PROFILE' }); return; }
    try {
      const result = await pool.query(`INSERT INTO user_profiles(user_id,nickname,avatar_url,bio,is_public) VALUES($1,$2,$3,$4,false) ON CONFLICT(user_id) DO UPDATE SET nickname=EXCLUDED.nickname,avatar_url=EXCLUDED.avatar_url,bio=EXCLUDED.bio,updated_at=now() RETURNING nickname,avatar_url,bio,is_public`, [ownerOf(req), body.nickname.trim(), body.avatarUrl, body.bio.trim()]);
      res.json({ profile: result.rows[0] });
    } catch (error) { next(error); }
  });
  app.get('/api/inventory', async (req, res, next) => {
    try {
      const [items, ledger] = await Promise.all([
        pool.query(`SELECT i.item_id,i.definition,i.quantity,i.acquired_at,COALESCE(p.is_locked,false) AS is_locked,COALESCE(p.is_showcased,false) AS is_showcased
          FROM inventory_items i LEFT JOIN inventory_item_preferences p ON p.user_id=i.user_id AND p.item_id=i.item_id
          WHERE i.user_id=$1 AND i.quantity>0 ORDER BY i.acquired_at DESC`, [ownerOf(req)]),
        pool.query('SELECT season_id,task_id,reward,created_at FROM reward_ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT 2000', [ownerOf(req)]),
      ]);
      const sources = new Map<string, Array<{ seasonId: string; taskId: string; acquiredAt: Date | string }>>();
      for (const row of ledger.rows as Array<{ season_id: string; task_id: string; reward: { items?: Array<{ itemId: string }> }; created_at: Date | string }>) {
        for (const item of row.reward?.items ?? []) sources.set(item.itemId, [...(sources.get(item.itemId) ?? []), { seasonId: row.season_id, taskId: row.task_id, acquiredAt: row.created_at }]);
      }
      const acquisitions = await pool.query('SELECT item_id,source_type,source_id,season_id,task_id,created_at FROM inventory_acquisitions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 4000', [ownerOf(req)]);
      for (const row of acquisitions.rows as Array<{item_id:string;source_type:string;source_id:string;season_id:string|null;task_id:string|null;created_at:Date|string}>) sources.set(row.item_id,[...(sources.get(row.item_id)??[]),{seasonId:row.season_id??row.source_type,taskId:row.task_id??`${row.source_type}:${row.source_id}`,acquiredAt:row.created_at}]);
      const rarity = req.query.rarity;
      const seasonId = req.query.seasonId;
      const filtered = (items.rows as Array<{ item_id: string; definition: Record<string, unknown>; quantity: number; acquired_at: Date | string }>).map(row => ({ ...row, sources: sources.get(row.item_id) ?? [] }))
        .filter(item => (!rarity || item.definition.rarity === rarity) && (!seasonId || item.sources.some(source => source.seasonId === seasonId)));
      const [sales, economy, challenge, learning] = await Promise.all([
        pool.query('SELECT operation_id,items,coins,created_at FROM inventory_sales WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [ownerOf(req)]),
        pool.query('SELECT operation_id,kind,result,pool_version,created_at FROM economy_operations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [ownerOf(req)]),
        pool.query('SELECT id,tier,status,entry_fee,reward_item,reward_coins,draw_audit,pool_version,started_at,settled_at FROM challenge_runs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [ownerOf(req)]),
        pool.query('SELECT id,season_id,task_id,kind,reward,created_at FROM reward_ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [ownerOf(req)]),
      ]);
      res.json({ items: filtered, sales: sales.rows, transactions: [...sales.rows.map(row=>({...row,kind:'sale'})),...economy.rows,...challenge.rows.map(row=>({...row,kind:`challenge_${row.status}`})),...learning.rows].sort((a,b)=>new Date(b.created_at??b.started_at).getTime()-new Date(a.created_at??a.started_at).getTime()).slice(0,100) });
    } catch (error) { next(error); }
  });

  app.post('/api/inventory/preferences', async (req, res, next) => {
    const items = req.body?.items;
    if (!Array.isArray(items) || items.length < 1 || items.length > 155 || items.some((item: any) => typeof item?.itemId !== 'string' || item.itemId.length > 128 || typeof item.locked !== 'boolean' || typeof item.showcased !== 'boolean')) { res.status(400).json({ error: 'INVALID_INVENTORY_PREFERENCES' }); return; }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerOf(req)]);
      for (const item of items) {
        const owned = await client.query('SELECT 1 FROM inventory_items WHERE user_id=$1 AND item_id=$2 AND quantity>0', [ownerOf(req), item.itemId]);
        if (!owned.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'ITEM_NOT_OWNED', itemId: item.itemId }); return; }
        await client.query(`INSERT INTO inventory_item_preferences(user_id,item_id,is_locked,is_showcased) VALUES($1,$2,$3,$4)
        ON CONFLICT(user_id,item_id) DO UPDATE SET is_locked=EXCLUDED.is_locked,is_showcased=EXCLUDED.is_showcased,updated_at=now()`, [ownerOf(req), item.itemId, item.locked, item.showcased]);
      }
      await client.query('COMMIT'); res.json({ saved: items.length });
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); next(error); }
    finally { client.release(); }
  });

  app.post('/api/inventory/sell', async (req, res, next) => {
    const operationId = req.body?.operationId;
    const requested = req.body?.items;
    if (typeof operationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(operationId) || !Array.isArray(requested) || requested.length < 1 || requested.length > 155 || requested.some((item: any) => typeof item?.itemId !== 'string' || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 10000) || new Set(requested.map((item: any) => item.itemId)).size !== requested.length) { res.status(400).json({ error: 'INVALID_SALE' }); return; }
    const requestHash=createHash('sha256').update(JSON.stringify(requested.map((item:any)=>({itemId:item.itemId,quantity:item.quantity})).sort((a:any,b:any)=>a.itemId.localeCompare(b.itemId)))).digest('hex');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerOf(req)]);
      const already = await client.query('SELECT operation_id,items,coins,created_at,request_hash FROM inventory_sales WHERE user_id=$1 AND operation_id=$2', [ownerOf(req), operationId]);
      if (already.rows[0]) { if(already.rows[0].request_hash&&already.rows[0].request_hash!==requestHash){await client.query('ROLLBACK');res.status(409).json({error:'IDEMPOTENCY_KEY_REUSED'});return;} await client.query('COMMIT'); res.json({ sale: already.rows[0], idempotent: true }); return; }
      const items = [] as Array<{ itemId: string; name: string; quantity: number; unitPrice: number; total: number }>;
      let total = 0;
      for (const requestedItem of requested as Array<{ itemId: string; quantity: number }>) {
        const definition = COLLECTION_CATALOG.find(item => item.id === requestedItem.itemId);
        if (!definition || !definition.sellable || definition.limited) { await client.query('ROLLBACK'); res.status(422).json({ error: 'ITEM_NOT_SELLABLE', itemId: requestedItem.itemId }); return; }
        const held = await client.query('SELECT quantity FROM inventory_items WHERE user_id=$1 AND item_id=$2 FOR UPDATE', [ownerOf(req), requestedItem.itemId]);
        if (!held.rows[0] || Number(held.rows[0].quantity) < requestedItem.quantity) { await client.query('ROLLBACK'); res.status(409).json({ error: 'INSUFFICIENT_ITEM_QUANTITY', itemId: requestedItem.itemId }); return; }
        const preference = await client.query('SELECT is_locked FROM inventory_item_preferences WHERE user_id=$1 AND item_id=$2', [ownerOf(req), requestedItem.itemId]);
        if (preference.rows[0]?.is_locked) { await client.query('ROLLBACK'); res.status(409).json({ error: 'ITEM_LOCKED', itemId: requestedItem.itemId }); return; }
        const line = requestedItem.quantity * definition.sellPrice; total += line;
        items.push({ itemId: definition.id, name: definition.name, quantity: requestedItem.quantity, unitPrice: definition.sellPrice, total: line });
      }
      if (!Number.isSafeInteger(total) || total <= 0) { await client.query('ROLLBACK'); res.status(422).json({ error: 'INVALID_SALE_TOTAL' }); return; }
      for (const item of items) await client.query('UPDATE inventory_items SET quantity=quantity-$1 WHERE user_id=$2 AND item_id=$3', [item.quantity, ownerOf(req), item.itemId]);
      await client.query(`INSERT INTO wallets(user_id,currency,balance) VALUES($1,'learning-coin',$2)
        ON CONFLICT(user_id,currency) DO UPDATE SET balance=wallets.balance+EXCLUDED.balance`, [ownerOf(req), total]);
      const sale = await client.query(`INSERT INTO inventory_sales(user_id,operation_id,items,coins,request_hash) VALUES($1,$2,$3,$4,$5)
        RETURNING operation_id,items,coins,created_at`, [ownerOf(req), operationId, JSON.stringify(items), total,requestHash]);
      await client.query('COMMIT'); res.json({ sale: sale.rows[0], idempotent: false });
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); next(error); }
    finally { client.release(); }
  });

  app.get('/api/seasons', async (req, res, next) => {
    try {
      const result = await pool.query<Row>('SELECT id,campaign_id,title,revision,state,created_at,updated_at FROM seasons WHERE owner_user_id = $1 ORDER BY updated_at DESC', [ownerOf(req)]);
      res.json({ seasons: result.rows.map(publicSeason) });
    } catch (error) { next(error); }
  });

  app.post('/api/legacy-import', async (req, res, next) => {
    if (!Array.isArray(req.body?.archives) || req.body.archives.length < 1 || req.body.archives.length > 100 || JSON.stringify(req.body).length > 9_000_000) { res.status(400).json({ error: 'INVALID_IMPORT' }); return; }
    const archives: LearningState[] = [];
    for (const raw of req.body.archives as unknown[]) {
      const parsed = learningStateSchema.safeParse(raw);
      if (!parsed.success) { res.status(400).json({ error: 'INVALID_IMPORT' }); return; }
      const archive = structuredClone(parsed.data);
      archive.history = [];
      const legacyClaims = { wallet: archive.wallet, inventory: archive.inventory, rewardLedger: archive.rewardLedger };
      for (const [id, outcome] of Object.entries(archive.gridOutcomes ?? {})) archive.notes[`legacy-ninegrid-${id}`] = `旧档案中记录的成果（尚未重新验证）：${outcome.artifact}`.slice(0, 100000);
      archive.notes['legacy-reward-claims'] = `旧档奖励原始声明（未核验，仅保留记录，不计入余额）：${JSON.stringify(legacyClaims)}`.slice(0, 100000);
      archive.wallet = { currency: 'learning-coin', balance: 0 }; archive.inventory = {}; archive.rewardLedger = []; archive.gridOutcomes = {};
      normalizeCampaignRewards(archive.campaign);
      const oldProgress = archive.progress;
      archive.progress = Object.fromEntries(archive.campaign.stages.flatMap(stage => stage.tasks).map(task => {
        const old = oldProgress[task.id];
        return [task.id, { completedObjectives: old?.completedObjectives.filter(id => task.objectives.some(item => item.id === id)) ?? [], evidence: old?.evidence ?? '', ...(old?.supplementalEvidence ? { supplementalEvidence: old.supplementalEvidence } : {}), status: 'idle' as const }];
      }));
      for (const task of archive.campaign.stages.flatMap(stage => stage.tasks)) {
        const old = oldProgress[task.id];
        if (old?.status !== 'completed' || taskEvidence({ ...archive, progress: oldProgress }, task.id).trim().length < 20 || !isTaskUnlocked(archive.campaign, archive.progress, task.id)) continue;
        archive.progress[task.id] = { ...archive.progress[task.id], status: 'completed', verification: 'self', evaluationSource: 'self', selfChecked: true, completedAt: old.completedAt ?? new Date().toISOString() };
      }
      const completed = new Set(Object.entries(archive.progress).filter(([, progress]) => progress.status === 'completed').map(([id]) => id));
      archive.reviews = archive.reviews.filter(card => completed.has(card.taskId));
      for (const taskId of completed) if (!archive.reviews.some(card => card.taskId === taskId)) archive.reviews.push({ taskId, dueAt: new Date(Date.now() + 86_400_000).toISOString(), interval: 1, ease: 2.5, repetitions: 0, history: [] });
      const sanitized = learningStateSchema.safeParse(archive);
      if (!sanitized.success) { res.status(400).json({ error: 'INVALID_IMPORT' }); return; }
      archives.push(sanitized.data);
    }
    const fingerprint = createHash('sha256').update(JSON.stringify(req.body.archives)).digest('hex');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ season_ids: string[] }>('SELECT season_ids FROM legacy_imports WHERE owner_user_id=$1 AND source_sha256=$2', [ownerOf(req), fingerprint]);
      if (existing.rows[0]) { await client.query('ROLLBACK'); res.json({ imported: false, duplicate: true, seasonIds: existing.rows[0].season_ids }); return; }
      const seasonIds: string[] = [];
      for (const state of archives) {
        const inserted = await client.query<Row>(`INSERT INTO seasons (id,owner_user_id,campaign_id,title,revision,state) VALUES ($1,$2,$3,$4,1,$5)
          ON CONFLICT (owner_user_id,campaign_id) DO NOTHING RETURNING id,campaign_id,title,revision,state,created_at,updated_at`, [randomUUID(), ownerOf(req), state.campaign.id, state.campaign.title, JSON.stringify(state)]);
        if (inserted.rows[0]) seasonIds.push(inserted.rows[0].id);
        else {
          const found = await client.query<{ id: string }>('SELECT id FROM seasons WHERE owner_user_id=$1 AND campaign_id=$2', [ownerOf(req), state.campaign.id]);
          if (found.rows[0]) seasonIds.push(found.rows[0].id);
        }
      }
      await client.query('INSERT INTO legacy_imports (id,owner_user_id,source_sha256,season_ids) VALUES ($1,$2,$3,$4)', [randomUUID(), ownerOf(req), fingerprint, seasonIds]);
      await client.query('COMMIT');
      res.status(201).json({ imported: true, duplicate: false, seasonIds, count: seasonIds.length });
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); next(error); }
    finally { client.release(); }
  });

  app.post('/api/seasons', async (req, res, next) => {
    const parsed = learningStateSchema.safeParse(stripClientAuthority(req.body?.state));
    if (!parsed.success) { res.status(400).json({ error: 'INVALID_ARCHIVE' }); return; }
    const state = withoutClientAuthority(parsed.data);
    const id = randomUUID();
    try {
      const result = await pool.query<Row>(`INSERT INTO seasons (id,owner_user_id,campaign_id,title,revision,state)
        VALUES ($1,$2,$3,$4,1,$5) RETURNING id,campaign_id,title,revision,state,created_at,updated_at`,
      [id, ownerOf(req), state.campaign.id, state.campaign.title, JSON.stringify(state)]);
      res.status(201).json({ season: publicSeason(result.rows[0]) });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') { res.status(409).json({ error: 'SEASON_EXISTS' }); return; }
      next(error);
    }
  });

  app.get('/api/seasons/:id', async (req, res, next) => {
    if (!idPattern.test(req.params.id)) { res.status(404).json({ error: 'NOT_FOUND' }); return; }
    try {
      const result = await pool.query<Row>('SELECT id,campaign_id,title,revision,state,created_at,updated_at FROM seasons WHERE id = $1 AND owner_user_id = $2', [req.params.id, ownerOf(req)]);
      if (!result.rows[0]) { res.status(404).json({ error: 'NOT_FOUND' }); return; }
      res.json({ season: publicSeason(result.rows[0]) });
    } catch (error) { next(error); }
  });

  app.put('/api/seasons/:id', async (req, res, next) => {
    if (!idPattern.test(req.params.id) || !Number.isInteger(req.body?.revision) || req.body.revision < 1) { res.status(400).json({ error: 'INVALID_REQUEST' }); return; }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query<Row>('SELECT id,campaign_id,title,revision,state,created_at,updated_at FROM seasons WHERE id = $1 AND owner_user_id = $2 FOR UPDATE', [req.params.id, ownerOf(req)]);
      const old = found.rows[0];
      if (!old) { await client.query('ROLLBACK'); res.status(404).json({ error: 'NOT_FOUND' }); return; }
      if (old.revision !== req.body.revision) { await client.query('ROLLBACK'); res.status(409).json({ error: 'REVISION_CONFLICT', revision: old.revision, season: publicSeason(old) }); return; }
      if (req.body?.state?.campaign?.id !== old.campaign_id) { await client.query('ROLLBACK'); res.status(400).json({ error: 'CAMPAIGN_IMMUTABLE' }); return; }
      const parsed = learningStateSchema.safeParse(stripClientAuthority(req.body?.state, old.state));
      if (!parsed.success) { await client.query('ROLLBACK'); res.status(400).json({ error: 'INVALID_ARCHIVE' }); return; }
      if (parsed.data.campaign.id !== old.campaign_id) { await client.query('ROLLBACK'); res.status(400).json({ error: 'CAMPAIGN_IMMUTABLE' }); return; }
      const state = withoutClientAuthority(parsed.data, old.state);
      const result = await client.query<Row>(`UPDATE seasons SET title=$1,state=$2,revision=revision+1,updated_at=now()
        WHERE id=$3 AND owner_user_id=$4 AND revision=$5
        RETURNING id,campaign_id,title,revision,state,created_at,updated_at`,
      [state.campaign.title, JSON.stringify(state), req.params.id, ownerOf(req), req.body.revision]);
      if (!result.rows[0]) { await client.query('ROLLBACK'); res.status(409).json({ error: 'REVISION_CONFLICT' }); return; }
      await client.query('COMMIT');
      res.json({ season: publicSeason(result.rows[0]) });
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); next(error); }
    finally { client.release(); }
  });

  app.post('/api/seasons/:id/settle', async (req, res, next) => {
    if (!idPattern.test(req.params.id) || typeof req.body?.taskId !== 'string' || !Number.isInteger(req.body?.revision)) { res.status(400).json({ error: 'INVALID_REQUEST' }); return; }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query<Row>('SELECT id,campaign_id,title,revision,state,created_at,updated_at FROM seasons WHERE id=$1 AND owner_user_id=$2 FOR UPDATE', [req.params.id, ownerOf(req)]);
      const row = found.rows[0];
      if (!row) { await client.query('ROLLBACK'); res.status(404).json({ error: 'NOT_FOUND' }); return; }
      if (row.revision !== req.body.revision) { await client.query('ROLLBACK'); res.status(409).json({ error: 'REVISION_CONFLICT', revision: row.revision }); return; }
      const previous = row.state;
      const task = previous.campaign.stages.flatMap(stage => stage.tasks).find(item => item.id === req.body.taskId);
      const progress = previous.progress[req.body.taskId];
      if (!task || !progress) { await client.query('ROLLBACK'); res.status(404).json({ error: 'TASK_NOT_FOUND' }); return; }
      if (progress.status === 'completed' && req.body.verification !== 'ai') { await client.query('ROLLBACK'); res.json({ season: publicSeason(row), alreadyCompleted: true, rewards: [] }); return; }
      if (!isTaskUnlocked(previous.campaign, previous.progress, task.id)) { await client.query('ROLLBACK'); res.status(409).json({ error: 'PREREQUISITES_NOT_MET' }); return; }
      if (taskEvidence(previous, task.id).trim().length < 20) { await client.query('ROLLBACK'); res.status(422).json({ error: 'EVIDENCE_REQUIRED' }); return; }
      let verification: 'self' | 'ai' = 'self';
      if (req.body.verification === 'ai') {
        const hash = evidenceHash(taskEvidence(previous, task.id));
        const checked = await client.query('SELECT 1 FROM task_evaluations WHERE owner_user_id=$1 AND season_id=$2 AND task_id=$3 AND evidence_sha256=$4 AND (evaluation->>\'passed\')::boolean=true AND (evaluation->>\'score\')::integer>=70', [ownerOf(req), row.id, task.id, hash]);
        if (!checked.rowCount || progress.evaluationSource !== 'ai' || progress.evaluationEvidence !== taskEvidence(previous, task.id) || !progress.evaluation?.passed || progress.evaluation.score < 70) { await client.query('ROLLBACK'); res.status(422).json({ error: 'AI_EVALUATION_REQUIRED' }); return; }
        if (progress.status === 'completed' && progress.verification === 'ai') { await client.query('ROLLBACK'); res.json({ season: publicSeason(row), alreadyCompleted: true, rewards: [] }); return; }
        verification = 'ai';
      } else if (!progress.selfChecked) { await client.query('ROLLBACK'); res.status(422).json({ error: 'SELF_CHECK_REQUIRED' }); return; }
      const canonical = structuredClone(previous);
      normalizeCampaignRewards(canonical.campaign);
      const completed = completeTask(canonical, task.id, verification);
      const previousKeys = new Set((previous.rewardLedger ?? []).map(entry => entry.idempotencyKey));
      const additions = (completed.rewardLedger ?? []).filter(entry => !previousKeys.has(entry.idempotencyKey));
      for (const entry of additions) {
        const inserted = await client.query<{ id: string }>(`INSERT INTO reward_ledger (id,user_id,season_id,task_id,kind,idempotency_key,reward)
          VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (user_id,idempotency_key) DO NOTHING RETURNING id`,
        [randomUUID(), ownerOf(req), row.id, entry.taskId, entry.kind, entry.idempotencyKey, JSON.stringify(entry.reward)]);
        if (!inserted.rowCount) continue;
        if (entry.reward.coins > 0) await client.query(`INSERT INTO wallets (user_id,currency,balance) VALUES ($1,'learning-coin',$2)
          ON CONFLICT (user_id,currency) DO UPDATE SET balance=wallets.balance+EXCLUDED.balance`, [ownerOf(req), entry.reward.coins]);
        for (const item of entry.reward.items) await client.query(`INSERT INTO inventory_items (user_id,item_id,definition,quantity)
          VALUES ($1,$2,$3,$4) ON CONFLICT (user_id,item_id) DO UPDATE SET quantity=inventory_items.quantity+EXCLUDED.quantity`,
        [ownerOf(req), item.itemId, JSON.stringify(item), item.quantity]);
      }
      const updated = await client.query<Row>(`UPDATE seasons SET state=$1,revision=revision+1,updated_at=now() WHERE id=$2 AND owner_user_id=$3 AND revision=$4
        RETURNING id,campaign_id,title,revision,state,created_at,updated_at`, [JSON.stringify(completed), row.id, ownerOf(req), row.revision]);
      if (!updated.rows[0]) { await client.query('ROLLBACK'); res.status(409).json({ error: 'REVISION_CONFLICT' }); return; }
      await client.query('COMMIT');
      res.json({ season: publicSeason(updated.rows[0]), alreadyCompleted: false, rewards: additions });
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); next(error); }
    finally { client.release(); }
  });
  app.post('/api/seasons/:id/reviews/settle', async (req,res,next) => {
    const {taskId,rating,answer,hintUsed,revision}=req.body??{};
    if(!idPattern.test(req.params.id)||typeof taskId!=='string'||!Number.isInteger(rating)||rating<1||rating>4||typeof answer!=='string'||answer.trim().length<8||answer.length>10000||typeof hintUsed!=='boolean'||!Number.isInteger(revision)||revision<1){res.status(400).json({error:'INVALID_REVIEW'});return;}
    const client=await pool.connect();
    try{
      await client.query('BEGIN');const found=await client.query<Row>('SELECT id,campaign_id,title,revision,state,created_at,updated_at FROM seasons WHERE id=$1 AND owner_user_id=$2 FOR UPDATE',[req.params.id,ownerOf(req)]);const row=found.rows[0];
      if(!row){await client.query('ROLLBACK');res.status(404).json({error:'NOT_FOUND'});return;}if(row.revision!==revision){await client.query('ROLLBACK');res.status(409).json({error:'REVISION_CONFLICT',revision:row.revision});return;}
      const card=row.state.reviews.find(item=>item.taskId===taskId);if(!card||row.state.progress[taskId]?.status!=='completed'||Date.parse(card.dueAt)>Date.now()){await client.query('ROLLBACK');res.status(409).json({error:'REVIEW_NOT_DUE'});return;}
      const key=`review:${row.campaign_id}:${taskId}:${card.history.length+1}`;const coins=rating>=3&&answer.trim().length>=30&&!hintUsed?6:0;const reward={xp:0,coins,items:[]};
      const next=rateReview(row.state,taskId,rating,new Date(),{answer:answer.trim(),hintUsed});
      if(coins){const inserted=await client.query(`INSERT INTO reward_ledger(id,user_id,season_id,task_id,kind,idempotency_key,reward) VALUES($1,$2,$3,$4,'review',$5,$6) ON CONFLICT(user_id,idempotency_key) DO NOTHING RETURNING id`,[randomUUID(),ownerOf(req),row.id,taskId,key,JSON.stringify(reward)]);if(inserted.rowCount)await client.query(`INSERT INTO wallets(user_id,currency,balance) VALUES($1,'learning-coin',$2) ON CONFLICT(user_id,currency) DO UPDATE SET balance=wallets.balance+EXCLUDED.balance`,[ownerOf(req),coins]);next.rewardLedger=[...(next.rewardLedger??[]),{id:`review-${key}`,campaignId:row.campaign_id,taskId,at:new Date().toISOString(),reward,kind:'review',idempotencyKey:key}];}
      const updated=await client.query<Row>('UPDATE seasons SET state=$1,revision=revision+1,updated_at=now() WHERE id=$2 AND owner_user_id=$3 AND revision=$4 RETURNING id,campaign_id,title,revision,state,created_at,updated_at',[JSON.stringify(next),row.id,ownerOf(req),revision]);if(!updated.rows[0]){await client.query('ROLLBACK');res.status(409).json({error:'REVISION_CONFLICT'});return;}await client.query('COMMIT');res.json({season:publicSeason(updated.rows[0]),reward:{...reward,idempotencyKey:key},effective:coins>0});
    }catch(error){await client.query('ROLLBACK').catch(()=>undefined);next(error);}finally{client.release();}
  });
}

export async function persistEvaluation(pool: Pool, userId: string, seasonId: string, taskId: string, evidence: string, evaluation: Evaluation): Promise<number> {
  const verifiedEvaluation = evaluationSchema.parse(evaluation);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query<Row>('SELECT id,campaign_id,title,revision,state,created_at,updated_at FROM seasons WHERE id=$1 AND owner_user_id=$2 FOR UPDATE', [seasonId, userId]);
    const row = found.rows[0];
    if (!row) throw new Error('SEASON_NOT_FOUND');
    const taskExists = row.state.campaign.stages.some(stage => stage.tasks.some(task => task.id === taskId));
    if (!taskExists || taskEvidence(row.state, taskId) !== evidence) throw new Error('EVIDENCE_STALE');
    const hash = evidenceHash(evidence);
    await client.query(`INSERT INTO task_evaluations (id,owner_user_id,season_id,task_id,evidence_sha256,evaluation)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (owner_user_id,season_id,task_id,evidence_sha256)
      DO UPDATE SET evaluation=EXCLUDED.evaluation,created_at=now()`, [randomUUID(), userId, seasonId, taskId, hash, JSON.stringify(verifiedEvaluation)]);
    const state = structuredClone(row.state);
    const old = state.progress[taskId];
    state.progress[taskId] = { ...old, evaluation: verifiedEvaluation, evaluationSource: 'ai', evaluationEvidence: evidence };
    const updated = await client.query('UPDATE seasons SET state=$1,revision=revision+1,updated_at=now() WHERE id=$2 AND owner_user_id=$3 AND revision=$4 RETURNING revision', [JSON.stringify(state), seasonId, userId, row.revision]);
    if (!updated.rows[0]) throw new Error('REVISION_CONFLICT');
    await client.query('COMMIT');
    return updated.rows[0].revision;
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
}
