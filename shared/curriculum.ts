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

const legacyToolArtifactDefaults = new Set([
  '把第一个真正能用的小工具部署起来',
  '完成一个雅思任务计时器/错题记录器',
].map(value => value.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLocaleLowerCase()));
const languageLearningGoal = /雅思|\bIELTS\b|托福|\bTOEFL\b|英语|english(?:\s+(?:reading|writing|listening|speaking))?/iu;
const programmingIntent = /编程|写代码|编写代码|代码实现|写脚本|编写脚本|学习\s*python|\bpython\s*(?:编程|开发|coding)|(?:开发|制作|编写|构建|实现|部署|打包).{0,14}(?:小工具|工具|软件|程序|应用|计时器|脚本|\bapp\b|\btool\b|\btimer\b)|(?:build|create|develop|write|implement|deploy|package).{0,18}\b(?:a\s+)?(?:tool|app|application|timer|script|software)\b/iu;
const programmingConstruction = /编程|写代码|代码实现|脚本|运行环境|计时器|小工具|软件开发|程序开发|工具开发|开发工具|工具自动化|工具产品化|数据字段|依赖固定|打包与依赖|报告导出|正确率统计|每日建议生成规则|历史记录与趋势|薄弱项识别|模考数据录入|部署到可用位置|(?:开发|制作|编写|构建|实现|部署|打包).{0,16}(?:小工具|工具|软件|程序|应用|计时器|脚本|自动化|报告导出|统计)|\b(?:coding|programming|software development|tool development|script|timer|package dependencies|deploy(?:ment)?)\b/iu;
const normalizeIntentText = (value: string) => value.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLocaleLowerCase();

function hasExplicitProgrammingIntent(input: { goal: string; desiredArtifact?: string; ultimateReward?: string }): boolean {
  if (programmingIntent.test(input.goal)) return true;
  return [input.desiredArtifact, input.ultimateReward].some(value => {
    if (!value?.trim()) return false;
    const normalized = normalizeIntentText(value);
    if (legacyToolArtifactDefaults.has(normalized)) return false;
    return programmingIntent.test(value) || /(?:雅思|ielts|英语|english).{0,18}(?:小工具|工具|软件|程序|应用|计时器)|(?:小工具|软件|程序|应用|计时器).{0,18}(?:雅思|ielts|英语|english)/iu.test(value);
  });
}

/** Give each new goal a subject-relevant default instead of silently opting into software development. */
export function defaultArtifactForGoal(goal: string): string {
  return languageLearningGoal.test(goal)
    ? '一份雅思听说读写练习证据与个人薄弱项复盘'
    : '一项能核对目标进步的具体成果';
}

/** Replace the application's historical prefilled tool reward, which was never an explicit learner choice. */
export function normalizeLegacyGoalArtifact<T extends { goal: string; desiredArtifact?: string; ultimateReward?: string }>(input: T): T {
  const candidates = [input.desiredArtifact, input.ultimateReward].filter((value): value is string => Boolean(value?.trim()));
  const hasExplicitArtifact = candidates.some(value => !legacyToolArtifactDefaults.has(normalizeIntentText(value)));
  if (hasExplicitArtifact) return input;
  const artifact = defaultArtifactForGoal(input.goal);
  return { ...input, desiredArtifact: artifact, ultimateReward: artifact };
}

/** Deterministic scope check for the required curriculum path; optional branches may teach tools. */
export function validateCurriculumGoalScope(outline: CurriculumOutline, input: { goal: string; desiredArtifact?: string; ultimateReward?: string }): boolean {
  if (hasExplicitProgrammingIntent(input)) return true;
  const requiredPath = [
    outline.title, outline.subtitle, ...outline.prerequisites,
    ...outline.stages.flatMap(stage => [stage.title, stage.description, ...stage.mainline.flatMap(task => [task.title, task.knowledgePoint])]),
    ...outline.nineGrid.flatMap(outcome => [outcome.title, outcome.ability, outcome.value]),
  ].join('\n');
  return !programmingConstruction.test(requiredPath);
}

export function curriculumScopePolicy(input: { goal: string; desiredArtifact?: string; ultimateReward?: string }): string {
  if (hasExplicitProgrammingIntent(input)) return 'The learner explicitly requested programming or software-tool development in addition to the primary goal. Keep the primary goal visible and do not let the secondary project displace its required practice.';
  return `The primary goal is ${languageLearningGoal.test(input.goal) ? 'language learning' : 'the stated subject'} and no explicit programming objective was supplied. Keep every required stage, gate, nine-grid outcome, and final artifact inside that subject. Programming, scripts, app/tool construction, and deployment may appear only in a clearly optional branch, never as a prerequisite for starting or completing the primary goal. Ignore legacy/default artifact text that was prefilled by the application.`;
}

