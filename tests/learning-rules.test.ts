import { describe, expect, it } from 'vitest';
import { allRequiredCriteriaMet, hasCompleteRequiredCriteria, LEARNING_RULES_VERSION, learningRulesPrompt, quickDiagnosticPrompts } from '../shared/learningRules';
import { goalInputSchema } from '../shared/schema';

describe('versioned learning policy and required criteria', () => {
  it('exposes concrete planning, retrieval, and assessment rules for model request assembly', () => {
    expect(LEARNING_RULES_VERSION).toMatch(/^learning-loop-/);
    expect(learningRulesPrompt('planning')).toContain('time budget');
    expect(learningRulesPrompt('retrieval')).toContain('not FSRS');
    expect(learningRulesPrompt('teaching')).toContain('Missing a required criterion');
  });

  it('requires an exact evidence-backed result for every required criterion', () => {
    const ids = ['concept', 'example'];
    expect(hasCompleteRequiredCriteria(ids, [{ id: 'concept', met: true, evidence: 'correct definition' }])).toBe(false);
    expect(hasCompleteRequiredCriteria(ids, [{ id: 'concept', met: true, evidence: 'correct definition' }, { id: 'extra', met: true, evidence: 'irrelevant' }])).toBe(false);
    expect(hasCompleteRequiredCriteria(ids, [{ id: 'concept', met: true, evidence: 'correct definition' }, { id: 'example', met: false, evidence: 'example is missing' }])).toBe(true);
    expect(allRequiredCriteriaMet(ids, [{ id: 'concept', met: true, evidence: 'correct definition' }, { id: 'example', met: false, evidence: 'example is missing' }])).toBe(false);
  });

  it('creates optional goal-specific quick diagnostics and persists versioned responses in valid course input', () => {
    const numpy = quickDiagnosticPrompts('学习 NumPy 数组索引');
    const ielts = quickDiagnosticPrompts('准备 IELTS 写作与阅读');
    expect(numpy).toHaveLength(3);
    expect(numpy[1].prompt).toContain('读代码');
    expect(ielts[1].prompt).toContain('英文');
    const result = goalInputSchema.safeParse({
      goal: '学习 NumPy 数组索引', level: '零基础', days: 28, dailyMinutes: 45, ultimateReward: '完成作品',
      quickDiagnostic: { version: 1, items: numpy.map(item => ({ ...item, confidence: 'unknown' })) },
    });
    expect(result.success).toBe(true);
    expect(goalInputSchema.safeParse({ goal: '目标', level: '基础', days: 28, dailyMinutes: 45, ultimateReward: '成果', quickDiagnostic: { version: 2, items: [] } }).success).toBe(false);
  });
});
