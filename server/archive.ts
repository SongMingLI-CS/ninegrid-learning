import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { Express, Request } from 'express';
import type { Pool } from 'pg';
import { COLLECTION_CATALOG } from '../shared/catalog';
import { BOXES, CHALLENGES, ECONOMY_VERSION, EFFECTIVE_REVIEW_COINS, FREE_CHALLENGE_REWARD_COINS, STAGE_COMPLETION_COINS, chainCompletionCoins, isStandardPoolEligible, learningCoinsForMinutes, poolExpectedRecovery, poolTotals, rarityBoxItem, validateEconomy, type BoxId, type ChallengeTier, type RewardPoolEntry } from '../shared/economy';
import { buildChallengeQuestionSet, calculateChallengeKd, ChallengeQuestionBankError, CHALLENGE_MODE_SETTINGS, type ChallengeMode } from '../shared/challengeRules';
import { applySeasonGoalAdjustment, buildSeasonGoalAdjustmentPreview } from '../shared/seasonAdjustment';
import { evaluationSchema, learningStateSchema } from '../shared/schema';
import type { LearningState, TaskProgress } from '../shared/types';
import type { Evaluation } from '../shared/types';
import { completeTask, currentTaskVerification, isTaskUnlocked, rateReview, recordGridOutcome, taskEvidenceText } from '../src/lib/engine';

