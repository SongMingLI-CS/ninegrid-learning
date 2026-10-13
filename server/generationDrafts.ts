import { createHash, randomUUID } from 'node:crypto';
import type { Express, Request } from 'express';
import type { Pool } from 'pg';
import { campaignSchema, goalInputSchema } from '../shared/schema';
import { curriculumOutlineSchema } from '../shared/curriculum';
import type { Campaign, LearningState } from '../shared/types';

type DraftRow = {
  id: string; input_fingerprint: string; input: unknown; rules_version: number; outline: unknown; batches: Record<string, unknown>;
  status: string; progress: unknown; failure: unknown; final_campaign: unknown; activated_season_id?: string; revision: number; expires_at: Date | string;
};
const ownerOf = (req: Request) => (req.session as typeof req.session & { userId?: string }).userId;
const publicDraft = (row: DraftRow) => ({ id: row.id, input: row.input, rulesVersion: row.rules_version, outline: row.outline, batches: row.batches, status: row.status, progress: row.progress, failure: row.failure, revision: row.revision, expiresAt: row.expires_at, ...(row.final_campaign ? { finalCampaign: row.final_campaign } : {}), ...(row.activated_season_id ? { activatedSeasonId: row.activated_season_id } : {}) });
const validId = (value: string) => /^[0-9a-f-]{36}$/i.test(value);
const MAX_DRAFT_BYTES = 2_000_000;
const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');

