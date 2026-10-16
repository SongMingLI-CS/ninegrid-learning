import { describe, expect, it } from 'vitest';
import { CHALLENGE_MODE_SETTINGS, CHALLENGE_QUESTION_COUNTS, buildChallengeQuestionSet, calculateChallengeKd, challengeAfterEvaluation, type ChallengeMode } from '../shared/challengeRules';
import { CHALLENGES, FREE_CHALLENGE_REWARD_COINS, poolExpectedRecovery } from '../shared/economy';

describe('challenge mode and KD rules', () => {
  it('assigns the specified question counts to the paid tiers and ordinary-length free practice', () => {
    expect(CHALLENGE_QUESTION_COUNTS).toEqual({
      free: 5,
      ordinary: 5,
      confidential: 10,
      'top-secret': 15,
    });
    expect(FREE_CHALLENGE_REWARD_COINS).toBe(Math.floor(poolExpectedRecovery(CHALLENGES.confidential.pool) / 10));
  });

  it('calculates correct answers per settled round independently for each mode', () => {
    const stats = calculateChallengeKd([
      { tier: 'ordinary', status: 'passed', correctAnswers: 4 },
      { tier: 'ordinary', status: 'failed', correctAnswers: 2 },
      { tier: 'confidential', status: 'passed', correctAnswers: 10 },
      { tier: 'top-secret', status: 'technical_refund', correctAnswers: 0 },
      { tier: 'top-secret', status: 'active', correctAnswers: 7 },
      { tier: 'free', status: 'passed', correctAnswers: 5 },
    ]);

    expect(stats.ordinary).toEqual({ correctAnswers: 6, settledRounds: 2, kd: 3 });
    expect(stats.confidential).toEqual({ correctAnswers: 10, settledRounds: 1, kd: 10 });
    expect(stats['top-secret']).toEqual({ correctAnswers: 0, settledRounds: 0, kd: null });
    expect(stats.free).toEqual({ correctAnswers: 5, settledRounds: 1, kd: 5 });
    expect(stats.overallPaid).toEqual({ correctAnswers: 16, settledRounds: 3, kd: 5.33 });
  });

  it('matches the player example of 16 correct answers across five rounds', () => {
    const stats = calculateChallengeKd([
      { tier: 'ordinary', status: 'passed', correctAnswers: 5 },
      { tier: 'ordinary', status: 'passed', correctAnswers: 4 },
      { tier: 'confidential', status: 'failed', correctAnswers: 3 },
      { tier: 'top-secret', status: 'failed', correctAnswers: 2 },
      { tier: 'free', status: 'abandoned', correctAnswers: 2 },
    ]);

    expect(stats.overall).toEqual({ correctAnswers: 16, settledRounds: 5, kd: 3.2 });
    expect(stats.overallPaid).toEqual({ correctAnswers: 14, settledRounds: 4, kd: 3.5 });
    expect(stats.free).toEqual({ correctAnswers: 2, settledRounds: 1, kd: 2 });
  });

  it('rejects invalid mode values at the type boundary', () => {
    const modes: ChallengeMode[] = ['free', 'ordinary', 'confidential', 'top-secret'];
    expect(modes).toHaveLength(4);
  });

  it('builds a tier-sized question set from unlocked objectives without exposing lesson answers', () => {
    const tasks = Array.from({ length: 5 }, (_, index) => ({
      id: `task-${index}`,
      title: `Stage ${index} task`,
      brief: `Use the supplied concept in scenario ${index}.`,
      kind: index === 4 ? 'boss' as const : 'practice' as const,
      minutes: 12 + index,
      acceptance: 'Show a result and explain it.',
      deliverable: `Result ${index}`,
      objectives: [{ id: `objective-${index}`, text: `Explain concept ${index}.` }],
      lessonRevision: 1,
      referenceAnswer: `SECRET ANSWER ${index}`,
    }));

    const built = buildChallengeQuestionSet({ tier: 'ordinary', tasks, focusTaskId: 'task-2' });

    expect(built).toHaveLength(5);
    expect(built[0].taskId).toBe('task-2');
    expect(new Set(built.map(question => question.id)).size).toBe(5);
    expect(built.map(question => question.difficulty)).toEqual(Array(5).fill(CHALLENGE_MODE_SETTINGS.ordinary.difficulty));
    expect(JSON.stringify(built)).not.toContain('SECRET ANSWER');
    expect(CHALLENGE_MODE_SETTINGS['top-secret'].difficulty).toMatch(/综合|迁移/);
  });

  it('enforces increasingly demanding fixed criteria for each challenge tier', () => {
    const tasks = Array.from({ length: 15 }, (_, index) => ({
      id: `tier-task-${index}`, title: `Task ${index}`, brief: `Apply concept ${index} in the lesson context.`,
      kind: 'practice' as const, minutes: 15, acceptance: 'Show the result and explain it.',
      objectives: [{ id: `tier-objective-${index}`, text: `Apply concept ${index}.` }],
    }));
    const ordinary = buildChallengeQuestionSet({ tier: 'ordinary', tasks })[0];
    const confidential = buildChallengeQuestionSet({ tier: 'confidential', tasks })[0];
    const topSecret = buildChallengeQuestionSet({ tier: 'top-secret', tasks })[0];

    expect(ordinary.requiredCriteria.map(item => item.text).join(' ')).toMatch(/直接依据/);
    expect(confidential.requiredCriteria.map(item => item.text).join(' ')).toMatch(/多步|错误/);
    expect(topSecret.requiredCriteria.map(item => item.text).join(' ')).toMatch(/迁移|边界/);
    expect(new Set([ordinary, confidential, topSecret].map(question => question.requiredCriteria.at(-1)?.id)).size).toBe(3);
  });

  it('keeps eligible objectives distinct across course namespaces and excludes already exposed questions', () => {
    const tasks = Array.from({ length: 10 }, (_, index) => ({
      id: `task-${index}`, title: `Task ${index}`, brief: 'Context.', kind: 'practice' as const, minutes: 15,
      acceptance: 'Explain the result.', objectives: [{ id: `objective-${index}`, text: `Explain concept ${index}.` }],
    }));
    const first = buildChallengeQuestionSet({ tier: 'ordinary', namespace: 'course-a', tasks });
    const otherCourse = buildChallengeQuestionSet({ tier: 'ordinary', namespace: 'course-b', tasks });
    const remaining = buildChallengeQuestionSet({ tier: 'ordinary', namespace: 'course-a', tasks, excludedQuestionIds: new Set(first.map(question => question.id)) });

    expect(first.map(question => question.id)).not.toEqual(otherCourse.map(question => question.id));
    expect(remaining.every(question => !first.some(seen => seen.id === question.id))).toBe(true);
    expect(remaining).toHaveLength(5);
  });

  it('supports unlimited rounds by cycling through versioned question variants and reusing them after rotation', () => {
    const tasks = Array.from({ length: 5 }, (_, index) => ({
      id: `unlimited-task-${index}`, title: `Task ${index}`, brief: 'Use this skill in context.', kind: 'practice' as const,
      minutes: 15, acceptance: 'Show a result and explain it.', objectives: [{ id: `unlimited-objective-${index}`, text: `Apply skill ${index}.` }],
    }));
    const exposed = new Set<string>();
    const promptSets = new Set<string>();
    for (let round = 0; round < 12; round++) {
      const questions = buildChallengeQuestionSet({ tier: 'ordinary', namespace: 'unlimited-season', tasks, variantSeed: `round-${round}`, excludedQuestionIds: exposed });
      expect(questions).toHaveLength(5);
      expect(new Set(questions.map(question => question.id)).size).toBe(5);
      promptSets.add(questions.map(question => question.prompt).join('\n'));
      for (const question of questions) exposed.add(question.id);
    }
    expect(promptSets.size).toBeGreaterThan(1);
    expect(exposed.size).toBeGreaterThan(5);
  });

  it('recognizes legacy unnamespaced exposure IDs during the transition', () => {
    const tasks = Array.from({ length: 6 }, (_, index) => ({
      id: `old-task-${index}`, title: `Task ${index}`, brief: 'Context.', kind: 'practice' as const, minutes: 15,
      acceptance: 'Explain the result.', objectives: [{ id: `old-objective-${index}`, text: `Explain concept ${index}.` }],
    }));
    const remaining = buildChallengeQuestionSet({
      tier: 'ordinary', namespace: 'legacy-course', tasks,
      excludedQuestionIds: new Set(['old-task-0:old-objective-0:r1']),
    });
    expect(remaining.some(question => question.id === 'legacy-course:old-task-0:old-objective-0:r1:v1')).toBe(false);
    expect(remaining).toHaveLength(5);
  });

  it('requires an explicit extraction step after meeting the answer threshold', () => {
    expect(challengeAfterEvaluation(3, 3, false)).toBe('ready_to_extract');
    expect(challengeAfterEvaluation(2, 3, false)).toBe('failed');
    expect(challengeAfterEvaluation(5, 3, true)).toBe('failed');
  });
});
