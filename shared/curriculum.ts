import { z } from 'zod';

const id = z.string().min(1).max(128).regex(/^[\p{L}\p{N}_-]+$/u);
const text = (limit = 500) => z.string().trim().min(1).max(limit);
export const outlineTaskSchema = z.object({ id, title: text(300), knowledgePoint: text(300), minutes: z.number().int().min(5).max(90), prerequisites: z.array(id).max(30) });
export const stageOutlineSchema = z.object({
  id, title: text(300), description: text(2000), gateTaskId: id,
  mainline: z.array(outlineTaskSchema).min(1).max(40),
  branches: z.array(z.object({ id, title: text(200), tasks: z.array(outlineTaskSchema).min(1).max(10) })).max(6),
});
export const seasonalCollectibleProposalSchema = z.object({
  name: text(120), story: text(1200), appearance: text(1200), abilityOutcome: text(1000),
});
export const curriculumOutlineSchema = z.object({
  title: text(300), subtitle: text(1000), prerequisites: z.array(text(500)).max(30),
  densityRationale: text(2000).optional(), stages: z.array(stageOutlineSchema).min(1).max(20),
  seasonalCollectible: seasonalCollectibleProposalSchema,
  nineGrid: z.array(z.object({ id, title: text(200), ability: text(500), value: text(500), taskIds: z.array(id).min(1).max(10) })).length(9),
});
export type CurriculumOutline = z.infer<typeof curriculumOutlineSchema>;
export type OutlineTask = z.infer<typeof outlineTaskSchema> & { track: 'main' | 'branch'; chainId: string };

export function normalizeGeneratedCurriculumOutline(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.prerequisites !== 'string') return value;
  const prerequisites = candidate.prerequisites.split(/[;；\n]+/u).map(item => item.trim()).filter(Boolean);
  return { ...candidate, prerequisites };
}

/** Repair a hallucinated standalone gate ID only when its actual final mainline task is explicitly a synthesis or assessment. */
export function normalizeMissingStageGates(outline: CurriculumOutline): CurriculumOutline | null {
  const taskIds = new Set(outline.stages.flatMap(stage => [
    ...stage.mainline.map(task => task.id),
    ...stage.branches.flatMap(branch => branch.tasks.map(task => task.id)),
  ]));
  let changed = false;
  const stages = outline.stages.map(stage => {
    if (taskIds.has(stage.gateTaskId)) return stage;
    const finalTask = stage.mainline.at(-1);
    if (!finalTask || !/(综合|阶段|终局|最终).{0,8}(验收|测评|小测|考核)|(?:验收|测评|小测|考核).{0,8}(综合|阶段|终局|最终)/u.test(finalTask.title)) return stage;
    changed = true;
    return { ...stage, gateTaskId: finalTask.id };
  });
  if (!changed) return null;
  if (stages.some(stage => !taskIds.has(stage.gateTaskId))) return null;
  return { ...outline, stages };
}

export interface CurriculumBudgetPlan {
  feasible: boolean;
  totalMinutes: number;
  reviewMinutes: number;
  mainlineMinutes: number;
  optionalMinutes: number;
  stageCount: number;
  mainlineTaskCounts: number[];
  branchChainsPerStage: number[];
  rationale: string;
  suggestion?: string;
}

/** Plan curriculum density before asking a model to create any task nodes. */
export function planCurriculumBudget(input: { days: number; dailyMinutes: number }): CurriculumBudgetPlan {
  const totalMinutes = input.days * input.dailyMinutes;
  const reviewMinutes = Math.max(1, Math.floor(totalMinutes * 0.15));
  const learningMinutes = totalMinutes - reviewMinutes;
  if (learningMinutes < 5) {
    const suggestedDailyMinutes = Math.max(input.dailyMinutes + 1, Math.ceil(6 / input.days));
    return {
      feasible: false, totalMinutes, reviewMinutes, mainlineMinutes: learningMinutes, optionalMinutes: 0,
      stageCount: 0, mainlineTaskCounts: [], branchChainsPerStage: [],
      rationale: '当前总预算连一个最短的实作任务和复习都无法安排。',
      suggestion: `将每日预算提高到至少 ${suggestedDailyMinutes} 分钟，或把周期延长到至少 ${Math.ceil(6 / input.dailyMinutes)} 天，再生成课程。`,
    };
  }
  const taskCapacity = Math.max(1, Math.min(60, Math.floor(learningMinutes / 12)));
  const stageCount = Math.max(1, Math.min(4, Math.ceil(taskCapacity / 15)));
  const base = Math.floor(taskCapacity / stageCount);
  const remainder = taskCapacity % stageCount;
  const mainlineTaskCounts = Array.from({ length: stageCount }, (_, index) => base + (index < remainder ? 1 : 0));
  const mainlineMinutes = taskCapacity * 12;
  const optionalMinutes = Math.max(0, totalMinutes - reviewMinutes - mainlineMinutes);
  const optionalPerStage = optionalMinutes / stageCount;
  const branches = optionalPerStage >= 45 ? 3 : optionalPerStage >= 30 ? 2 : optionalPerStage >= 15 ? 1 : 0;
  const branchChainsPerStage = Array.from({ length: stageCount }, () => branches);
  const standard = stageCount === 4 && mainlineTaskCounts.every(count => count === 15) && branches === 3;
  const rationale = standard
    ? '预算支持四个完整阶段；主线按每项约 12 分钟预留，并保留 15% 复习时间，支线只在剩余时间内提供。'
    : `预算支持 ${stageCount} 个阶段、${taskCapacity} 个主线任务；按每项约 12 分钟和 15% 复习时间测算，支线为可选内容。${branches < 3 ? '由于可选时间较少，支线数量相应减少。' : ''}`;
  return { feasible: true, totalMinutes, reviewMinutes, mainlineMinutes, optionalMinutes, stageCount, mainlineTaskCounts, branchChainsPerStage, rationale };
}

