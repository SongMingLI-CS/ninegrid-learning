import { z } from 'zod';

const reserved = /^(?:__proto__|prototype|constructor|api[-_]?key|access[-_]?token|authorization|password|secret)$/i;
const idSchema = z.string().min(1).max(128).regex(/^[\p{L}\p{N}_-]+$/u).refine(id => !reserved.test(id), '标识符不安全');
const text = (max = 4000) => z.string().trim().min(1).max(max);
const dateSchema = z.iso.datetime({ offset: true });
const unique = (values: string[]) => new Set(values).size === values.length;
const resourceSchema = z.object({
  title: text(300),
  url: z.string().max(2048).url().refine(value => {
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
    } catch { return false; }
  }, '资料地址必须是无凭据的 HTTP(S) 链接'),
});

export const taskSchema = z.object({
  id: idSchema, title: text(300), brief: text(), kind: z.enum(['investigate', 'recall', 'practice', 'boss']),
  minutes: z.number().int().min(1).max(480), xp: z.number().int().min(0).max(10000),
  prerequisites: z.array(idSchema).max(100).refine(unique, '前置任务不能重复'),
  objectives: z.array(z.object({ id: idSchema, text: text(1000) })).min(1).max(20)
    .refine(items => unique(items.map(item => item.id)), '目标 ID 不能重复'),
  curiosity: text(), steps: z.array(text(2000)).min(1).max(30), acceptance: text(),
  recallQuestion: text(), hint: text(), resources: z.array(resourceSchema).max(20),
});

export const goalInputSchema = z.object({
  goal: text(8000), level: text(200), days: z.number().int().min(1).max(365),
  dailyMinutes: z.number().int().min(1).max(1440), ultimateReward: text(2000),
});

