import type { Campaign, CampaignSnapshot, DailySchedule, Evaluation, LearningState, LessonContent, RewardBundle, Task, TaskAttempt, TaskProgress } from '../../shared/types';
import { evaluationSchema, lessonContentSchema } from '../../shared/schema';
import { BRANCH_CHAIN_COMPLETION_COINS, chainCompletionCoins, EFFECTIVE_REVIEW_COINS, LEARNING_COIN_RATE_PER_MINUTE, STAGE_COMPLETION_COINS, VERIFIED_SEASON_COMPLETION_COINS } from '../../shared/economy';

export function getTasks(campaign: Campaign): Task[] { return campaign.stages.flatMap(stage => stage.tasks); }

function stageGateIds(stage: Campaign['stages'][number]): string[] {
  if (stage.gateTaskIds) return stage.gateTaskIds;
  return stage.mainlineTaskIds ?? stage.tasks.filter(task => (task.track ?? 'main') === 'main').map(task => task.id);
}

export function getRewardIdempotencyKey(campaignId: string, kind: 'mission' | 'verification' | 'chain' | 'stage' | 'season', ownerId: string): string {
  const scope = kind === 'mission' || kind === 'verification' ? `task-${ownerId}` : kind === 'chain' ? `chain-${ownerId}` : kind === 'stage' ? `stage-${ownerId}` : 'season';
  const rawKey = `campaign-${campaignId}-${scope}-${kind}`.replace(/[^\p{L}\p{N}_-]/gu, '-');
  let hash = 2166136261;
  for (const char of rawKey) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  return `${rawKey.slice(0, 106)}-${(hash >>> 0).toString(36)}`;
}

export function createProgressForCampaign(campaign: Campaign): LearningState['progress'] {
  return Object.fromEntries(getTasks(campaign).map(task => [task.id, { completedObjectives: [], evidence: '', status: 'idle' as const }]));
}

export function isTaskUnlocked(campaign: Campaign, progress: LearningState['progress'], taskId: string): boolean {
  const stageIndex = campaign.stages.findIndex(stage => stage.tasks.some(task => task.id === taskId));
  if (stageIndex < 0) return false;
  const task = campaign.stages[stageIndex].tasks.find(task => task.id === taskId)!;
  const completed = (id: string) => Object.hasOwn(progress, id) && progress[id].status === 'completed';
  return campaign.stages.slice(0, stageIndex).every(stage => stageGateIds(stage).every(completed))
    && [...task.prerequisites, ...(task.unlockAfter ?? [])].every(completed);
}