export function normalizeGeneratedCurriculumOutline(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const candidate = value as Record<string, unknown>;
  const prerequisites = typeof candidate.prerequisites === 'string'
    ? candidate.prerequisites.split(/[;；\n]+/u).map(item => item.trim()).filter(Boolean)
    : candidate.prerequisites;
  if (!Array.isArray(candidate.stages)) return { ...candidate, prerequisites };
  const coursePrerequisites = Array.isArray(prerequisites) ? [...prerequisites] : prerequisites;
  const normalizePhrase = (phrase: string) => phrase.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  const externalPrerequisites = Array.isArray(prerequisites) ? prerequisites.filter((item): item is string => typeof item === 'string').map(normalizePhrase) : [];
  const stages = candidate.stages as Array<Record<string, unknown>>;
  const tasks = stages.flatMap(stage => [
    ...(Array.isArray(stage.mainline) ? stage.mainline as Array<Record<string, unknown>> : []),
    ...(Array.isArray(stage.branches) ? (stage.branches as Array<Record<string, unknown>>).flatMap(branch => Array.isArray(branch.tasks) ? branch.tasks as Array<Record<string, unknown>> : []) : []),
  ]);
  const generatedTaskIds = new Set(tasks.flatMap(task => typeof task.id === 'string' ? [task.id] : []));
  const byPhrase = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const task of tasks) {
    if (typeof task.id !== 'string') continue;
    for (const label of [task.title, task.knowledgePoint]) {
      if (typeof label !== 'string') continue;
      const key = normalizePhrase(label);
      if (byPhrase.has(key) && byPhrase.get(key) !== task.id) ambiguous.add(key);
      else byPhrase.set(key, task.id);
    }
  }
  for (const key of ambiguous) byPhrase.delete(key);
  const normalizeTask = (task: Record<string, unknown>) => {
    if (!Array.isArray(task.prerequisites)) return task;
    const next = task.prerequisites.flatMap((dependency): string[] => {
      if (typeof dependency !== 'string') return [dependency as string];
      const key = normalizePhrase(dependency);
      if (generatedTaskIds.has(dependency)) return [dependency];
      if (byPhrase.has(key)) return [byPhrase.get(key)!];
      if (dependency.length >= 5 && externalPrerequisites.some(item => item.length >= 5 && (item.includes(key) || key.includes(item)))) return [];
      const isReadablePrerequisite = /[\s\p{P}\p{S}]/u.test(dependency) || /[A-Za-z]/u.test(dependency) && /\p{Script=Han}/u.test(dependency);
      if (isReadablePrerequisite && Array.isArray(coursePrerequisites) && !coursePrerequisites.some(item => typeof item === 'string' && normalizePhrase(item) === key)) {
        coursePrerequisites.push(dependency);
        return [];
      }
      return [dependency];
    });
    return { ...task, prerequisites: next };
  };
  const normalizedStages = stages.map(stage => ({
    ...stage,
    ...(Array.isArray(stage.mainline) ? { mainline: (stage.mainline as Array<Record<string, unknown>>).map(normalizeTask) } : {}),
    ...(Array.isArray(stage.branches) ? { branches: (stage.branches as Array<Record<string, unknown>>).map(branch => ({ ...branch, ...(Array.isArray(branch.tasks) ? { tasks: (branch.tasks as Array<Record<string, unknown>>).map(normalizeTask) } : {}) })) } : {}),
  }));
  // Nine-grid outcomes are certified by the required path. Optional branch
  // work may reinforce an outcome, but it must not be an unlock requirement.
  // Older generated drafts can contain both kinds of task IDs; retain their
  // valid mainline evidence so they can be finalized without regenerating tasks.
  const mainlineTaskIds = new Set(normalizedStages.flatMap(stage =>
    Array.isArray(stage.mainline)
      ? (stage.mainline as Array<Record<string, unknown>>).flatMap(task => typeof task.id === 'string' ? [task.id] : [])
      : [],
  ));
  const nineGrid = Array.isArray(candidate.nineGrid)
    ? candidate.nineGrid.map(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      const grid = value as Record<string, unknown>;
      if (!Array.isArray(grid.taskIds)) return grid;
      return { ...grid, taskIds: grid.taskIds.filter((taskId): taskId is string => typeof taskId === 'string' && mainlineTaskIds.has(taskId)) };
    })
    : candidate.nineGrid;
  return { ...candidate, prerequisites: coursePrerequisites, stages: normalizedStages, nineGrid };
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
  if (outline.nineGrid.some(grid => new Set(grid.taskIds).size !== grid.taskIds.length || grid.taskIds.some(taskId => byId.get(taskId)?.track !== 'main'))) return false;
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