export const campaignSchema = z.object({
  ...goalInputSchema.shape, id: idSchema, title: text(300), subtitle: text(1000), createdAt: dateSchema,
  source: z.enum(['demo', 'deepseek']), stages: z.array(z.object({
    id: idSchema, title: text(300), description: text(), tasks: z.array(taskSchema).min(1).max(100),
  })).min(1).max(20),
}).superRefine((campaign, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (!unique(campaign.stages.map(stage => stage.id))) issue('阶段 ID 必须唯一');
  const tasks = campaign.stages.flatMap(stage => stage.tasks);
  if (!unique(tasks.map(task => task.id))) issue('任务 ID 必须唯一');
  if (!unique(tasks.flatMap(task => task.objectives.map(objective => objective.id)))) issue('目标 ID 必须全局唯一');
  const byId = new Map(tasks.map(task => [task.id, task]));
  const stages = new Map(campaign.stages.flatMap((stage, i) => stage.tasks.map(task => [task.id, i] as const)));
  for (const task of tasks) {
    for (const prerequisite of task.prerequisites) {
      if (!byId.has(prerequisite)) issue(`任务 ${task.id} 的前置任务不存在：${prerequisite}`);
      else if (stages.get(prerequisite)! > stages.get(task.id)!) issue(`任务 ${task.id} 不能依赖后续阶段`);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    for (const dependency of byId.get(id)?.prerequisites ?? []) if (!visit(dependency)) return false;
    visiting.delete(id); visited.add(id);
    return true;
  };
  if (tasks.some(task => !visit(task.id))) issue('任务依赖不能形成循环');
});

export const evaluationSchema = z.object({
  passed: z.boolean(), score: z.number().min(0).max(100), feedback: text(8000),
  gaps: z.array(text(2000)).max(30), nextStep: text(4000),
});

const progressSchema = z.object({
  completedObjectives: z.array(idSchema).max(20).refine(unique, '已完成目标不能重复'),
  evidence: z.string().max(100000), status: z.enum(['idle', 'active', 'completed']),
  evaluation: evaluationSchema.optional(), verification: z.enum(['self', 'ai']).optional(), completedAt: dateSchema.optional(),
});
const reviewSchema = z.object({
  taskId: idSchema, dueAt: dateSchema, interval: z.number().int().min(1).max(36500),
  ease: z.number().min(1.3).max(5), repetitions: z.number().int().min(0).max(100000),
  history: z.array(z.object({ at: dateSchema, rating: z.number().int().min(1).max(4) })).max(100000),
});
const noteKey = z.string().min(1).max(200).refine(key => !reserved.test(key), '笔记标题不能是凭据字段');

// Zod objects strip unknown fields at every boundary; AI output never supplies progress.
export const learningStateSchema = z.object({
  version: z.literal(1), campaign: campaignSchema, progress: z.record(idSchema, progressSchema),
  reviews: z.array(reviewSchema).max(2000), notes: z.record(noteKey, z.string().max(100000)),
}).superRefine((state, ctx) => {
  const issue = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: 'custom', message, path });
  const tasks = state.campaign.stages.flatMap(stage => stage.tasks);
  const byId = new Map(tasks.map(task => [task.id, task]));
  const completed = (id: string) => state.progress[id]?.status === 'completed';
  const reviewIds = state.reviews.map(card => card.taskId);
  if (!unique(reviewIds)) issue('每个任务只能有一张复习卡', ['reviews']);
  for (const [id, progress] of Object.entries(state.progress)) {
    const task = byId.get(id);
    if (!task) { issue('进度引用了未知任务', ['progress', id]); continue; }
    const objectiveIds = new Set(task.objectives.map(objective => objective.id));
    if (progress.completedObjectives.some(objective => !objectiveIds.has(objective))) issue('进度引用了未知目标', ['progress', id]);
    if (progress.status !== 'completed') {
      if (progress.completedAt || progress.verification) issue('未完成任务不能有完成时间或验收标记', ['progress', id]);
    } else {
      if (!progress.completedAt || !progress.verification) issue('完成任务必须记录时间与验收方式', ['progress', id]);
      if (!task.objectives.every(objective => progress.completedObjectives.includes(objective.id))) issue('完成任务必须达成所有目标', ['progress', id]);
      if (Array.from(progress.evidence.trim()).length < 20) issue('完成证据至少需要 20 个字符', ['progress', id]);
      if (progress.verification === 'ai' && (!progress.evaluation?.passed || progress.evaluation.score < 70)) issue('AI 验收必须通过且不少于 70 分', ['progress', id]);
      if (!reviewIds.includes(id)) issue('完成任务缺少复习卡', ['reviews']);
    }
    // Active means selected/browsed, including a locked mission. Only completion
    // crosses the progression boundary and must satisfy every stage gate.
    if (progress.status === 'completed') {
      const stageIndex = state.campaign.stages.findIndex(stage => stage.tasks.some(item => item.id === id));
      const required = [...state.campaign.stages.slice(0, stageIndex).flatMap(stage => stage.tasks.map(item => item.id)), ...task.prerequisites];
      if (!required.every(completed)) issue('任务未满足前置任务或阶段门槛', ['progress', id]);
      if (progress.completedAt && required.some(dep => {
        const at = state.progress[dep]?.completedAt;
        return at && Date.parse(at) > Date.parse(progress.completedAt!);
      })) issue('任务完成时间不能早于前置任务', ['progress', id]);
    }
  }
  state.reviews.forEach((card, index) => {
    const progress = state.progress[card.taskId];
    if (!byId.has(card.taskId) || progress?.status !== 'completed') { issue('复习卡必须对应已完成任务', ['reviews', index]); return; }
    let previous = Date.parse(progress.completedAt ?? '');
    for (const entry of card.history) {
      const at = Date.parse(entry.at);
      if (at < previous) issue('复习历史时间必须有序且晚于任务完成', ['reviews', index]);
      previous = at;
    }
    if (Date.parse(card.dueAt) < previous) issue('复习到期时间不能早于完成或最近复习', ['reviews', index]);
  });
});
