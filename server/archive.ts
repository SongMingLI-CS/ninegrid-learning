import { createHash, randomUUID } from 'node:crypto';
import type { Express, Request } from 'express';
import type { Pool } from 'pg';
import { evaluationSchema, learningStateSchema } from '../shared/schema';
import type { LearningState, TaskProgress } from '../shared/types';
import type { Evaluation } from '../shared/types';
import { completeTask, isTaskUnlocked, recordGridOutcome } from '../src/lib/engine';

type Row = { id: string; campaign_id: string; title: string; revision: number; state: LearningState; created_at: Date | string; updated_at: Date | string };
type Options = { pool: Pool };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ownerOf = (req: Request) => (req.session as typeof req.session & { userId?: string }).userId;
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
      const coins = Math.max(1, Math.ceil(xp / 10));
      task.xp = xp;
      task.reward = { xp, coins, items: task.kind === 'boss' ? [{ itemId: `${task.id}-field-notes`, name: '验证记录徽记', description: '完成综合任务后获得的原创学习收藏品。', rarity: 'rare', icon: '✦', quantity: 1 }] : [] };
    }
    stage.reward = { xp: 100, coins: 8, items: [] };
    for (const chain of stage.chains ?? []) chain.completionReward = { xp: Math.min(500, chain.taskIds.length * 20), coins: chain.track === 'main' ? 5 : 3, items: [] };
  }
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
  app.get('/api/inventory', async (req, res, next) => {
    try {
      const [items, ledger] = await Promise.all([
        pool.query('SELECT item_id,definition,quantity,acquired_at FROM inventory_items WHERE user_id=$1 ORDER BY acquired_at DESC', [ownerOf(req)]),
        pool.query('SELECT season_id,task_id,reward,created_at FROM reward_ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT 2000', [ownerOf(req)]),
      ]);
      const sources = new Map<string, Array<{ seasonId: string; taskId: string; acquiredAt: Date | string }>>();
      for (const row of ledger.rows as Array<{ season_id: string; task_id: string; reward: { items?: Array<{ itemId: string }> }; created_at: Date | string }>) {
        for (const item of row.reward?.items ?? []) sources.set(item.itemId, [...(sources.get(item.itemId) ?? []), { seasonId: row.season_id, taskId: row.task_id, acquiredAt: row.created_at }]);
      }
      const rarity = req.query.rarity;
      const seasonId = req.query.seasonId;
      const filtered = (items.rows as Array<{ item_id: string; definition: Record<string, unknown>; quantity: number; acquired_at: Date | string }>).map(row => ({ ...row, sources: sources.get(row.item_id) ?? [] }))
        .filter(item => (!rarity || item.definition.rarity === rarity) && (!seasonId || item.sources.some(source => source.seasonId === seasonId)));
      res.json({ items: filtered });
    } catch (error) { next(error); }
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
