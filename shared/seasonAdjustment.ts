import type { Campaign, LearningState, Stage, Task } from './types';
import { analyzeCurriculumGoalScope } from './curriculum';
import { seasonGoalAdjustmentAssessmentSchema, type SeasonGoalAdjustmentAssessment } from './seasonAdjustmentAssessment';
import { lessonContentSchema } from './schema';
import { lessonExposesReferenceAnswer, taskChallengeContract, usesCodeExample } from './learningChallenge';

export type SeasonGoalAdjustmentInput = { goal: string; desiredArtifact: string };
export const SEASON_ADJUSTMENT_ASSESSMENT_VERSION = 2;
export type SeasonGoalAdjustmentPreviewTask = {
  taskId: string;
  title: string;
  stageId: string;
  stageTitle: string;
  action: 'keep' | 'refresh' | 'replace' | 'review' | 'blocked';
  originalTaskDisposition?: 'move-to-optional-branch';
  reason: string;
  evidence?: string[];
  minutes: number;
  preservesEvidence: true;
  replacement?: Pick<Task, 'id' | 'title' | 'brief' | 'acceptance' | 'deliverable' | 'minutes'>;
  replacementTask?: Task;
  contentReview?: SeasonGoalAdjustmentAssessment['tasks'][number]['contentReview'];
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
  assessmentVersion?: number;
  assessedAt?: string;
  baseRevision?: number;
  campaignId: string;
  goal: string;
  desiredArtifact: string;
  campaignChange?: { titleBefore: string; titleAfter: string; subtitleBefore: string; subtitleAfter: string; reason: string };
  seasonalCollectibleChange?: {
    before: Pick<NonNullable<Campaign['seasonalCollectible']>, 'name' | 'story' | 'appearance' | 'abilityOutcome'>;
    after: Pick<NonNullable<Campaign['seasonalCollectible']>, 'name' | 'story' | 'appearance' | 'abilityOutcome'>;
    reason: string;
  };
  assessment?: SeasonGoalAdjustmentAssessment;
  stageChanges: SeasonGoalAdjustmentPreviewStage[];
  tasks: SeasonGoalAdjustmentPreviewTask[];
  budget: { mainlineMinutesBefore: number; mainlineMinutesAfter: number; movedToOptionalMinutes: number; dailyMinutesBefore: number; dailyMinutes: number; daysBefore: number; days: number };
  notice: string;
};

const languageGoalPattern = /雅思|ielts|英语|english|听力|口语|阅读|写作|语言能力/i;
const explicitProgrammingPattern = /学习(?:编程|python|numpy|开发)|同时.{0,8}(?:编程|开发工具)|编写.{0,12}(?:应用|程序|脚本|工具)|build.{0,20}(?:app|tool|software|script)/i;

function fingerprint(value: unknown): string {
  const input = JSON.stringify(value);
  return [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35].map(seed => {
    let hash = seed;
    for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
    return (hash >>> 0).toString(16).padStart(8, '0');
  }).join('');
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

function languageStageChange(stage: Stage, stageIndex: number, stageCount: number, finding: string): SeasonGoalAdjustmentPreviewStage {
  const cleanedTitle = stage.title
    .replace(/(?:最小)?(?:小工具|工具)(?:数据化|反馈(?:闭环)?|数据建模|反馈生成|打包(?:与依赖固定)?|依赖固定|骨架)?/gi, '')
    .replace(/(?:应用|软件|脚本|计时器|开发|编程|代码|部署|运行环境)(?:骨架|逻辑|记录|开发|部署|阶段)?/gi, '')
    .replace(/[\s与和、·:：]+$/g, '')
    .trim();
  const stageLabel = cleanedTitle && /[\u3400-\u9fff]/.test(cleanedTitle) ? cleanedTitle : `第 ${stageIndex + 1} 阶段`;
  const baseTitle = /雅思|IELTS/i.test(stageLabel) ? stageLabel : `雅思${stageLabel}`;
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
    reason: `${finding}；建议将阶段主旨收回到雅思四科训练。`,
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
    ...(task.goalCapabilityIds ? { goalCapabilityIds: task.goalCapabilityIds } : {}),
    ...(task.goalRelevance ? { goalRelevance: `该练习直接支持“${targetGoal}”中的${skill}能力，并保留可核对的作答证据。` } : {}),
    action: activity.brief,
    prerequisites: [], objectives: [{ id: objectiveId, text: activity.objective }], curiosity: `怎样把这项英语能力迁移到新的材料中？`,
    steps: activity.steps, acceptance: activity.acceptance, recallQuestion: activity.recall,
    hint: '先确认题目要求，再组织答案并用材料或具体例子支撑。', hints: ['先用自己的话确定题目要你完成什么。', '检查答案是否包含要求的证据和解释。'],
    resources: [], track: 'main', chainId: task.chainId, deliverable: activity.deliverable,
    reward: { xp: 0, coins: 0, items: [] },
  };
}

