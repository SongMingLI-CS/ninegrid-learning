import { describe, expect, it } from 'vitest';
import { applySeasonGoalAdjustment, buildSeasonGoalAdjustmentPreview } from '../shared/seasonAdjustment';
import { learningStateSchema } from '../shared/schema';
import type { LearningState, Task } from '../shared/types';

function task(id: string, title: string, prerequisites: string[] = []): Task {
  return {
    id, title, brief: `${title} brief`, kind: 'practice', minutes: 20, xp: 40, prerequisites,
    objectives: [{ id: `${id}-objective`, text: `${title} objective` }], curiosity: 'Why?', steps: ['Do the work.'],
    acceptance: 'Show evidence.', recallQuestion: 'What did you learn?', hint: 'Start with the goal.', resources: [],
    track: 'main', chainId: 'main-chain', deliverable: `${title} evidence`, reward: { xp: 40, coins: 26000, items: [] },
  };
}

function existingState(): LearningState {
  const setup = task('setup-script', '运行环境与第一个脚本');
  const reading = task('reading-evidence', '阅读主旨与证据', [setup.id]);
  const campaign = {
    id: 'ielts-season', title: 'IELTS action', subtitle: 'Language practice', goal: 'Build an IELTS timer and tracking tool.',
    level: 'beginner', days: 28, dailyMinutes: 80, ultimateReward: 'Deploy the IELTS tool.', desiredArtifact: 'Deploy the IELTS tool.',
    createdAt: '2026-10-01T00:00:00.000Z', source: 'deepseek' as const,
    stages: [{ id: 'stage-one', title: 'Stage one', description: 'Practice', tasks: [setup, reading], mainlineTaskIds: [setup.id, reading.id], gateTaskIds: [reading.id], chains: [{ id: 'main-chain', title: 'Mainline', track: 'main' as const, taskIds: [setup.id, reading.id], completionReward: { xp: 10, coins: 1000, items: [] } }] }],
  };
  return {
    version: 2, campaign,
    progress: {
      [setup.id]: { completedObjectives: [setup.objectives[0].id], evidence: 'Old script answer stays here and preserves a meaningful learning record.', status: 'completed', verification: 'self', evaluationSource: 'self', selfChecked: true, selfCheckEvidence: 'Old script answer stays here and preserves a meaningful learning record.', completedAt: '2026-10-02T00:00:00.000Z' },
      [reading.id]: { completedObjectives: [], evidence: '', status: 'idle' },
    },
    reviews: [{ taskId: setup.id, dueAt: '2026-10-03T00:00:00.000Z', interval: 1, ease: 2.5, repetitions: 0, history: [] }], notes: {}, wallet: { currency: 'learning-coin', balance: 12345 }, inventory: {}, rewardLedger: [{
      id: 'existing-reward', campaignId: campaign.id, taskId: setup.id, at: '2026-10-02T00:00:00.000Z',
      reward: { xp: 0, coins: 12345, items: [] }, kind: 'mission', idempotencyKey: 'existing-reward-key',
    }],
  };
}