export function buildDailySchedule(campaign: Campaign, progress: LearningState['progress'], reviews: LearningState['reviews'], date: string, adjustment?: 'half' | 'more' | 'skip-known' | 'too-hard'): DailySchedule {
  const budget = Math.max(1, Math.floor(campaign.dailyMinutes * (adjustment === 'half' ? 0.5 : adjustment === 'more' ? 1.5 : 1)));
  const due = reviews.filter(card => Date.parse(card.dueAt) <= Date.parse(`${date}T23:59:59.999Z`));
  const reviewIds = new Set(due.map(card => card.taskId));
  const tasks = getTasks(campaign);
  const ready = tasks.filter(task => progress[task.id]?.status !== 'completed' && isTaskUnlocked(campaign, progress, task.id));
  const core = ready.filter(task => (task.track ?? 'main') === 'main');
  const branches = ready.filter(task => (task.track ?? 'main') === 'branch');
  const items: DailySchedule['items'] = [];
  let remaining = budget;
  for (const card of due) {
    if (remaining <= 0) break;
    const task = tasks.find(item => item.id === card.taskId);
    const minutes = Math.min(remaining, Math.max(3, Math.min(8, Math.ceil(budget * 0.15))));
    items.push({ taskId: card.taskId, kind: 'review', minutes, required: true, deliverable: `闭卷回答：${task?.recallQuestion ?? '写下记得的关键概念，再核对'}` }); remaining -= minutes;
  }
  const focus = core[0];
  if (focus && remaining > 0) {
    const focusMinutes = Math.min(remaining, focus.minutes);
    const lessonMinutes = Math.max(1, Math.floor(focusMinutes * 0.4));
    const practiceMinutes = focusMinutes - lessonMinutes;
    items.push({ taskId: focus.id, kind: 'lesson', minutes: lessonMinutes, required: true, deliverable: `学习并记录：${focus.title}` });
    if (practiceMinutes > 0) items.push({ taskId: focus.id, kind: 'practice', minutes: practiceMinutes, required: true, deliverable: focus.acceptance });
    remaining -= focusMinutes;
  }
  if (adjustment !== 'half' && adjustment !== 'too-hard' && adjustment !== 'skip-known' && remaining > 0 && branches.length) {
    const branch = branches[0]; const minutes = Math.min(remaining, branch.minutes);
    items.push({ taskId: branch.id, kind: 'practice', minutes, required: false, deliverable: branch.acceptance }); remaining -= minutes;
  }
  if (items.length === 0 && reviewIds.size === 0 && core[0] && budget > 0) items.push({ taskId: core[0].id, kind: 'lesson', minutes: Math.min(budget, core[0].minutes), required: true, deliverable: core[0].acceptance });
  const totalMinutes = items.reduce((sum, item) => sum + item.minutes, 0);
  return { date, theme: focus?.title ?? (due.length ? '间隔复习：先回忆，再核对' : '行动线已完成，选择一条支线探索'), items, totalMinutes, outcome: focus?.acceptance ?? '独立复述本阶段产出与仍待验证的问题。', nextUnlock: focus ? `完成「${focus.title}」后检查下一主线节点` : '查看下一阶段解锁条件', revision: 1 };
}

export function getTaskReward(task: Task): RewardBundle {
  const item = task.kind === 'boss' ? [{ itemId: `${task.id}-field-notes`, name: '验证记录徽记', description: '完成综合任务后获得的原创学习收藏品。', rarity: 'rare' as const, icon: '✦', quantity: 1 }] : [];
  return { xp: task.xp, coins: Math.floor(task.minutes * LEARNING_COIN_RATE_PER_MINUTE), items: task.reward?.items ?? item };
}

function applyReward(state: LearningState, task: Task, reward: RewardBundle, kind: 'mission' | 'verification' | 'chain' | 'stage' | 'season', now: Date, ownerId = task.id): LearningState {
  const idempotencyKey = getRewardIdempotencyKey(state.campaign.id, kind, kind === 'mission' || kind === 'verification' ? task.id : ownerId);
  if ((state.rewardLedger ?? []).some(entry => entry.idempotencyKey === idempotencyKey)) return state;
  const entry = { id: `reward-${idempotencyKey}`.slice(0, 128), campaignId: state.campaign.id, taskId: task.id, at: timestamp(now), reward, kind, idempotencyKey };
  const inventory = { ...(state.inventory ?? {}) };
  for (const item of reward.items) {
    const owned = inventory[item.itemId];
    inventory[item.itemId] = { item, quantity: (owned?.quantity ?? 0) + item.quantity, acquiredAt: owned?.acquiredAt ?? entry.at, sources: [...(owned?.sources ?? []), entry.id] };
  }
  return { ...state, wallet: { currency: 'learning-coin', balance: (state.wallet?.balance ?? 0) + reward.coins }, inventory,
    rewardLedger: [...(state.rewardLedger ?? []), entry] };
}

export function switchCampaign(state: LearningState, campaign: Campaign): LearningState {
  const snapshot: CampaignSnapshot = { campaign: state.campaign, progress: state.progress, reviews: state.reviews, notes: state.notes, content: state.content, schedules: state.schedules, attempts: state.attempts, contentHistory: state.contentHistory, gridOutcomes: state.gridOutcomes, dailyAdjustments: state.dailyAdjustments, knownTasks: state.knownTasks, lastTaskId: state.lastTaskId };
  const existing = state.history?.find(item => item.campaign.id === campaign.id);
  const history = [...(state.history ?? []).filter(item => item.campaign.id !== campaign.id && item.campaign.id !== state.campaign.id), snapshot];
  if (existing) return { ...state, ...existing, attempts: existing.attempts ?? {}, contentHistory: existing.contentHistory ?? {}, gridOutcomes: existing.gridOutcomes ?? {}, dailyAdjustments: existing.dailyAdjustments ?? {}, knownTasks: existing.knownTasks ?? {}, version: 2, history };
  const seeded = Object.fromEntries(getTasks(campaign).filter(task => task.teaching).map(task => [task.id, task.teaching!]));
  return { ...state, campaign, progress: createProgressForCampaign(campaign), reviews: [], notes: {}, content: seeded, contentHistory: {}, attempts: {}, gridOutcomes: {}, dailyAdjustments: {}, knownTasks: {}, schedules: {}, version: 2, history };
}

