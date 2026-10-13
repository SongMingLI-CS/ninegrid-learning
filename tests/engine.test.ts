import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Campaign, Evaluation, LearningState, LessonContent, Task } from '../shared/types';
import { campaignSchema, evaluationSchema, goalInputSchema, learningStateSchema, taskSchema } from '../shared/schema';
import { activateTask, buildDailySchedule, cacheLesson, completeTask, createProgressForCampaign, getStats, getTasks, isTaskUnlocked, markSelfChecked, rateReview, recordAttempt, recordGridOutcome, setEvaluation, setEvidence, setSupplementalEvidence, switchCampaign, updateObjective } from '../src/lib/engine';
import { createInitialState, exportState, importState, loadState, loadStateSafely, saveState, saveStateSafely, setStorageScope } from '../src/lib/storage';
import { DEMO_CAMPAIGN } from '../src/lib/demo';
import { NUMPY_DEMO_CAMPAIGN } from '../src/lib/numpyDemo';

const NOW = new Date('2026-10-13T08:00:00.000Z');
const EVIDENCE = '我运行了程序，记录输入、实际输出与报错，并解释了结果和修改原因。';
const PASS: Evaluation = { passed: true, score: 70, feedback: '满足验收条件', gaps: [], nextStep: '继续练习' };
function task(id: string, prerequisites: string[] = []): Task {
  return { id, title: id, brief: '练习与解释', kind: 'practice', minutes: 20, xp: 100, prerequisites,
    objectives: [{ id: `${id}-o`, text: '运行并解释结果' }], curiosity: '为什么？', steps: ['运行程序'],
    acceptance: '输出符合预期', recallQuestion: '如何解释？', hint: '检查输入', resources: [{ title: 'Python 教程', url: 'https://docs.python.org/3/tutorial/' }] };
}
function fresh(): LearningState {
  const campaign: Campaign = { id: 'test', title: '行动', subtitle: '练习', goal: '学会解释程序', level: '入门', days: 7,
    dailyMinutes: 30, ultimateReward: '完成作品', createdAt: NOW.toISOString(), source: 'demo', stages: [
      { id: 's1', title: '第一阶段', description: '准备', tasks: [task('a'), task('b', ['a'])] },
      { id: 's2', title: '第二阶段', description: '综合', tasks: [task('c')] },
    ] };
  return { version: 1, campaign, progress: Object.fromEntries(['a', 'b', 'c'].map(id => [id, { completedObjectives: [], evidence: '', status: 'idle' }])), reviews: [], notes: {} };
}
function ready(state: LearningState, id: string) {
  return setEvidence(updateObjective(state, id, `${id}-o`), id, EVIDENCE);
}
function done(state: LearningState, id: string) { return completeTask(ready(state, id), id, 'self', NOW); }
afterEach(() => { vi.unstubAllGlobals(); setStorageScope(); });

