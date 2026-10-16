export type ChallengeMode = 'free' | 'ordinary' | 'confidential' | 'top-secret';
export type ChallengeRunStatus = 'active' | 'evaluating' | 'ready_to_extract' | 'passed' | 'failed' | 'abandoned' | 'technical_error' | 'technical_refund';

export const CHALLENGE_QUESTION_COUNTS: Record<ChallengeMode, number> = {
  free: 5,
  ordinary: 5,
  confidential: 10,
  'top-secret': 15,
};

export interface ChallengeModeSetting {
  title: string;
  questionCount: number;
  correctToPass: number;
  minutes: number;
  entryFee: number;
  hintLimit: number;
  difficulty: string;
  questionStyle: string;
  paid: boolean;
}

export const CHALLENGE_MODE_SETTINGS: Record<ChallengeMode, ChallengeModeSetting> = {
  free: {
    title: '免费训练', questionCount: 5, correctToPass: 3, minutes: 20, entryFee: 0, hintLimit: 2,
    difficulty: '基础回忆与直接应用', questionStyle: '直接回忆概念，或在当前情境中完成一步应用。', paid: false,
  },
  ordinary: {
    title: '普通行动', questionCount: 5, correctToPass: 3, minutes: 20, entryFee: 100_000, hintLimit: 2,
    difficulty: '基础回忆与直接应用', questionStyle: '直接应用：在给定情境中完成目标，并简要说明依据。', paid: true,
  },
  confidential: {
    title: '机密行动', questionCount: 10, correctToPass: 7, minutes: 35, entryFee: 300_000, hintLimit: 1,
    difficulty: '多步推理与错误诊断', questionStyle: '多步诊断：说明关键判断、完成过程，并找出常见错误。', paid: true,
  },
  'top-secret': {
    title: '绝密行动', questionCount: 15, correctToPass: 12, minutes: 50, entryFee: 600_000, hintLimit: 0,
    difficulty: '综合迁移与边界验证', questionStyle: '综合迁移：在新情境或边界条件下应用知识，验证结果并解释取舍。', paid: true,
  },
};

export interface ChallengeQuestionTask {
  id: string;
  title: string;
  brief: string;
  kind: 'investigate' | 'recall' | 'practice' | 'boss';
  minutes: number;
  acceptance: string;
  deliverable?: string;
  objectives: Array<{ id: string; text: string }>;
  lessonRevision?: number;
  referenceAnswer?: string;
  hint?: string;
  hints?: string[];
}

export interface ChallengeQuestion {
  id: string;
  taskId: string;
  taskTitle: string;
  objectiveId: string;
  prompt: string;
  requiredCriteria: Array<{ id: string; text: string }>;
  hints: string[];
  lessonRevision: number;
  difficulty: ChallengeModeSetting['difficulty'];
  variant: number;
}

export class ChallengeQuestionBankError extends Error {
  constructor(readonly available: number, readonly required: number) {
    super('CHALLENGE_QUESTION_BANK_INSUFFICIENT');
    this.name = 'ChallengeQuestionBankError';
  }
}

