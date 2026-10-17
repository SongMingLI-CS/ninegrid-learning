import { z } from 'zod';

const stableId = z.string().min(1).max(128).regex(/^[\p{L}\p{N}_-]+$/u);
const text = (max: number) => z.string().trim().min(1).max(max);

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
    action: z.enum(['keep', 'replace', 'review']),
    reason: text(1200),
    evidence: z.array(text(500)).max(4),
    goalCapabilityIds: z.array(stableId).min(1).max(6),
    goalRelevance: text(800),
    replacement: z.object({
      title: text(300), brief: text(1000), action: text(1000),
      objective: text(1000), steps: z.array(text(2000)).min(1).max(12),
      acceptance: text(1200), deliverable: text(1000), recallQuestion: text(1000),
      hint: text(1000), hints: z.array(text(1000)).max(5), curiosity: text(1000),
    }).strict().optional(),
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
    if ((task.action === 'replace') !== Boolean(task.replacement)) ctx.addIssue({ code: 'custom', path: ['tasks', index, 'replacement'], message: '替换任务必须提供完整的新任务内容，其他动作不能携带替换内容。' });
  });
});

export type SeasonGoalAdjustmentAssessment = z.infer<typeof seasonGoalAdjustmentAssessmentSchema>;
