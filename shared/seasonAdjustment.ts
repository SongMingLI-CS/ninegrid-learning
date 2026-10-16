import type { Campaign, LearningState, Stage, Task } from './types';

export type SeasonGoalAdjustmentInput = { goal: string; desiredArtifact: string };
export type SeasonGoalAdjustmentPreviewTask = {
  taskId: string;
  title: string;
  stageId: string;
  stageTitle: string;
  action: 'keep' | 'replace';
  originalTaskDisposition?: 'move-to-optional-branch';
  reason: string;
  minutes: number;
  preservesEvidence: true;
  replacement?: Pick<Task, 'id' | 'title' | 'brief' | 'acceptance' | 'deliverable' | 'minutes'>;
  dependencyChanges: string[];
};
export type SeasonGoalAdjustmentPreviewStage = {
  stageId: string;
  titleBefore: string;
  titleAfter: string;
  descriptionBefore: string;
  descriptionAfter: string;
  reason: string;
};
export type SeasonGoalAdjustmentPreview = {
  previewId: string;
  campaignId: string;
  goal: string;
  desiredArtifact: string;
  stageChanges: SeasonGoalAdjustmentPreviewStage[];
  tasks: SeasonGoalAdjustmentPreviewTask[];
  budget: { mainlineMinutesBefore: number; mainlineMinutesAfter: number; movedToOptionalMinutes: number; dailyMinutesBefore: number; dailyMinutes: number; daysBefore: number; days: number };
  notice: string;
};

const programmingPattern = /\b(?:python|numpy|script|timer|deploy|deployment|environment|code|coding|programming|software|tool)\b|运行环境|脚本|计时器|部署|代码|编程|开发工具|小工具/i;
const languageGoalPattern = /雅思|ielts|英语|english|听力|口语|阅读|写作|语言能力/i;
const explicitProgrammingPattern = /学习(?:编程|python|numpy|开发)|同时.{0,8}(?:编程|开发工具)|编写.{0,12}(?:应用|程序|脚本|工具)|build.{0,20}(?:app|tool|software|script)/i;