export function cacheLesson(state: LearningState, taskId: string, value: LessonContent, regenerate = false): LearningState {
  const task = getTasks(state.campaign).find(item => item.id === taskId);
  if (!task) throw new Error('任务不存在');
  const lesson = lessonContentSchema.parse(value);
  const current = state.content?.[taskId] ?? task.teaching;
  if (current && !regenerate) return state;
  return { ...state, content: { ...(state.content ?? {}), [taskId]: lesson }, contentHistory: { ...(state.contentHistory ?? {}), ...(current ? { [taskId]: [...(state.contentHistory?.[taskId] ?? []), current] } : {}) } };
}

export function recordAttempt(state: LearningState, taskId: string, attempt: Omit<TaskAttempt, 'at'>, now = new Date()): LearningState {
  taskAndProgress(state, taskId);
  if (!Number.isInteger(attempt.hintLevelsUsed) || attempt.hintLevelsUsed < 0 || attempt.hintLevelsUsed > 5) throw new Error('提示使用级别无效');
  return { ...state, attempts: { ...(state.attempts ?? {}), [taskId]: [...(state.attempts?.[taskId] ?? []), { ...attempt, at: timestamp(now) }] } };
}

export function recordGridOutcome(state: LearningState, gridId: string, artifact: string, now = new Date()): LearningState {
  const grid = state.campaign.nineGrid?.find(item => item.id === gridId);
  if (!grid) throw new Error('九格成果不存在');
  if (Array.from(artifact.trim()).length < 20) throw new Error('请提交至少 20 字的作品或验证记录');
  const verified = grid.unlockTaskIds.every(id => state.progress[id]?.status === 'completed' && state.progress[id]?.verification === 'ai');
  if (!verified) throw new Error('对应能力链尚未全部通过 AI 验证');
  return { ...state, gridOutcomes: { ...(state.gridOutcomes ?? {}), [gridId]: { artifact, verifiedAt: timestamp(now), taskIds: grid.unlockTaskIds } } };
}

function taskAndProgress(state: LearningState, id: string): [Task, TaskProgress] {
  const task = getTasks(state.campaign).find(task => task.id === id);
  if (!task) throw new Error('任务不存在');
  return [task, Object.hasOwn(state.progress, id) ? state.progress[id] : { completedObjectives: [], evidence: '', status: 'idle' }];
}
function replaceProgress(state: LearningState, id: string, progress: TaskProgress): LearningState {
  return { ...state, progress: { ...state.progress, [id]: progress } };
}
function assertEditable(progress: TaskProgress): void {
  if (progress.status === 'completed') throw new Error('已完成任务的证据与目标已归档，不能修改');
}
function clearEvaluation(progress: TaskProgress): TaskProgress {
  const { evaluation: _evaluation, verification: _verification, completedAt: _completedAt, selfChecked: _selfChecked, evaluationSource: _evaluationSource, evaluationEvidence: _evaluationEvidence, ...rest } = progress;
  return rest;
}
function evaluationMatchesCurrentEvidence(progress: TaskProgress): boolean {
  const current = [progress.evidence, progress.supplementalEvidence?.trim() ? `补充证据：\n${progress.supplementalEvidence}` : ''].filter(Boolean).join('\n\n');
  return progress.evaluationEvidence === current;
}
function timestamp(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new Error('时间无效');
  return now.toISOString();
}
// A scheduling day is exactly 24 hours, independent of timezone and DST changes.
function dueAfter(now: Date, days: number): string {
  timestamp(now);
  return new Date(now.getTime() + days * 86400000).toISOString();
}