describe('progression and verification', () => {
  it('requires every earlier stage and explicit prerequisites before unlocking', () => {
    let state = fresh();
    expect(getTasks(state.campaign).map(t => t.id)).toEqual(['a', 'b', 'c']);
    expect(isTaskUnlocked(state.campaign, state.progress, 'a')).toBe(true);
    expect(isTaskUnlocked(state.campaign, state.progress, 'b')).toBe(false);
    expect(isTaskUnlocked(state.campaign, state.progress, 'missing')).toBe(false);
    state = done(state, 'a');
    expect(isTaskUnlocked(state.campaign, state.progress, 'b')).toBe(true);
    expect(isTaskUnlocked(state.campaign, state.progress, 'c')).toBe(false);
    state = done(state, 'b');
    expect(isTaskUnlocked(state.campaign, state.progress, 'c')).toBe(true);
  });
  it('rejects locked completion even if evidence is supplied', () => {
    let state = fresh();
    state.progress.c = { status: 'active', completedObjectives: ['c-o'], evidence: EVIDENCE };
    expect(() => completeTask(state, 'c', 'self', NOW)).toThrow();
  });
  it('allows browsing a locked task without allowing it to earn completion', () => {
    const state = activateTask(fresh(), 'c');
    expect(state.progress.c.status).toBe('active');
    expect(importState(exportState(state)).progress.c.status).toBe('active');
    expect(() => completeTask(ready(state, 'c'), 'c', 'self', NOW)).toThrow();
  });
  it('rejects completion before its prerequisite completion time', () => {
    const state = ready(done(fresh(), 'a'), 'b');
    expect(() => completeTask(state, 'b', 'self', new Date('2026-10-12T08:00:00Z'))).toThrow();
  });
  it('activates an unlocked task without mutating input and toggles only valid objectives', () => {
    const state = fresh();
    const active = activateTask(state, 'a');
    expect(active.progress.a.status).toBe('active');
    expect(state.progress.a.status).toBe('idle');
    const checked = updateObjective(active, 'a', 'a-o');
    expect(checked.progress.a.completedObjectives).toEqual(['a-o']);
    expect(updateObjective(checked, 'a', 'a-o').progress.a.completedObjectives).toEqual([]);
    expect(() => updateObjective(active, 'a', 'b-o')).toThrow();
    expect(() => setEvidence(active, 'missing', EVIDENCE)).toThrow();
  });
  it('requires at least twenty non-whitespace evidence characters without forcing hidden checklist state', () => {
    const state = setEvidence(fresh(), 'a', EVIDENCE);
    const checked = state;
    for (const evidence of ['', ' '.repeat(50), '少于二十字', ` ${'x'.repeat(19)} `]) {
      expect(() => completeTask(setEvidence(checked, 'a', evidence), 'a', 'self', NOW)).toThrow();
    }
    expect(completeTask(setEvidence(checked, 'a', 'x'.repeat(20)), 'a', 'self', NOW).progress.a.status).toBe('completed');
  });
  it('requires a passing AI evaluation with score at least 70', () => {
    const state = ready(fresh(), 'a');
    expect(() => completeTask(state, 'a', 'ai', NOW)).toThrow();
    for (const evaluation of [{ ...PASS, passed: false, score: 100 }, { ...PASS, score: 69 }]) {
      expect(() => completeTask(setEvaluation(state, 'a', evaluation), 'a', 'ai', NOW)).toThrow();
    }
    const completed = completeTask(setEvaluation(state, 'a', PASS), 'a', 'ai', NOW);
    expect(completed.progress.a.verification).toBe('ai');
  });
  it('invalidates evaluation and verification when evidence or objectives change', () => {
    const evaluated = setEvaluation(ready(fresh(), 'a'), 'a', PASS);
    evaluated.progress.a.verification = 'ai';
    for (const changed of [setEvidence(evaluated, 'a', `${EVIDENCE}新结论`), updateObjective(evaluated, 'a', 'a-o')]) {
      expect(changed.progress.a.evaluation).toBeUndefined();
      expect(changed.progress.a.verification).toBeUndefined();
    }
    expect(setEvidence(evaluated, 'a', EVIDENCE)).toBe(evaluated);
  });
  it('invalidates a saved AI pass when supplemental evidence changes but preserves original evidence', () => {
    let state = ready(fresh(), 'a');
    state = markSelfChecked(state, 'a');
    state = completeTask(state, 'a', 'self', NOW);
    state = setEvaluation(state, 'a', PASS, 'ai');
    const changed = setSupplementalEvidence(state, 'a', '新增输出结果和解释');
    expect(changed.progress.a.evidence).toBe(EVIDENCE);
    expect(changed.progress.a.evaluation).toBeUndefined();
    expect(changed.progress.a.evaluationSource).toBeUndefined();
    expect(completeTask(changed, 'a', 'ai', NOW)).toBe(changed);
    const reevaluated = setEvaluation(changed, 'a', PASS, 'ai');
    expect(completeTask(reevaluated, 'a', 'ai', NOW).progress.a.verification).toBe('ai');
  });
  it('awards once, creates a next-day review, and protects completed work', () => {
    const state = done(fresh(), 'a');
    expect(state.progress.a.completedAt).toBe('2026-10-13T08:00:00.000Z');
    expect(state.progress.a.verification).toBe('self');
    expect(state.reviews).toEqual([{ taskId: 'a', dueAt: '2026-10-14T08:00:00.000Z', interval: 1, ease: 2.5, repetitions: 0, history: [] }]);
    expect(completeTask(state, 'a', 'self', NOW)).toBe(state);
    expect(activateTask(state, 'a')).toBe(state);
    expect(() => updateObjective(state, 'a', 'a-o')).toThrow();
    expect(() => setEvidence(state, 'a', '新的证据')).toThrow();
    expect(() => setEvaluation(state, 'a', PASS)).not.toThrow();
    expect(getStats(state, NOW)).toMatchObject({ xp: 100, completed: 1, total: 3, slots: 0, due: 0, stageCompleted: [false, false] });
  });
  it('computes nine slots and stage completion from actual completed tasks', () => {
    let state = done(fresh(), 'a');
    state = done(state, 'b');
    expect(getStats(state, NOW)).toMatchObject({ xp: 300, completed: 2, slots: 0, stageCompleted: [true, false] });
    state = done(state, 'c');
    expect(getStats(state, new Date('2026-10-14T08:00:00Z'))).toEqual({ xp: 500, completed: 3, total: 3, slots: 0, due: 3, stageCompleted: [true, true] });
  });
});