type Row = { id: string; campaign_id: string; title: string; revision: number; state: LearningState; created_at: Date | string; updated_at: Date | string; lifecycle_status?: 'active'|'paused'|'archived'|'deleted' };
type Options = { pool: Pool };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ownerOf = (req: Request) => (req.session as typeof req.session & { userId?: string }).userId;
const profileAvatars=new Set(['','/assets/avatars/field.svg','/assets/avatars/compass.svg','/assets/avatars/signal.svg']);
const publicSeason = (row: Row) => ({ id: row.id, campaignId: row.campaign_id, title: row.title, revision: row.revision, state: row.state, lifecycleStatus: row.lifecycle_status ?? 'active', createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() });
const eligibleChallengeTasks = (row: Row) => row.state.campaign.stages.flatMap(stage => stage.tasks)
  .filter(task => row.state.progress[task.id]?.status === 'completed' || isTaskUnlocked(row.state.campaign, row.state.progress, task.id))
  .map(task => ({ ...task, lessonRevision: row.state.content?.[task.id]?.revision ?? task.teaching?.revision ?? 1 }));
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
    const selfCheckIsCurrent = next.selfChecked === true && next.selfCheckEvidence === taskEvidenceText(next);
    const safe: TaskProgress = {
      completedObjectives: next.completedObjectives.filter(id => task.objectives.some(objective => objective.id === id)),
      evidence: next.evidence,
      status: old?.status ?? 'idle',
      ...(old?.status === 'completed' ? { evidence: old.evidence, completedObjectives: old.completedObjectives, verification: old.verification, completedAt: old.completedAt } : {}),
      ...(next.supplementalEvidence ? { supplementalEvidence: next.supplementalEvidence } : {}),
      ...(selfCheckIsCurrent ? { selfChecked: true, selfCheckEvidence: next.selfCheckEvidence, ...(next.selfCheckLessonRevision !== undefined ? { selfCheckLessonRevision: next.selfCheckLessonRevision } : {}) } : {}),
      ...(next.lessonRevision !== undefined ? { lessonRevision: next.lessonRevision } : old?.lessonRevision !== undefined ? { lessonRevision: old.lessonRevision } : {}),
      ...(sameEvidence && old?.evaluation ? { evaluation: old.evaluation, evaluationSource: old.evaluationSource, evaluationEvidence: old.evaluationEvidence, ...(old.evaluationLessonRevision !== undefined ? { evaluationLessonRevision: old.evaluationLessonRevision } : {}), verification: old.verification, completedAt: old.completedAt } : {}),
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
    const clientEvidence = [typeof client.evidence === 'string' ? client.evidence : '', typeof client.supplementalEvidence === 'string' && client.supplementalEvidence.trim() ? `补充证据：\n${client.supplementalEvidence}` : ''].filter(Boolean).join('\n\n');
    const selfCheckIsCurrent = client.selfChecked === true && client.selfCheckEvidence === clientEvidence;
    safeProgress[task.id] = {
      completedObjectives: Array.isArray(client.completedObjectives) ? client.completedObjectives : [],
      evidence: typeof client.evidence === 'string' ? client.evidence : '',
      status: previous?.status ?? 'idle',
      ...(previous?.status === 'completed' ? { evidence: previous.evidence, completedObjectives: previous.completedObjectives, verification: previous.verification, completedAt: previous.completedAt } : {}),
      ...(typeof client.supplementalEvidence === 'string' && client.supplementalEvidence ? { supplementalEvidence: client.supplementalEvidence } : {}),
      ...(selfCheckIsCurrent ? { selfChecked: true, selfCheckEvidence: client.selfCheckEvidence, ...(Number.isInteger(client.selfCheckLessonRevision) ? { selfCheckLessonRevision: client.selfCheckLessonRevision } : {}) } : {}),
      ...(Number.isInteger(client.lessonRevision) ? { lessonRevision: client.lessonRevision } : previous?.lessonRevision !== undefined ? { lessonRevision: previous.lessonRevision } : {}),
      ...(sameEvidence && previous?.evaluation ? { evaluation: previous.evaluation, evaluationSource: previous.evaluationSource, evaluationEvidence: previous.evaluationEvidence, ...(previous.evaluationLessonRevision !== undefined ? { evaluationLessonRevision: previous.evaluationLessonRevision } : {}), verification: previous.verification, completedAt: previous.completedAt } : {}),
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
    stage.reward = { xp: 100, coins: STAGE_COMPLETION_COINS, items: [catalogReward(`stage:${stage.id}`, 'small-gold')] };
    const primaryMainChainId=stage.chains?.find((chain:any)=>chain.track==='main')?.id;
    for (const chain of stage.chains ?? []) { const minutes=chain.taskIds.reduce((sum: number,id: string)=>sum+(stage.tasks.find((task: any)=>task.id===id)?.minutes??0),0);chain.completionReward={xp:Math.min(120,Math.floor(minutes*0.4)),coins:chain.track==='main'&&chain.id===primaryMainChainId?chainCompletionCoins(chain.track):0,items:chain.track==='main'&&minutes>=120?[catalogReward(`chain:${chain.id}`,'small-purple')]:[]}; }
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
  const candidates = COLLECTION_CATALOG.filter(item => item.rarity === chosen.rarity && isStandardPoolEligible(item));
  const item = candidates[randomInt(candidates.length)];
  return { item:{ itemId: item.id, name: item.name, description: item.description, rarity: item.rarity, icon: '✦', quantity: chosen.quantity }, audit:{version:ECONOMY_VERSION,ticket:ticketInteger,ticketScale:1_000_000_000,rarity:chosen.rarity,probability:chosen.probability,itemId:item.id,quantity:chosen.quantity} };
}

export function mountArchiveRoutes(app: Express, { pool }: Options): void {
  app.get('/api/wallet', async (req, res, next) => {
    try {
      const [wallet, ledger] = await Promise.all([
        pool.query('SELECT currency,balance FROM wallets WHERE user_id=$1 ORDER BY currency', [ownerOf(req)]),
        pool.query('SELECT id,season_id,task_id,kind,idempotency_key,reward,economy_version,created_at FROM reward_ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT 500', [ownerOf(req)]),
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
      const existingStock = await client.query('SELECT quantity FROM inventory_items WHERE user_id=$1 AND item_id=$2 FOR UPDATE', [ownerOf(req), item.itemId]);
      if (Number(existingStock.rows[0]?.quantity ?? 0) > 2_147_483_647 - quantity) { await client.query('ROLLBACK'); res.status(409).json({ error: 'INVENTORY_LIMIT' }); return; }
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
    res.json({ version: ECONOMY_VERSION, tiers: Object.entries(CHALLENGE_MODE_SETTINGS).map(([id, setting]) => ({
      id,
      ...setting,
      ...(id === 'free' ? { pool: [], poolTotal: 0, rewardCoins: FREE_CHALLENGE_REWARD_COINS, rewardExpectedRecovery: FREE_CHALLENGE_REWARD_COINS } : {
        pool: CHALLENGES[id as ChallengeTier].pool,
        poolTotal: poolTotals(CHALLENGES[id as ChallengeTier].pool),
        rewardExpectedRecovery: poolExpectedRecovery(CHALLENGES[id as ChallengeTier].pool),
      }),
    })) });
  });
  app.get('/api/challenges/history', async (req,res,next) => {
    try {
      const [result,stats]=await Promise.all([
        pool.query('SELECT id,season_id,task_id,tier,status,entry_fee,prompt,evidence,evaluation,reward_item,reward_coins,draw_audit,pool_version,started_at,deadline_at,settled_at,question_count,pass_threshold,questions,answers,correct_answers,question_set_version FROM challenge_runs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30',[ownerOf(req)]),
        pool.query<{tier:ChallengeMode;status:string;correct_answers:number}>('SELECT tier,status,correct_answers FROM challenge_runs WHERE user_id=$1',[ownerOf(req)]),
      ]);
      res.json({challenges:result.rows,kdStats:calculateChallengeKd(stats.rows.map(row=>({tier:row.tier,status:row.status as any,correctAnswers:Number(row.correct_answers)})))});
    } catch(error){next(error);}
  });
  app.get('/api/challenges/availability', async (req,res,next) => {
    const seasonId=typeof req.query.seasonId==='string'?req.query.seasonId:'';
    if(!idPattern.test(seasonId)){res.status(400).json({error:'INVALID_SEASON_ID'});return;}
    try{
      const found=await pool.query<Row>('SELECT id,campaign_id,title,revision,state,created_at,updated_at,lifecycle_status FROM seasons WHERE id=$1 AND owner_user_id=$2',[seasonId,ownerOf(req)]);
      const row=found.rows[0];if(!row){res.status(404).json({error:'NOT_FOUND'});return;}
      if(row.lifecycle_status!=='active'){res.status(409).json({error:row.lifecycle_status==='paused'?'SEASON_PAUSED':'ARCHIVED_SEASON_READ_ONLY'});return;}
      const candidates=eligibleChallengeTasks(row);
      const distinct=new Set(candidates.flatMap(task=>task.objectives.map(objective=>`${row.campaign_id}:${task.id}:${objective.id}:r${task.lessonRevision??1}`)));
      // A challenge can always rotate through alternate prompts and repeat them after the rotation.
      // Keep this count about eligible learning objectives, not historical exposure rows.
      const available=distinct.size;
      res.json({seasonId,byMode:Object.fromEntries(Object.entries(CHALLENGE_MODE_SETTINGS).map(([mode,setting])=>[mode,{available,required:setting.questionCount,ready:available>=setting.questionCount}]))});
    }catch(error){next(error);}
  });
  app.post('/api/challenges/enter', async (req, res, next) => {
    const { seasonId, taskId, tier: tierId, operationId } = req.body ?? {};
    if (typeof seasonId !== 'string' || !idPattern.test(seasonId) || typeof taskId !== 'string' || taskId.length > 128 || !idPattern.test(operationId ?? '') || !Object.hasOwn(CHALLENGE_MODE_SETTINGS, tierId)) { res.status(400).json({ error: 'INVALID_CHALLENGE' }); return; }
    const mode = tierId as ChallengeMode; const setting = CHALLENGE_MODE_SETTINGS[mode]; const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerOf(req)]);
      const prior=await client.query<any>('SELECT * FROM challenge_runs WHERE user_id=$1 AND entry_operation_id=$2 FOR UPDATE',[ownerOf(req),operationId]);
      if(prior.rows[0]){
        const previous=prior.rows[0];
        if(previous.season_id!==seasonId||previous.task_id!==taskId||previous.tier!==mode){await client.query('ROLLBACK');res.status(409).json({error:'CHALLENGE_ENTRY_IDEMPOTENCY_CONFLICT'});return;}
        const wallet=await client.query<{balance:string|number}>('SELECT balance FROM wallets WHERE user_id=$1 AND currency=\'learning-coin\'',[ownerOf(req)]);
        await client.query('COMMIT');
        res.status(200).json({challenge:{id:previous.id,seasonId:previous.season_id,taskId:previous.task_id,tier:previous.tier,title:setting.title,status:previous.status,entryFee:Number(previous.entry_fee),prompt:previous.prompt,deadlineAt:new Date(previous.deadline_at).toISOString(),hintLimit:setting.hintLimit,questionCount:Number(previous.question_count),correctToPass:Number(previous.pass_threshold),questions:previous.questions,answers:previous.answers,evaluation:previous.evaluation,correctAnswers:Number(previous.correct_answers??0),rewardItem:previous.reward_item,paid:setting.paid,difficulty:setting.difficulty},balance:Number(wallet.rows[0]?.balance??0),idempotent:true});return;
      }
      const season = await client.query<Row>('SELECT id,campaign_id,title,revision,state,created_at,updated_at,lifecycle_status FROM seasons WHERE id=$1 AND owner_user_id=$2 FOR UPDATE', [seasonId, ownerOf(req)]);
      const row = season.rows[0]; const task = row?.state.campaign.stages.flatMap(stage => stage.tasks).find(item => item.id === taskId);
      if (!row || !task) { await client.query('ROLLBACK'); res.status(404).json({ error: 'TASK_NOT_FOUND' }); return; }
      if(row.lifecycle_status!=='active'){await client.query('ROLLBACK');res.status(409).json({error:row.lifecycle_status==='paused'?'SEASON_PAUSED':'ARCHIVED_SEASON_READ_ONLY'});return;}
      if (row.state.progress[taskId]?.status !== 'completed' && !isTaskUnlocked(row.state.campaign, row.state.progress, taskId)) { await client.query('ROLLBACK'); res.status(409).json({ error: 'CHALLENGE_TASK_NOT_AVAILABLE' }); return; }
      if (setting.paid) {
        const activePaid = await client.query<{id:string}>('SELECT id FROM challenge_runs WHERE user_id=$1 AND entry_fee>0 AND status IN (\'active\',\'evaluating\',\'ready_to_extract\') ORDER BY started_at LIMIT 1', [ownerOf(req)]);
        if (activePaid.rowCount) { await client.query('ROLLBACK'); res.status(409).json({ error: 'PAID_CHALLENGE_IN_PROGRESS', challengeId: activePaid.rows[0].id }); return; }
      }
      if(!setting.paid){const activeFree=await client.query<{id:string}>('SELECT id FROM challenge_runs WHERE user_id=$1 AND tier=\'free\' AND status IN (\'active\',\'evaluating\',\'ready_to_extract\') ORDER BY started_at LIMIT 1',[ownerOf(req)]);if(activeFree.rowCount){await client.query('ROLLBACK');res.status(409).json({error:'FREE_CHALLENGE_IN_PROGRESS',challengeId:activeFree.rows[0].id});return;}}
      const eligibleTasks = eligibleChallengeTasks(row);
      const exposureRows=await client.query<{question_id:string}>('SELECT question_id FROM challenge_question_exposures WHERE user_id=$1',[ownerOf(req)]);
      const excludedQuestionIds=new Set(exposureRows.rows.map(item=>item.question_id));
      let questions;
      try { questions = buildChallengeQuestionSet({ tier: mode, namespace: row.campaign_id, variantSeed: operationId, tasks: eligibleTasks, focusTaskId: taskId, excludedQuestionIds }); }
      catch (error) {
        if (error instanceof ChallengeQuestionBankError) { await client.query('ROLLBACK'); res.status(409).json({ error: 'CHALLENGE_QUESTION_BANK_INSUFFICIENT', available: error.available, required: error.required }); return; }
        throw error;
      }
      let balance = 0;
      if (setting.paid) {
        const wallet = await client.query<{balance:string|number}>('SELECT balance FROM wallets WHERE user_id=$1 AND currency=\'learning-coin\' FOR UPDATE', [ownerOf(req)]);
        const available = Number(wallet.rows[0]?.balance ?? 0);
        if (!Number.isSafeInteger(available) || available < setting.entryFee) { await client.query('ROLLBACK'); res.status(409).json({ error: 'INSUFFICIENT_BALANCE', required: setting.entryFee }); return; }
        const debit = await client.query<{balance:string|number}>(`UPDATE wallets SET balance=$1 WHERE user_id=$2 AND currency='learning-coin' AND balance=$3 RETURNING balance`, [available - setting.entryFee, ownerOf(req), available]);
        if (!debit.rowCount) { await client.query('ROLLBACK'); res.status(409).json({ error: 'WALLET_CHANGED', required: setting.entryFee }); return; }
        balance = Number(debit.rows[0].balance);
      } else {
        const wallet = await client.query<{balance:string|number}>('SELECT balance FROM wallets WHERE user_id=$1 AND currency=\'learning-coin\'', [ownerOf(req)]);
        balance = Number(wallet.rows[0]?.balance ?? 0);
      }
      const id = randomUUID(); const deadline = new Date(Date.now() + (setting.minutes * 2 + 15) * 60_000);
      const prompt = `${setting.title} · ${questions.length} 题\n${setting.difficulty}\n围绕赛季「${row.title}」的已解锁目标完成本局；每题单独作答，结算后查看逐题反馈。`;
      const answers = questions.map(question => ({ questionId: question.id, answer: '' }));
      const questionSetVersion = `delta-challenge-v4-${row.campaign_id}-season-rev-${row.revision}`;
      await client.query(`INSERT INTO challenge_runs(id,user_id,season_id,task_id,tier,status,entry_fee,prompt,deadline_at,question_count,pass_threshold,questions,answers,question_set_version,entry_operation_id)
        VALUES($1,$2,$3,$4,$5,'active',$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [id, ownerOf(req), seasonId, taskId, mode, setting.entryFee, prompt, deadline, setting.questionCount, setting.correctToPass, JSON.stringify(questions), JSON.stringify(answers), questionSetVersion,operationId]);
      for(const question of questions) await client.query('INSERT INTO challenge_question_exposures(user_id,question_id,first_run_id) VALUES($1,$2,$3) ON CONFLICT(user_id,question_id) DO NOTHING',[ownerOf(req),question.id,id]);
      await client.query('COMMIT'); res.status(201).json({ challenge: { id, seasonId, taskId, tier: mode, title: setting.title, status: 'active', entryFee: setting.entryFee, prompt, acceptance: task.acceptance, deadlineAt: deadline.toISOString(), hintLimit: setting.hintLimit, questionCount: setting.questionCount, correctToPass: setting.correctToPass, questions, answers, paid: setting.paid, difficulty: setting.difficulty }, balance });
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); next(error); } finally { client.release(); }
  });
  app.put('/api/challenges/:id/answers', async(req,res,next)=>{
    if(!idPattern.test(req.params.id)||!Array.isArray(req.body?.answers)||req.body.answers.length>15||req.body.answers.some((item:any)=>!item||typeof item.questionId!=='string'||typeof item.answer!=='string'||item.answer.length>20_000||!Number.isInteger(item.hintLevelsUsed??0)||(item.hintLevelsUsed??0)<0||(item.hintLevelsUsed??0)>5)){res.status(400).json({error:'INVALID_CHALLENGE_ANSWERS'});return;}
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const found=await client.query<{status:string;questions:any;tier:ChallengeMode}>('SELECT status,questions,tier FROM challenge_runs WHERE id=$1 AND user_id=$2 FOR UPDATE',[req.params.id,ownerOf(req)]);
      const row=found.rows[0];if(!row){await client.query('ROLLBACK');res.status(404).json({error:'CHALLENGE_NOT_FOUND'});return;}
      if(row.status!=='active'){await client.query('ROLLBACK');res.status(409).json({error:'CHALLENGE_NOT_ACTIVE'});return;}
      const questions=Array.isArray(row.questions)?row.questions:[];const knownIds=new Set(questions.map(question=>question.id));const seen=new Set<string>();
      if(req.body.answers.some((item:any)=>(item.hintLevelsUsed??0)>CHALLENGE_MODE_SETTINGS[row.tier].hintLimit)){await client.query('ROLLBACK');res.status(400).json({error:'CHALLENGE_HINT_LIMIT_EXCEEDED'});return;}
      for(const item of req.body.answers){if(!knownIds.has(item.questionId)||seen.has(item.questionId)){await client.query('ROLLBACK');res.status(400).json({error:'INVALID_CHALLENGE_ANSWERS'});return;}seen.add(item.questionId);}
      const answerMap=new Map(req.body.answers.map((item:any)=>[item.questionId,{questionId:item.questionId,answer:item.answer,hintLevelsUsed:item.hintLevelsUsed??0}]));
      const answers=questions.map(question=>answerMap.get(question.id)??{questionId:question.id,answer:'',hintLevelsUsed:0});
      await client.query('UPDATE challenge_runs SET answers=$1::jsonb,evidence=$2 WHERE id=$3',[JSON.stringify(answers),JSON.stringify(answers),req.params.id]);
      await client.query('COMMIT');res.json({challengeId:req.params.id,answers,savedAt:new Date().toISOString()});
    }catch(error){await client.query('ROLLBACK').catch(()=>undefined);next(error);}finally{client.release();}
  });
  app.post('/api/challenges/:id/abandon', async (req, res, next) => {
    if (!idPattern.test(req.params.id)) { res.status(400).json({ error: 'INVALID_CHALLENGE_ID' }); return; }
    try { const result = await pool.query(`UPDATE challenge_runs SET status='abandoned',settled_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('active','ready_to_extract') RETURNING id,status,entry_fee`, [req.params.id, ownerOf(req)]); if (!result.rowCount) { res.status(409).json({ error: 'CHALLENGE_NOT_ACTIVE' }); return; } res.json({ challenge: result.rows[0], refunded: false }); }
    catch (error) { next(error); }
  });
  app.get('/api/profile', async (req, res, next) => {
    try {
      const userId = ownerOf(req);
      const [user, profile, seasons, wallet, items, rewards, challenges, challengeStatsRows, seasonalCollectibles, currentSelection] = await Promise.all([
        pool.query('SELECT email,created_at FROM users WHERE id=$1', [userId]),
        pool.query('SELECT nickname,avatar_url,bio,is_public FROM user_profiles WHERE user_id=$1', [userId]),
        pool.query<{ id:string; title:string; state:LearningState; revision:number; updated_at:Date|string; created_at:Date|string; lifecycle_status:string }>('SELECT id,title,state,revision,updated_at,created_at,lifecycle_status FROM seasons WHERE owner_user_id=$1 ORDER BY updated_at DESC', [userId]),
        pool.query('SELECT balance FROM wallets WHERE user_id=$1 AND currency=\'learning-coin\'', [userId]),
        pool.query(`SELECT i.item_id,i.definition,i.quantity,i.acquired_at,COALESCE(p.is_showcased,false) is_showcased,COALESCE(p.showcase_order,0) showcase_order FROM inventory_items i LEFT JOIN inventory_item_preferences p ON p.user_id=i.user_id AND p.item_id=i.item_id WHERE i.user_id=$1 AND i.quantity>0`, [userId]),
        pool.query('SELECT reward FROM reward_ledger WHERE user_id=$1', [userId]),
        pool.query('SELECT id,tier,status,entry_fee,reward_item,reward_coins,draw_audit,pool_version,started_at,settled_at FROM challenge_runs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [userId]),
        pool.query<{tier:ChallengeMode;status:string;correct_answers:number}>('SELECT tier,status,correct_answers FROM challenge_runs WHERE user_id=$1', [userId]),
        pool.query(`SELECT c.season_id,c.item_id,c.reward_key,c.definition,c.final_task_id,c.claimed_at,s.title,
          EXISTS(SELECT 1 FROM season_collectible_claims x WHERE x.owner_user_id=c.owner_user_id AND x.reward_key=c.reward_key) AS claimed,
          s.state->'progress'->c.final_task_id->>'evidence' AS final_evidence
          FROM season_collectibles c JOIN seasons s ON s.id=c.season_id WHERE c.owner_user_id=$1 ORDER BY c.created_at DESC`, [userId]),
        pool.query('SELECT season_id,revision FROM user_current_seasons WHERE user_id=$1',[userId]),
      ]);
      const kinds = items.rows.filter((item: any) => COLLECTION_CATALOG.some(entry => entry.id === item.item_id)).length;
      const seasonalByTarget = new Map<string, (typeof seasonalCollectibles.rows)[number]>();
      for (const collectible of seasonalCollectibles.rows as Array<{ reward_key: string } & Record<string, unknown>>) {
        if (!seasonalByTarget.has(collectible.reward_key)) seasonalByTarget.set(collectible.reward_key, collectible);
      }
      const profileData = profile.rows[0] ?? { nickname: '行动者', avatar_url: '', bio: '', is_public: false };
      const profileSeasons=seasons.rows.map((row:any)=>{
        const allTasks=row.state.campaign.stages.flatMap((stage:any)=>stage.tasks);
        const mainTasks=allTasks.filter((task:any)=>(task.track??'main')==='main');
        const completedTasks=allTasks.filter((task:any)=>row.state.progress[task.id]?.status==='completed');
        const mainCompleted=mainTasks.filter((task:any)=>row.state.progress[task.id]?.status==='completed');
        const lastTask=allTasks.find((task:any)=>task.id===row.state.lastTaskId&&row.state.progress[task.id]?.status!=='completed'&&isTaskUnlocked(row.state.campaign,row.state.progress,task.id));
        const nextTask=lastTask??mainTasks.find((task:any)=>row.state.progress[task.id]?.status!=='completed'&&isTaskUnlocked(row.state.campaign,row.state.progress,task.id))??allTasks.find((task:any)=>row.state.progress[task.id]?.status!=='completed'&&isTaskUnlocked(row.state.campaign,row.state.progress,task.id));
        const nextStageIndex=nextTask?row.state.campaign.stages.findIndex((stage:any)=>stage.tasks.some((task:any)=>task.id===nextTask.id)):-1;
        const finalId=row.state.campaign.seasonalCollectible?.finalTaskId??row.state.campaign.stages.at(-1)?.gateTaskIds?.at(-1);
        const finalTask=allTasks.find((task:any)=>task.id===finalId)??mainTasks.at(-1);
        const mainlineDone=mainCompleted.length===mainTasks.length;
        const status=row.lifecycle_status!=='active'?row.lifecycle_status:mainlineDone?'completed':'active';
        const studyDates=[...completedTasks.map((task:any)=>row.state.progress[task.id]?.completedAt),...(row.state.reviews??[]).flatMap((card:any)=>card.history?.map((entry:any)=>entry.at)??[])].filter(Boolean).sort();
        return {id:row.id,revision:row.revision,title:row.title,goal:row.state.campaign.goal,createdAt:row.created_at,updatedAt:row.updated_at,lastStudyAt:studyDates.at(-1)??null,
          desiredArtifact:row.state.campaign.desiredArtifact??row.state.campaign.ultimateReward,
          finalProjectEvidence:finalTask&&row.state.progress[finalTask.id]?.status==='completed'?row.state.progress[finalTask.id]?.evidence:null,
          status,completed:completedTasks.length,total:allTasks.length,mainlineCompleted:mainCompleted.length,mainlineTotal:mainTasks.length,
          selfCompleted:completedTasks.filter((task:any)=>row.state.progress[task.id]?.verification==='self').length,
          aiCompleted:completedTasks.filter((task:any)=>row.state.progress[task.id]?.verification==='ai').length,
          currentStageIndex:nextStageIndex,nextTaskId:nextTask?.id??null,nextTaskTitle:nextTask?.title??null,
          stages:row.state.campaign.stages.map((stage:any)=>({title:stage.title,completed:(stage.gateTaskIds??stage.mainlineTaskIds??[]).every((id:string)=>row.state.progress[id]?.status==='completed')})),
          grid:(row.state.campaign.nineGrid??[]).map((slot:any)=>({title:slot.title,evidence:row.state.gridOutcomes?.[slot.id]?.artifact??null})),
        };
      });
      const showcased=items.rows.filter((item:any)=>item.is_showcased).sort((a:any,b:any)=>a.showcase_order-b.showcase_order).slice(0,4).map((item:any)=>({...(COLLECTION_CATALOG.find(def=>def.id===item.item_id)??item.definition),quantity:item.quantity,itemId:item.item_id,showcaseOrder:item.showcase_order}));
      const activity=[...seasons.rows.flatMap((row:any)=>Object.entries(row.state.progress).filter(([,progress]:any)=>progress.status==='completed').map(([taskId,progress]:any)=>({kind:'learning',seasonId:row.id,seasonTitle:row.title,taskId,title:row.state.campaign.stages.flatMap((stage:any)=>stage.tasks).find((task:any)=>task.id===taskId)?.title??taskId,verification:progress.verification??'self',at:progress.completedAt??row.updated_at}))),...challenges.rows.map((run:any)=>({kind:'challenge',id:run.id,tier:run.tier,status:run.status,at:run.settled_at??run.started_at}))].sort((a:any,b:any)=>new Date(b.at).getTime()-new Date(a.at).getTime()).slice(0,40);
      const challengeStats=calculateChallengeKd(challengeStatsRows.rows.map(row=>({tier:row.tier,status:row.status as any,correctAnswers:Number(row.correct_answers)})));
      res.json({ profile: { ...profileData, joinedAt: user.rows[0]?.created_at }, balance: Number(wallet.rows[0]?.balance ?? 0), xp: rewards.rows.reduce((sum: number, row: any) => sum + Number(row.reward?.xp ?? 0), 0), currentSeasonId:currentSelection.rows[0]?.season_id??null,selectionRevision:Number(currentSelection.rows[0]?.revision??0),seasons:profileSeasons, collection: { kinds, total: COLLECTION_CATALOG.length, completion: kinds / COLLECTION_CATALOG.length, byRarity: Object.fromEntries(['small-purple','small-gold','large-gold','small-red','large-red'].map(rarity => [rarity, items.rows.filter((item: any) => COLLECTION_CATALOG.some(def=>def.id===item.item_id&&def.rarity===rarity)).length])) }, seasonalCollectibles: [...seasonalByTarget.values()], showcased,activity, challenges: challenges.rows, challengeStats, private: !profileData.is_public });
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
        pool.query('SELECT season_id,task_id,reward,economy_version,created_at FROM reward_ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT 2000', [ownerOf(req)]),
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
      const [sales, economy, challenge, learning, seasonal] = await Promise.all([
        pool.query('SELECT operation_id,items,coins,economy_version,created_at FROM inventory_sales WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [ownerOf(req)]),
        pool.query('SELECT operation_id,kind,result,pool_version,created_at FROM economy_operations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [ownerOf(req)]),
        pool.query('SELECT id,tier,status,entry_fee,reward_item,reward_coins,draw_audit,pool_version,started_at,settled_at FROM challenge_runs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [ownerOf(req)]),
        pool.query('SELECT id,season_id,task_id,kind,reward,economy_version,created_at FROM reward_ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [ownerOf(req)]),
        pool.query(`SELECT c.season_id,c.final_task_id,c.definition,c.claimed_at,s.title FROM season_collectibles c JOIN seasons s ON s.id=c.season_id
          WHERE c.owner_user_id=$1 AND c.claimed_at IS NOT NULL ORDER BY c.claimed_at DESC LIMIT 100`, [ownerOf(req)]),
      ]);
      res.json({ items: filtered, sales: sales.rows, transactions: [...sales.rows.map(row=>({...row,kind:'sale'})),...economy.rows,...challenge.rows.map(row=>({...row,kind:`challenge_${row.status}`})),...learning.rows,...seasonal.rows.map((row:any)=>({id:`season-exclusive-${row.season_id}`,kind:'season_exclusive',season_id:row.season_id,task_id:row.final_task_id,result:{item:row.definition},created_at:row.claimed_at}))].sort((a,b)=>new Date(b.created_at??b.started_at).getTime()-new Date(a.created_at??a.started_at).getTime()).slice(0,100) });
    } catch (error) { next(error); }
  });

  app.post('/api/inventory/preferences', async (req, res, next) => {
    const items = req.body?.items;
    if (!Array.isArray(items) || items.length < 1 || items.length > 155 || items.some((item: any) => typeof item?.itemId !== 'string' || item.itemId.length > 128 || typeof item.locked !== 'boolean' || typeof item.showcased !== 'boolean' || (item.showcaseOrder !== undefined && (!Number.isInteger(item.showcaseOrder) || item.showcaseOrder < 0 || item.showcaseOrder > 3)))) { res.status(400).json({ error: 'INVALID_INVENTORY_PREFERENCES' }); return; }
    if (new Set(items.map((item:any)=>item.itemId)).size !== items.length || items.filter((item:any)=>item.showcased).length > 4) { res.status(400).json({error:'SHOWCASE_LIMIT'}); return; }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerOf(req)]);
      for (const item of items) {
        const owned = await client.query('SELECT 1 FROM inventory_items WHERE user_id=$1 AND item_id=$2 AND quantity>0', [ownerOf(req), item.itemId]);
        if (!owned.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'ITEM_NOT_OWNED', itemId: item.itemId }); return; }
        let order=item.showcaseOrder;
        if(order===undefined&&item.showcased){
          const existing=await client.query<{item_id:string;showcase_order:number}>('SELECT item_id,showcase_order FROM inventory_item_preferences WHERE user_id=$1 AND is_showcased=true',[ownerOf(req)]);
          order=existing.rows.find(row=>row.item_id===item.itemId)?.showcase_order??[0,1,2,3].find(slot=>!existing.rows.some(row=>row.showcase_order===slot));
          if(order===undefined){await client.query('ROLLBACK');res.status(409).json({error:'SHOWCASE_LIMIT'});return;}
        }
        await client.query(`INSERT INTO inventory_item_preferences(user_id,item_id,is_locked,is_showcased,showcase_order) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(user_id,item_id) DO UPDATE SET is_locked=EXCLUDED.is_locked,is_showcased=EXCLUDED.is_showcased,showcase_order=EXCLUDED.showcase_order,updated_at=now()`, [ownerOf(req), item.itemId, item.locked, item.showcased,order??0]);
      }
      const showcase=await client.query<{showcase_order:number}>('SELECT showcase_order FROM inventory_item_preferences WHERE user_id=$1 AND is_showcased=true',[ownerOf(req)]);
      if(showcase.rows.length>4||new Set(showcase.rows.map(row=>row.showcase_order)).size!==showcase.rows.length){await client.query('ROLLBACK');res.status(409).json({error:'SHOWCASE_LIMIT_OR_ORDER_CONFLICT'});return;}
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
      const credited=await client.query(`INSERT INTO wallets(user_id,currency,balance) VALUES($1,'learning-coin',$2)
        ON CONFLICT(user_id,currency) DO UPDATE SET balance=wallets.balance+EXCLUDED.balance WHERE wallets.balance <= 9007199254740991-EXCLUDED.balance RETURNING balance`, [ownerOf(req), total]);
      if(!credited.rowCount){await client.query('ROLLBACK');res.status(409).json({error:'WALLET_LIMIT'});return;}
      const sale = await client.query(`INSERT INTO inventory_sales(user_id,operation_id,items,coins,request_hash,economy_version) VALUES($1,$2,$3,$4,$5,$6)
        RETURNING operation_id,items,coins,created_at,economy_version`, [ownerOf(req), operationId, JSON.stringify(items), total,requestHash,ECONOMY_VERSION]);
      await client.query('COMMIT'); res.json({ sale: sale.rows[0], idempotent: false });
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); next(error); }
    finally { client.release(); }
  });

  app.get('/api/seasons', async (req, res, next) => {
    try {
      const [result, selection] = await Promise.all([
        pool.query<Row>('SELECT id,campaign_id,title,revision,state,created_at,updated_at,lifecycle_status FROM seasons WHERE owner_user_id=$1 ORDER BY updated_at DESC', [ownerOf(req)]),
        pool.query<{ season_id:string|null; revision:number }>('SELECT season_id,revision FROM user_current_seasons WHERE user_id=$1', [ownerOf(req)]),
      ]);
      res.json({ seasons: result.rows.map(publicSeason), currentSeasonId: selection.rows[0]?.season_id ?? null, selectionRevision: Number(selection.rows[0]?.revision ?? 0) });
    } catch (error) { next(error); }
  });

  app.get('/api/seasons/current', async (req,res,next) => {
    try {
      const result=await pool.query<{season_id:string|null;revision:number;id?:string;campaign_id?:string;title?:string;season_revision?:number;state?:LearningState;created_at?:Date|string;updated_at?:Date|string;lifecycle_status?:'active'|'paused'|'archived'|'deleted'}>(`SELECT u.season_id,u.revision,s.id,s.campaign_id,s.title,s.revision season_revision,s.state,s.created_at,s.updated_at,s.lifecycle_status
        FROM user_current_seasons u LEFT JOIN seasons s ON s.id=u.season_id AND s.owner_user_id=u.user_id AND s.lifecycle_status NOT IN ('archived','deleted') WHERE u.user_id=$1`,[ownerOf(req)]);
      const row=result.rows[0];
      res.json({currentSeasonId:row?.id?row.season_id:null,selectionRevision:Number(row?.revision??0),...(row?.id?{season:publicSeason({id:row.id,campaign_id:row.campaign_id!,title:row.title!,revision:row.season_revision!,state:row.state!,created_at:row.created_at!,updated_at:row.updated_at!,lifecycle_status:row.lifecycle_status})}:{})});
    }catch(error){next(error);}
  });

  app.put('/api/seasons/current', async (req,res,next) => {
    const { seasonId, revision } = req.body ?? {};
    if (!idPattern.test(seasonId ?? '') || !Number.isInteger(revision) || revision < 0) { res.status(400).json({error:'INVALID_SEASON_SELECTION'}); return; }
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[ownerOf(req)]);
      const current=await client.query<{revision:number}>('SELECT revision FROM user_current_seasons WHERE user_id=$1 FOR UPDATE',[ownerOf(req)]);
      const actual=current.rows[0]?.revision??0;
      if(actual!==revision){await client.query('ROLLBACK');res.status(409).json({error:'SEASON_SELECTION_CONFLICT',revision:actual});return;}
      const target=await client.query<{id:string}>('SELECT id FROM seasons WHERE id=$1 AND owner_user_id=$2 AND lifecycle_status NOT IN (\'archived\',\'deleted\') FOR UPDATE',[seasonId,ownerOf(req)]);
      if(!target.rowCount){await client.query('ROLLBACK');res.status(404).json({error:'SEASON_NOT_AVAILABLE'});return;}
      const updated=await client.query<{revision:number}>('INSERT INTO user_current_seasons(user_id,season_id,revision) VALUES($1,$2,1) ON CONFLICT(user_id) DO UPDATE SET season_id=EXCLUDED.season_id,revision=user_current_seasons.revision+1,updated_at=now() RETURNING revision',[ownerOf(req),seasonId]);
      await client.query('UPDATE seasons SET updated_at=now() WHERE id=$1',[seasonId]);
      await client.query('COMMIT');res.json({currentSeasonId:seasonId,revision:updated.rows[0].revision});
    } catch(error){await client.query('ROLLBACK').catch(()=>undefined);next(error);} finally{client.release();}
  });

  app.patch('/api/seasons/:id/lifecycle', async(req,res,next)=>{
    const {status,revision,selectionRevision,restore}=req.body??{};
    if(!idPattern.test(req.params.id)||!['active','paused','archived','deleted'].includes(status)||!Number.isInteger(revision)||revision<1||!Number.isInteger(selectionRevision)||selectionRevision<0||(restore!==undefined&&typeof restore!=='boolean')){res.status(400).json({error:'INVALID_SEASON_LIFECYCLE'});return;}
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[ownerOf(req)]);
      const current=await client.query<{season_id:string|null;revision:number}>('SELECT season_id,revision FROM user_current_seasons WHERE user_id=$1 FOR UPDATE',[ownerOf(req)]);
      const actualSelectionRevision=Number(current.rows[0]?.revision??0);
      if(actualSelectionRevision!==selectionRevision){await client.query('ROLLBACK');res.status(409).json({error:'SEASON_SELECTION_CONFLICT',selectionRevision:actualSelectionRevision,currentSeasonId:current.rows[0]?.season_id??null});return;}
      const found=await client.query<Row>('SELECT id,campaign_id,title,revision,state,created_at,updated_at,lifecycle_status FROM seasons WHERE id=$1 AND owner_user_id=$2 FOR UPDATE',[req.params.id,ownerOf(req)]);
      const old=found.rows[0];if(!old){await client.query('ROLLBACK');res.status(404).json({error:'NOT_FOUND'});return;}
      if(old.revision!==revision){await client.query('ROLLBACK');res.status(409).json({error:'REVISION_CONFLICT',season:publicSeason(old)});return;}
      if((old.lifecycle_status==='archived'||old.lifecycle_status==='deleted')&&status==='active'&&restore!==true){await client.query('ROLLBACK');res.status(409).json({error:'SEASON_RESTORE_CONFIRMATION_REQUIRED'});return;}
      if(old.lifecycle_status==='deleted'&&status!=='deleted'&&status!=='active'){await client.query('ROLLBACK');res.status(409).json({error:'DELETED_SEASON_READ_ONLY'});return;}
      if(old.lifecycle_status==='archived'&&status==='paused'){await client.query('ROLLBACK');res.status(409).json({error:'ARCHIVED_SEASON_READ_ONLY'});return;}
      if(old.lifecycle_status===status){await client.query('COMMIT');res.json({season:publicSeason(old),currentSeasonId:current.rows[0]?.season_id??null,selectionRevision:actualSelectionRevision,idempotent:true});return;}
      const updated=await client.query<Row>(`UPDATE seasons SET lifecycle_status=$1,revision=revision+1,updated_at=now() WHERE id=$2 AND owner_user_id=$3 RETURNING id,campaign_id,title,revision,state,created_at,updated_at,lifecycle_status`,[status,req.params.id,ownerOf(req)]);
      let currentSeasonId=current.rows[0]?.season_id??null;let nextSelectionRevision=actualSelectionRevision;
      if(status==='archived'||status==='deleted'){
        if(currentSeasonId===req.params.id){
          const fallback=await client.query<{id:string}>('SELECT id FROM seasons WHERE owner_user_id=$1 AND id<>$2 AND lifecycle_status=\'active\' ORDER BY updated_at DESC,id LIMIT 1',[ownerOf(req),req.params.id]);
          currentSeasonId=fallback.rows[0]?.id??null;
          const selection=await client.query<{revision:number}>('UPDATE user_current_seasons SET season_id=$1,revision=revision+1,updated_at=now() WHERE user_id=$2 RETURNING revision',[currentSeasonId,ownerOf(req)]);
          nextSelectionRevision=Number(selection.rows[0]?.revision??actualSelectionRevision);
        }
      }
      await client.query('COMMIT');res.json({season:publicSeason(updated.rows[0]),currentSeasonId,selectionRevision:nextSelectionRevision});
    }catch(error){await client.query('ROLLBACK').catch(()=>undefined);next(error);}finally{client.release();}
  });

  app.post('/api/seasons/:id/goal-preview', async(req,res,next)=>{
    if(!idPattern.test(req.params.id)||!Number.isInteger(req.body?.revision)||req.body.revision<1||typeof req.body?.goal!=='string'||req.body.goal.trim().length<1||req.body.goal.length>8000||typeof req.body?.desiredArtifact!=='string'||req.body.desiredArtifact.trim().length<1||req.body.desiredArtifact.length>2000){res.status(400).json({error:'INVALID_SEASON_GOAL'});return;}
    try{
      const found=await pool.query<Row>('SELECT id,campaign_id,title,revision,state,created_at,updated_at,lifecycle_status FROM seasons WHERE id=$1 AND owner_user_id=$2',[req.params.id,ownerOf(req)]);
      const season=found.rows[0];if(!season){res.status(404).json({error:'NOT_FOUND'});return;}
      if(season.lifecycle_status!=='active'){res.status(409).json({error:season.lifecycle_status==='paused'?'SEASON_PAUSED':'ARCHIVED_SEASON_READ_ONLY'});return;}
      if(season.revision!==req.body.revision){res.status(409).json({error:'REVISION_CONFLICT',revision:season.revision});return;}
      res.json({preview:buildSeasonGoalAdjustmentPreview(season.state,{goal:req.body.goal,desiredArtifact:req.body.desiredArtifact},{baseRevision:season.revision})});
    }catch(error){next(error);}
  });

  app.post('/api/seasons/:id/goal-adjustment', async(req,res,next)=>{
    const {revision,previewId}=req.body??{};
    if(!idPattern.test(req.params.id)||!Number.isInteger(revision)||revision<1||typeof previewId!=='string'||!/^[a-f0-9]{32}$/.test(previewId)||typeof req.body?.goal!=='string'||typeof req.body?.desiredArtifact!=='string'){res.status(400).json({error:'INVALID_SEASON_GOAL'});return;}
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[ownerOf(req)]);
      const found=await client.query<Row>('SELECT id,campaign_id,title,revision,state,created_at,updated_at,lifecycle_status FROM seasons WHERE id=$1 AND owner_user_id=$2 FOR UPDATE',[req.params.id,ownerOf(req)]);
      const season=found.rows[0];if(!season){await client.query('ROLLBACK');res.status(404).json({error:'NOT_FOUND'});return;}
      if(season.lifecycle_status!=='active'){await client.query('ROLLBACK');res.status(409).json({error:season.lifecycle_status==='paused'?'SEASON_PAUSED':'ARCHIVED_SEASON_READ_ONLY'});return;}
      if(season.revision!==revision){await client.query('ROLLBACK');res.status(409).json({error:'REVISION_CONFLICT',revision:season.revision});return;}
      const preview=buildSeasonGoalAdjustmentPreview(season.state,{goal:req.body.goal,desiredArtifact:req.body.desiredArtifact},{baseRevision:revision});
      if(preview.previewId!==previewId){await client.query('ROLLBACK');res.status(409).json({error:'SEASON_PREVIEW_STALE'});return;}
      const blockedTaskIds=preview.tasks.filter(task=>task.action==='blocked').map(task=>task.taskId);
      if(blockedTaskIds.length){await client.query('ROLLBACK');res.status(422).json({error:'SEASON_ADJUSTMENT_REQUIRES_REGENERATION',taskIds:blockedTaskIds});return;}
      const state=applySeasonGoalAdjustment(season.state,preview);
      const parsed=learningStateSchema.safeParse(state);
      if(!parsed.success){await client.query('ROLLBACK');res.status(422).json({error:'SEASON_ADJUSTMENT_INVALID'});return;}
      const updated=await client.query<Row>(`UPDATE seasons SET state=$1,title=$2,revision=revision+1,updated_at=now()
        WHERE id=$3 AND owner_user_id=$4 AND revision=$5
        RETURNING id,campaign_id,title,revision,state,created_at,updated_at,lifecycle_status`,[JSON.stringify(parsed.data),parsed.data.campaign.title,req.params.id,ownerOf(req),revision]);
      if(!updated.rows[0]){await client.query('ROLLBACK');res.status(409).json({error:'REVISION_CONFLICT'});return;}
      const collectible=parsed.data.campaign.seasonalCollectible;
      if(collectible){
        const rule=await client.query<{item_id:string;claimed_at:Date|null}>('SELECT item_id,claimed_at FROM season_collectibles WHERE season_id=$1 AND owner_user_id=$2 FOR UPDATE',[req.params.id,ownerOf(req)]);
        if(rule.rows[0]?.item_id===collectible.id&&!rule.rows[0].claimed_at){
          const gateTaskIds=parsed.data.campaign.stages.flatMap(stage=>stage.gateTaskIds??[]);
          await client.query('UPDATE season_collectibles SET final_task_id=$1,gate_task_ids=$2 WHERE season_id=$3 AND owner_user_id=$4 AND claimed_at IS NULL',[collectible.finalTaskId,gateTaskIds,req.params.id,ownerOf(req)]);
        }
      }
      await client.query(`INSERT INTO season_goal_adjustments(id,owner_user_id,season_id,revision_before,revision_after,previous_goal,next_goal,previous_artifact,next_artifact,preview)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[randomUUID(),ownerOf(req),req.params.id,revision,updated.rows[0].revision,season.state.campaign.goal,parsed.data.campaign.goal,season.state.campaign.desiredArtifact??season.state.campaign.ultimateReward,parsed.data.campaign.desiredArtifact??parsed.data.campaign.ultimateReward,JSON.stringify(preview)]);
      await client.query('COMMIT');res.json({season:publicSeason(updated.rows[0]),preview});
    }catch(error){await client.query('ROLLBACK').catch(()=>undefined);next(error);}finally{client.release();}
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
    const expectedSelectionRevision = req.body?.selectionRevision;
    if (expectedSelectionRevision !== undefined && (!Number.isInteger(expectedSelectionRevision) || expectedSelectionRevision < 0)) { res.status(400).json({ error: 'INVALID_SEASON_SELECTION' }); return; }
    const id = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerOf(req)]);
      const pointer = await client.query<{season_id:string|null;revision:number}>('SELECT season_id,revision FROM user_current_seasons WHERE user_id=$1 FOR UPDATE', [ownerOf(req)]);
      const actualRevision = Number(pointer.rows[0]?.revision ?? 0);
      if (expectedSelectionRevision !== undefined && expectedSelectionRevision !== actualRevision) {
        await client.query('ROLLBACK'); res.status(409).json({ error: 'SEASON_SELECTION_CONFLICT', currentSeasonId: pointer.rows[0]?.season_id ?? null, selectionRevision: actualRevision }); return;
      }
      const result = await client.query<Row>(`INSERT INTO seasons (id,owner_user_id,campaign_id,title,revision,state)
        VALUES ($1,$2,$3,$4,1,$5) RETURNING id,campaign_id,title,revision,state,created_at,updated_at`,
      [id, ownerOf(req), state.campaign.id, state.campaign.title, JSON.stringify(state)]);
      const selected = await client.query<{revision:number}>(`INSERT INTO user_current_seasons(user_id,season_id,revision) VALUES($1,$2,1)
        ON CONFLICT(user_id) DO UPDATE SET season_id=EXCLUDED.season_id,revision=user_current_seasons.revision+1,updated_at=now() RETURNING revision`, [ownerOf(req), id]);
      await client.query('COMMIT');
      res.status(201).json({ season: publicSeason(result.rows[0]), currentSeasonId: id, selectionRevision: Number(selected.rows[0].revision) });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') { res.status(409).json({ error: 'SEASON_EXISTS' }); return; }
      next(error);
    } finally { client.release(); }
  });

  app.get('/api/seasons/:id', async (req, res, next) => {
    if (!idPattern.test(req.params.id)) { res.status(404).json({ error: 'NOT_FOUND' }); return; }
    try {
      const result = await pool.query<Row>('SELECT id,campaign_id,title,revision,state,created_at,updated_at,lifecycle_status FROM seasons WHERE id = $1 AND owner_user_id = $2', [req.params.id, ownerOf(req)]);
      if (!result.rows[0]) { res.status(404).json({ error: 'NOT_FOUND' }); return; }
      res.json({ season: publicSeason(result.rows[0]) });
    } catch (error) { next(error); }
  });

  app.put('/api/seasons/:id', async (req, res, next) => {
    if (!idPattern.test(req.params.id) || !Number.isInteger(req.body?.revision) || req.body.revision < 1) { res.status(400).json({ error: 'INVALID_REQUEST' }); return; }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query<Row>('SELECT id,campaign_id,title,revision,state,created_at,updated_at,lifecycle_status FROM seasons WHERE id = $1 AND owner_user_id = $2 FOR UPDATE', [req.params.id, ownerOf(req)]);
      const old = found.rows[0];
      if (!old) { await client.query('ROLLBACK'); res.status(404).json({ error: 'NOT_FOUND' }); return; }
      if (old.lifecycle_status !== 'active') { await client.query('ROLLBACK'); res.status(409).json({ error: old.lifecycle_status === 'paused' ? 'SEASON_PAUSED' : 'ARCHIVED_SEASON_READ_ONLY' }); return; }
      if (old.revision !== req.body.revision) { await client.query('ROLLBACK'); res.status(409).json({ error: 'REVISION_CONFLICT', revision: old.revision, season: publicSeason(old) }); return; }
      if (req.body?.state?.campaign?.id !== old.campaign_id) { await client.query('ROLLBACK'); res.status(400).json({ error: 'CAMPAIGN_IMMUTABLE' }); return; }
      const parsed = learningStateSchema.safeParse(stripClientAuthority(req.body?.state, old.state));
      if (!parsed.success) { await client.query('ROLLBACK'); res.status(400).json({ error: 'INVALID_ARCHIVE' }); return; }
      if (parsed.data.campaign.id !== old.campaign_id) { await client.query('ROLLBACK'); res.status(400).json({ error: 'CAMPAIGN_IMMUTABLE' }); return; }
      const state = withoutClientAuthority(parsed.data, old.state);
      const result = await client.query<Row>(`UPDATE seasons SET title=$1,state=$2,revision=revision+1,updated_at=now()
        WHERE id=$3 AND owner_user_id=$4 AND revision=$5
        RETURNING id,campaign_id,title,revision,state,created_at,updated_at,lifecycle_status`,
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
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[ownerOf(req)]);
      const found = await client.query<Row>('SELECT id,campaign_id,title,revision,state,created_at,updated_at,lifecycle_status FROM seasons WHERE id=$1 AND owner_user_id=$2 FOR UPDATE', [req.params.id, ownerOf(req)]);
      const row = found.rows[0];
      if (!row) { await client.query('ROLLBACK'); res.status(404).json({ error: 'NOT_FOUND' }); return; }
      if (row.lifecycle_status !== 'active') { await client.query('ROLLBACK'); res.status(409).json({ error: row.lifecycle_status === 'paused' ? 'SEASON_PAUSED' : 'ARCHIVED_SEASON_READ_ONLY' }); return; }
      if (row.revision !== req.body.revision) { await client.query('ROLLBACK'); res.status(409).json({ error: 'REVISION_CONFLICT', revision: row.revision }); return; }
      const previous = row.state;
      const task = previous.campaign.stages.flatMap(stage => stage.tasks).find(item => item.id === req.body.taskId);
      const progress = previous.progress[req.body.taskId];
      if (!task || !progress) { await client.query('ROLLBACK'); res.status(404).json({ error: 'TASK_NOT_FOUND' }); return; }
      if (progress.status === 'completed' && req.body.verification !== 'ai') { await client.query('ROLLBACK'); res.json({ season: publicSeason(row), alreadyCompleted: true, rewards: [] }); return; }
      if (!isTaskUnlocked(previous.campaign, previous.progress, task.id)) { await client.query('ROLLBACK'); res.status(409).json({ error: 'PREREQUISITES_NOT_MET' }); return; }
      if (taskEvidence(previous, task.id).trim().length < 20) { await client.query('ROLLBACK'); res.status(422).json({ error: 'EVIDENCE_REQUIRED' }); return; }
      const currentLessonRevision = previous.content?.[task.id]?.revision ?? task.teaching?.revision;
      let verification: 'self' | 'ai' = 'self';
      if (req.body.verification === 'ai') {
        const hash = evidenceHash(taskEvidence(previous, task.id));
        const checked = await client.query('SELECT 1 FROM task_evaluations WHERE owner_user_id=$1 AND season_id=$2 AND task_id=$3 AND evidence_sha256=$4 AND (evaluation->>\'passed\')::boolean=true AND (evaluation->>\'score\')::integer>=70', [ownerOf(req), row.id, task.id, hash]);
        if (!checked.rowCount || currentTaskVerification(progress, currentLessonRevision) !== 'ai' || progress.evaluationEvidence !== taskEvidence(previous, task.id)) { await client.query('ROLLBACK'); res.status(422).json({ error: 'AI_EVALUATION_REQUIRED' }); return; }
        if (progress.status === 'completed' && progress.verification === 'ai') { await client.query('ROLLBACK'); res.json({ season: publicSeason(row), alreadyCompleted: true, rewards: [] }); return; }
        verification = 'ai';
      } else if (currentTaskVerification(progress, currentLessonRevision) !== 'self') { await client.query('ROLLBACK'); res.status(422).json({ error: 'SELF_CHECK_REQUIRED' }); return; }
      const canonical = structuredClone(previous);
      normalizeCampaignRewards(canonical.campaign);
      const completed = completeTask(canonical, task.id, verification);
      const previousKeys = new Set((previous.rewardLedger ?? []).map(entry => entry.idempotencyKey));
      const additions = (completed.rewardLedger ?? []).filter(entry => !previousKeys.has(entry.idempotencyKey));
      for (const entry of additions) {
        const inserted = await client.query<{ id: string }>(`INSERT INTO reward_ledger (id,user_id,season_id,task_id,kind,idempotency_key,reward,economy_version)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (user_id,idempotency_key) DO NOTHING RETURNING id`,
        [randomUUID(), ownerOf(req), row.id, entry.taskId, entry.kind, entry.idempotencyKey, JSON.stringify(entry.reward), ECONOMY_VERSION]);
        if (!inserted.rowCount) continue;
        if (entry.reward.coins > 0) { const credited=await client.query(`INSERT INTO wallets (user_id,currency,balance) VALUES ($1,'learning-coin',$2)
          ON CONFLICT (user_id,currency) DO UPDATE SET balance=wallets.balance+EXCLUDED.balance WHERE wallets.balance <= 9007199254740991-EXCLUDED.balance RETURNING balance`, [ownerOf(req), entry.reward.coins]); if(!credited.rowCount)throw new Error('WALLET_LIMIT'); }
        for (const item of entry.reward.items) await client.query(`INSERT INTO inventory_items (user_id,item_id,definition,quantity)
          VALUES ($1,$2,$3,$4) ON CONFLICT (user_id,item_id) DO UPDATE SET quantity=inventory_items.quantity+EXCLUDED.quantity`,
        [ownerOf(req), item.itemId, JSON.stringify(item), item.quantity]);
      }
      let seasonalCollectible: { item: Record<string, unknown>; claimed: boolean; alreadyClaimed?: boolean } | undefined;
      const collectibleRule = await client.query<{ item_id: string; reward_key: string; definition: Record<string, unknown>; final_task_id: string; gate_task_ids: string[] }>(
        'SELECT item_id,reward_key,definition,final_task_id,gate_task_ids FROM season_collectibles WHERE season_id=$1 AND owner_user_id=$2 FOR UPDATE', [row.id, ownerOf(req)]);
      const rule = collectibleRule.rows[0];
      if (rule && completed.campaign.seasonalCollectible?.id === rule.item_id && completed.campaign.seasonalCollectible.finalTaskId === rule.final_task_id) {
        const allGatesVerified = completed.campaign.stages.every(stage => (stage.gateTaskIds ?? []).length > 0 && (stage.gateTaskIds ?? []).every(id => completed.progress[id]?.status === 'completed' && completed.progress[id]?.verification === 'ai'));
        const finalProgress = completed.progress[rule.final_task_id];
        const finalEvidence = taskEvidence(completed, rule.final_task_id);
        const finalEvaluation = finalEvidence.length >= 20 ? await client.query('SELECT 1 FROM task_evaluations WHERE owner_user_id=$1 AND season_id=$2 AND task_id=$3 AND evidence_sha256=$4 AND (evaluation->>\'passed\')::boolean=true AND (evaluation->>\'score\')::integer>=70', [ownerOf(req), row.id, rule.final_task_id, evidenceHash(finalEvidence)]) : { rowCount: 0 };
        if (allGatesVerified && finalProgress?.status === 'completed' && finalProgress.verification === 'ai' && finalEvaluation.rowCount) {
          // Lock the account before checking the target-level claim so parallel seasons cannot both award the same design.
          await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerOf(req)]);
          const existingClaim = await client.query('SELECT id FROM season_collectible_claims WHERE owner_user_id=$1 AND reward_key=$2', [ownerOf(req), rule.reward_key]);
          const claim = existingClaim.rowCount ? undefined : await client.query(`INSERT INTO season_collectible_claims(id,owner_user_id,season_id,reward_key,item_id,evidence_sha256,reward_version)
            VALUES($1,$2,$3,$4,$5,$6,1) ON CONFLICT(owner_user_id,reward_key) DO NOTHING RETURNING id`, [randomUUID(), ownerOf(req), row.id, rule.reward_key, rule.item_id, evidenceHash(finalEvidence)]);
          if (claim?.rowCount) {
            await client.query(`INSERT INTO inventory_items(user_id,item_id,definition,quantity) VALUES($1,$2,$3,1)
              ON CONFLICT(user_id,item_id) DO UPDATE SET quantity=inventory_items.quantity+1`, [ownerOf(req), rule.item_id, JSON.stringify(rule.definition)]);
            await client.query(`INSERT INTO inventory_acquisitions(id,user_id,item_id,quantity,source_type,source_id,season_id,task_id)
              VALUES($1,$2,$3,1,'season-exclusive',$4,$5,$6)`, [randomUUID(), ownerOf(req), rule.item_id, row.id, row.id, rule.final_task_id]);
            await client.query('UPDATE season_collectibles SET claimed_at=now(),evidence_sha256=$1 WHERE season_id=$2 AND owner_user_id=$3', [evidenceHash(finalEvidence), row.id, ownerOf(req)]);
            seasonalCollectible = { item: rule.definition, claimed: true };
          } else {
            seasonalCollectible = { item: rule.definition, claimed: false, alreadyClaimed: true };
          }
        }
      }
      const updated = await client.query<Row>(`UPDATE seasons SET state=$1,revision=revision+1,updated_at=now() WHERE id=$2 AND owner_user_id=$3 AND revision=$4
        RETURNING id,campaign_id,title,revision,state,created_at,updated_at`, [JSON.stringify(completed), row.id, ownerOf(req), row.revision]);
      if (!updated.rows[0]) { await client.query('ROLLBACK'); res.status(409).json({ error: 'REVISION_CONFLICT' }); return; }
      await client.query('COMMIT');
      res.json({ season: publicSeason(updated.rows[0]), alreadyCompleted: false, rewards: additions, ...(seasonalCollectible ? { seasonalCollectible } : {}) });
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); next(error); }
    finally { client.release(); }
  });
  app.post('/api/seasons/:id/reviews/settle', async (req,res,next) => {
    const {taskId,rating,answer,hintUsed,revision}=req.body??{};
    if(!idPattern.test(req.params.id)||typeof taskId!=='string'||!Number.isInteger(rating)||rating<1||rating>4||typeof answer!=='string'||answer.trim().length<8||answer.length>10000||typeof hintUsed!=='boolean'||!Number.isInteger(revision)||revision<1){res.status(400).json({error:'INVALID_REVIEW'});return;}
    const client=await pool.connect();
    try{
      await client.query('BEGIN');const found=await client.query<Row>('SELECT id,campaign_id,title,revision,state,created_at,updated_at,lifecycle_status FROM seasons WHERE id=$1 AND owner_user_id=$2 FOR UPDATE',[req.params.id,ownerOf(req)]);const row=found.rows[0];
      if(!row){await client.query('ROLLBACK');res.status(404).json({error:'NOT_FOUND'});return;}if(row.revision!==revision){await client.query('ROLLBACK');res.status(409).json({error:'REVISION_CONFLICT',revision:row.revision});return;}
      if(row.lifecycle_status!=='active'){await client.query('ROLLBACK');res.status(409).json({error:row.lifecycle_status==='paused'?'SEASON_PAUSED':'ARCHIVED_SEASON_READ_ONLY'});return;}
      const card=row.state.reviews.find(item=>item.taskId===taskId);if(!card||row.state.progress[taskId]?.status!=='completed'||Date.parse(card.dueAt)>Date.now()){await client.query('ROLLBACK');res.status(409).json({error:'REVIEW_NOT_DUE'});return;}
      const key=`review:${row.campaign_id}:${taskId}:${card.history.length+1}`;const coins=rating>=3&&answer.trim().length>=30&&!hintUsed?EFFECTIVE_REVIEW_COINS:0;const reward={xp:0,coins,items:[]};
      const next=rateReview(row.state,taskId,rating,new Date(),{answer:answer.trim(),hintUsed});
      if(coins){const inserted=await client.query(`INSERT INTO reward_ledger(id,user_id,season_id,task_id,kind,idempotency_key,reward,economy_version) VALUES($1,$2,$3,$4,'review',$5,$6,$7) ON CONFLICT(user_id,idempotency_key) DO NOTHING RETURNING id`,[randomUUID(),ownerOf(req),row.id,taskId,key,JSON.stringify(reward),ECONOMY_VERSION]);if(inserted.rowCount){const credited=await client.query(`INSERT INTO wallets(user_id,currency,balance) VALUES($1,'learning-coin',$2) ON CONFLICT(user_id,currency) DO UPDATE SET balance=wallets.balance+EXCLUDED.balance WHERE wallets.balance <= 9007199254740991-EXCLUDED.balance RETURNING balance`,[ownerOf(req),coins]);if(!credited.rowCount)throw new Error('WALLET_LIMIT');}next.rewardLedger=[...(next.rewardLedger??[]),{id:`review-${key}`,campaignId:row.campaign_id,taskId,at:new Date().toISOString(),reward,kind:'review',idempotencyKey:key}];}
      const updated=await client.query<Row>('UPDATE seasons SET state=$1,revision=revision+1,updated_at=now() WHERE id=$2 AND owner_user_id=$3 AND revision=$4 RETURNING id,campaign_id,title,revision,state,created_at,updated_at',[JSON.stringify(next),row.id,ownerOf(req),revision]);if(!updated.rows[0]){await client.query('ROLLBACK');res.status(409).json({error:'REVISION_CONFLICT'});return;}await client.query('COMMIT');res.json({season:publicSeason(updated.rows[0]),reward:{...reward,idempotencyKey:key},effective:coins>0});
    }catch(error){await client.query('ROLLBACK').catch(()=>undefined);next(error);}finally{client.release();}
  });
}