function eligibleReplacements(state: LearningState, targetGoal: string, explicitGoal: string, findings: ReturnType<typeof analyzeCurriculumGoalScope>): Map<string, { stageIndex: number; task: Task; replacement: Task }> {
  const { campaign } = state;
  const shouldReplace = isLanguageGoal(targetGoal) && !explicitProgrammingPattern.test(explicitGoal);
  const replacements = new Map<string, { stageIndex: number; task: Task; replacement: Task }>();
  if (!shouldReplace) return replacements;
  const blockingTaskIds = new Set(findings.filter(item => item.severity === 'blocking' && item.taskId).map(item => item.taskId!));
  campaign.stages.forEach((stage, stageIndex) => {
    let replacementIndex = 0;
    const mainlineIds = new Set(stage.mainlineTaskIds ?? stage.tasks.filter(task => (task.track ?? 'main') === 'main').map(task => task.id));
    for (const task of stage.tasks) {
      if (!mainlineIds.has(task.id) || !blockingTaskIds.has(task.id)) continue;
      replacements.set(task.id, { stageIndex, task, replacement: buildReplacement(campaign, stage.id, task, replacementIndex++, targetGoal) });
    }
  });
  return replacements;
}

export function buildSeasonGoalAdjustmentPreview(state: LearningState, input: SeasonGoalAdjustmentInput, options: { baseRevision?: number } = {}): SeasonGoalAdjustmentPreview {
  const goal = input.goal.trim();
  const desiredArtifact = input.desiredArtifact.trim();
  if (!goal || !desiredArtifact) throw new Error('请填写学习目标和最终成果。');
  const targetText = `${goal}\n${desiredArtifact}`;
  const schedule = targetSchedule(state, targetText);
  const projectedCampaign: Campaign = { ...state.campaign, goal, desiredArtifact, ultimateReward: desiredArtifact };
  const scopeFindings = analyzeCurriculumGoalScope(projectedCampaign, { goal, desiredArtifact, ultimateReward: desiredArtifact });
  const replacements = eligibleReplacements(state, targetText, goal, scopeFindings);
  const isLanguageAdjustment = isLanguageGoal(targetText) && !explicitProgrammingPattern.test(goal);
  const stageFindingById = new Map<string, string>();
  for (const finding of scopeFindings) {
    if (finding.severity === 'review' && !finding.taskId) stageFindingById.set(finding.stageId, finding.reason);
    if (finding.severity === 'blocking' && finding.taskId) stageFindingById.set(finding.stageId, '本阶段存在明确偏离目标的必需主线任务，阶段名称和说明需要同步反映调整后的训练重点。');
  }
  const stageChanges = isLanguageAdjustment
    ? state.campaign.stages.flatMap((stage, index) => stageFindingById.has(stage.id)
      ? [languageStageChange(stage, index, state.campaign.stages.length, stageFindingById.get(stage.id)!)]
      : [])
    : [];
  const allTasks = state.campaign.stages.flatMap((stage, stageIndex) => {
    const mainline = new Set(stage.mainlineTaskIds ?? stage.tasks.filter(task => (task.track ?? 'main') === 'main').map(task => task.id));
    return stage.tasks.filter(task => mainline.has(task.id)).map(task => ({ stageIndex, task }));
  });
  const allTaskRows = state.campaign.stages.flatMap(stage => stage.tasks.map(task => ({ stageId: stage.id, task })));
  const findingByTaskId = new Map(scopeFindings.filter(item => item.taskId).map(item => [item.taskId!, item]));
  const tasks = allTasks.map(({ stageIndex, task }): SeasonGoalAdjustmentPreviewTask => {
    const stage = state.campaign.stages[stageIndex];
    const match = replacements.get(task.id);
    const finding = findingByTaskId.get(task.id);
    const needsReview = Boolean(finding && !match);
    const dependentTasks = allTaskRows.filter(item => item.task.prerequisites.includes(task.id) || (item.task.unlockAfter ?? []).includes(task.id));
    return {
      taskId: task.id, title: task.title, stageId: stage.id, stageTitle: stage.title,
      action: match ? 'replace' : finding?.severity === 'blocking' ? 'blocked' : needsReview ? 'review' : 'keep',
      ...(match ? { originalTaskDisposition: 'move-to-optional-branch' as const } : {}),
      reason: match ? `按目标关联校验，该主线任务的必需交付偏离雅思能力训练；原任务保留为可选支线。${finding?.reason ?? ''}` : finding?.severity === 'blocking' ? `该必需主线任务明确偏离新目标，当前没有安全的目标内替代任务，因此不能应用此预览。${finding.reason}` : needsReview ? finding!.reason : '任务行动、交付物和验收没有发现明确的目标外必需内容；保留主线。',
      ...(finding?.evidence?.length ? { evidence: finding.evidence } : {}),
      minutes: task.minutes, preservesEvidence: true,
      ...(match ? { replacement: { id: match.replacement.id, title: match.replacement.title, brief: match.replacement.brief, acceptance: match.replacement.acceptance, deliverable: match.replacement.deliverable ?? '', minutes: match.replacement.minutes } } : {}),
      dependencyChanges: match ? dependentTasks.map(item => item.task.title) : [],
    };
  });
  const before = allTasks.reduce((sum, item) => sum + item.task.minutes, 0);
  const after = tasks.reduce((sum, item) => sum + (item.action === 'replace' ? item.replacement!.minutes : item.minutes), 0);
  const moved = [...replacements.values()].reduce((sum, item) => sum + item.task.minutes, 0);
  const budget = { mainlineMinutesBefore: before, mainlineMinutesAfter: after, movedToOptionalMinutes: moved, dailyMinutesBefore: state.campaign.dailyMinutes, dailyMinutes: schedule.dailyMinutes, daysBefore: state.campaign.days, days: schedule.days };
  const plan = { campaignId: state.campaign.id, baseRevision: options.baseRevision, goal, desiredArtifact, stageChanges, tasks, budget };
  return {
    previewId: fingerprint({ state, plan }), baseRevision: options.baseRevision,
    campaignId: state.campaign.id, goal, desiredArtifact, stageChanges, tasks, budget,
    notice: tasks.some(item => item.action === 'blocked')
      ? `有 ${tasks.filter(item => item.action === 'blocked').length} 项明确偏离新目标的必需任务尚无安全替代内容；此预览不能应用。请先重新生成目标内任务，再生成调整预览。其余预览仍绑定当前赛季版本。`
      : replacements.size || stageChanges.length || schedule.days !== state.campaign.days || schedule.dailyMinutes !== state.campaign.dailyMinutes
      ? `预览将修正 ${stageChanges.length} 个阶段信息、替换 ${replacements.size} 个明确偏离目标的主线任务；另有 ${tasks.filter(item => item.action === 'review').length} 项需人工确认。预算按替换后任务分钟数重算。旧答案、证据、评价和奖励流水保留，新任务不继承旧评价或重复发奖。`
      : tasks.some(item => item.action === 'review') ? `没有自动替换不确定任务；有 ${tasks.filter(item => item.action === 'review').length} 项需要逐项确认是否符合新目标。`
        : '当前阶段、任务和预算与新目标一致；本次只更新学习目标和最终成果描述。',
  };
}