describe('transparent simplified review scheduling', () => {
  it('expands successful intervals from one to six days and then by ease', () => {
    let state = done(fresh(), 'a');
    state = rateReview(state, 'a', 3, NOW);
    expect(state.reviews[0]).toMatchObject({ interval: 1, repetitions: 1, ease: 2.5 });
    state = rateReview(state, 'a', 3, new Date('2026-10-14T08:00:00Z'));
    expect(state.reviews[0]).toMatchObject({ interval: 6, repetitions: 2, dueAt: '2026-10-20T08:00:00.000Z' });
    state = rateReview(state, 'a', 3, new Date('2026-10-20T08:00:00Z'));
    expect(state.reviews[0]).toMatchObject({ interval: 15, repetitions: 3, dueAt: '2026-11-04T08:00:00.000Z' });
    expect(state.reviews[0].history.map(h => h.rating)).toEqual([3, 3, 3]);
  });
  it('resets failed recall and bounds ease at 1.3', () => {
    let state = rateReview(rateReview(done(fresh(), 'a'), 'a', 4, NOW), 'a', 4, NOW);
    expect(state.reviews[0].ease).toBeGreaterThan(2.5);
    for (let i = 0; i < 12; i++) state = rateReview(state, 'a', 1, NOW);
    expect(state.reviews[0]).toMatchObject({ interval: 1, repetitions: 0, ease: 1.3, dueAt: '2026-10-14T08:00:00.000Z' });
  });
  it('accepts difficult success but rejects invalid ratings and missing cards', () => {
    const state = done(fresh(), 'a');
    expect(rateReview(state, 'a', 2, NOW).reviews[0]).toMatchObject({ repetitions: 1, ease: 2.35 });
    for (const rating of [0, 5, 1.5, NaN]) expect(() => rateReview(state, 'a', rating, NOW)).toThrow();
    expect(() => rateReview(state, 'b', 3, NOW)).toThrow();
    expect(() => rateReview(state, 'a', 3, new Date('invalid'))).toThrow();
  });
});