export function mountGenerationDraftRoutes(app: Express, { pool }: { pool: Pool }): void {
  app.get('/api/generation-drafts', async (req, res, next) => {
    try {
      await pool.query("DELETE FROM generation_drafts WHERE owner_user_id=$1 AND expires_at < now() AND status <> 'activated'", [ownerOf(req)]);
      const result = await pool.query<DraftRow>(`SELECT * FROM generation_drafts WHERE owner_user_id=$1 ORDER BY updated_at DESC LIMIT 5`, [ownerOf(req)]);
      res.json({ drafts: result.rows.map(publicDraft) });
    } catch (error) { next(error); }
  });

  app.post('/api/generation-drafts', async (req, res, next) => {
    if (jsonBytes(req.body) > MAX_DRAFT_BYTES) { res.status(413).json({ code: 'DRAFT_TOO_LARGE', error: '课程草稿超过 2 MB 限额。请减少材料或拆成更小课程。' }); return; }
    const parsed = goalInputSchema.safeParse(req.body?.input);
    if (!parsed.success || req.body?.rulesVersion !== 4) { res.status(400).json({ code: 'INVALID_DRAFT', error: '草稿输入或课程规则版本无效。' }); return; }
    const fingerprintBase = createHash('sha256').update(JSON.stringify({ input: parsed.data, rulesVersion: 4 })).digest('hex');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize account-level count/volume limits for different simultaneous inputs.
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerOf(req)]);
      await client.query("DELETE FROM generation_drafts WHERE owner_user_id=$1 AND status <> 'activated' AND expires_at < now()", [ownerOf(req)]);
      const found = await client.query<DraftRow>('SELECT * FROM generation_drafts WHERE owner_user_id=$1 AND input_fingerprint=$2 FOR UPDATE', [ownerOf(req), fingerprintBase]);
      const existing = found.rows[0];
      if (existing && existing.status !== 'activated') {
        const updated = await client.query<DraftRow>(`UPDATE generation_drafts SET status=CASE WHEN status IN ('failed','cancelled') THEN 'partial' ELSE status END, updated_at=now(), expires_at=now()+interval '30 days', revision=revision+1 WHERE id=$1 RETURNING *`, [existing.id]);
        await client.query('COMMIT'); res.json({ draft: publicDraft(updated.rows[0]), reused: true }); return;
      }
      const fingerprint = existing ? createHash('sha256').update(`${fingerprintBase}:${randomUUID()}`).digest('hex') : fingerprintBase;
      const count = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM generation_drafts WHERE owner_user_id=$1 AND status NOT IN ('activated','failed','cancelled')", [ownerOf(req)]);
      if (Number(count.rows[0]?.count ?? 0) >= 3) { await client.query('ROLLBACK'); res.status(429).json({ code: 'DRAFT_LIMIT', error: '账号已有 3 个未完成的生成草稿；请恢复、取消或完成其中一个。' }); return; }
      const inserted = await client.query<DraftRow>(`INSERT INTO generation_drafts (id,owner_user_id,input_fingerprint,input,rules_version,status)
        VALUES ($1,$2,$3,$4,4,'pending') RETURNING *`, [randomUUID(), ownerOf(req), fingerprint, JSON.stringify(parsed.data)]);
      await client.query('COMMIT'); res.status(201).json({ draft: publicDraft(inserted.rows[0]), reused: false });
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); next(error); }
    finally { client.release(); }
  });

  app.patch('/api/generation-drafts/:id', async (req, res, next) => {
    if (!validId(req.params.id)) { res.status(400).json({ code: 'INVALID_DRAFT' }); return; }
    if (jsonBytes(req.body) > MAX_DRAFT_BYTES) { res.status(413).json({ code: 'DRAFT_TOO_LARGE', error: '课程草稿超过 2 MB 限额。请减少材料或拆成更小课程。' }); return; }
    if (!Number.isSafeInteger(req.body?.revision) || req.body.revision < 1) { res.status(400).json({ code: 'DRAFT_REVISION_REQUIRED', error: '更新草稿必须携带有效 revision。请重新读取草稿后重试。' }); return; }
    const allowed = new Set(['generating','partial','failed','cancelled','awaiting-confirmation']);
    if (req.body?.status !== undefined && !allowed.has(req.body.status)) { res.status(400).json({ code: 'INVALID_DRAFT_STATUS' }); return; }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<DraftRow>('SELECT * FROM generation_drafts WHERE id=$1 AND owner_user_id=$2 FOR UPDATE', [req.params.id, ownerOf(req)]);
      const old = result.rows[0];
      if (!old) { await client.query('ROLLBACK'); res.status(404).json({ code: 'DRAFT_NOT_FOUND' }); return; }
      if (old.status === 'activated') { await client.query('ROLLBACK'); res.status(409).json({ code: 'DRAFT_ALREADY_ACTIVATED' }); return; }
      if (req.body.revision !== old.revision) { await client.query('ROLLBACK'); res.status(409).json({ code: 'DRAFT_REVISION_CONFLICT', revision: old.revision, error: '草稿已在另一设备更新。请重新读取后恢复，当前提交未覆盖服务器内容。' }); return; }
      const outline = req.body?.outline ?? old.outline;
      if (outline && !curriculumOutlineSchema.safeParse(outline).success) { await client.query('ROLLBACK'); res.status(400).json({ code: 'INVALID_DRAFT_OUTLINE' }); return; }
      const batches = { ...(old.batches ?? {}) } as Record<string, Record<string, unknown>>;
      if (req.body?.batch) {
        const batch = req.body.batch as { stageId?: unknown; chainId?: unknown; batchKey?: unknown; tasks?: unknown };
        if (typeof batch.stageId !== 'string' || typeof batch.chainId !== 'string' || typeof batch.batchKey !== 'string' || !Array.isArray(batch.tasks) || batch.tasks.length < 1 || batch.tasks.length > 5 || JSON.stringify(batch).length > 200_000) { await client.query('ROLLBACK'); res.status(400).json({ code: 'INVALID_DRAFT_BATCH' }); return; }
        const key = `${batch.stageId}/${batch.chainId}/${batch.batchKey}`;
        if (Object.hasOwn(batches, key)) { await client.query('ROLLBACK'); res.status(409).json({ code: 'DRAFT_BATCH_EXISTS' }); return; }
        batches[key] = batch as unknown as Record<string, unknown>;
      }
      const finalCampaign = req.body?.finalCampaign ?? old.final_campaign;
      const checkedFinal = finalCampaign === null || finalCampaign === undefined ? undefined : campaignSchema.safeParse(finalCampaign);
      if (checkedFinal && (!checkedFinal.success || checkedFinal.data.goal !== (old.input as any).goal || checkedFinal.data.sourceMaterial !== (old.input as any).sourceMaterial)) { await client.query('ROLLBACK'); res.status(400).json({ code: 'INVALID_FINAL_CAMPAIGN' }); return; }
      const status = req.body?.status ?? old.status;
      if (old.final_campaign && status !== 'awaiting-confirmation') { await client.query('ROLLBACK'); res.status(409).json({ code: 'DRAFT_FINAL_STATUS_LOCKED' }); return; }
      if (old.final_campaign && finalCampaign && JSON.stringify(old.final_campaign) !== JSON.stringify(finalCampaign)) { await client.query('ROLLBACK'); res.status(409).json({ code: 'DRAFT_FINAL_CAMPAIGN_LOCKED' }); return; }
      if (status === 'awaiting-confirmation' && !finalCampaign) { await client.query('ROLLBACK'); res.status(400).json({ code: 'FINAL_CAMPAIGN_REQUIRED' }); return; }
      const progress = req.body?.progress ?? old.progress;
      const failure = req.body?.failure ?? null;
      const stored = { input: old.input, rulesVersion: old.rules_version, outline: outline ?? null, batches, status, progress: progress ?? {}, failure, finalCampaign: finalCampaign ?? null };
      if (jsonBytes(stored) > MAX_DRAFT_BYTES) { await client.query('ROLLBACK'); res.status(413).json({ code: 'DRAFT_TOO_LARGE', error: '合并后的课程草稿超过 2 MB 限额；此前已保存的草稿保持不变。请缩短材料或删除不需要的批次。' }); return; }
      const updated = await client.query<DraftRow>(`UPDATE generation_drafts SET outline=$1,batches=$2,status=$3,progress=$4,failure=$5,final_campaign=$6,revision=revision+1,updated_at=now(),expires_at=now()+interval '30 days' WHERE id=$7 AND owner_user_id=$8 RETURNING *`, [outline ? JSON.stringify(outline) : null, JSON.stringify(batches), status, JSON.stringify(progress ?? {}), failure ? JSON.stringify(failure) : null, finalCampaign ? JSON.stringify(finalCampaign) : null, old.id, ownerOf(req)]);
      await client.query('COMMIT'); res.json({ draft: publicDraft(updated.rows[0]) });
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); next(error); }
    finally { client.release(); }
  });

  app.post('/api/generation-drafts/:id/activate', async (req, res, next) => {
    if (!validId(req.params.id)) { res.status(404).json({ code: 'DRAFT_NOT_FOUND' }); return; }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerOf(req)]);
      const selection = await client.query<{season_id:string|null;revision:number}>('SELECT season_id,revision FROM user_current_seasons WHERE user_id=$1 FOR UPDATE', [ownerOf(req)]);
      const selectionRevision = Number(selection.rows[0]?.revision ?? 0);
      const found = await client.query<DraftRow>('SELECT * FROM generation_drafts WHERE id=$1 AND owner_user_id=$2 FOR UPDATE', [req.params.id, ownerOf(req)]);
      const draft = found.rows[0];
      if (!draft) { await client.query('ROLLBACK'); res.status(404).json({ code: 'DRAFT_NOT_FOUND' }); return; }
      if (draft.activated_season_id) {
        const season = await client.query('SELECT id,campaign_id,title,revision,state,created_at,updated_at,lifecycle_status FROM seasons WHERE id=$1 AND owner_user_id=$2', [draft.activated_season_id, ownerOf(req)]);
        if (season.rows[0]) { await client.query('COMMIT'); res.json({ season: season.rows[0], currentSeasonId: selection.rows[0]?.season_id ?? null, selectionRevision, idempotent: true }); return; }
      }
      if (req.body?.selectionRevision !== undefined && (!Number.isInteger(req.body.selectionRevision) || req.body.selectionRevision !== selectionRevision)) {
        await client.query('ROLLBACK'); res.status(409).json({ code: 'SEASON_SELECTION_CONFLICT', currentSeasonId: selection.rows[0]?.season_id ?? null, selectionRevision }); return;
      }
      if (draft.status !== 'awaiting-confirmation') { await client.query('ROLLBACK'); res.status(409).json({ code: 'DRAFT_NOT_READY' }); return; }
      const checked = campaignSchema.safeParse(draft.final_campaign);
      if (!checked.success || checked.data.goal !== (draft.input as any).goal || checked.data.sourceMaterial !== (draft.input as any).sourceMaterial) { await client.query('ROLLBACK'); res.status(409).json({ code: 'DRAFT_TARGET_MISMATCH' }); return; }
      const submittedCampaign = checked.data as Campaign;
      const input = draft.input as { goal: string; sourceMaterial?: string; desiredArtifact?: string; ultimateReward: string; language?: string };
      const rewardKey = createHash('sha256').update(JSON.stringify({ goal: input.goal.trim(), sourceMaterial: input.sourceMaterial?.trim() ?? '', desiredArtifact: input.desiredArtifact?.trim() ?? input.ultimateReward.trim(), language: input.language ?? 'mixed', version: 1 })).digest('hex');
      const finalTaskId = submittedCampaign.stages.at(-1)?.gateTaskIds?.[0];
      const campaign: Campaign = {
        ...submittedCampaign,
        ...(submittedCampaign.seasonalCollectible && finalTaskId ? { seasonalCollectible: {
          ...submittedCampaign.seasonalCollectible,
          id: `season-red-${rewardKey.slice(0, 40)}`,
          rewardKey,
          finalTaskId,
          displayValue: 1_600_000,
        } } : { seasonalCollectible: undefined }),
      };
      const state: LearningState = { version: 2, campaign, progress: Object.fromEntries(campaign.stages.flatMap(stage => stage.tasks).map(task => [task.id, { completedObjectives: [], evidence: '', status: 'idle' as const }])), reviews: [], notes: {}, wallet: { currency: 'learning-coin', balance: 0 }, inventory: {}, rewardLedger: [], gridOutcomes: {} };
      let inserted = await client.query(`INSERT INTO seasons (id,owner_user_id,campaign_id,title,revision,state) VALUES ($1,$2,$3,$4,1,$5) ON CONFLICT(owner_user_id,campaign_id) DO NOTHING RETURNING id,campaign_id,title,revision,state,created_at,updated_at,lifecycle_status`, [randomUUID(), ownerOf(req), campaign.id, campaign.title, JSON.stringify(state)]);
      if (!inserted.rows[0]) {
        inserted = await client.query('SELECT id,campaign_id,title,revision,state,created_at,updated_at,lifecycle_status FROM seasons WHERE owner_user_id=$1 AND campaign_id=$2', [ownerOf(req), campaign.id]);
        if (!inserted.rows[0] || inserted.rows[0].lifecycle_status !== 'active') { await client.query('ROLLBACK'); res.status(409).json({code:'SEASON_NOT_AVAILABLE'}); return; }
      }
      if (campaign.seasonalCollectible) {
        const collectible = campaign.seasonalCollectible;
        const gateTaskIds = campaign.stages.flatMap(stage => stage.gateTaskIds ?? []);
        const definition = {
          id: collectible.id, name: collectible.name, category: '纪念物', rarity: 'large-red', size: '2×3',
          imageKey: 'season-exclusive-placeholder',
          description: `${collectible.story}\n\n${collectible.appearance}\n\n对应学习成果：${collectible.abilityOutcome}`,
          displayValue: 1_600_000, sellPrice: 0, limited: true, sellable: false,
          seasonId: inserted.rows[0].id, version: 1,
        };
        await client.query(`INSERT INTO season_collectibles(season_id,owner_user_id,item_id,reward_key,definition,final_task_id,gate_task_ids,reward_version)
          VALUES($1,$2,$3,$4,$5,$6,$7,1) ON CONFLICT(season_id) DO NOTHING`,
        [inserted.rows[0].id, ownerOf(req), collectible.id, collectible.rewardKey, JSON.stringify(definition), collectible.finalTaskId, gateTaskIds]);
      }
      const selected = await client.query<{revision:number}>(`INSERT INTO user_current_seasons(user_id,season_id,revision) VALUES($1,$2,1)
        ON CONFLICT(user_id) DO UPDATE SET season_id=EXCLUDED.season_id,revision=user_current_seasons.revision+1,updated_at=now() RETURNING revision`,[ownerOf(req),inserted.rows[0].id]);
      // Keep only the compact activation key; the full course already lives in seasons.state.
      await client.query("UPDATE generation_drafts SET status='activated',activated_season_id=$1,input=$4::jsonb,outline=NULL,batches='{}'::jsonb,progress='{}'::jsonb,failure=NULL,final_campaign=NULL,revision=revision+1,updated_at=now() WHERE id=$2 AND owner_user_id=$3", [inserted.rows[0].id, draft.id, ownerOf(req), JSON.stringify({ goal: (draft.input as any).goal, activated: true })]);
      await client.query('COMMIT'); res.status(201).json({ season: inserted.rows[0], currentSeasonId: inserted.rows[0].id, selectionRevision: Number(selected.rows[0].revision), idempotent: false });
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); next(error); }
    finally { client.release(); }
  });
}
