import type { Campaign, Evaluation, LearningState, Task, TaskProgress } from '../../shared/types';
import { evaluationSchema } from '../../shared/schema';

export function getTasks(campaign: Campaign): Task[] { return campaign.stages.flatMap(stage => stage.tasks); }

export function isTaskUnlocked(campaign: Campaign, progress: LearningState['progress'], taskId: string): boolean {
  const stageIndex = campaign.stages.findIndex(stage => stage.tasks.some(task => task.id === taskId));
  if (stageIndex < 0) return false;
  const task = campaign.stages[stageIndex].tasks.find(task => task.id === taskId)!;
  const completed = (id: string) => Object.hasOwn(progress, id) && progress[id].status === 'completed';
  return campaign.stages.slice(0, stageIndex).every(stage => stage.tasks.every(item => completed(item.id)))
    && task.prerequisites.every(completed);
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
  const { evaluation: _evaluation, verification: _verification, completedAt: _completedAt, ...rest } = progress;
  return rest;
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

export function setEvaluation(state: LearningState, taskId: string, evaluation: Evaluation): LearningState {
  const [, progress] = taskAndProgress(state, taskId);
  assertEditable(progress);
  return replaceProgress(state, taskId, { ...clearEvaluation(progress), evaluation: evaluationSchema.parse(evaluation) });
}

export function completeTask(state: LearningState, taskId: string, verification: 'self' | 'ai', now = new Date()): LearningState {
  const [task, progress] = taskAndProgress(state, taskId);
  if (progress.status === 'completed') return state;
  if (verification !== 'self' && verification !== 'ai') throw new Error('验收方式无效');
  if (!isTaskUnlocked(state.campaign, state.progress, taskId)) throw new Error('请先完成前置任务与前一阶段');
  if (!task.objectives.every(objective => progress.completedObjectives.includes(objective.id))) throw new Error('请先完成所有目标');
  if (Array.from(progress.evidence.trim()).length < 20) throw new Error('请提交至少 20 个字符的行动证据');
  if (verification === 'ai' && (!progress.evaluation?.passed || progress.evaluation.score < 70)) throw new Error('AI 验收未通过，需达到 70 分');
  const completedAt = timestamp(now);
  const stageIndex = state.campaign.stages.findIndex(stage => stage.tasks.some(item => item.id === taskId));
  const required = [...state.campaign.stages.slice(0, stageIndex).flatMap(stage => stage.tasks.map(item => item.id)), ...task.prerequisites];
  if (required.some(id => Date.parse(state.progress[id]?.completedAt ?? '') > now.getTime())) {
    throw new Error('完成时间不能早于前置任务，请检查设备时间');
  }
  const next = replaceProgress(state, taskId, { ...progress, status: 'completed', verification, completedAt });
  return { ...next, reviews: [...state.reviews.filter(card => card.taskId !== taskId), {
    taskId, dueAt: dueAfter(now, 1), interval: 1, ease: 2.5, repetitions: 0, history: [],
  }] };
}

export function getStats(state: LearningState, now = new Date()): {
  xp: number; completed: number; total: number; slots: number; due: number; stageCompleted: boolean[];
} {
  const tasks = getTasks(state.campaign);
  const completedTasks = tasks.filter(task => state.progress[task.id]?.status === 'completed');
  const completed = completedTasks.length;
  const total = tasks.length;
  return {
    xp: completedTasks.reduce((sum, task) => sum + task.xp, 0), completed, total,
    slots: total === 0 ? 0 : Math.floor(completed / total * 9),
    due: state.reviews.filter(card => state.progress[card.taskId]?.status === 'completed' && Date.parse(card.dueAt) <= now.getTime()).length,
    stageCompleted: state.campaign.stages.map(stage => stage.tasks.length > 0 && stage.tasks.every(task => state.progress[task.id]?.status === 'completed')),
  };
}

export function rateReview(state: LearningState, taskId: string, rating: number, now = new Date()): LearningState {
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
  const updated = { ...card, interval, ease, repetitions, dueAt: dueAfter(now, interval), history: [...card.history, { at, rating }] };
  return { ...state, reviews: state.reviews.map(card => card.taskId === taskId ? updated : card) };
}