describe('schemas and safe state import', () => {
  it('validates the complete beginner NumPy walkthrough against the campaign schema', () => {
    const parsed = campaignSchema.parse(NUMPY_DEMO_CAMPAIGN);
    expect(parsed.nineGrid).toHaveLength(9);
    expect(parsed.stages.every(stage => stage.chains?.some(chain => chain.track === 'main'))).toBe(true);
    expect(parsed.stages.some(stage => stage.chains?.some(chain => chain.track === 'branch'))).toBe(true);
  });
  it('validates sensible input and evaluation ranges and removes extra metadata', () => {
    expect(goalInputSchema.safeParse({ goal: '学 Python', level: '入门', days: 7, dailyMinutes: 30, ultimateReward: '脚本' }).success).toBe(true);
    expect(goalInputSchema.safeParse({ goal: '', level: '入门', days: 0, dailyMinutes: -1, ultimateReward: '' }).success).toBe(false);
    expect(evaluationSchema.safeParse({ ...PASS, score: 101 }).success).toBe(false);
    expect(taskSchema.parse({ ...task('a'), apiKey: 'secret' })).not.toHaveProperty('apiKey');
  });
  it.each(['stage', 'task', 'objective', 'dependency', 'cycle', 'forward', 'unsafe', 'url'])('rejects invalid campaign %s', kind => {
    const campaign = fresh().campaign;
    const a = campaign.stages[0].tasks[0];
    const b = campaign.stages[0].tasks[1];
    if (kind === 'stage') campaign.stages[1].id = 's1';
    if (kind === 'task') b.id = 'a';
    if (kind === 'objective') b.objectives[0].id = 'a-o';
    if (kind === 'dependency') a.prerequisites = ['missing'];
    if (kind === 'cycle') a.prerequisites = ['b'];
    if (kind === 'forward') a.prerequisites = ['c'];
    if (kind === 'unsafe') a.id = '__proto__';
    if (kind === 'url') a.resources[0].url = 'javascript:alert(1)';
    expect(campaignSchema.safeParse(campaign).success).toBe(false);
  });
  it('reports malformed resource addresses as validation failures rather than throwing', () => {
    for (const url of ['not a URL', 'https://[broken', 'https://user:password@example.com/docs']) {
      const candidate = task('a'); candidate.resources[0].url = url;
      expect(taskSchema.safeParse(candidate).success).toBe(false);
    }
  });
  it('round-trips completed work and sanitizes nested metadata and credential fields', () => {
    const state = done(fresh(), 'a');
    state.notes.a = '解释变量绑定';
    const raw = { ...state, apiKey: 'secret', campaign: { ...state.campaign, apiKey: 'secret' }, progress: { ...state.progress, a: { ...state.progress.a, apiKey: 'secret' } } };
    const imported = importState(JSON.stringify(raw));
    expect(exportState(imported)).not.toContain('secret');
    expect(importState(exportState(imported))).toEqual(imported);
    expect(exportState(raw as LearningState)).not.toContain('secret');
  });
  it.each(['json', 'version', 'foreign-progress', 'objective', 'duplicate-objective', 'evidence', 'prerequisite', 'evaluation', 'review', 'duplicate-review', 'missing-review', 'review-history', 'unfinished-review', 'verification', 'date'])('rejects invalid imported state %s', kind => {
    const state = done(fresh(), 'a');
    if (kind === 'json') { expect(() => importState('{broken')).toThrow(); return; }
    if (kind === 'version') (state as unknown as { version: number }).version = 99;
    if (kind === 'foreign-progress') state.progress.foreign = state.progress.a;
    if (kind === 'objective') state.progress.a.completedObjectives = ['b-o'];
    if (kind === 'duplicate-objective') state.progress.a.completedObjectives = ['a-o', 'a-o'];
    if (kind === 'evidence') state.progress.a.evidence = '太短';
    if (kind === 'prerequisite') { state.progress.c = { ...state.progress.a, completedObjectives: ['c-o'] }; state.reviews.push({ ...state.reviews[0], taskId: 'c' }); }
    if (kind === 'evaluation') { state.progress.a.verification = 'ai'; state.progress.a.evaluation = { ...PASS, score: 69 }; }
    if (kind === 'review') state.reviews[0].taskId = 'foreign';
    if (kind === 'duplicate-review') state.reviews.push({ ...state.reviews[0] });
    if (kind === 'missing-review') state.reviews = [];
    if (kind === 'review-history') state.reviews[0].history = [{ at: NOW.toISOString(), rating: 5 }];
    if (kind === 'unfinished-review') state.reviews[0].taskId = 'b';
    if (kind === 'verification') delete state.progress.a.verification;
    if (kind === 'date') state.progress.a.completedAt = 'yesterday';
    expect(learningStateSchema.safeParse(state).success).toBe(false);
    expect(() => importState(JSON.stringify(state))).toThrow();
  });
  it('supports fresh progress records for generated campaigns', () => {
    const state = fresh(); state.progress = {};
    expect(importState(JSON.stringify(state)).progress).toEqual({});
  });
});