export function validateCurriculumOutline(outline: CurriculumOutline, input: { days: number; dailyMinutes: number }): boolean {
  const budget = planCurriculumBudget(input);
  if (!budget.feasible || outline.stages.length !== budget.stageCount) return false;
  const tasks = outline.stages.flatMap(stage => [
    ...stage.mainline.map(task => ({ ...task, track: 'main' as const, chainId: `${stage.id}-main`, stageId: stage.id })),
    ...stage.branches.flatMap(branch => branch.tasks.map(task => ({ ...task, track: 'branch' as const, chainId: branch.id, stageId: stage.id }))),
  ]);
  const structuralIds = [
    ...outline.stages.map(stage => stage.id),
    ...outline.stages.flatMap(stage => [
      `${stage.id}-main`, ...stage.branches.map(branch => branch.id),
    ]),
    ...tasks.map(task => task.id), ...outline.nineGrid.map(grid => grid.id),
  ];
  if (new Set(structuralIds).size !== structuralIds.length) return false;
  const byId = new Map(tasks.map(task => [task.id, task]));
  if (outline.stages.some((stage, index) => stage.mainline.length !== budget.mainlineTaskCounts[index] || !stage.mainline.some(task => task.id === stage.gateTaskId))) return false;
  if (outline.stages.some((stage, index) => stage.branches.length !== budget.branchChainsPerStage[index] || stage.branches.some(branch => branch.tasks.length !== 3))) return false;
  const canonicalDensity = budget.stageCount === 4 && budget.mainlineTaskCounts.every(count => count === 15) && budget.branchChainsPerStage.every(count => count === 3);
  if (!canonicalDensity && !outline.densityRationale?.trim()) return false;
  if (outline.nineGrid.some(grid => new Set(grid.taskIds).size !== grid.taskIds.length || grid.taskIds.some(taskId => !byId.has(taskId)) || !grid.taskIds.some(taskId => byId.get(taskId)?.track === 'main'))) return false;
  const stageOrder = new Map(outline.stages.map((stage, index) => [stage.id, index]));
  const taskOrder = new Map<string, number>();
  for (const stage of outline.stages) {
    stage.mainline.forEach((task, index) => taskOrder.set(task.id, index));
    stage.branches.forEach(branch => branch.tasks.forEach((task, index) => taskOrder.set(task.id, index)));
  }
  for (let i = 1; i < outline.stages.length; i++) {
    if (!outline.stages[i].mainline[0].prerequisites.includes(outline.stages[i - 1].gateTaskId)) return false;
  }
  for (const task of tasks) {
    if (new Set(task.prerequisites).size !== task.prerequisites.length || task.prerequisites.some(dep => !byId.has(dep) || dep === task.id)) return false;
    const depTasks = task.prerequisites.map(dep => byId.get(dep)!);
    if (depTasks.some(dep => (stageOrder.get(dep.stageId) ?? -1) > (stageOrder.get(task.stageId) ?? -1))) return false;
    if (depTasks.some(dep => dep.stageId === task.stageId && dep.chainId === task.chainId && (taskOrder.get(dep.id) ?? -1) >= (taskOrder.get(task.id) ?? -1))) return false;
    if (task.track === 'main' && depTasks.some(dep => dep.track === 'branch')) return false;
    if (task.track === 'branch' && depTasks.some(dep => dep.stageId !== task.stageId && dep.track === 'branch')) return false;
    const taskStageIndex = stageOrder.get(task.stageId)!;
    if (depTasks.some(dep => stageOrder.get(dep.stageId)! < taskStageIndex && dep.id !== outline.stages[taskStageIndex - 1]?.gateTaskId)) return false;
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const cycle = (taskId: string): boolean => {
    if (visiting.has(taskId)) return true;
    if (visited.has(taskId)) return false;
    visiting.add(taskId);
    if (byId.get(taskId)!.prerequisites.some(cycle)) return true;
    visiting.delete(taskId); visited.add(taskId); return false;
  };
  if (tasks.some(task => cycle(task.id))) return false;
  const requiredMinutes = outline.stages.reduce((sum, stage) => sum + stage.mainline.reduce((stageSum, task) => stageSum + task.minutes, 0), 0);
  const optionalMinutes = outline.stages.reduce((sum, stage) => sum + stage.branches.reduce((branchSum, branch) => branchSum + branch.tasks.reduce((taskSum, task) => taskSum + task.minutes, 0), 0), 0);
  // optionalMinutes is a pre-generation estimate. Validate the actual merged
  // outline totals so longer model estimates cannot silently exceed the cycle.
  return requiredMinutes >= budget.mainlineMinutes
    && requiredMinutes + budget.reviewMinutes + optionalMinutes <= budget.totalMinutes
    && optionalMinutes <= budget.optionalMinutes;
}
