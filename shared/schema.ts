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
export const rewardBundleSchema = z.object({
  xp: z.number().int().min(0).max(10000), coins: z.number().int().min(0).max(1000),
  items: z.array(z.object({ itemId: idSchema, name: text(120), description: text(500), rarity: z.enum(['common', 'rare', 'legendary']), icon: text(40), quantity: z.number().int().min(1).max(99) })).max(10),
});
export const lessonContentSchema = z.object({
  purpose: text(2000), explanation: text(12000), terms: z.array(z.object({ en: text(100), zh: text(100), context: text(500) })).max(30),
  example: z.object({ prompt: text(2000), code: text(12000), walkthrough: text(4000) }),
  guidedPractice: z.object({ prompt: text(3000), expected: text(2000), hint: text(1000) }),
  challenge: z.object({ prompt: text(4000), acceptance: text(3000), hints: z.array(text(1000)).min(1).max(5) }),
  language: z.enum(['en', 'zh', 'mixed']), generatedAt: dateSchema, revision: z.number().int().min(1).max(1000),
});
const dailyScheduleSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), theme: text(500), items: z.array(z.object({ taskId: idSchema, kind: z.enum(['review','lesson','practice','reflection']), minutes: z.number().int().min(1).max(1440), required: z.boolean(), deliverable: text(500) })).max(100), totalMinutes: z.number().int().min(0).max(1440), outcome: text(1000), nextUnlock: text(1000), revision: z.number().int().min(1).max(1000) });

export const taskSchema = z.object({
  id: idSchema, title: text(300), brief: text(), kind: z.enum(['investigate', 'recall', 'practice', 'boss']),
  minutes: z.number().int().min(1).max(480), xp: z.number().int().min(0).max(10000),
  prerequisites: z.array(idSchema).max(100).refine(unique, '前置任务不能重复'),
  objectives: z.array(z.object({ id: idSchema, text: text(1000) })).min(1).max(20)
    .refine(items => unique(items.map(item => item.id)), '目标 ID 不能重复'),
  curiosity: text(), steps: z.array(text(2000)).min(1).max(30), acceptance: text(),
  recallQuestion: text(), hint: text(), resources: z.array(resourceSchema).max(20),
  track: z.enum(['main', 'branch']).optional(), chainId: idSchema.optional(), unlockAfter: z.array(idSchema).max(100).optional(),
  reward: rewardBundleSchema.optional(), teaching: lessonContentSchema.optional(),
});

export const goalInputSchema = z.object({
  goal: text(8000), level: text(200), days: z.number().int().min(1).max(365),
  dailyMinutes: z.number().int().min(1).max(1440), ultimateReward: text(2000),
  desiredArtifact: text(2000).optional(), language: z.enum(['en','zh','mixed']).optional(), sourceMaterial: z.string().max(20000).optional(),
});

export const campaignSchema = z.object({
  ...goalInputSchema.shape, id: idSchema, title: text(300), subtitle: text(1000), createdAt: dateSchema,
  source: z.enum(['demo', 'deepseek']), stages: z.array(z.object({
    id: idSchema, title: text(300), description: text(), tasks: z.array(taskSchema).min(1).max(100),
    mainlineTaskIds: z.array(idSchema).max(100).optional(), gateTaskIds: z.array(idSchema).max(100).optional(), reward: rewardBundleSchema.optional(),
    chains: z.array(z.object({ id: idSchema, title: text(200), track: z.enum(['main','branch']), taskIds: z.array(idSchema).min(1).max(100), completionReward: rewardBundleSchema.optional() })).max(20).optional(),
  })).min(1).max(20),
  prerequisites: z.array(text(500)).max(100).optional(),
  nineGrid: z.array(z.object({ id: idSchema, title: text(200), ability: text(1000), value: text(1000), unlockTaskIds: z.array(idSchema).min(1).max(100), artifact: text(2000).optional() })).length(9).optional(),
}).superRefine((campaign, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (!unique(campaign.stages.map(stage => stage.id))) issue('阶段 ID 必须唯一');
  const tasks = campaign.stages.flatMap(stage => stage.tasks);
  if (!unique(tasks.map(task => task.id))) issue('任务 ID 必须唯一');
  if (!unique(tasks.flatMap(task => task.objectives.map(objective => objective.id)))) issue('目标 ID 必须全局唯一');
  const byId = new Map(tasks.map(task => [task.id, task]));
  const taskIds = new Set(byId.keys());
  for (const stage of campaign.stages) {
    for (const id of [...(stage.mainlineTaskIds ?? []), ...(stage.gateTaskIds ?? []), ...(stage.chains ?? []).flatMap(chain => chain.taskIds)]) {
      if (!taskIds.has(id)) issue(`阶段 ${stage.id} 引用了不存在的任务：${id}`);
    }
    for (const chain of stage.chains ?? []) if (chain.track === 'main' && chain.taskIds.some(id => !stage.tasks.some(task => task.id === id))) issue(`主线任务链必须属于当前阶段：${chain.id}`);
    for (const task of stage.tasks) if (task.chainId && !(stage.chains ?? []).some(chain => chain.id === task.chainId)) issue(`任务 ${task.id} 引用了不存在的任务链`);
  }
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
  supplementalEvidence: z.string().max(100000).optional(),
  evaluation: evaluationSchema.optional(), verification: z.enum(['self', 'ai']).optional(), completedAt: dateSchema.optional(),
  selfChecked: z.boolean().optional(),
  evaluationSource: z.enum(['self','ai']).optional(),
});
const reviewSchema = z.object({
  taskId: idSchema, dueAt: dateSchema, interval: z.number().int().min(1).max(36500),
  ease: z.number().min(1.3).max(5), repetitions: z.number().int().min(0).max(100000),
  history: z.array(z.object({ at: dateSchema, rating: z.number().int().min(1).max(4), answer: z.string().max(10000).optional(), hintUsed: z.boolean().optional() })).max(100000),
});
const noteKey = z.string().min(1).max(200).refine(key => !reserved.test(key), '笔记标题不能是凭据字段');