export function activateTask(state: LearningState, taskId: string): LearningState {
  const [, progress] = taskAndProgress(state, taskId);
  if (progress.status === 'completed' || progress.status === 'active') return state;
  // Selecting a mission is allowed before unlocking it; completion is gated.
  return replaceProgress(state, taskId, { ...progress, status: 'active' });
}

export function updateObjective(state: LearningState, taskId: string, objectiveId: string): LearningState {
  const [task, progress] = taskAndProgress(state, taskId);
  assertEditable(progress);
  if (!task.objectives.some(objective => objective.id === objectiveId)) throw new Error('目标不属于当前任务');
  const completedObjectives = progress.completedObjectives.includes(objectiveId)
    ? progress.completedObjectives.filter(id => id !== objectiveId) : [...progress.completedObjectives, objectiveId];
  return replaceProgress(state, taskId, { ...clearEvaluation(progress), completedObjectives });
}

export function setEvidence(state: LearningState, taskId: string, evidence: string): LearningState {
  const [, progress] = taskAndProgress(state, taskId);
  if (typeof evidence !== 'string' || evidence.length > 100000) throw new Error('证据必须是有效文本且不超过 100000 字符');
  if (progress.evidence === evidence) return state;
  assertEditable(progress);
  return replaceProgress(state, taskId, { ...clearEvaluation(progress), evidence });
}

export function setSupplementalEvidence(state: LearningState, taskId: string, evidence: string): LearningState {
  const [, progress] = taskAndProgress(state, taskId);
  if (progress.status !== 'completed' || progress.verification !== 'self') throw new Error('只有自行完成且尚未通过 AI 的任务可以补充证据');
  if (typeof evidence !== 'string' || evidence.length > 100000) throw new Error('补充证据必须是有效文本且不超过 100000 字符');
  if (progress.supplementalEvidence === evidence) return state;
  const { evaluation: _evaluation, evaluationSource: _evaluationSource, evaluationEvidence: _evaluationEvidence, ...rest } = progress;
  return replaceProgress(state, taskId, { ...rest, supplementalEvidence: evidence });
}

export function setEvaluation(state: LearningState, taskId: string, evaluation: Evaluation, source: 'self' | 'ai' = 'ai'): LearningState {
  const [, progress] = taskAndProgress(state, taskId);
  if (progress.status === 'completed' && !(source === 'ai' && progress.verification === 'self')) assertEditable(progress);
  if (progress.status === 'completed' && source !== 'ai') throw new Error('已自行完成的任务只能追加 AI 核验');
  const evidence = [progress.evidence, progress.supplementalEvidence?.trim() ? `补充证据：\n${progress.supplementalEvidence}` : ''].filter(Boolean).join('\n\n');
  if (progress.status === 'completed') return replaceProgress(state, taskId, { ...progress, evaluation: evaluationSchema.parse(evaluation), evaluationSource: source, evaluationEvidence: evidence });
  return replaceProgress(state, taskId, { ...clearEvaluation(progress), evaluation: evaluationSchema.parse(evaluation), evaluationSource: source, evaluationEvidence: evidence });
}

export function markSelfChecked(state: LearningState, taskId: string): LearningState {
  const [, progress] = taskAndProgress(state, taskId);
  assertEditable(progress);
  if (progress.evidence.trim().length < 20) throw new Error('提交至少 20 个字符的答案或成果后再做自我检查');
  const { evaluation: _evaluation, verification: _verification, ...rest } = progress;
  return replaceProgress(state, taskId, { ...rest, selfChecked: true });
}

