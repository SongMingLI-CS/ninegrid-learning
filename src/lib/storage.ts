import type { LearningState } from '../../shared/types';
import { learningStateSchema } from '../../shared/schema';
import { DEMO_CAMPAIGN } from './demo';

const STORAGE_KEY = 'ninegrid.learning.v1';

export function createInitialState(): LearningState {
  // Parsing clones the nested demo, so resetting cannot inherit an earlier edit.
  const campaign = structuredClone(DEMO_CAMPAIGN);
  const progress: LearningState['progress'] = Object.fromEntries(campaign.stages.flatMap(stage => stage.tasks)
    .map(task => [task.id, { completedObjectives: [], evidence: '', status: 'idle' as const }]));
  return learningStateSchema.parse({ version: 1, campaign, progress, reviews: [], notes: {} });
}

export function loadState(): LearningState {
  if (typeof window === 'undefined') return createInitialState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? createInitialState() : importState(raw);
  } catch {
    // Do not rewrite malformed JSON: recovery/export may still need the original.
    return createInitialState();
  }
}

export function saveState(state: LearningState): void {
  const raw = exportState(state);
  if (typeof window === 'undefined') return;
  // Propagate quota/permission errors so the UI can report an unsuccessful save.
  window.localStorage.setItem(STORAGE_KEY, raw);
}

export function exportState(state: LearningState): string {
  return JSON.stringify(learningStateSchema.parse(state), null, 2);
}

export function importState(raw: string): LearningState {
  if (typeof raw !== 'string' || raw.length > 10000000) throw new Error('备份为空或超过 10 MB');
  return learningStateSchema.parse(JSON.parse(raw));
}
