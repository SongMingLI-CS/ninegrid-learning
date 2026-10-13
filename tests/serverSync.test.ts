import { describe, expect, it } from 'vitest';
import { reconcileServerState } from '../src/lib/serverSync';
import { NUMPY_DEMO_CAMPAIGN } from '../src/lib/numpyDemo';
import { createProgressForCampaign, completeTask, markSelfChecked, setEvidence } from '../src/lib/engine';
import type { LearningState } from '../shared/types';
describe('server response and in-flight drafts', () => {
  it('preserves new answers and notes while applying authoritative completion metadata and rewards', () => {
    let sent: LearningState = { version: 2, campaign: NUMPY_DEMO_CAMPAIGN, progress: createProgressForCampaign(NUMPY_DEMO_CAMPAIGN), notes: {}, reviews: [] };
    const ids = Object.keys(sent.progress); sent = markSelfChecked(setEvidence(sent, ids[0], 'Original independent code, result and a detailed explanation.'), ids[0]);
    const server = completeTask(sent, ids[0], 'self'); const draft = structuredClone(sent);
    draft.progress[ids[0]].evidence = 'A later answer typed while the settlement request was pending.';
    draft.progress[ids[1]].evidence = 'A new answer on another task.'; draft.notes[ids[1]] = 'New note.';
    const merged = reconcileServerState(server, sent, draft);
    expect(merged.progress[ids[0]].evidence).toBe(sent.progress[ids[0]].evidence);
    expect(merged.progress[ids[0]].supplementalEvidence).toContain(draft.progress[ids[0]].evidence);
    expect(merged.progress[ids[0]].completedAt).toBe(server.progress[ids[0]].completedAt);
    expect(merged.progress[ids[1]].evidence).toBe(draft.progress[ids[1]].evidence);
    expect(merged.notes[ids[1]]).toBe('New note.'); expect(merged.rewardLedger).toEqual(server.rewardLedger);
  });
});