/** Builds a reviewable plan from one validated AI assessment. */
export function buildAssessedSeasonGoalAdjustmentPreview(
  state: LearningState,
  input: SeasonGoalAdjustmentInput,
  rawAssessment: unknown,
  options: { baseRevision?: number; assessedAt?: string } = {},
): SeasonGoalAdjustmentPreview {
  const parsed = seasonGoalAdjustmentAssessmentSchema.safeParse(rawAssessment);
  if (!parsed.success) throw new Error(`课程目标评估返回了不完整或无效的结构：${parsed.error.issues.map(issue => `${issue.path.join('.')} ${issue.message}`).join('；')}`);
  const assessment = parsed.data;
  const stages = state.campaign.stages;
  const currentCollectible = state.campaign.seasonalCollectible;
  if (Boolean(currentCollectible) !== Boolean(assessment.seasonalCollectible)) throw new Error('课程目标评估必须保留并重评现有赛季收藏，不能静默创建或删除奖励。');
  const mainline = stages.flatMap(stage => {
    const mainlineIds = new Set(stage.mainlineTaskIds ?? stage.tasks.filter(task => (task.track ?? 'main') === 'main').map(task => task.id));
    return stage.tasks.filter(task => mainlineIds.has(task.id)).map(task => ({ stage, task }));
  });
  const sameIds = (left: string[], right: string[]) => left.length === right.length && left.every(id => right.includes(id));
  if (!sameIds(assessment.stages.map(item => item.stageId), stages.map(stage => stage.id))) throw new Error('课程目标评估遗漏或更改了阶段 ID。');
  if (!sameIds(assessment.tasks.map(item => item.taskId), mainline.map(row => row.task.id))) throw new Error('课程目标评估遗漏或新增了主线任务。');
  const mainlineIds = new Set(mainline.map(row => row.task.id));
  if (assessment.nineGrid.some(slot => slot.taskIds.some(taskId => !mainlineIds.has(taskId)))) throw new Error('九格能力引用了不存在的主线任务。');
  const knownSlots = state.campaign.nineGrid?.map(slot => slot.id) ?? [];
  if (knownSlots.length === 9 && !sameIds(assessment.nineGrid.map(slot => slot.id), knownSlots)) throw new Error('课程目标评估更改了九格 ID，无法安全保留已有证据。');
  const coveredCapabilities = new Set(assessment.tasks.flatMap(task => task.goalCapabilityIds));
  if (assessment.capabilities.some(capability => !coveredCapabilities.has(capability.id))) throw new Error('课程目标评估包含没有主线任务覆盖的能力。');

  const goal = input.goal.trim();
  const desiredArtifact = input.desiredArtifact.trim();
  if (!goal || !desiredArtifact) throw new Error('请填写学习目标和最终成果。');
  const base = buildSeasonGoalAdjustmentPreview(state, input, options);
  const staticRows = new Map(base.tasks.map(row => [row.taskId, row]));
  const allTaskRows = stages.flatMap(stage => stage.tasks.map(task => ({ stage, task })));
  const capabilityIds = new Set(assessment.capabilities.map(capability => capability.id));
  const assessedTasks = new Map(assessment.tasks.map(item => [item.taskId, item]));
  const assessedAt = options.assessedAt ?? state.campaign.createdAt;
  const tasks: SeasonGoalAdjustmentPreviewTask[] = mainline.map(({ stage, task }) => {
    const reviewed = assessedTasks.get(task.id)!;
    const staticFinding = staticRows.get(task.id);
    const hardMismatch = staticFinding?.action === 'blocked';
    const action: SeasonGoalAdjustmentPreviewTask['action'] = hardMismatch && reviewed.action === 'keep' ? 'blocked' : reviewed.action;
    if (reviewed.action === 'keep' && !(state.content?.[task.id] ?? task.teaching)) throw new Error(`任务「${task.title}」尚无已保存讲解；必须生成并审阅新教学内容后才能确认同步。`);
    if (reviewed.goalCapabilityIds.some(id => !capabilityIds.has(id))) throw new Error(`任务 ${task.title} 引用了未声明的目标能力。`);
    const dependents = allTaskRows.filter(row => row.task.prerequisites.includes(task.id) || (row.task.unlockAfter ?? []).includes(task.id));
    let replacementTask: Task | undefined;
    if ((action === 'refresh' || action === 'replace') && reviewed.replacement && reviewed.lesson) {
      const replacementId = `goal_${fingerprint([state.campaign.id, stage.id, task.id, goal, desiredArtifact, reviewed.replacement, reviewed.lesson])}`;
      replacementTask = {
        id: replacementId, title: reviewed.replacement.title, brief: reviewed.replacement.brief,
        kind: task.kind, minutes: task.minutes, xp: 0, prerequisites: [...task.prerequisites],
        objectives: reviewed.replacement.objectives.map((text, index) => ({ id: `${replacementId}_objective_${index + 1}`, text })),
        curiosity: reviewed.replacement.curiosity, steps: [...reviewed.replacement.steps],
        acceptance: reviewed.replacement.acceptance, recallQuestion: reviewed.replacement.recallQuestion,
        hint: reviewed.replacement.hint, hints: [...reviewed.replacement.hints], resources: [],
        track: 'main', chainId: task.chainId, goalCapabilityIds: [...reviewed.goalCapabilityIds],
        goalRelevance: reviewed.goalRelevance, action: reviewed.replacement.action,
        deliverable: reviewed.replacement.deliverable, reward: { xp: 0, coins: 0, items: [] },
      };
      const contract = taskChallengeContract(replacementTask);
      const lesson = lessonContentSchema.safeParse({
        ...reviewed.lesson,
        example: { ...reviewed.lesson.example, kind: usesCodeExample(replacementTask) ? 'code' : 'text' },
        challenge: { ...reviewed.lesson.challenge, prompt: contract.prompt, rubric: contract.rubric },
        language: state.campaign.language ?? reviewed.lesson.language,
        generatedAt: assessedAt,
        revision: 1,
      });
      if (!lesson.success || lessonExposesReferenceAnswer(lesson.data)) throw new Error(`任务「${task.title}」的新讲解或独立挑战未通过结构与答案隔离校验，不能应用预览。`);
      replacementTask.teaching = lesson.data;
    }
    const deterministicConflict = hardMismatch && reviewed.action === 'keep';
    return {
      taskId: task.id, title: task.title, stageId: stage.id, stageTitle: stage.title, action,
      ...(action === 'refresh' || action === 'replace' ? { originalTaskDisposition: 'move-to-optional-branch' as const } : {}),
      reason: deterministicConflict
        ? `确定性规则发现该任务包含目标外的必需内容；评估建议保留，不能自动应用。${staticFinding?.reason ?? ''}`
        : reviewed.reason,
      evidence: reviewed.evidence.length ? reviewed.evidence : staticFinding?.evidence,
      minutes: task.minutes, preservesEvidence: true,
      contentReview: reviewed.contentReview,
      ...(replacementTask ? {
        replacement: { id: replacementTask.id, title: replacementTask.title, brief: replacementTask.brief, acceptance: replacementTask.acceptance, deliverable: replacementTask.deliverable ?? '', minutes: replacementTask.minutes },
        replacementTask,
      } : {}),
      dependencyChanges: action === 'refresh' || action === 'replace' ? dependents.map(row => row.task.title) : [],
    };
  });

  const stageChanges = assessment.stages.flatMap(item => {
    const before = stages.find(stage => stage.id === item.stageId)!;
    return before.title === item.title && before.description === item.description ? [] : [{
      stageId: item.stageId, titleBefore: before.title, titleAfter: item.title,
      descriptionBefore: before.description, descriptionAfter: item.description, reason: item.reason,
    }];
  });
  const campaignChange = state.campaign.title === assessment.campaign.title && state.campaign.subtitle === assessment.campaign.subtitle ? undefined : {
    titleBefore: state.campaign.title, titleAfter: assessment.campaign.title,
    subtitleBefore: state.campaign.subtitle, subtitleAfter: assessment.campaign.subtitle,
    reason: assessment.rationale,
  };
  const assessedCollectible = assessment.seasonalCollectible;
  const seasonalCollectibleChange = currentCollectible && assessedCollectible && (
    currentCollectible.name !== assessedCollectible.name || currentCollectible.story !== assessedCollectible.story ||
    currentCollectible.appearance !== assessedCollectible.appearance || currentCollectible.abilityOutcome !== assessedCollectible.abilityOutcome
  ) ? {
    before: { name: currentCollectible.name, story: currentCollectible.story, appearance: currentCollectible.appearance, abilityOutcome: currentCollectible.abilityOutcome },
    after: { name: assessedCollectible.name, story: assessedCollectible.story, appearance: assessedCollectible.appearance, abilityOutcome: assessedCollectible.abilityOutcome },
    reason: assessedCollectible.reason,
  } : undefined;
  const mainlineMinutes = mainline.reduce((sum, row) => sum + row.task.minutes, 0);
  const replacementMinutes = tasks.filter(row => row.action === 'replace' || row.action === 'refresh').reduce((sum, row) => sum + row.minutes, 0);
  const mainlineMinutesAfter = tasks.reduce((sum, row) => sum + ((row.action === 'replace' || row.action === 'refresh') ? row.replacement?.minutes ?? row.minutes : row.minutes), 0);
  const budget = { ...base.budget, mainlineMinutesBefore: mainlineMinutes, mainlineMinutesAfter, movedToOptionalMinutes: replacementMinutes };
  const assessmentVersion = SEASON_ADJUSTMENT_ASSESSMENT_VERSION;
  const plan = { assessmentVersion, campaignId: state.campaign.id, baseRevision: options.baseRevision, assessedAt, goal, desiredArtifact, campaignChange, seasonalCollectibleChange, assessment, stageChanges, tasks, budget };
  const blockedCount = tasks.filter(row => row.action === 'blocked').length;
  const reviewCount = tasks.filter(row => row.action === 'review').length;
  return {
    previewId: fingerprint({ state, plan }), assessmentVersion, assessedAt, baseRevision: options.baseRevision, campaignId: state.campaign.id,
    goal, desiredArtifact, campaignChange, seasonalCollectibleChange, assessment, stageChanges, tasks, budget,
    notice: blockedCount
      ? `有 ${blockedCount} 项主线任务与新目标存在明确冲突，此预览不能应用。`
      : reviewCount
        ? `有 ${reviewCount} 项任务的目标关联仍不确定；补充目标或材料后重新评估，不能默认作为必需主线。`
        : `评估覆盖了赛季名称、${stageChanges.length} 个阶段、${tasks.length} 项主线任务的任务合同与讲解内容、${assessment.capabilities.length} 项目标能力和九格成果${seasonalCollectibleChange ? '及赛季收藏说明' : ''}。需要更新的任务以新版本进入主线，旧任务、答案、证据、评价和奖励流水保留在原任务记录中；新版本不继承旧验收。未领取收藏会同步更新；已领取收藏保留历史描述。`,
  };
}