export function completeTask(state: LearningState, taskId: string, verification: 'self' | 'ai', now = new Date()): LearningState {
  const [task, progress] = taskAndProgress(state, taskId);
  if (progress.status === 'completed') {
    if (progress.verification !== 'self' || verification !== 'ai' || !progress.evaluation?.passed || progress.evaluation.score < 70 || progress.evaluationSource !== 'ai' || !evaluationMatchesCurrentEvidence(progress)) return state;
    let promoted = replaceProgress(state, taskId, { ...progress, verification: 'ai' });
    const verificationItems = getTaskReward(task).items;
    if (verificationItems.length) promoted = applyReward(promoted, task, { xp: 0, coins: 0, items: verificationItems }, 'verification', now);
    const ids = new Set(getTasks(promoted.campaign).filter(item => promoted.progress[item.id]?.status === 'completed').map(item => item.id));
    const ownerStage=promoted.campaign.stages.find(stage=>stage.tasks.some(item=>item.id===taskId));
    if(ownerStage){
      for(const chain of ownerStage.chains??[]) if(chain.taskIds.every(id=>ids.has(id)&&promoted.progress[id]?.verification==='ai')&&chain.completionReward?.items.length){promoted=applyReward(promoted,task,{xp:0,coins:0,items:chain.completionReward.items},'verification',now,`chain-${chain.id}`);}
      if(stageGateIds(ownerStage).every(id=>ids.has(id)&&promoted.progress[id]?.verification==='ai')&&ownerStage.reward?.items.length)promoted=applyReward(promoted,task,{xp:0,coins:0,items:ownerStage.reward.items},'verification',now,`stage-${ownerStage.id}`);
    }
    const allMainlineAiVerified = promoted.campaign.stages.every(stage => stageGateIds(stage).every(id => ids.has(id) && promoted.progress[id]?.verification === 'ai'));
    if (allMainlineAiVerified) promoted = applyReward(promoted, task, { xp: 500, coins: VERIFIED_SEASON_COMPLETION_COINS, items: [] }, 'season', now, promoted.campaign.id);
    return promoted;
  }
  if (verification !== 'self' && verification !== 'ai') throw new Error('验收方式无效');
  if (!isTaskUnlocked(state.campaign, state.progress, taskId)) throw new Error('请先完成前置任务与前一阶段');
  if (Array.from(progress.evidence.trim()).length < 20) throw new Error('请提交至少 20 个字符的行动证据');
  if (verification === 'ai' && (!progress.evaluation?.passed || progress.evaluation.score < 70 || progress.evaluationSource !== 'ai' || !evaluationMatchesCurrentEvidence(progress))) throw new Error('AI 验收未通过，需达到 70 分且评价必须对应当前证据');
  const completedAt = timestamp(now);
  const stageIndex = state.campaign.stages.findIndex(stage => stage.tasks.some(item => item.id === taskId));
  const required = [...state.campaign.stages.slice(0, stageIndex).flatMap(stageGateIds), ...task.prerequisites, ...(task.unlockAfter ?? [])];
  if (required.some(id => Date.parse(state.progress[id]?.completedAt ?? '') > now.getTime())) {
    throw new Error('完成时间不能早于前置任务，请检查设备时间');
  }
  const next = replaceProgress(state, taskId, { ...progress, status: 'completed', verification, completedAt });
  let rewarded: LearningState = { ...next, reviews: [...state.reviews.filter(card => card.taskId !== taskId), {
    taskId, dueAt: dueAfter(now, 1), interval: 1, ease: 2.5, repetitions: 0, history: [],
  }], version: 2 };
  const missionReward = getTaskReward(task);
  rewarded = applyReward(rewarded, task, { ...missionReward, items: verification === 'ai' ? missionReward.items : [] }, 'mission', now);
  const completedIds = new Set(getTasks(rewarded.campaign).filter(item => rewarded.progress[item.id]?.status === 'completed').map(item => item.id));
  const stage = rewarded.campaign.stages[stageIndex];
  for (const chain of stage.chains ?? []) if (chain.taskIds.every(id => completedIds.has(id))) {
    const primaryMainChain = stage.chains?.find(item => item.track === 'main')?.id;
    const chainReward = { ...(chain.completionReward ?? { xp: Math.max(10, chain.taskIds.length * 20), coins: 0, items: [] }), coins: chain.track === 'main' && chain.id === primaryMainChain ? chainCompletionCoins(chain.track) : BRANCH_CHAIN_COMPLETION_COINS };
    const independentlyVerified = chain.taskIds.every(id => rewarded.progress[id]?.verification === 'ai');
    rewarded = applyReward(rewarded, task, { ...chainReward, items: independentlyVerified ? chainReward.items : [] }, 'chain', now, chain.id);
  }
  if (stageGateIds(stage).every(id => completedIds.has(id))) {
    const stageReward = { ...(stage.reward ?? { xp: 100, coins: 0, items: [] }), coins: STAGE_COMPLETION_COINS };
    const independentlyVerified = stageGateIds(stage).every(id => rewarded.progress[id]?.verification === 'ai');
    rewarded = applyReward(rewarded, task, { ...stageReward, items: independentlyVerified ? stageReward.items : [] }, 'stage', now, stage.id);
  }
  const allMainlineAiVerified = rewarded.campaign.stages.every(item => stageGateIds(item).every(id => completedIds.has(id) && rewarded.progress[id]?.verification === 'ai'));
  if (allMainlineAiVerified) rewarded = applyReward(rewarded, task, { xp: 500, coins: VERIFIED_SEASON_COMPLETION_COINS, items: [] }, 'season', now, rewarded.campaign.id);
  return rewarded;
}

