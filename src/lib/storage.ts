import type { LearningState } from '../../shared/types';
import { learningStateSchema } from '../../shared/schema';
import { DEMO_CAMPAIGN } from './demo';
import { createProgressForCampaign } from './engine';

const STORAGE_KEY = 'ninegrid.learning.v1';

export function createInitialState(): LearningState {
  // Parsing clones the nested demo, so resetting cannot inherit an earlier edit.
  const campaign = structuredClone(DEMO_CAMPAIGN);
  const progress = createProgressForCampaign(campaign);
  return learningStateSchema.parse({ version: 2, campaign, progress, reviews: [], notes: {}, content: {}, contentHistory: {}, attempts: {}, schedules: {}, history: [], wallet: { currency: '学习币', balance: 0 }, inventory: {}, rewardLedger: [], gridOutcomes: {}, dailyAdjustments: {} });
}

export function loadState(): LearningState {
  return loadStateSafely().state;
}

export function loadStateSafely(): { state: LearningState; warning?: string; isNew?: boolean } {
  if (typeof window === 'undefined') return { state: createInitialState(), isNew: true };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
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
  window.localStorage.setItem(STORAGE_KEY, raw);
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
  if (parsed.version === 2) return parsed;
  return learningStateSchema.parse({ ...parsed, version: 2, content: {}, contentHistory: {}, attempts: {}, schedules: {}, history: [], wallet: { currency: '学习币', balance: 0 }, inventory: {}, rewardLedger: [], gridOutcomes: {}, dailyAdjustments: {} });
}
