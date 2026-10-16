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
  it('previews and applies the requested two-month IELTS schedule instead of retaining stale timing', () => {
    const original = existingState();
    original.campaign.days = 28;
    original.campaign.dailyMinutes = 145;
    const input = {
      goal: '一个月雅思达到 6.5，第二个月达到 7.0。',
      desiredArtifact: '一个月 6.5、两个月 7.0 的听说读写成绩与练习档案。',
    };

    const preview = buildSeasonGoalAdjustmentPreview(original, input);

    expect(preview.budget).toMatchObject({ daysBefore: 28, days: 60, dailyMinutesBefore: 145, dailyMinutes: 80 });
    const updated = applySeasonGoalAdjustment(original, preview);
    expect(updated.campaign.days).toBe(60);
    expect(updated.campaign.dailyMinutes).toBe(80);
  });

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

  it('does not let a clearly off-scope task pass as a review-only item for unsupported target adjustments', () => {
    const original = existingState();
    const preview = buildSeasonGoalAdjustmentPreview(original, {
      goal: '学习中国古典诗词鉴赏',
      desiredArtifact: '一份包含文本证据的诗词分析作品集',
    });

    expect(preview.tasks[0].action).toBe('blocked');
    expect(preview.notice).toMatch(/不能应用|重新生成/);
    expect(() => applySeasonGoalAdjustment(original, preview)).toThrow(/重新生成任务/);
  });

  it('recognizes the existing IELTS stages and task labels that use bare tool wording', () => {
    const original = existingState();
    const baseStage = original.campaign.stages[0];
    const makeStage = (id: string, title: string, description: string, taskTitles: string[]) => {
      const chainId = `${id}-main`;
      const tasks = taskTitles.map((title, index) => ({ ...task(`${id}-task-${index + 1}`, title), chainId }));
      return {
        ...baseStage,
        id,
        title,
        description,
        tasks,
        mainlineTaskIds: tasks.map(item => item.id),
        gateTaskIds: [tasks.at(-1)!.id],
        chains: [{ ...baseStage.chains![0], id: chainId, taskIds: tasks.map(item => item.id) }],
      };
    };
    original.campaign.stages = [
      makeStage('stage-two', '题型方法与工具数据化', '围绕题型训练建立工具数据化流程。', ['雅思阅读：题型判断与证据定位', '工具：打包与依赖固定']),
      makeStage('stage-three', '限时训练与工具反馈闭环', '通过工具反馈闭环完成限时训练。', ['雅思写作：限时观点段落', '小工具数据建模与反馈生成']),
    ];
    original.progress = Object.fromEntries(original.campaign.stages.flatMap(stage => stage.tasks.map(item => [item.id, { completedObjectives: [], evidence: '', status: 'idle' as const }])));

    const preview = buildSeasonGoalAdjustmentPreview(original, {
      goal: '雅思，现在是六级 430 分水平，从来没做过雅思真题。',
      desiredArtifact: '一个月 6.5，两个月 7.0 水平。',
    });

    expect(preview.stageChanges.map(change => change.stageId)).toEqual(['stage-two']);
    expect(preview.stageChanges.map(change => change.titleAfter)).toEqual(['雅思题型方法与四科训练']);
    expect(preview.tasks.find(item => item.title === '工具：打包与依赖固定')).toMatchObject({
      action: 'replace',
      originalTaskDisposition: 'move-to-optional-branch',
      replacement: { title: expect.stringMatching(/雅思/) },
    });
    expect(preview.tasks.find(item => item.title === '雅思阅读：题型判断与证据定位')?.action).toBe('keep');
    expect(preview.tasks.find(item => item.title === '小工具数据建模与反馈生成')?.action).toBe('review');
    expect(preview.notice).toContain('修正 1 个阶段信息');
    expect(preview.notice).toContain('替换 1 个明确偏离目标的主线任务');
  });

  it('does not move programming tasks when the new goal explicitly includes building a learning tool', () => {
    const original = existingState();
    const preview = buildSeasonGoalAdjustmentPreview(original, {
      goal: '学习雅思，同时编写一个雅思计时器工具。', desiredArtifact: '雅思训练工具与练习档案。',
    });
    expect(preview.tasks.every(item => item.action === 'keep')).toBe(true);

    const naturalRequest = buildSeasonGoalAdjustmentPreview(original, {
      goal: '学习雅思，同时开发一款听力练习工具。', desiredArtifact: '雅思听力练习工具与个人练习档案。',
    });
    expect(naturalRequest.tasks.every(item => item.action === 'keep')).toBe(true);
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

  it('uses task scope evidence, binds a preview to the archive revision, and invalidates it when saved progress changes', () => {
    const original = existingState();
    const task = original.campaign.stages[0].tasks[0];
    task.title = '雅思阅读：主旨与证据';
    task.brief = '阅读英文材料并定位作者观点。';
    task.deliverable = '可安装的雅思练习软件';
    task.acceptance = '提供运行截图、应用程序和固定依赖。';
    const input = { goal: '提升雅思听说读写能力', desiredArtifact: '四科练习证据与复盘档案' };

    const preview = buildSeasonGoalAdjustmentPreview(original, input, { baseRevision: 7 });

    expect(preview.baseRevision).toBe(7);
    expect(preview.tasks[0]).toMatchObject({
      action: 'replace',
      reason: expect.stringMatching(/交付|验收|软件|程序/),
    });
    const updatedProgress = structuredClone(original);
    updatedProgress.progress[task.id].evidence = 'A new answer was saved after the preview.';
    const refreshed = buildSeasonGoalAdjustmentPreview(updatedProgress, input, { baseRevision: 7 });
    expect(refreshed.previewId).not.toBe(preview.previewId);
    expect(() => applySeasonGoalAdjustment(updatedProgress, preview)).toThrow(/内容已变化/);
  });

  it('does not turn a mathematical tool into an out-of-scope software task', () => {
    const original = existingState();
    const task = original.campaign.stages[0].tasks[0];
    task.title = '线性代数：选择计算工具';
    task.brief = '比较手算与矩阵计算器的结果。';
    task.deliverable = '矩阵推导过程和核对结果';
    task.acceptance = '给出正确特征值并解释核对过程。';
    original.campaign.goal = '理解线性代数中的特征值';

    const preview = buildSeasonGoalAdjustmentPreview(original, {
      goal: '理解线性代数中的特征值', desiredArtifact: '一组有推导和验证的练习',
    });

    expect(preview.tasks[0].action).toBe('keep');
  });

  it('applies the confirmed preview with new IDs, optional legacy evidence, and unchanged economics', () => {
    const original = existingState();
    const input = { goal: '提升雅思听说读写能力，完成可核对的英语练习档案。', desiredArtifact: '完成包含听说读写样本、证据和复盘的雅思训练档案。' };
    original.schedules = { '2026-10-16': { date: '2026-10-16', theme: '今日主线', items: [{ taskId: 'setup-script', kind: 'lesson', minutes: 20, required: true, deliverable: '脚本证据' }], totalMinutes: 20, outcome: '完成练习', nextUnlock: '继续', revision: 1 } };
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
    expect(updated.schedules?.['2026-10-16'].items[0]).toMatchObject({ taskId: replacement!.id, deliverable: replacement!.deliverable });
    expect(learningStateSchema.safeParse(updated).success).toBe(true);
  });
});