describe('season target adjustment preview', () => {
  it('previews and applies an IELTS stage rename when only the stage metadata still describes a tool', () => {
    const original = existingState();
    const reading = task('reading-lesson', '雅思阅读：主旨与证据');
    original.campaign.stages[0] = {
      ...original.campaign.stages[0],
      title: '雅思认知与最小工具骨架',
      description: '熟悉考试并搭建最小工具骨架。',
      tasks: [reading],
      mainlineTaskIds: [reading.id],
      gateTaskIds: [reading.id],
      chains: [{ id: 'main-chain', title: '雅思主线', track: 'main', taskIds: [reading.id], completionReward: { xp: 10, coins: 1000, items: [] } }],
    };
    original.progress = { [reading.id]: { completedObjectives: [], evidence: '', status: 'idle' } };

    const preview = buildSeasonGoalAdjustmentPreview(original, {
      goal: '提升雅思听说读写能力，达到雅思目标分数。',
      desiredArtifact: '保留雅思练习证据和成绩记录。',
    });

    expect(preview.tasks).toHaveLength(1);
    expect(preview.tasks[0].action).toBe('keep');
    expect(preview.stageChanges).toEqual([
      expect.objectContaining({
        stageId: 'stage-one',
        titleBefore: '雅思认知与最小工具骨架',
        titleAfter: expect.stringMatching(/雅思/),
      }),
    ]);
    expect(preview.notice).not.toMatch(/未发现.*只更新目标/);

    const updated = applySeasonGoalAdjustment(original, preview);
    expect(updated.campaign.stages[0].title).toBe(preview.stageChanges[0].titleAfter);
    expect(updated.campaign.stages[0].tasks[0].id).toBe(reading.id);
    expect(updated.campaign.stages[0].description).not.toContain('工具骨架');
    expect(updated.progress).toEqual(original.progress);
    expect(updated.wallet).toEqual(original.wallet);
    expect(updated.rewardLedger).toEqual(original.rewardLedger);
  });

  it('uses the new goal to identify an IELTS scope even when the old season was only about programming', () => {
    const original = existingState();
    original.campaign.goal = '学习 Python 编程，做一个计时器工具。';
    const preview = buildSeasonGoalAdjustmentPreview(original, {
      goal: '提升雅思听说读写能力。', desiredArtifact: '可核对的雅思练习档案。',
    });
    expect(preview.tasks.some(item => item.action === 'replace')).toBe(true);
  });

  it('does not move programming tasks when the new goal explicitly includes building a learning tool', () => {
    const original = existingState();
    const preview = buildSeasonGoalAdjustmentPreview(original, {
      goal: '学习雅思，同时编写一个雅思计时器工具。', desiredArtifact: '雅思训练工具与练习档案。',
    });
    expect(preview.tasks.every(item => item.action === 'keep')).toBe(true);
  });

  it('previews a versioned IELTS replacement without mutating the source archive', () => {
    const original = existingState();
    const preview = buildSeasonGoalAdjustmentPreview(original, {
      goal: '提升雅思听说读写能力，完成可核对的英语练习档案。',
      desiredArtifact: '完成包含听说读写样本、证据和复盘的雅思训练档案。',
    });

    expect(preview.tasks).toHaveLength(2);
    expect(preview.tasks[0]).toMatchObject({ action: 'replace', title: '运行环境与第一个脚本', preservesEvidence: true });
    expect(preview.tasks[0].replacement?.title).toMatch(/雅思/);
    expect(preview.tasks[0].dependencyChanges).toContain('阅读主旨与证据');
    expect(preview.budget.mainlineMinutesBefore).toBe(preview.budget.mainlineMinutesAfter);
    expect(original.campaign.goal).toContain('timer');
  });

  it('applies the confirmed preview with new IDs, optional legacy evidence, and unchanged economics', () => {
    const original = existingState();
    const input = { goal: '提升雅思听说读写能力，完成可核对的英语练习档案。', desiredArtifact: '完成包含听说读写样本、证据和复盘的雅思训练档案。' };
    const preview = buildSeasonGoalAdjustmentPreview(original, input);
    const updated = applySeasonGoalAdjustment(original, preview);
    const oldTask = updated.campaign.stages[0].tasks.find(item => item.id === 'setup-script');
    const replacement = updated.campaign.stages[0].tasks.find(item => item.id === preview.tasks[0].replacement?.id);

    expect(updated.campaign.goal).toBe(input.goal);
    expect(updated.campaign.desiredArtifact).toBe(input.desiredArtifact);
    expect(oldTask).toMatchObject({ track: 'branch' });
    expect(replacement).toMatchObject({ track: 'main', reward: { xp: 0, coins: 0, items: [] } });
    expect(updated.progress['setup-script'].evidence).toContain('preserves a meaningful learning record');
    expect(updated.progress[replacement!.id]).toMatchObject({ status: 'idle', evidence: '' });
    expect(updated.wallet).toEqual(original.wallet);
    expect(updated.rewardLedger).toEqual(original.rewardLedger);
    expect(learningStateSchema.safeParse(updated).success).toBe(true);
  });
});