export async function persistEvaluation(pool: Pool, userId: string, seasonId: string, taskId: string, evidence: string, evaluation: Evaluation, lessonRevision?: number): Promise<number> {
  const verifiedEvaluation = evaluationSchema.parse(evaluation);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query<Row>('SELECT id,campaign_id,title,revision,state,created_at,updated_at,lifecycle_status FROM seasons WHERE id=$1 AND owner_user_id=$2 FOR UPDATE', [seasonId, userId]);
    const row = found.rows[0];
    if (!row) throw new Error('SEASON_NOT_FOUND');
    if (row.lifecycle_status !== 'active') throw new Error(row.lifecycle_status === 'paused' ? 'SEASON_PAUSED' : 'ARCHIVED_SEASON_READ_ONLY');
    const taskExists = row.state.campaign.stages.some(stage => stage.tasks.some(task => task.id === taskId));
    if (!taskExists || taskEvidence(row.state, taskId) !== evidence) throw new Error('EVIDENCE_STALE');
    if (lessonRevision !== undefined) {
      const task = row.state.campaign.stages.flatMap(stage => stage.tasks).find(item => item.id === taskId)!;
      const lesson = row.state.content?.[taskId] ?? task.teaching;
      const progress = row.state.progress[taskId];
      if (progress.answerRevealed) throw new Error('ANSWER_REVEALED');
      if (!lesson || lesson.revision !== lessonRevision || (progress.lessonRevision !== undefined && progress.lessonRevision !== lessonRevision)) throw new Error('LESSON_CHALLENGE_STALE');
    }
    const hash = evidenceHash(evidence);
    await client.query(`INSERT INTO task_evaluations (id,owner_user_id,season_id,task_id,evidence_sha256,evaluation)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (owner_user_id,season_id,task_id,evidence_sha256)
      DO UPDATE SET evaluation=EXCLUDED.evaluation,created_at=now()`, [randomUUID(), userId, seasonId, taskId, hash, JSON.stringify(verifiedEvaluation)]);
    const state = structuredClone(row.state);
    const old = state.progress[taskId];
    state.progress[taskId] = { ...old, evaluation: verifiedEvaluation, evaluationSource: 'ai', evaluationEvidence: evidence, ...(lessonRevision !== undefined ? { lessonRevision, evaluationLessonRevision: lessonRevision } : {}) };
    const updated = await client.query('UPDATE seasons SET state=$1,revision=revision+1,updated_at=now() WHERE id=$2 AND owner_user_id=$3 AND revision=$4 RETURNING revision', [JSON.stringify(state), seasonId, userId, row.revision]);
    if (!updated.rows[0]) throw new Error('REVISION_CONFLICT');
    await client.query('COMMIT');
    return updated.rows[0].revision;
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
}