describe('demo and browser storage', () => {
  it('isolates browser cache by account and restores each learner profile separately', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } } });
    const first = createInitialState(); first.campaign.title = 'Learner One';
    setStorageScope('user-111'); saveState(first);
    setStorageScope('user-222');
    expect(loadStateSafely().state.campaign.title).not.toBe('Learner One');
    const second = createInitialState(); second.campaign.title = 'Learner Two'; saveState(second);
    setStorageScope('user-111');
    expect(loadState().campaign.title).toBe('Learner One');
  });
  it('starts all twelve demo missions fresh and gives each a useful official reference', () => {
    const state = createInitialState();
    expect(campaignSchema.safeParse(DEMO_CAMPAIGN).success).toBe(true);
    expect(state.campaign.stages.map(s => s.title)).toEqual(['建立前哨', '追踪线索', '实战突破', '终局撤离']);
    expect(getTasks(state.campaign)).toHaveLength(12);
    expect(getTasks(state.campaign)[0].title).toBe('建立前哨：让 Python 回应你');
    expect(getTasks(state.campaign).every(t => t.minutes >= 15 && t.minutes <= 40 && t.resources.every(r => new URL(r.url).hostname === 'docs.python.org'))).toBe(true);
    expect(getStats(state, NOW)).toMatchObject({ completed: 0, xp: 0, slots: 0, due: 0 });
    state.progress[getTasks(state.campaign)[0].id].evidence = '本次尝试';
    expect(createInitialState().progress[getTasks(state.campaign)[0].id].evidence).toBe('');
  });
  it('finishes every demo task in order and remains valid for export', () => {
    let state = createInitialState();
    for (const task of getTasks(state.campaign)) {
      state = activateTask(state, task.id);
      for (const objective of task.objectives) state = updateObjective(state, task.id, objective.id);
      state = completeTask(setEvidence(state, task.id, EVIDENCE), task.id, 'self', NOW);
    }
    expect(getStats(state, NOW)).toMatchObject({ completed: 12, total: 12, slots: 0, stageCompleted: [true, true, true, true] });
    expect(importState(exportState(state))).toEqual(state);
  });
  it('loads and exports safely without a browser', () => {
    vi.stubGlobal('window', undefined);
    expect(loadState().version).toBe(2);
    expect(() => saveState(fresh())).not.toThrow();
  });
  it('preserves damaged stored JSON until an explicit save', () => {
    const data = new Map<string, string>();
    const localStorage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    vi.stubGlobal('window', { localStorage });
    saveState(fresh());
    expect(loadState().campaign).toEqual(fresh().campaign);
    expect(loadState().progress).toEqual(fresh().progress);
    const key = [...data.keys()][0];
    data.set(key, '{damaged original');
    expect(getStats(loadState(), NOW).total).toBe(12);
    expect(data.get(key)).toBe('{damaged original');
    const invalid = fresh(); invalid.progress.foreign = invalid.progress.a;
    expect(() => saveState(invalid)).toThrow();
    expect(data.get(key)).toBe('{damaged original');
    saveState(fresh());
    expect(loadState().campaign).toEqual(fresh().campaign);
    expect(loadState().progress).toEqual(fresh().progress);
  });
  it('recovers reads when browser storage access is blocked', () => {
    vi.stubGlobal('window', { get localStorage() { throw new Error('blocked'); } });
    expect(loadState().version).toBe(2);
    expect(() => saveState(fresh())).toThrow();
  });
});