function fingerprint(value: unknown): string {
  const input = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function isProgrammingTask(task: Task): boolean {
  return programmingPattern.test([task.title, task.brief, task.deliverable ?? '', task.acceptance, ...task.steps].join(' '));
}

function isLanguageGoal(goal: string): boolean { return languageGoalPattern.test(goal); }

function targetSchedule(state: LearningState, targetText: string): { days: number; dailyMinutes: number } {
  const hasTwoMonthMilestone = /(?:两个月|两个(?:月)?目标|第二个月|2\s*个?月|2\s*months?)/i.test(targetText)
    || /(?:一个月|1\s*month).{0,24}两个\s*\d/i.test(targetText);
  const explicitDailyMinutes = targetText.match(/(?:每天|每日|daily)\s*(\d{1,3})\s*(?:分钟|minutes?|mins?)|\b(\d{1,3})\s*(?:分钟|minutes?|mins?)\s*(?:每天|每日|daily)\b/i);
  const requestedMinutes = explicitDailyMinutes ? Number(explicitDailyMinutes[1] ?? explicitDailyMinutes[2]) : undefined;
  if (!isLanguageGoal(targetText)) return { days: state.campaign.days, dailyMinutes: requestedMinutes ?? state.campaign.dailyMinutes };
  return {
    days: hasTwoMonthMilestone ? 60 : state.campaign.days,
    dailyMinutes: requestedMinutes ?? (hasTwoMonthMilestone ? 80 : state.campaign.dailyMinutes),
  };
}

function languageStageChange(stage: Stage, stageIndex: number, stageCount: number): SeasonGoalAdjustmentPreviewStage | undefined {
  if (!programmingPattern.test(`${stage.title} ${stage.description}`)) return undefined;
  const cleanedTitle = stage.title
    .replace(/(?:最小)?(?:小工具|工具|应用|软件|脚本|计时器|开发|编程|代码|部署|运行环境)(?:骨架|逻辑|记录|开发|部署|阶段)?/gi, '')
    .replace(/[\s与和、·:：]+$/g, '')
    .trim();
  const baseTitle = cleanedTitle && /雅思|IELTS/i.test(cleanedTitle) ? cleanedTitle : `雅思阶段 ${stageIndex + 1}`;
  const titleAfter = `${baseTitle}与四科训练`;
  const descriptionAfter = stageIndex === 0
    ? '围绕雅思听、说、读、写建立能力基线，熟悉题型与评分要求，并形成可核对的练习证据。'
    : stageIndex === stageCount - 1
      ? '通过限时综合练习检验雅思目标能力，补齐薄弱项并整理最终成果。'
      : '围绕阶段重点完成雅思专项练习，并使用新材料验证理解与迁移能力。';
  return {
    stageId: stage.id,
    titleBefore: stage.title,
    titleAfter,
    descriptionBefore: stage.description,
    descriptionAfter,
    reason: '阶段名称或说明仍包含工具开发内容；雅思四科训练应作为本阶段核心。',
  };
}

function buildReplacement(campaign: Campaign, stageId: string, task: Task, index: number, targetGoal: string): Task {
  const skill = ['阅读', '听力', '写作', '口语'][index % 4];
  const content: Record<string, { title: string; brief: string; objective: string; acceptance: string; deliverable: string; steps: string[]; recall: string }> = {
    '阅读': {
      title: '雅思阅读：主旨与证据定位', brief: '阅读一段符合当前水平的英文材料，概括核心观点，并用原文证据支持判断。', objective: '准确概括材料主旨，并标出能够支持结论的英文证据。', acceptance: '提交 1 句英文或中文主旨概括、至少 2 处原文定位证据，并说明证据与结论的对应关系。', deliverable: '主旨概括与定位证据', steps: ['先限时通读材料，写下作者主要观点。', '圈出支撑观点的关键词句，区分事实与推断。', '用自己的话概括，并逐条说明证据如何支持主旨。'], recall: '哪一处原文证据最能支撑你的主旨概括？为什么？',
    },
    '听力': {
      title: '雅思听力：关键信息与干扰项', brief: '听取一段日常或学术语境材料，记录关键信息并解释一个易混淆细节。', objective: '从听力材料中提取关键信息，并用上下文排除干扰项。', acceptance: '提交至少 3 条关键信息及其时间/人物/原因关系，并解释 1 个干扰项为何不成立。', deliverable: '听力关键信息记录与干扰项说明', steps: ['第一次听时记录主题和说话人目的。', '第二次听时补全数字、转折和因果信息。', '对照上下文检查易混淆选项，写明排除依据。'], recall: '你用什么信号识别了材料中的转折或修正？',
    },
    '写作': {
      title: '雅思写作：观点段落与论证', brief: '围绕一个与目标相关的 IELTS 写作题目，完成有明确立场、解释和例证的段落。', objective: '写出立场清晰、论证连贯且例证相关的英文段落。', acceptance: '提交 100–160 词英文段落，包含主题句、解释、具体例子和回扣观点；标出并修正至少 1 处语言问题。', deliverable: '一段经自查的 IELTS 英文论证', steps: ['拆解题目中的主题和限定条件。', '用主题句表明观点，再补充解释和具体例证。', '检查段落衔接、语法和词汇准确性，并说明一项修改理由。'], recall: '哪一句把例证和段落主张连接起来？',
    },
    '口语': {
      title: '雅思口语：展开回答与具体细节', brief: '针对一个 IELTS 口语问题作答，形成直接回应、解释和具体细节的连贯表达。', objective: '在限定时间内给出切题、连贯且包含具体细节的口语回答。', acceptance: '提交 45–90 秒录音或转写，直接回答问题，至少给出 2 个相关细节，并使用清楚的连接表达。', deliverable: '一段切题且有细节的 IELTS 口语回答', steps: ['用一句话直接回应问题。', '补充原因、经历或对比等具体细节。', '回听或复读，检查是否跑题、重复或缺少解释。'], recall: '哪个具体细节让你的回答更有说服力？',
    },
  };
  const activity = content[skill];
  const id = `goal_${fingerprint([campaign.id, stageId, task.id, targetGoal, skill])}`;
  const objectiveId = `${id}_objective`;
  return {
    id, title: activity.title, brief: activity.brief, kind: task.kind, minutes: task.minutes, xp: 0,
    prerequisites: [], objectives: [{ id: objectiveId, text: activity.objective }], curiosity: `怎样把这项英语能力迁移到新的材料中？`,
    steps: activity.steps, acceptance: activity.acceptance, recallQuestion: activity.recall,
    hint: '先确认题目要求，再组织答案并用材料或具体例子支撑。', hints: ['先用自己的话确定题目要你完成什么。', '检查答案是否包含要求的证据和解释。'],
    resources: [], track: 'main', chainId: task.chainId, deliverable: activity.deliverable,
    reward: { xp: 0, coins: 0, items: [] },
  };
}

function eligibleReplacements(state: LearningState, targetGoal = state.campaign.goal, explicitGoal = targetGoal): Map<string, { stageIndex: number; task: Task; replacement: Task }> {
  const { campaign } = state;
  const shouldReplace = isLanguageGoal(targetGoal) && !explicitProgrammingPattern.test(explicitGoal);
  const replacements = new Map<string, { stageIndex: number; task: Task; replacement: Task }>();
  if (!shouldReplace) return replacements;
  campaign.stages.forEach((stage, stageIndex) => {
    let replacementIndex = 0;
    const mainlineIds = new Set(stage.mainlineTaskIds ?? stage.tasks.filter(task => (task.track ?? 'main') === 'main').map(task => task.id));
    for (const task of stage.tasks) {
      if (!mainlineIds.has(task.id) || !isProgrammingTask(task)) continue;
      replacements.set(task.id, { stageIndex, task, replacement: buildReplacement(campaign, stage.id, task, replacementIndex++, targetGoal) });
    }
  });
  return replacements;
}

export function buildSeasonGoalAdjustmentPreview(state: LearningState, input: SeasonGoalAdjustmentInput): SeasonGoalAdjustmentPreview {
  const goal = input.goal.trim();
  const desiredArtifact = input.desiredArtifact.trim();
  if (!goal || !desiredArtifact) throw new Error('请填写学习目标和最终成果。');
  const targetText = `${goal}\n${desiredArtifact}`;
  const schedule = targetSchedule(state, targetText);
  const replacements = eligibleReplacements(state, targetText, goal);
  const stageChanges = isLanguageGoal(targetText) && !explicitProgrammingPattern.test(goal)
    ? state.campaign.stages.flatMap((stage, index) => {
      const change = languageStageChange(stage, index, state.campaign.stages.length);
      return change ? [change] : [];
    })
    : [];
  const allTasks = state.campaign.stages.flatMap((stage, stageIndex) => {
    const mainline = new Set(stage.mainlineTaskIds ?? stage.tasks.filter(task => (task.track ?? 'main') === 'main').map(task => task.id));
    return stage.tasks.filter(task => mainline.has(task.id)).map(task => ({ stageIndex, task }));
  });
  const tasks = allTasks.map(({ stageIndex, task }): SeasonGoalAdjustmentPreviewTask => {
    const stage = state.campaign.stages[stageIndex];
    const match = replacements.get(task.id);
    const dependentTasks = allTasks.filter(item => item.task.prerequisites.includes(task.id) || (item.task.unlockAfter ?? []).includes(task.id));
    return {
      taskId: task.id, title: task.title, stageId: stage.id, stageTitle: stage.title,
      action: match ? 'replace' : 'keep',
      ...(match ? { originalTaskDisposition: 'move-to-optional-branch' as const } : {}),
      reason: match ? '该主线任务要求脚本、开发或部署，而当前目标是雅思语言训练；原任务将保留为可选支线。' : '与新的学习目标一致，继续保留为主线任务。',
      minutes: task.minutes, preservesEvidence: true,
      ...(match ? { replacement: { id: match.replacement.id, title: match.replacement.title, brief: match.replacement.brief, acceptance: match.replacement.acceptance, deliverable: match.replacement.deliverable ?? '', minutes: match.replacement.minutes } } : {}),
      dependencyChanges: match ? dependentTasks.map(item => item.task.title) : [],
    };
  });
  const before = allTasks.reduce((sum, item) => sum + item.task.minutes, 0);
  const moved = [...replacements.values()].reduce((sum, item) => sum + item.task.minutes, 0);
  return {
    previewId: fingerprint({ campaignId: state.campaign.id, input: { goal, desiredArtifact }, schedule, revisionData: state.campaign.stages.map(stage => [stage.title, stage.description, stage.tasks.map(task => [task.id, task.title, task.minutes, task.prerequisites])]) }),
    campaignId: state.campaign.id, goal, desiredArtifact, stageChanges, tasks,
    budget: { mainlineMinutesBefore: before, mainlineMinutesAfter: before, movedToOptionalMinutes: moved, dailyMinutesBefore: state.campaign.dailyMinutes, dailyMinutes: schedule.dailyMinutes, daysBefore: state.campaign.days, days: schedule.days },
    notice: replacements.size || stageChanges.length || schedule.days !== state.campaign.days || schedule.dailyMinutes !== state.campaign.dailyMinutes
      ? `预览将修正 ${stageChanges.length} 个阶段信息、替换 ${replacements.size} 个偏离目标的主线任务，并按目标调整周期与每日预算；旧答案、证据、评价和奖励流水保留，新任务不继承旧评价或重复发奖。`
      : '当前阶段、任务和预算已与新目标一致；本次只更新学习目标和最终成果描述。',
  };
}

export function applySeasonGoalAdjustment(state: LearningState, preview: SeasonGoalAdjustmentPreview): LearningState {
  if (preview.campaignId !== state.campaign.id) throw new Error('预览不属于当前赛季。');
  const current = buildSeasonGoalAdjustmentPreview(state, preview);
  if (current.previewId !== preview.previewId) throw new Error('赛季内容已变化，请重新生成调整预览。');
  const replacements = eligibleReplacements(state, `${preview.goal}\n${preview.desiredArtifact}`, preview.goal);
  const next = structuredClone(state);
  const replacedIds = new Map([...replacements].map(([id, value]) => [id, value.replacement.id]));
  const branchIdsByStage = new Map<number, string[]>();

  next.campaign.goal = preview.goal;
  next.campaign.desiredArtifact = preview.desiredArtifact;
  next.campaign.ultimateReward = preview.desiredArtifact;
  next.campaign.days = preview.budget.days;
  next.campaign.dailyMinutes = preview.budget.dailyMinutes;
  for (const change of preview.stageChanges) {
    const stage = next.campaign.stages.find(item => item.id === change.stageId);
    if (!stage) throw new Error('赛季阶段已变化，请重新生成预览。');
    stage.title = change.titleAfter;
    stage.description = change.descriptionAfter;
  }

  for (const [taskId, { stageIndex }] of replacements) {
    const ids = branchIdsByStage.get(stageIndex) ?? [];
    ids.push(taskId); branchIdsByStage.set(stageIndex, ids);
  }

  next.campaign.stages = next.campaign.stages.map((stage, stageIndex) => {
    const stageReplacementIds = new Set([...replacements].filter(([, value]) => value.stageIndex === stageIndex).map(([id]) => id));
    const remap = (ids: string[]) => ids.map(id => replacedIds.get(id) ?? id);
    if (!stageReplacementIds.size) return {
      ...stage,
      tasks: stage.tasks.map(task => ({ ...task, prerequisites: remap(task.prerequisites), ...(task.unlockAfter ? { unlockAfter: remap(task.unlockAfter) } : {}) })),
      ...(stage.mainlineTaskIds ? { mainlineTaskIds: remap(stage.mainlineTaskIds) } : {}),
      ...(stage.gateTaskIds ? { gateTaskIds: remap(stage.gateTaskIds) } : {}),
    };
    const stageReplacements = [...replacements].filter(([, value]) => value.stageIndex === stageIndex);
    const branchChainId = `legacy_${fingerprint([next.campaign.id, stage.id, 'optional'])}`;
    const previousChainByTask = new Map((stage.chains ?? []).flatMap(chain => chain.taskIds.map(taskId => [taskId, chain] as const)));
    const tasks = stage.tasks.flatMap(task => {
      const replacement = replacements.get(task.id);
      if (!replacement) {
        return [{ ...task, prerequisites: remap(task.prerequisites), ...(task.unlockAfter ? { unlockAfter: remap(task.unlockAfter) } : {}) }];
      }
      const previousChain = previousChainByTask.get(task.id);
      return [
        { ...replacement.replacement, prerequisites: remap(task.prerequisites), ...(task.unlockAfter ? { unlockAfter: remap(task.unlockAfter) } : {}), chainId: previousChain?.track === 'main' ? previousChain.id : `main_${fingerprint([stage.id, 'replacement'])}` },
        { ...task, track: 'branch' as const, chainId: branchChainId },
      ];
    });
    const mainReplacementChainId = stage.chains?.find(chain => chain.track === 'main')?.id ?? `main_${fingerprint([stage.id, 'replacement'])}`;
    for (const task of tasks) {
      if (task.track === 'main' && replacements.has(task.id)) task.chainId = mainReplacementChainId;
    }
    const chains = (stage.chains ?? []).flatMap(chain => {
      if (chain.track !== 'main') return [chain];
      const taskIds = chain.taskIds.map(id => replacedIds.get(id) ?? id);
      return taskIds.length ? [{ ...chain, taskIds }] : [];
    });
    if (!chains.some(chain => chain.id === mainReplacementChainId)) chains.push({ id: mainReplacementChainId, title: '雅思核心训练', track: 'main' as const, taskIds: stageReplacementIds.size ? stage.mainlineTaskIds?.map(id => replacedIds.get(id) ?? id) ?? tasks.filter(task => task.track === 'main').map(task => task.id) : [], completionReward: { xp: 0, coins: 0, items: [] } });
    if (stageReplacementIds.size) chains.push({ id: branchChainId, title: '原工具开发任务（可选）', track: 'branch' as const, taskIds: [...stageReplacementIds], completionReward: { xp: 0, coins: 0, items: [] } });
    return {
      ...stage, tasks, chains,
      ...(stage.mainlineTaskIds ? { mainlineTaskIds: stage.mainlineTaskIds.map(id => replacedIds.get(id) ?? id) } : {}),
      ...(stage.gateTaskIds ? { gateTaskIds: stage.gateTaskIds.map(id => replacedIds.get(id) ?? id) } : {}),
    };
  });

  for (const [oldId, newId] of replacedIds) {
    const oldTask = state.campaign.stages.flatMap(stage => stage.tasks).find(task => task.id === oldId)!;
    const newTask = next.campaign.stages.flatMap(stage => stage.tasks).find(task => task.id === newId)!;
    next.progress[newId] = { completedObjectives: [], evidence: '', status: 'idle' };
    if (next.lastTaskId === oldId) next.lastTaskId = newId;
    for (const grid of next.campaign.nineGrid ?? []) grid.unlockTaskIds = grid.unlockTaskIds.map(id => id === oldId ? newId : id);
    if (next.campaign.seasonalCollectible?.finalTaskId === oldId) next.campaign.seasonalCollectible.finalTaskId = newId;
    if (!newTask.objectives.length || oldTask.id === newTask.id) throw new Error('无法安全建立新的主线任务。');
    if (next.reviews.some(card => card.taskId === newId)) next.reviews = next.reviews.filter(card => card.taskId !== newId);
  }
  return next;
}