// Zod objects strip unknown fields at every boundary; AI output never supplies progress.
export const learningStateSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]), campaign: campaignSchema, progress: z.record(idSchema, progressSchema),
  reviews: z.array(reviewSchema).max(2000), notes: z.record(noteKey, z.string().max(100000)),
  content: z.record(idSchema, lessonContentSchema).optional(),
  schedules: z.record(z.string().max(10), dailyScheduleSchema).optional(),
  history: z.array(z.object({ campaign: campaignSchema, progress: z.record(idSchema, progressSchema), reviews: z.array(reviewSchema).max(2000), notes: z.record(noteKey, z.string().max(100000)), content: z.record(idSchema, lessonContentSchema).optional(), schedules: z.record(z.string().max(10), dailyScheduleSchema).optional(), attempts: z.record(idSchema, z.array(z.object({ at: dateSchema, answer: z.string().max(100000), hintLevelsUsed: z.number().int().min(0).max(5), verification: z.enum(['self','ai','none']), passed: z.boolean(), score: z.number().min(0).max(100).optional(), errorType: z.enum(['concept','operation','hint-dependence','prerequisite','none']).optional(), feedback: z.string().max(8000) })).max(10000)).optional(), contentHistory: z.record(idSchema, z.array(lessonContentSchema).max(100)).optional(), gridOutcomes: z.record(idSchema, z.object({ artifact: text(100000), verifiedAt: dateSchema, taskIds: z.array(idSchema).min(1).max(100) })).optional(), dailyAdjustments: z.record(z.string().max(10), z.enum(['half','more','skip-known','too-hard'])).optional(), knownTasks: z.record(idSchema, z.boolean()).optional(), lastTaskId: idSchema.optional() })).max(100).optional(),
  wallet: z.object({ currency: z.string().max(40), balance: z.number().int().min(0).max(100000000) }).optional(),
  inventory: z.record(idSchema, z.object({ item: rewardBundleSchema.shape.items.element, quantity: z.number().int().min(1).max(1000000), acquiredAt: dateSchema, sources: z.array(idSchema).max(10000) })).optional(),
  rewardLedger: z.array(z.object({ id: idSchema, campaignId: idSchema.default('legacy-unknown'), taskId: idSchema, at: dateSchema, reward: rewardBundleSchema, kind: z.enum(['mission','verification','chain','stage','season','review']), idempotencyKey: idSchema })).max(100000).optional(),
  gridOutcomes: z.record(idSchema, z.object({ artifact: text(100000), verifiedAt: dateSchema, taskIds: z.array(idSchema).min(1).max(100) })).optional(),
  dailyAdjustments: z.record(z.string().max(10), z.enum(['half','more','skip-known','too-hard'])).optional(),
  knownTasks: z.record(idSchema, z.boolean()).optional(),
  attempts: z.record(idSchema, z.array(z.object({ at: dateSchema, answer: z.string().max(100000), hintLevelsUsed: z.number().int().min(0).max(5), verification: z.enum(['self','ai','none']), passed: z.boolean(), score: z.number().min(0).max(100).optional(), errorType: z.enum(['concept','operation','hint-dependence','prerequisite','none']).optional(), feedback: z.string().max(8000) })).max(10000)).optional(),
  contentHistory: z.record(idSchema, z.array(lessonContentSchema).max(100)).optional(),
  lastTaskId: idSchema.optional(),
}).superRefine((state, ctx) => {
  const issue = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: 'custom', message, path });
  const tasks = state.campaign.stages.flatMap(stage => stage.tasks);
  const byId = new Map(tasks.map(task => [task.id, task]));
  const archivedCampaigns = (state.history ?? []).map(snapshot => snapshot.campaign);
  const completed = (id: string) => state.progress[id]?.status === 'completed';
  const reviewIds = state.reviews.map(card => card.taskId);
  for (const id of Object.keys(state.content ?? {})) if (!byId.has(id)) issue('课程内容缓存引用了未知任务', ['content', id]);
  for (const id of Object.keys(state.attempts ?? {})) if (!byId.has(id)) issue('学习尝试记录引用了未知任务', ['attempts', id]);
  for (const id of Object.keys(state.contentHistory ?? {})) if (!byId.has(id)) issue('教学版本引用了未知任务', ['contentHistory', id]);
  for (const id of Object.keys(state.knownTasks ?? {})) if (!byId.has(id)) issue('已掌握诊断引用了未知任务', ['knownTasks', id]);
  if (state.lastTaskId && !byId.has(state.lastTaskId)) issue('上次任务不属于当前课程', ['lastTaskId']);
  const ledger = state.rewardLedger ?? [];
  if (!unique(ledger.map(entry => entry.id)) || !unique(ledger.map(entry => entry.idempotencyKey))) issue('奖励流水和领取标识必须唯一', ['rewardLedger']);
  for (const [index, entry] of ledger.entries()) {
    const sourceCampaign = entry.campaignId === state.campaign.id ? state.campaign : archivedCampaigns.find(campaign => campaign.id === entry.campaignId);
    if (!sourceCampaign && entry.campaignId !== 'legacy-unknown') issue('奖励流水必须标记有效的赛季来源', ['rewardLedger', index, 'campaignId']);
    else if (sourceCampaign && !sourceCampaign.stages.some(stage => stage.tasks.some(task => task.id === entry.taskId))) issue('奖励流水触发任务必须属于其赛季来源', ['rewardLedger', index, 'taskId']);
  }
  for (const [index, snapshot] of (state.history ?? []).entries()) {
    const snapshotTasks = new Set(snapshot.campaign.stages.flatMap(stage => stage.tasks.map(task => task.id)));
    for (const field of ['content', 'attempts', 'contentHistory'] as const) for (const id of Object.keys(snapshot[field] ?? {})) if (!snapshotTasks.has(id)) issue('历史课程数据引用了其他目标的任务', ['history', index, field, id]);
    for (const id of Object.keys(snapshot.knownTasks ?? {})) if (!snapshotTasks.has(id)) issue('历史掌握诊断引用了其他目标的任务', ['history', index, 'knownTasks', id]);
  }
  if (state.wallet && state.wallet.balance !== ledger.reduce((sum, entry) => sum + entry.reward.coins, 0)) issue('钱包余额必须与奖励流水一致', ['wallet']);
  const heldItems = new Map<string, number>();
  for (const entry of ledger) for (const item of entry.reward.items) heldItems.set(item.itemId, (heldItems.get(item.itemId) ?? 0) + item.quantity);
  for (const [itemId, held] of Object.entries(state.inventory ?? {})) if ((heldItems.get(itemId) ?? 0) !== held.quantity) issue('持有道具数量必须与奖励流水一致', ['inventory', itemId]);
  for (const [itemId, count] of heldItems) if (state.inventory?.[itemId]?.quantity !== count) issue('奖励到账的道具必须在仓库中可追溯', ['inventory', itemId]);
  if (!unique(reviewIds)) issue('每个任务只能有一张复习卡', ['reviews']);
  for (const [id, progress] of Object.entries(state.progress)) {
    const task = byId.get(id);
    if (!task) { issue('进度引用了未知任务', ['progress', id]); continue; }
    const objectiveIds = new Set(task.objectives.map(objective => objective.id));
    if (progress.completedObjectives.some(objective => !objectiveIds.has(objective))) issue('进度引用了未知目标', ['progress', id]);
    if (progress.status !== 'completed') {
      if (progress.completedAt || progress.verification) issue('未完成任务不能有完成时间或验收标记', ['progress', id]);
      if (progress.evaluationSource === 'ai' && !progress.evaluation) issue('AI 验收来源必须关联评价记录', ['progress', id]);
    } else {
      if (!progress.completedAt || !progress.verification) issue('完成任务必须记录时间与验收方式', ['progress', id]);
      if (Array.from(progress.evidence.trim()).length < 20) issue('完成证据至少需要 20 个字符', ['progress', id]);
      if (progress.verification === 'ai' && (!progress.evaluation?.passed || progress.evaluation.score < 70 || progress.evaluationSource !== 'ai')) issue('AI 验收必须通过且不少于 70 分并保存来源', ['progress', id]);
      if (!reviewIds.includes(id)) issue('完成任务缺少复习卡', ['reviews']);
    }
    // Active means selected/browsed, including a locked mission. Only completion
    // crosses the progression boundary and must satisfy every stage gate.
    if (progress.status === 'completed') {
      const stageIndex = state.campaign.stages.findIndex(stage => stage.tasks.some(item => item.id === id));
      const required = [...state.campaign.stages.slice(0, stageIndex).flatMap(stage => stage.gateTaskIds ?? stage.mainlineTaskIds ?? stage.tasks.filter(item => (item.track ?? 'main') === 'main').map(item => item.id)), ...task.prerequisites, ...(task.unlockAfter ?? [])];
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