export function getStats(state: LearningState, now = new Date()): {
  xp: number; completed: number; total: number; slots: number; due: number; stageCompleted: boolean[];
} {
  const tasks = getTasks(state.campaign);
  const completedTasks = tasks.filter(task => state.progress[task.id]?.status === 'completed');
  const completed = completedTasks.length;
  const total = tasks.length;
  return {
    xp: state.rewardLedger?.length ? state.rewardLedger.reduce((sum, entry) => sum + entry.reward.xp, 0) : completedTasks.reduce((sum, task) => sum + task.xp, 0), completed, total,
    slots: state.campaign.nineGrid?.filter(grid => Boolean(state.gridOutcomes?.[grid.id]) && grid.unlockTaskIds.every(id => state.progress[id]?.status === 'completed')).length ?? 0,
    due: state.reviews.filter(card => state.progress[card.taskId]?.status === 'completed' && Date.parse(card.dueAt) <= now.getTime()).length,
    stageCompleted: state.campaign.stages.map(stage => stageGateIds(stage).length > 0 && stageGateIds(stage).every(id => state.progress[id]?.status === 'completed')),
  };
}

export function rateReview(state: LearningState, taskId: string, rating: number, now = new Date(), response: { answer?: string; hintUsed?: boolean } = {}): LearningState {
  if (!Number.isInteger(rating) || rating < 1 || rating > 4) throw new Error('复习评分必须是 1 到 4 的整数');
  const [, progress] = taskAndProgress(state, taskId);
  const card = state.reviews.find(card => card.taskId === taskId);
  if (!card || progress.status !== 'completed') throw new Error('此任务还没有可复习的卡片');
  const at = timestamp(now);
  const lastAt = card.history.at(-1)?.at ?? progress.completedAt;
  if (lastAt && now.getTime() < Date.parse(lastAt)) throw new Error('复习时间不能早于任务完成或上次复习');
  // 1=forgot, 2=hard, 3=good, 4=easy. Failure resets; success uses 1, 6,
  // then previous interval × ease. Ease adjustments are intentionally explicit.
  const adjustments = [-0.2, -0.15, 0, 0.15];
  const ease = Math.min(5, Math.max(1.3, Math.round((card.ease + adjustments[rating - 1]) * 100) / 100));
  const repetitions = rating === 1 ? 0 : card.repetitions + 1;
  const interval = rating === 1 || repetitions === 1 ? 1 : repetitions === 2 ? 6
    : Math.min(36500, Math.max(card.interval + 1, Math.round(card.interval * ease)));
  const updated = { ...card, interval, ease, repetitions, dueAt: dueAfter(now, interval), history: [...card.history, { at, rating, ...(response.answer !== undefined ? { answer: response.answer.slice(0, 10000) } : {}), ...(response.hintUsed !== undefined ? { hintUsed: response.hintUsed } : {}) }] };
  return { ...state, reviews: state.reviews.map(card => card.taskId === taskId ? updated : card) };
}
