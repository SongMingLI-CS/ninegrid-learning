import { z } from 'zod';

const id = z.string().min(1).max(128).regex(/^[\p{L}\p{N}_-]+$/u);
const text = (limit = 500) => z.string().trim().min(1).max(limit);
export const outlineTaskSchema = z.object({ id, title: text(300), knowledgePoint: text(300), minutes: z.number().int().min(5).max(90), prerequisites: z.array(id).max(30) });
export const stageOutlineSchema = z.object({
  id, title: text(300), description: text(2000), gateTaskId: id,
  mainline: z.array(outlineTaskSchema).min(1).max(40),
  branches: z.array(z.object({ id, title: text(200), tasks: z.array(outlineTaskSchema).min(1).max(10) })).max(6),
});
export const curriculumOutlineSchema = z.object({
  title: text(300), subtitle: text(1000), prerequisites: z.array(text(500)).max(30),
  densityRationale: text(2000).optional(), stages: z.array(stageOutlineSchema).min(1).max(20),
  nineGrid: z.array(z.object({ id, title: text(200), ability: text(500), value: text(500), taskIds: z.array(id).min(1).max(10) })).length(9),
});
export type CurriculumOutline = z.infer<typeof curriculumOutlineSchema>;
export type OutlineTask = z.infer<typeof outlineTaskSchema> & { track: 'main' | 'branch'; chainId: string };

export function validateCurriculumOutline(outline: CurriculumOutline, input: { days: number; dailyMinutes: number }): boolean {
  const stages = outline.stages;
  const tasks = stages.flatMap(stage => [
    ...stage.mainline.map(task => ({ ...task, track: 'main' as const, chainId: `${stage.id}-main`, stageId: stage.id })),
    ...stage.branches.flatMap(branch => branch.tasks.map(task => ({ ...task, track: 'branch' as const, chainId: branch.id, stageId: stage.id }))),
  ]);
  const ids = [
    ...stages.map(stage => stage.id), ...stages.flatMap(stage => stage.branches.map(branch => branch.id)),
    ...stages.map(stage => `${stage.id}-main`),
    ...tasks.map(task => task.id), ...outline.nineGrid.map(grid => grid.id),
  ];
  if (new Set(ids).size !== ids.length || new Set(tasks.map(task => task.id)).size !== tasks.length) return false;
  const byId = new Map(tasks.map(task => [task.id, task]));
  if (stages.some(stage => !stage.mainline.some(task => task.id === stage.gateTaskId))) return false;
  if (outline.nineGrid.some(grid => grid.taskIds.some(taskId => !byId.has(taskId)) || !grid.taskIds.some(taskId => byId.get(taskId)?.track === 'main'))) return false;
  const stageOrder = new Map(stages.map((stage, index) => [stage.id, index]));
  const taskOrder = new Map<string, number>();
  for (const stage of stages) {
    stage.mainline.forEach((task, index) => taskOrder.set(task.id, index));
    stage.branches.forEach(branch => branch.tasks.forEach((task, index) => taskOrder.set(task.id, index)));
  }
  const dense = input.days >= 14 && input.dailyMinutes >= 20;
  if (dense) {
    if (stages.some(stage => stage.mainline.length !== 15 || stage.branches.length !== 3 || stage.branches.some(branch => branch.tasks.length !== 3))) return false;
  } else if (!outline.densityRationale) return false;
  for (let i = 1; i < stages.length; i++) if (!stages[i].mainline[0].prerequisites.includes(stages[i-1].gateTaskId)) return false;
  for (const task of tasks) {
    if (new Set(task.prerequisites).size !== task.prerequisites.length || task.prerequisites.some(dep => !byId.has(dep) || dep === task.id)) return false;
    const depTask = task.prerequisites.map(dep => byId.get(dep)!);
    if (depTask.some(dep => (stageOrder.get(dep.stageId) ?? -1) > (stageOrder.get(task.stageId) ?? -1))) return false;
    if (depTask.some(dep => dep.stageId === task.stageId && dep.chainId === task.chainId && (taskOrder.get(dep.id) ?? -1) >= (taskOrder.get(task.id) ?? -1))) return false;
    if (task.track === 'main' && depTask.some(dep => dep.track === 'branch')) return false;
    if (task.track === 'branch' && depTask.some(dep => dep.stageId !== task.stageId && dep.track === 'branch')) return false;
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
  const requiredMinutes = stages.reduce((sum, stage) => sum + stage.mainline.reduce((stageSum, task) => stageSum + task.minutes, 0), 0);
  // Reserve roughly 15% for retrieval and spaced review instead of consuming every available minute with new material.
  return requiredMinutes * 1.15 <= input.days * input.dailyMinutes;
}