describe('course branches, schedules, rewards, and multiple campaigns', () => {
  it('initializes progress for every generated mission through one factory', () => {
    const campaign = fresh().campaign;
    const progress = createProgressForCampaign(campaign);
    expect(Object.keys(progress)).toHaveLength(3);
    expect(progress.a).toEqual({ completedObjectives: [], evidence: '', status: 'idle' });
  });
  it('lets optional branches unlock from a mainline node without blocking the next phase', () => {
    let state = fresh();
    const [a, b] = state.campaign.stages[0].tasks;
    const branch = task('branch', ['a']); branch.track = 'branch'; branch.chainId = 'explore';
    state.campaign.stages[0].tasks.push(branch);
    state.progress.branch = { completedObjectives: [], evidence: '', status: 'idle' };
    state.campaign.stages[0].mainlineTaskIds = ['a', 'b'];
    state.campaign.stages[0].chains = [{ id: 'main-chain', title: '主线', track: 'main', taskIds: ['a', 'b'] }, { id: 'explore', title: '应用支线', track: 'branch', taskIds: ['branch'] }];
    state.campaign.stages[1].tasks[0].prerequisites = ['b'];
    state = done(state, 'a');
    expect(isTaskUnlocked(state.campaign, state.progress, 'branch')).toBe(true);
    expect(isTaskUnlocked(state.campaign, state.progress, 'c')).toBe(false);
    state = done(state, 'b');
    expect(isTaskUnlocked(state.campaign, state.progress, 'c')).toBe(true);
    expect(state.progress.branch.status).toBe('idle');
  });
  it('does not reactivate or mutate an already completed task', () => {
    const completed = done(fresh(), 'a');
    expect(activateTask(completed, 'a')).toBe(completed);
  });
  it('awards deterministic mission, wallet and item rewards exactly once', () => {
    const first = done(fresh(), 'a');
    const again = completeTask(first, 'a', 'self', NOW);
    expect(first.rewardLedger).toHaveLength(1);
    expect(first.wallet?.balance).toBeGreaterThan(0);
    expect(again.rewardLedger).toEqual(first.rewardLedger);
    expect(again.wallet).toEqual(first.wallet);
  });
  it('does not re-award a completed chain or stage when a later branch is finished', () => {
    let state = fresh();
    const branch = task('branch', ['b']); branch.track = 'branch';
    state.campaign.stages[0].tasks.push(branch);
    state.progress.branch = { completedObjectives: [], evidence: '', status: 'idle' };
    state.campaign.stages[0].mainlineTaskIds = ['a', 'b'];
    state.campaign.stages[0].chains = [
      { id: 'main-chain', title: '主线链路', track: 'main', taskIds: ['a', 'b'] },
      { id: 'branch-chain', title: '支线链路', track: 'branch', taskIds: ['branch'] },
    ];
    state = done(state, 'a'); state = done(state, 'b');
    const stageAndMainChain = state.rewardLedger?.filter(entry => entry.kind === 'stage' || entry.kind === 'chain');
    state = done(state, 'branch');
    expect(state.rewardLedger?.filter(entry => entry.kind === 'stage' || entry.kind === 'chain').filter(entry => entry.idempotencyKey.includes('main-chain') || entry.kind === 'stage')).toHaveLength(2);
    expect(state.rewardLedger?.filter(entry => entry.kind === 'stage')).toHaveLength(1);
    expect(state.rewardLedger?.filter(entry => entry.kind === 'chain' && entry.idempotencyKey.includes('main-chain'))).toHaveLength(1);
    expect(stageAndMainChain?.every(entry => state.rewardLedger?.some(next => next.id === entry.id))).toBe(true);
  });
  it('does not grant chain or stage items from self-reported diagnosis completion', () => {
    let state = fresh();
    state.campaign.stages[0].chains = [{ id: 'main-chain', title: '主线链路', track: 'main', taskIds: ['a', 'b'], completionReward: { xp: 50, coins: 10, items: [{ itemId: 'chain-relic', name: '链路收藏品', description: '仅保存验收证据。', rarity: 'legendary', icon: '⬡', quantity: 1 }] } }];
    state.campaign.stages[0].mainlineTaskIds = ['a', 'b'];
    state.campaign.stages[0].reward = { xp: 80, coins: 10, items: [{ itemId: 'stage-relic', name: '阶段收藏品', description: '阶段挑战奖励。', rarity: 'rare', icon: '✦', quantity: 1 }] };
    state = done(done(state, 'a'), 'b');
    expect(state.rewardLedger?.filter(entry => entry.kind === 'chain' || entry.kind === 'stage').every(entry => entry.reward.items.length === 0)).toBe(true);
    expect(state.inventory?.['chain-relic']).toBeUndefined();
    expect(state.inventory?.['stage-relic']).toBeUndefined();
  });
  it('migrates older reward claims to owner-scoped keys before a later branch can trigger them', () => {
    let state = fresh();
    const branch = task('branch', ['b']); branch.track = 'branch';
    state.campaign.stages[0].tasks.push(branch);
    state.progress.branch = { completedObjectives: [], evidence: '', status: 'idle' };
    state.campaign.stages[0].mainlineTaskIds = ['a', 'b'];
    state.campaign.stages[0].chains = [{ id: 'main-chain', title: '主线链路', track: 'main', taskIds: ['a', 'b'] }];
    state = done(done(state, 'a'), 'b');
    const legacy = JSON.parse(JSON.stringify(state)) as LearningState;
    for (const entry of legacy.rewardLedger ?? []) {
      entry.campaignId = 'legacy-unknown';
      if (entry.kind === 'chain') entry.idempotencyKey = `test-main-chain-${entry.taskId}-chain`;
      else if (entry.kind === 'stage') entry.idempotencyKey = `test-s1-${entry.taskId}-stage`;
      else if (entry.kind === 'mission') entry.idempotencyKey = `test-${entry.taskId}-${entry.taskId}-mission`;
    }
    state = importState(JSON.stringify(legacy));
    expect(state.rewardLedger?.filter(entry => entry.kind === 'stage')).toHaveLength(1);
    expect(state.rewardLedger?.filter(entry => entry.kind === 'chain')).toHaveLength(1);
    state = done(state, 'branch');
    expect(state.rewardLedger?.filter(entry => entry.kind === 'stage')).toHaveLength(1);
    expect(state.rewardLedger?.filter(entry => entry.kind === 'chain' && entry.idempotencyKey.includes('main-chain'))).toHaveLength(1);
  });
  it('promotes a self-completed task to AI verified without repeating base rewards', () => {
    let state = fresh();
    state.campaign.stages[0].tasks[0].kind = 'boss';
    state.campaign.nineGrid = Array.from({ length: 9 }, (_, index) => ({ id: index === 0 ? 'grid-a' : `grid-${index}`, title: `格${index + 1}`, ability: '解释', value: '作品', unlockTaskIds: ['a'] }));
    state = ready(state, 'a'); state = markSelfChecked(state, 'a'); state = completeTask(state, 'a', 'self', NOW);
    const baseLedger = state.rewardLedger;
    state = setEvaluation(state, 'a', PASS, 'ai'); state = completeTask(state, 'a', 'ai', NOW);
    expect(state.progress.a).toMatchObject({ status: 'completed', verification: 'ai', completedAt: NOW.toISOString() });
    expect(state.rewardLedger?.filter(entry => entry.kind === 'mission')).toHaveLength(1);
    expect(state.rewardLedger?.find(entry => entry.kind === 'mission')?.reward).toEqual(baseLedger?.[0].reward);
    expect(state.rewardLedger?.filter(entry => entry.kind === 'verification')).toHaveLength(1);
    expect(state.rewardLedger?.find(entry => entry.kind === 'verification')?.reward).toMatchObject({ xp: 0, coins: 0, items: [{ itemId: 'a-field-notes' }] });
    expect(() => recordGridOutcome(state, 'grid-a', EVIDENCE, NOW)).not.toThrow();
    expect(() => exportState(state)).not.toThrow();
    const repeat = completeTask(state, 'a', 'ai', NOW);
    expect(repeat.rewardLedger).toEqual(state.rewardLedger);
    expect(repeat.wallet).toEqual(state.wallet);
  });
  it('keeps review answers and hint use as review evidence', () => {
    const state = done(fresh(), 'a');
    const reviewed = rateReview(state, 'a', 2, NOW, { answer: 'ndarray shape describes dimensions', hintUsed: true });
    expect(reviewed.reviews[0].history[0]).toMatchObject({ answer: 'ndarray shape describes dimensions', hintUsed: true });
  });
  it('fits required recall and mainline work inside the user time budget', () => {
    const campaign = fresh().campaign;
    campaign.dailyMinutes = 18;
    const schedule = buildDailySchedule(campaign, fresh().progress, [], '2026-10-13');
    expect(schedule.totalMinutes).toBeLessThanOrEqual(18);
    expect(schedule.items.some(item => item.required)).toBe(true);
  });
  it('switches between archived learning goals without losing progress', () => {
    const original = done(fresh(), 'a');
    const second = structuredClone(original.campaign); second.id = 'second'; second.goal = '第二条学习路线';
    const switched = switchCampaign(original, second);
    expect(switched.campaign.id).toBe('second');
    expect(switched.progress.a.status).toBe('idle');
    const restored = switchCampaign(switched, original.campaign);
    expect(restored.progress.a.status).toBe('completed');
    expect(restored.history?.some(record => record.campaign.id === 'second')).toBe(true);
  });
  it('isolates attempts, teaching history, grid outcomes and adjustments across goals through save/export', () => {
    const lesson: LessonContent = { purpose: '识别结构', explanation: 'shape describes dimensions.', terms: [{ en: 'shape', zh: '形状', context: 'array dimensions' }], example: { prompt: '预测维度', code: 'x.shape', walkthrough: '比较输出' }, guidedPractice: { prompt: '预测', expected: '(2,)', hint: '看长度' }, challenge: { prompt: '独立验证', acceptance: '说明输出', hints: ['检查 axis'] }, language: 'mixed', generatedAt: NOW.toISOString(), revision: 1 };
    let original = ready(fresh(), 'a');
    original = markSelfChecked(original, 'a');
    original = recordAttempt(original, 'a', { answer: EVIDENCE, hintLevelsUsed: 1, verification: 'self', passed: false, feedback: '自评記錄' }, NOW);
    original = cacheLesson(original, 'a', lesson);
    original = cacheLesson(original, 'a', { ...lesson, revision: 2 }, true);
    original.campaign.nineGrid = Array.from({ length: 9 }, (_, index) => ({ id: index === 0 ? 'grid-a' : `grid-${index}`, title: `格${index + 1}`, ability: '解释', value: '作品', unlockTaskIds: ['a'] }));
    original = completeTask(original, 'a', 'self', NOW);
    original = setEvaluation(original, 'a', PASS, 'ai');
    original = completeTask(original, 'a', 'ai', NOW);
    original = recordGridOutcome(original, 'grid-a', EVIDENCE, NOW);
    original.dailyAdjustments = { '2026-10-13': 'too-hard' };
    original.knownTasks = { a: true };
    const second = structuredClone(original.campaign); second.id = 'second'; second.goal = '第二条路线';
    let switched = switchCampaign(original, second);
    expect(switched.attempts).toEqual({}); expect(switched.contentHistory).toEqual({}); expect(switched.gridOutcomes).toEqual({}); expect(switched.dailyAdjustments).toEqual({}); expect(switched.knownTasks).toEqual({});
    switched = importState(exportState(switched));
    const saved = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) } });
    saveState(switched);
    switched = loadState();
    const restored = switchCampaign(switched, original.campaign);
    expect(restored.attempts?.a).toHaveLength(1);
    expect(restored.contentHistory?.a).toHaveLength(1);
    expect(restored.gridOutcomes?.['grid-a']?.artifact).toBe(EVIDENCE);
    expect(restored.dailyAdjustments).toEqual({ '2026-10-13': 'too-hard' });
    expect(restored.knownTasks).toEqual({ a: true });
    expect(importState(exportState(restored))).toEqual(restored);
  });
  it('returns save failures as a result the UI can surface', () => {
    vi.stubGlobal('window', { get localStorage() { throw new Error('blocked'); } });
    expect(saveStateSafely(fresh()).ok).toBe(false);
  });
});
