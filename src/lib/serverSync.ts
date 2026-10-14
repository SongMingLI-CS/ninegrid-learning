import type { LearningState } from '../../shared/types';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function changedMap<T>(server: Record<string, T> = {}, submitted: Record<string, T> = {}, draft: Record<string, T> = {}): Record<string, T> {
  const merged = { ...server };
  for (const key of new Set([...Object.keys(submitted), ...Object.keys(draft)])) if (!same(submitted[key], draft[key])) {
    if (Object.hasOwn(draft, key)) merged[key] = draft[key]; else delete merged[key];
  }
  return merged;
}

// Reconcile a command response with edits made while the command was in flight.
// Server progress/verification/rewards remain authoritative; drafts remain recoverable.
export function reconcileServerState(server: LearningState, submitted: LearningState, draft: LearningState): LearningState {
  if (server.campaign.id !== draft.campaign.id) return draft;
  const result: LearningState = { ...server, notes: changedMap(server.notes, submitted.notes, draft.notes), content: changedMap(server.content, submitted.content, draft.content), contentHistory: changedMap(server.contentHistory, submitted.contentHistory, draft.contentHistory), attempts: changedMap(server.attempts, submitted.attempts, draft.attempts), schedules: changedMap(server.schedules, submitted.schedules, draft.schedules), dailyAdjustments: changedMap(server.dailyAdjustments, submitted.dailyAdjustments, draft.dailyAdjustments), rescueLevels: changedMap(server.rescueLevels, submitted.rescueLevels, draft.rescueLevels), lastTaskId: draft.lastTaskId, progress: { ...server.progress } };
  for (const [id, current] of Object.entries(draft.progress)) {
    const sent = submitted.progress[id]; const saved = server.progress[id]; if (!sent || !saved) continue;
    const answerChanged = current.evidence !== sent.evidence;
    const supplementChanged = (current.supplementalEvidence ?? '') !== (sent.supplementalEvidence ?? '');
    const objectivesChanged = !same(current.completedObjectives, sent.completedObjectives);
    if (!answerChanged && !supplementChanged && !objectivesChanged) continue;
    if (saved.status === 'completed' && saved.verification === 'ai') {
      result.notes[`pending-evidence-${id}`] = `核验/结算期间编辑的未发送草稿：\n${current.evidence}\n${current.supplementalEvidence ?? ''}`;
      continue;
    }
    const next = { ...saved };
    if (saved.status === 'completed') {
      next.supplementalEvidence = [current.supplementalEvidence, answerChanged ? `结算期间的追加草稿：\n${current.evidence}` : ''].filter(Boolean).join('\n\n');
    } else {
      next.evidence = current.evidence; next.completedObjectives = current.completedObjectives; next.supplementalEvidence = current.supplementalEvidence;
      next.selfChecked = answerChanged ? false : current.selfChecked;
    }
    delete next.evaluation; delete next.evaluationSource; delete next.evaluationEvidence;
    result.progress[id] = next;
  }
  return result;
}

export interface PendingServerDraft { userId: string; seasonId: string; revision: number; state: LearningState; updatedAt: string }
const draftKey = (userId: string, seasonId: string) => `ninegrid.pending.${userId}.${seasonId}`;
export function savePendingDraft(draft: PendingServerDraft): void { localStorage.setItem(draftKey(draft.userId, draft.seasonId), JSON.stringify(draft)); }
export function readPendingDraft(userId: string, seasonId: string): PendingServerDraft | null {
  const raw = localStorage.getItem(draftKey(userId, seasonId)); if (!raw) return null;
  try { const parsed = JSON.parse(raw) as PendingServerDraft; return parsed.userId === userId && parsed.seasonId === seasonId ? parsed : null; } catch { return null; }
}
export function clearPendingDraft(userId: string, seasonId: string, submitted: LearningState): void {
  const pending = readPendingDraft(userId, seasonId);
  if (pending && same(pending.state, submitted)) localStorage.removeItem(draftKey(userId, seasonId));
}
export function discardPendingDraft(userId: string, seasonId: string): void { localStorage.removeItem(draftKey(userId, seasonId)); }
