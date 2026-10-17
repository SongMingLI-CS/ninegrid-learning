import { z } from 'zod';
import { lessonContentDraftSchema } from './schema';

const stableId = z.string().min(1).max(128).regex(/^[\p{L}\p{N}_-]+$/u);
const text = (max: number) => z.string().trim().min(1).max(max);
const alignment = z.enum(['aligned', 'update', 'mismatch', 'uncertain']);
const contentReview = z.object({
  contract: z.object({ objective: alignment, action: alignment, deliverable: alignment, acceptance: alignment, prerequisites: alignment }).strict(),
  lesson: z.object({ purpose: alignment, explanation: alignment, example: alignment, guidedPractice: alignment, independentChallenge: alignment, scoring: alignment }).strict(),
  summary: text(1200),
}).strict();
const taskReplacement = z.object({
  title: text(300), brief: text(1000), action: text(1000),
  objectives: z.array(text(1000)).min(1).max(12), steps: z.array(text(2000)).min(1).max(12),
  acceptance: text(1200), deliverable: text(1000), recallQuestion: text(1000),
  hint: text(1000), hints: z.array(text(1000)).max(5), curiosity: text(1000),
}).strict();

/** Structured, reviewable output used only to prepare a season-goal preview. */
export const seasonGoalAdjustmentAssessmentSchema = z.object({
  campaign: z.object({ title: text(300), subtitle: text(1000) }).strict(),
  rationale: text(2000),
  seasonalCollectible: z.object({
    name: text(120), story: text(1200), appearance: text(1200), abilityOutcome: text(1000), reason: text(1000),
  }).strict().optional(),
  capabilities: z.array(z.object({ id: stableId, title: text(300), description: text(800) }).strict()).min(1).max(24),
  stages: z.array(z.object({ stageId: stableId, title: text(300), description: text(2000), reason: text(1000) }).strict()).min(1).max(20),
  tasks: z.array(z.object({
    taskId: stableId,
    action: z.enum(['keep', 'refresh', 'replace', 'review']),
    reason: text(1200),
    evidence: z.array(text(500)).max(4),
    goalCapabilityIds: z.array(stableId).min(1).max(6),
    goalRelevance: text(800),
    contentReview,
    replacement: taskReplacement.optional(),
    lesson: lessonContentDraftSchema.strict().optional(),
  }).strict()).min(1).max(200),
  nineGrid: z.array(z.object({
    id: stableId, title: text(200), ability: text(500), value: text(500), taskIds: z.array(stableId).min(1).max(20),
  }).strict()).length(9),
}).strict().superRefine((assessment, ctx) => {
  const unique = (values: string[]) => new Set(values).size === values.length;
  if (!unique(assessment.capabilities.map(item => item.id))) ctx.addIssue({ code: 'custom', path: ['capabilities'], message: '能力 ID 必须唯一。' });
  if (!unique(assessment.stages.map(item => item.stageId))) ctx.addIssue({ code: 'custom', path: ['stages'], message: '阶段 ID 必须唯一。' });
  if (!unique(assessment.tasks.map(item => item.taskId))) ctx.addIssue({ code: 'custom', path: ['tasks'], message: '任务 ID 必须唯一。' });
  if (!unique(assessment.nineGrid.map(item => item.id))) ctx.addIssue({ code: 'custom', path: ['nineGrid'], message: '九格 ID 必须唯一。' });
  const capabilityIds = new Set(assessment.capabilities.map(item => item.id));
  assessment.tasks.forEach((task, index) => {
    if (task.goalCapabilityIds.some(id => !capabilityIds.has(id))) ctx.addIssue({ code: 'custom', path: ['tasks', index, 'goalCapabilityIds'], message: '任务引用了未声明的目标能力。' });
    const contract = Object.values(task.contentReview.contract);
    const lesson = Object.values(task.contentReview.lesson);
    const statuses = [...contract, ...lesson];
    const hasUncertain = statuses.includes('uncertain');
    const hasMismatch = statuses.includes('mismatch');
    const hasContractMismatch = contract.includes('mismatch');
    const hasUpdate = statuses.includes('update');
    const hasReplacement = Boolean(task.replacement && task.lesson);
    if (['refresh', 'replace'].includes(task.action) !== hasReplacement) ctx.addIssue({ code: 'custom', path: ['tasks', index], message: '同步更新或替换的任务必须同时提供完整任务合同和完整讲解；其他动作不能携带新内容。' });
    if (task.action === 'keep' && statuses.some(status => status !== 'aligned')) ctx.addIssue({ code: 'custom', path: ['tasks', index, 'contentReview'], message: '只有所有现有任务及教学内容均符合新目标时才能保留。' });
    if (task.action === 'refresh' && (!hasUpdate || hasMismatch || hasUncertain)) ctx.addIssue({ code: 'custom', path: ['tasks', index, 'contentReview'], message: '同步更新只适用于可保留任务身份、但明确需要更新的内容。' });
    if (task.action === 'replace' && (!hasContractMismatch || hasUncertain)) ctx.addIssue({ code: 'custom', path: ['tasks', index, 'contentReview'], message: '替换任务必须有明确偏离新目标的任务合同证据。' });
    if (task.action === 'review' && !hasUncertain) ctx.addIssue({ code: 'custom', path: ['tasks', index, 'contentReview'], message: '待确认任务必须指出无法确定的课程关联。' });
    if (task.action !== 'review' && hasUncertain) ctx.addIssue({ code: 'custom', path: ['tasks', index, 'contentReview'], message: '课程内容仍有不确定项，不能自动保留或替换。' });
    if (task.action === 'replace' && !hasMismatch) ctx.addIssue({ code: 'custom', path: ['tasks', index, 'contentReview'], message: '替换任务必须指出至少一项与目标冲突的内容。' });
  });
});

export type SeasonGoalAdjustmentAssessment = z.infer<typeof seasonGoalAdjustmentAssessmentSchema>;
