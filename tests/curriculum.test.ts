import { describe, expect, it } from 'vitest';
import { NUMPY_DEMO_CAMPAIGN } from '../src/lib/numpyDemo';
import { campaignSchema } from '../shared/schema';
import { curriculumOutlineSchema, normalizeGeneratedCurriculumOutline, normalizeMissingStageGates, validateCurriculumOutline } from '../shared/curriculum';
import { planCurriculumBudget } from '../shared/curriculum';
import { createProgressForCampaign, isTaskUnlocked, recordGridOutcome } from '../src/lib/engine';

function outlineFixture() {
  const stages = Array.from({ length: 4 }, (_, stageIndex) => {
    const stageId = `s${stageIndex}`;
    const mainline = Array.from({ length: 15 }, (_, i) => ({ id: `${stageId}-m${i}`, title: `main ${i}`, knowledgePoint: `point ${i}`, minutes: 12, prerequisites: i ? [`${stageId}-m${i-1}`] : stageIndex ? [`s${stageIndex-1}-m14`] : [] }));
    const branches = Array.from({ length: 3 }, (_, branchIndex) => ({ id: `${stageId}-b${branchIndex}`, title: `branch ${branchIndex}`, tasks: Array.from({ length: 3 }, (_, i) => ({ id:`${stageId}-b${branchIndex}-t${i}`, title:`branch task ${i}`, knowledgePoint:`branch point ${i}`, minutes:10, prerequisites:[i ? `${stageId}-b${branchIndex}-t${i-1}` : `${stageId}-m${branchIndex*4}`] })) }));
    return { id:stageId, title:`stage ${stageIndex}`, description:'learning', gateTaskId:mainline[14].id, mainline, branches };
  });
  return { title:'Course', subtitle:'Course subtitle', prerequisites:[], stages, seasonalCollectible:{name:'季节标本',story:'一段与目标相关的记录。',appearance:'深色金属外壳和封存标签。',abilityOutcome:'独立完成课程最终成果。'}, nineGrid:Array.from({length:9},(_,i)=>({id:`grid-${i}`,title:`grid ${i}`,ability:'skill',value:'value',taskIds:[`s${Math.min(3,Math.floor(i/3))}-m14`]})) };
}

