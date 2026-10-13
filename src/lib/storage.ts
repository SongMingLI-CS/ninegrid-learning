import type { LearningState } from '../../shared/types';
import { learningStateSchema } from '../../shared/schema';
import { DEMO_CAMPAIGN } from './demo';
import { createProgressForCampaign, getRewardIdempotencyKey } from './engine';

const STORAGE_KEY = 'ninegrid.learning.v1';
let storageKey = STORAGE_KEY;

export function setStorageScope(userId?: string): void {
  if (!userId) { storageKey = STORAGE_KEY; return; }
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(userId)) throw new Error('账号标识无效');
  storageKey = `${STORAGE_KEY}.user.${userId}`;
}

export function createInitialState(): LearningState {
  // Parsing clones the nested demo, so resetting cannot inherit an earlier edit.
  const campaign = structuredClone(DEMO_CAMPAIGN);
  const progress = createProgressForCampaign(campaign);
  return learningStateSchema.parse({ version: 2, campaign, progress, reviews: [], notes: {}, content: {}, contentHistory: {}, attempts: {}, schedules: {}, history: [], wallet: { currency: '学习币', balance: 0 }, inventory: {}, rewardLedger: [], gridOutcomes: {}, dailyAdjustments: {}, knownTasks: {} });
}

export function loadState(): LearningState {
  return loadStateSafely().state;
}

export function loadStateSafely(): { state: LearningState; warning?: string; isNew?: boolean } {
  if (typeof window === 'undefined') return { state: createInitialState(), isNew: true };
  try {
    const raw = window.localStorage.getItem(storageKey);
    return { state: raw === null ? createInitialState() : importState(raw), isNew: raw === null };
  } catch (error) {
    // Do not rewrite malformed JSON: recovery/export may still need the original.
    return { state: createInitialState(), warning: error instanceof Error ? `原存档无法读取，已保留原始数据且未覆盖：${error.message}` : '原存档无法读取，已保留原始数据且未覆盖。' };
  }
}

export function saveState(state: LearningState): void {
  const raw = exportState(state);
  if (typeof window === 'undefined') return;
  // Propagate quota/permission errors so the UI can report an unsuccessful save.
  window.localStorage.setItem(storageKey, raw);
}

export function saveStateSafely(state: LearningState): { ok: true } | { ok: false; error: string } {
  try { saveState(state); return { ok: true }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : '浏览器存储不可用' }; }
}

export function exportState(state: LearningState): string {
  return JSON.stringify(learningStateSchema.parse(state), null, 2);
}

export function importState(raw: string): LearningState {
  if (typeof raw !== 'string' || raw.length > 10000000) throw new Error('备份为空或超过 10 MB');
  const parsed = learningStateSchema.parse(JSON.parse(raw));
  if (parsed.version === 1) return learningStateSchema.parse({ ...parsed, version: 2, content: {}, contentHistory: {}, attempts: {}, schedules: {}, history: [], wallet: { currency: '学习币', balance: 0 }, inventory: {}, rewardLedger: [], gridOutcomes: {}, dailyAdjustments: {}, knownTasks: {} });
  const history = (parsed.history ?? []).map(snapshot => ({ ...snapshot, attempts: snapshot.attempts ?? {}, contentHistory: snapshot.contentHistory ?? {}, gridOutcomes: snapshot.gridOutcomes ?? {}, dailyAdjustments: snapshot.dailyAdjustments ?? {}, knownTasks: snapshot.knownTasks ?? {} }));
  const campaigns = [parsed.campaign, ...history.map(snapshot => snapshot.campaign)];
  const entries = (parsed.rewardLedger ?? []).map(entry => {
    const campaign = (entry.campaignId !== 'legacy-unknown' ? campaigns.find(item => item.id === entry.campaignId) : undefined)
      ?? campaigns.find(item => entry.idempotencyKey.startsWith(`${item.id}-`))
      ?? campaigns.find(item => item.stages.some(stage => stage.tasks.some(task => task.id === entry.taskId)))
      ?? parsed.campaign;
    let ownerId = entry.taskId;
    if (entry.kind === 'stage') {
      const stage = campaign.stages.find(item => item.tasks.some(task => task.id === entry.taskId));
      ownerId = stage?.id ?? ownerId;
    } else if (entry.kind === 'chain') {
      const chains = campaign.stages.flatMap(stage => stage.chains ?? []).filter(chain => chain.taskIds.includes(entry.taskId));
      const legacy = chains.find(chain => entry.idempotencyKey === `${campaign.id}-${chain.id}-${entry.taskId}-chain`.replace(/[^\p{L}\p{N}_-]/gu, '-').slice(0, 120));
      ownerId = (legacy ?? (chains.length === 1 ? chains[0] : undefined))?.id ?? ownerId;
    }
    const key = ['mission', 'verification', 'chain', 'stage', 'season'].includes(entry.kind)
      ? getRewardIdempotencyKey(campaign.id, entry.kind as 'mission' | 'verification' | 'chain' | 'stage' | 'season', ownerId)
      : entry.idempotencyKey;
    return { ...entry, campaignId: campaign.id, canonicalKey: key };
  });
  const reserved = new Set(entries.filter(entry => entry.idempotencyKey === entry.canonicalKey).map(entry => entry.canonicalKey));
  const migratedKeys = new Set<string>();
  const rewardLedger = entries.map(({ canonicalKey, ...entry }) => {
    if (entry.idempotencyKey === canonicalKey || reserved.has(canonicalKey) || migratedKeys.has(canonicalKey)) return entry;
    migratedKeys.add(canonicalKey);
    return { ...entry, idempotencyKey: canonicalKey };
  });
  return learningStateSchema.parse({ ...parsed, version: 2, contentHistory: parsed.contentHistory ?? {}, attempts: parsed.attempts ?? {}, gridOutcomes: parsed.gridOutcomes ?? {}, dailyAdjustments: parsed.dailyAdjustments ?? {}, knownTasks: parsed.knownTasks ?? {}, history, rewardLedger });
}