export function applySeasonGoalAdjustment(state: LearningState, preview: SeasonGoalAdjustmentPreview): LearningState {
  if (preview.campaignId !== state.campaign.id) throw new Error('预览不属于当前赛季。');
  const current = preview.assessment
    ? buildAssessedSeasonGoalAdjustmentPreview(state, preview, preview.assessment, { baseRevision: preview.baseRevision, assessedAt: preview.assessedAt })
    : buildSeasonGoalAdjustmentPreview(state, preview, { baseRevision: preview.baseRevision });
  if (current.previewId !== preview.previewId) throw new Error('赛季内容已变化，请重新生成调整预览。');
  if (preview.tasks.some(item => item.action === 'blocked')) throw new Error('该调整含有明确偏离目标且尚无替代的主线任务；请重新生成任务后再创建预览。');
  if (preview.assessment && preview.tasks.some(item => item.action === 'review')) throw new Error('仍有任务的目标关联待确认，不能应用。');
  const projectedCampaign: Campaign = { ...state.campaign, goal: preview.goal, desiredArtifact: preview.desiredArtifact, ultimateReward: preview.desiredArtifact };
  const scopeFindings = analyzeCurriculumGoalScope(projectedCampaign, { goal: preview.goal, desiredArtifact: preview.desiredArtifact, ultimateReward: preview.desiredArtifact });
  const replacements = preview.assessment
    ? new Map(preview.tasks.filter(item => item.action === 'replace' || item.action === 'refresh').map(item => {
      const row = state.campaign.stages.flatMap((stage, stageIndex) => stage.tasks.map(task => ({ stageIndex, task }))).find(candidate => candidate.task.id === item.taskId)!;
      if (!item.replacementTask) throw new Error('替换任务内容缺失，请重新生成预览。');
      return [item.taskId, { stageIndex: row.stageIndex, task: row.task, replacement: item.replacementTask }] as const;
    }))
    : eligibleReplacements(state, `${preview.goal}\n${preview.desiredArtifact}`, preview.goal, scopeFindings);
  const next = structuredClone(state);
  const replacedIds = new Map([...replacements].map(([id, value]) => [id, value.replacement.id]));
  const branchIdsByStage = new Map<number, string[]>();

  next.campaign.goal = preview.goal;
  next.campaign.desiredArtifact = preview.desiredArtifact;
  next.campaign.ultimateReward = preview.desiredArtifact;
  if (preview.campaignChange) {
    next.campaign.title = preview.campaignChange.titleAfter;
    next.campaign.subtitle = preview.campaignChange.subtitleAfter;
  }
  if (preview.assessment) {
    next.campaign.goalCapabilities = structuredClone(preview.assessment.capabilities);
    const assessedTasks = new Map(preview.assessment.tasks.map(item => [item.taskId, item]));
    for (const stage of next.campaign.stages) for (const task of stage.tasks) {
      const assessed = assessedTasks.get(task.id);
      if (!assessed || assessed.action === 'replace' || assessed.action === 'refresh') continue;
      task.goalCapabilityIds = [...assessed.goalCapabilityIds];
      task.goalRelevance = assessed.goalRelevance;
    }
    const replacementIds = new Map(preview.tasks.filter(item => (item.action === 'replace' || item.action === 'refresh') && item.replacement).map(item => [item.taskId, item.replacement!.id]));
    next.campaign.nineGrid = preview.assessment.nineGrid.map(slot => ({
      id: slot.id, title: slot.title, ability: slot.ability, value: slot.value,
      unlockTaskIds: slot.taskIds.map(id => replacementIds.get(id) ?? id),
      ...(state.campaign.nineGrid?.find(existing => existing.id === slot.id)?.artifact ? { artifact: state.campaign.nineGrid.find(existing => existing.id === slot.id)!.artifact } : {}),
    }));
    if (next.campaign.seasonalCollectible && preview.assessment.seasonalCollectible) {
      const collectible = next.campaign.seasonalCollectible;
      const reassessed = preview.assessment.seasonalCollectible;
      next.campaign.seasonalCollectible = {
        ...collectible,
        name: reassessed.name,
        story: reassessed.story,
        appearance: reassessed.appearance,
        abilityOutcome: reassessed.abilityOutcome,
        finalTaskId: replacedIds.get(collectible.finalTaskId) ?? collectible.finalTaskId,
      };
    }
  }
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
    if (!chains.some(chain => chain.id === mainReplacementChainId)) chains.push({ id: mainReplacementChainId, title: preview.assessment ? '目标核心训练' : '雅思核心训练', track: 'main' as const, taskIds: stageReplacementIds.size ? stage.mainlineTaskIds?.map(id => replacedIds.get(id) ?? id) ?? tasks.filter(task => task.track === 'main').map(task => task.id) : [], completionReward: { xp: 0, coins: 0, items: [] } });
    if (stageReplacementIds.size) chains.push({ id: branchChainId, title: '原任务（可选）', track: 'branch' as const, taskIds: [...stageReplacementIds], completionReward: { xp: 0, coins: 0, items: [] } });
    return {
      ...stage, tasks, chains,
      ...(stage.mainlineTaskIds ? { mainlineTaskIds: stage.mainlineTaskIds.map(id => replacedIds.get(id) ?? id) } : {}),
      ...(stage.gateTaskIds ? { gateTaskIds: stage.gateTaskIds.map(id => replacedIds.get(id) ?? id) } : {}),
    };
  });
  if (preview.assessment) for (const stage of next.campaign.stages) for (const task of stage.tasks) {
    if (task.track !== 'branch') continue;
    delete task.goalCapabilityIds;
    delete task.goalRelevance;
  }

  for (const [oldId, newId] of replacedIds) {
    const oldTask = state.campaign.stages.flatMap(stage => stage.tasks).find(task => task.id === oldId)!;
    const newTask = next.campaign.stages.flatMap(stage => stage.tasks).find(task => task.id === newId)!;
    next.progress[newId] = { completedObjectives: [], evidence: '', status: 'idle' };
    if (newTask.teaching) next.content = { ...(next.content ?? {}), [newId]: structuredClone(newTask.teaching) };
    if (next.lastTaskId === oldId) next.lastTaskId = newId;
    for (const grid of next.campaign.nineGrid ?? []) grid.unlockTaskIds = grid.unlockTaskIds.map(id => id === oldId ? newId : id);
    if (next.campaign.seasonalCollectible?.finalTaskId === oldId) next.campaign.seasonalCollectible.finalTaskId = newId;
    if (!newTask.objectives.length || oldTask.id === newTask.id) throw new Error('无法安全建立新的主线任务。');
    if (next.reviews.some(card => card.taskId === newId)) next.reviews = next.reviews.filter(card => card.taskId !== newId);
  }
  if (next.schedules) {
    next.schedules = Object.fromEntries(Object.entries(next.schedules).map(([date, schedule]) => [date, {
      ...schedule,
      items: schedule.items.map(item => {
        const replacementId = replacedIds.get(item.taskId);
        if (!replacementId) return item;
        const replacement = next.campaign.stages.flatMap(stage => stage.tasks).find(task => task.id === replacementId)!;
        return { ...item, taskId: replacementId, deliverable: replacement.deliverable ?? replacement.acceptance };
      }),
    }]));
  }
  return next;
}