describe('versioned NumPy curriculum', () => {
  it('provides four dense, verifiable stages with optional branches that do not gate progression', () => {
    const course = NUMPY_DEMO_CAMPAIGN;
    expect(course.curriculumRulesVersion).toBe(3);
    expect(course.stages).toHaveLength(4);
    for (const stage of course.stages) {
      expect(stage.tasks).toHaveLength(24);
      const main = stage.chains?.find(chain => chain.track === 'main');
      const branches = stage.chains?.filter(chain => chain.track === 'branch') ?? [];
      expect(main?.taskIds).toHaveLength(15);
      expect(branches).toHaveLength(3);
      expect(branches.every(chain => chain.taskIds.length === 3)).toBe(true);
      expect(stage.gateTaskIds?.every(id => main?.taskIds.includes(id))).toBe(true);
      for (const task of stage.tasks) {
        expect(task.knowledgePoints?.length).toBeGreaterThan(0);
        expect(task.knownBasis?.length).toBeGreaterThan(5);
        expect(task.deliverable?.length).toBeGreaterThan(5);
        expect(task.hints?.length).toBeGreaterThanOrEqual(2);
        expect(task.acceptance.length).toBeGreaterThan(20);
      }
    }
    expect(campaignSchema.safeParse(course).success).toBe(true);
  });

  it('keeps prior NumPy campaign identity separate and task rewards bounded by effort', () => {
    expect(NUMPY_DEMO_CAMPAIGN.id).not.toBe('numpy-first-analysis');
    for (const stage of NUMPY_DEMO_CAMPAIGN.stages) {
      expect(stage.tasks.every(task => task.minutes >= 5 && task.minutes <= 45)).toBe(true);
      expect(stage.chains?.find(chain => chain.track === 'main')?.completionReward?.coins).toBe(60_000);
      expect(stage.chains?.filter(chain => chain.track === 'branch').every(chain => (chain.completionReward?.coins ?? 0) === 0)).toBe(true);
    }
  });

  it('validates a dense four-stage outline before requesting detailed stage content', () => {
    const outline = outlineFixture();
    expect(curriculumOutlineSchema.safeParse(outline).success).toBe(true);
    expect(validateCurriculumOutline(outline, { days:28, dailyMinutes:60 })).toBe(true);
    const underfilled = structuredClone(outline);
    underfilled.stages[0].mainline.pop();
    expect(validateCurriculumOutline(underfilled, { days:28, dailyMinutes:60 })).toBe(false);
    const compressed = structuredClone(outline);
    for (const stage of compressed.stages) for (const task of stage.mainline) task.minutes = 5;
    expect(validateCurriculumOutline(compressed, { days:28, dailyMinutes:60 })).toBe(false);
    const invalidOrder = structuredClone(outline);
    invalidOrder.stages[0].mainline[0].prerequisites = [invalidOrder.stages[0].mainline[1].id];
    expect(validateCurriculumOutline(invalidOrder, { days:28, dailyMinutes:60 })).toBe(false);
    const branchGate = structuredClone(outline);
    branchGate.stages[1].mainline[0].prerequisites = [branchGate.stages[0].branches[0].tasks[2].id];
    expect(validateCurriculumOutline(branchGate, { days:28, dailyMinutes:60 })).toBe(false);
    const branchOnlyGrid = structuredClone(outline);
    branchOnlyGrid.nineGrid[0].taskIds = [branchOnlyGrid.stages[0].branches[0].tasks[0].id];
    expect(validateCurriculumOutline(branchOnlyGrid, { days:28, dailyMinutes:60 })).toBe(false);
    const shortGoal = { ...underfilled, stages: [{ ...underfilled.stages[0], mainline: [underfilled.stages[0].mainline[0]], gateTaskId: underfilled.stages[0].mainline[0].id, branches: [] }], nineGrid: outline.nineGrid.map(grid => ({ ...grid, taskIds: [`s0-m0`] })), densityRationale:'仅有两天预算，本路线只保留最关键主线能力。' };
    expect(validateCurriculumOutline(shortGoal, { days:2, dailyMinutes:15 })).toBe(false);
  });

  it('binds a clearly named final synthesis task when the model invents a separate gate ID', () => {
    const outline = outlineFixture();
    outline.stages.forEach((stage, index) => {
      stage.gateTaskId = `s${index}-G1`;
      stage.mainline.at(-1)!.title = `阶段综合验收 ${index + 1}`;
    });
    const normalized = normalizeMissingStageGates(outline);
    expect(normalized).not.toBe(outline);
    expect(normalized?.stages.map(stage => stage.gateTaskId)).toEqual(outline.stages.map(stage => stage.mainline.at(-1)!.id));
    expect(validateCurriculumOutline(normalized!, { days: 28, dailyMinutes: 60 })).toBe(true);

    const ambiguous = structuredClone(outline);
    ambiguous.stages[0].mainline.at(-1)!.title = '练习最后一项';
    expect(normalizeMissingStageGates(ambiguous)).toBeNull();
  });

  it('preserves a model-returned prerequisite sentence as a bounded list instead of dropping it', () => {
    const input = outlineFixture() as unknown as Record<string, unknown>;
    input.prerequisites = '已掌握 ndarray；可以运行 Python';
    const normalized = normalizeGeneratedCurriculumOutline(input);
    expect(normalized).toMatchObject({ prerequisites: ['已掌握 ndarray', '可以运行 Python'] });
    expect(curriculumOutlineSchema.safeParse(normalized).success).toBe(true);
  });

  it('checks actual mainline, review, and in-cycle branch minutes as one budget', () => {
    const outline = outlineFixture();
    for (const stage of outline.stages) {
      for (const task of stage.mainline) task.minutes = 13;
      for (const task of stage.branches.flatMap(branch => branch.tasks)) task.minutes = 19;
    }
    outline.stages[0].mainline.slice(0, 4).forEach(task => task.minutes = 21);
    outline.stages.flatMap(stage => stage.branches.flatMap(branch => branch.tasks)).slice(0, 16).forEach(task => task.minutes++);
    // 812 mainline + 252 review + 700 in-cycle optional = 1,764, 84 over.
    expect(outline.stages.flatMap(stage => stage.mainline).reduce((sum, task) => sum + task.minutes, 0)).toBe(812);
    expect(outline.stages.flatMap(stage => stage.branches.flatMap(branch => branch.tasks)).reduce((sum, task) => sum + task.minutes, 0)).toBe(700);
    expect(validateCurriculumOutline(outline, { days: 28, dailyMinutes: 60 })).toBe(false);

    const legal = outlineFixture();
    for (const stage of legal.stages) {
      for (const task of stage.mainline) task.minutes = 13;
      for (const task of stage.branches.flatMap(branch => branch.tasks)) task.minutes = 15;
    }
    legal.stages[0].mainline.slice(0, 4).forEach(task => task.minutes = 21);
    expect(legal.stages.flatMap(stage => stage.mainline).reduce((sum, task) => sum + task.minutes, 0)).toBe(812);
    expect(legal.stages.flatMap(stage => stage.branches.flatMap(branch => branch.tasks)).reduce((sum, task) => sum + task.minutes, 0)).toBe(540);
    // 812 + 252 review + 540 branches = 1,604, within the 1,680-minute cycle.
    expect(validateCurriculumOutline(legal, { days: 28, dailyMinutes: 60 })).toBe(true);
  });

  it('plans course size from the budget across compact, standard, short, and long goals', () => {
    const compact = planCurriculumBudget({ days: 14, dailyMinutes: 20 });
    expect(compact).toMatchObject({ feasible: true, totalMinutes: 280, reviewMinutes: 42, stageCount: 2, mainlineTaskCounts: [10, 9], branchChainsPerStage: [0, 0] });
    const standard = planCurriculumBudget({ days: 28, dailyMinutes: 60 });
    expect(standard).toMatchObject({ feasible: true, stageCount: 4, mainlineTaskCounts: [15,15,15,15], branchChainsPerStage: [3,3,3,3] });
    const short = planCurriculumBudget({ days: 2, dailyMinutes: 15 });
    expect(short).toMatchObject({ feasible: true, stageCount: 1, mainlineTaskCounts: [2], branchChainsPerStage: [0] });
    const longer = planCurriculumBudget({ days: 56, dailyMinutes: 90 });
    expect(longer.stageCount).toBe(4);
    expect(longer.mainlineTaskCounts.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(60);
    expect(longer.mainlineMinutes + longer.reviewMinutes).toBeLessThanOrEqual(longer.totalMinutes);
    const tooSmall = planCurriculumBudget({ days: 1, dailyMinutes: 5 });
    expect(tooSmall.feasible).toBe(false);
    expect(tooSmall.suggestion).toMatch(/分钟|天/);
  });

  it('rejects nonexistent nine-grid references and unlocks a valid integer-index ability only after AI-verified evidence', () => {
    const course = NUMPY_DEMO_CAMPAIGN;
    const indexGrid = course.nineGrid!.find(grid => grid.title === '整数索引')!;
    expect(indexGrid.unlockTaskIds).toEqual(['numpy-v3-selection-m03']);
    const broken = structuredClone(course);
    broken.nineGrid![indexGrid ? 3 : 0].unlockTaskIds = ['numpy-v3-selection-m02'];
    expect(campaignSchema.safeParse(broken).success).toBe(false);
    const taskId = indexGrid.unlockTaskIds[0];
    const progress = createProgressForCampaign(course);
    expect(isTaskUnlocked(course, progress, taskId)).toBe(false);
    for (const id of ['numpy-v3-foundation-m15','numpy-slice',taskId]) progress[id] = { completedObjectives: [], evidence: 'A verified index result with explanation.', status: 'completed', verification: 'ai' };
    expect(isTaskUnlocked(course, progress, taskId)).toBe(true);
    expect(() => recordGridOutcome({ version: 2, campaign: course, progress, reviews: [], notes: {} }, indexGrid.id, 'I selected (1, 2) and checked its returned value.')).not.toThrow();
  });

  it('samples every phase for distinct knowledge, explicit data, transfer work, and separate optional practice', () => {
    for (const [index, stage] of NUMPY_DEMO_CAMPAIGN.stages.entries()) {
      const main = stage.tasks.filter(task => (task.track ?? 'main') === 'main');
      const branch = stage.tasks.find(task => task.track === 'branch')!;
      const sample = [main[0], main[1], main[2], main.at(-1)!];
      expect(new Set(sample.map(task => task.knowledgePoints?.[0])).size).toBe(sample.length);
      for (const task of sample) {
        expect(task.brief.length).toBeGreaterThan(25);
        expect(task.steps.join(' ')).toContain(task.brief.split('。')[1].split('，')[0].slice(0, 4));
        expect(task.deliverable).toMatch(/提交/);
        expect(task.acceptance).toContain(task.knowledgePoints![0]);
      }
      expect(main.at(-1)?.kind).toBe('boss');
      expect(main.at(-1)?.acceptance).not.toBe(main[0].acceptance);
      expect(branch.track).toBe('branch');
      expect(branch.prerequisites.every(id => main.some(item => item.id === id) || stage.tasks.some(item => item.track === 'branch' && item.id === id))).toBe(true);
      expect(stage.gateTaskIds?.every(id => main.some(item => item.id === id))).toBe(true);
      expect(stage.description).toContain('支线');
      expect(index).toBeLessThan(4);
    }
    expect(NUMPY_DEMO_CAMPAIGN.prerequisites).toContain('Python 3 与基础列表、数字、print');
    expect(NUMPY_DEMO_CAMPAIGN.level).toContain('不默认掌握机器学习');
  });

  it('rejects mismatched task-chain ownership and optional-branch gates at the campaign boundary', () => {
    const wrongChain = structuredClone(NUMPY_DEMO_CAMPAIGN);
    wrongChain.stages[1].chains![0].taskIds[0] = wrongChain.stages[1].chains![1].taskIds[0];
    expect(campaignSchema.safeParse(wrongChain).success).toBe(false);
    const branchGate = structuredClone(NUMPY_DEMO_CAMPAIGN);
    branchGate.stages[1].gateTaskIds = [branchGate.stages[1].chains!.find(chain => chain.track === 'branch')!.taskIds[0]];
    expect(campaignSchema.safeParse(branchGate).success).toBe(false);
  });
});