/** Creates a version-bound set from distinct eligible task objectives. The reference answer is never copied. */
export function buildChallengeQuestionSet(input: {
  tier: ChallengeMode;
  namespace?: string;
  variantSeed?: string;
  tasks: readonly ChallengeQuestionTask[];
  focusTaskId?: string;
  excludedQuestionIds?: ReadonlySet<string>;
}): ChallengeQuestion[] {
  const setting = CHALLENGE_MODE_SETTINGS[input.tier];
  const challengeRequirements = input.tier === 'confidential'
    ? {
      prompt: '用至少两个明确步骤完成目标，并指出一个常见错误或误判，说明依据为何不支持它。',
      criteria: ['说明至少两个相关推理或操作步骤。', '识别一个可能的错误或误判，并用证据说明为什么不成立。'],
    }
    : input.tier === 'top-secret'
      ? {
        prompt: '把目标迁移到不同情境，加入边界条件，并说明结论的适用范围。',
        criteria: ['在不同于讲解示例的新情境中正确迁移目标能力。', '检查一个边界条件，并说明结论的适用范围或限制。'],
      }
      : {
        prompt: '直接完成目标，给出一个具体结果或证据，并说明它如何符合要求。',
        criteria: ['给出一个与目标相关的具体结果，并提供直接依据说明它如何符合要求。'],
      };
  const variants = [
    '为这个目标设计一个不同于讲解示例的具体情境，完成任务要求，并提交结果与直接证据。',
    '先独立预测或判断一个新输入、文本或情境的结果，再完成目标并用证据核对。',
    '选择一个容易混淆的近邻概念或情境，完成当前目标，并指出能区分它的证据。',
    '在一个最小的实际案例中完成目标，说明关键选择，并核对最终结果。',
    '给目标增加一个边界条件或反例，判断要求是否满足，并提交可核验依据。',
  ];
  const hashVariant = (value: string) => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
    return hash >>> 0;
  };
  const tasks = [...input.tasks].sort((a, b) => {
    if (a.id === input.focusTaskId) return -1;
    if (b.id === input.focusTaskId) return 1;
    if (input.tier === 'ordinary') return a.minutes - b.minutes || (a.kind === 'boss' ? 1 : 0) - (b.kind === 'boss' ? 1 : 0);
    if (input.tier === 'confidential') return Number(a.kind === 'boss') - Number(b.kind === 'boss') || a.minutes - b.minutes;
    return Number(b.kind === 'boss') - Number(a.kind === 'boss') || b.minutes - a.minutes;
  });

  const questions: ChallengeQuestion[] = [];
  for (const task of tasks) {
    for (const objective of task.objectives) {
      const baseId = `${input.namespace ? `${input.namespace}:` : ''}${task.id}:${objective.id}:r${task.lessonRevision ?? 1}`;
      const legacyId = input.namespace ? baseId.slice(input.namespace.length + 1) : baseId;
      const start = hashVariant(`${input.variantSeed ?? ''}:${task.id}:${objective.id}`) % variants.length;
      const rotation = Array.from({ length: variants.length }, (_, offset) => (start + offset) % variants.length);
      const selectedVariant = rotation.find(variant => {
        const id = `${baseId}:v${variant + 1}`;
        const isLegacyFirstVariant = variant === 0 && (input.excludedQuestionIds?.has(baseId) || input.excludedQuestionIds?.has(legacyId));
        return !isLegacyFirstVariant && !input.excludedQuestionIds?.has(id);
      }) ?? start;
      const id = `${baseId}:v${selectedVariant + 1}`;
      questions.push({
        id,
        taskId: task.id,
        taskTitle: task.title,
        objectiveId: objective.id,
        prompt: `任务背景：${task.brief}\n本题目标：${objective.text}\n本局情境变式：${variants[selectedVariant]}\n题目要求：${setting.questionStyle}\n本档行动要求：${challengeRequirements.prompt}\n需要提交：${task.deliverable?.trim() || task.acceptance}`.slice(0, 4000),
        requiredCriteria: [
          { id: objective.id, text: objective.text },
          ...challengeRequirements.criteria.map((text, index) => ({ id: `challenge-${input.tier}-${questions.length + 1}-${index + 1}`, text })),
        ],
        hints: [
          task.hints?.[0] ?? task.hint ?? `先把「${objective.text}」拆成目标、依据和结果，再开始作答。`,
          task.hints?.[1] ?? '对照本任务的验收要求，逐项检查你的证据是否完整。',
        ].map(hint => hint.slice(0, 1000)),
        lessonRevision: task.lessonRevision ?? 1,
        difficulty: setting.difficulty,
        variant: selectedVariant + 1,
      });
      if (questions.length === setting.questionCount) return questions;
    }
  }

  throw new ChallengeQuestionBankError(questions.length, setting.questionCount);
}

export function challengeAfterEvaluation(correctAnswers: number, passThreshold: number, deadlineExpired: boolean): 'ready_to_extract' | 'failed' {
  return !deadlineExpired && correctAnswers >= passThreshold ? 'ready_to_extract' : 'failed';
}

export interface ChallengeRunStatInput {
  tier: ChallengeMode;
  status: ChallengeRunStatus;
  correctAnswers: number;
}

export interface ChallengeKdStat {
  correctAnswers: number;
  settledRounds: number;
  kd: number | null;
}

export type ChallengeKdStats = Record<ChallengeMode, ChallengeKdStat> & { overall: ChallengeKdStat; overallPaid: ChallengeKdStat };

const SETTLED_KD_STATUSES = new Set<ChallengeRunStatus>(['passed', 'failed', 'abandoned']);

function empty(): ChallengeKdStat {
  return { correctAnswers: 0, settledRounds: 0, kd: null };
}

function finalize(stat: ChallengeKdStat): ChallengeKdStat {
  return {
    ...stat,
    kd: stat.settledRounds ? Math.round((stat.correctAnswers / stat.settledRounds) * 100) / 100 : null,
  };
}

/**
 * K/D is correct answers per settled round. Technical refunds and active runs
 * are excluded; a settled failure or abandonment counts as a round.
 */
export function calculateChallengeKd(runs: readonly ChallengeRunStatInput[]): ChallengeKdStats {
  const stats: Record<ChallengeMode, ChallengeKdStat> = {
    free: empty(), ordinary: empty(), confidential: empty(), 'top-secret': empty(),
  };

  for (const run of runs) {
    if (!SETTLED_KD_STATUSES.has(run.status)) continue;
    const correctAnswers = Number.isFinite(run.correctAnswers) ? Math.max(0, Math.floor(run.correctAnswers)) : 0;
    const target = stats[run.tier];
    target.correctAnswers += correctAnswers;
    target.settledRounds += 1;
  }

  const overall = Object.values(stats).reduce<ChallengeKdStat>((total, stat) => {
    total.correctAnswers += stat.correctAnswers;
    total.settledRounds += stat.settledRounds;
    return total;
  }, empty());
  const overallPaid = ['ordinary', 'confidential', 'top-secret'].reduce<ChallengeKdStat>((total, tier) => {
    total.correctAnswers += stats[tier as ChallengeMode].correctAnswers;
    total.settledRounds += stats[tier as ChallengeMode].settledRounds;
    return total;
  }, empty());

  return {
    overall: finalize(overall),
    free: finalize(stats.free),
    ordinary: finalize(stats.ordinary),
    confidential: finalize(stats.confidential),
    'top-secret': finalize(stats['top-secret']),
    overallPaid: finalize(overallPaid),
  };
}
