import { describe, expect, it } from 'vitest';
import { NUMPY_DEMO_CAMPAIGN } from '../src/lib/numpyDemo';
import { campaignSchema } from '../shared/schema';
import { curriculumOutlineSchema, validateCurriculumOutline } from '../shared/curriculum';

function outlineFixture() {
  const stages = Array.from({ length: 4 }, (_, stageIndex) => {
    const stageId = `s${stageIndex}`;
    const mainline = Array.from({ length: 15 }, (_, i) => ({ id: `${stageId}-m${i}`, title: `main ${i}`, knowledgePoint: `point ${i}`, minutes: 10, prerequisites: i ? [`${stageId}-m${i-1}`] : stageIndex ? [`s${stageIndex-1}-m14`] : [] }));
    const branches = Array.from({ length: 3 }, (_, branchIndex) => ({ id: `${stageId}-b${branchIndex}`, title: `branch ${branchIndex}`, tasks: Array.from({ length: 3 }, (_, i) => ({ id:`${stageId}-b${branchIndex}-t${i}`, title:`branch task ${i}`, knowledgePoint:`branch point ${i}`, minutes:10, prerequisites:[i ? `${stageId}-b${branchIndex}-t${i-1}` : `${stageId}-m${branchIndex*4}`] })) }));
    return { id:stageId, title:`stage ${stageIndex}`, description:'learning', gateTaskId:mainline[14].id, mainline, branches };
  });
  return { title:'Course', subtitle:'Course subtitle', prerequisites:[], stages, nineGrid:Array.from({length:9},(_,i)=>({id:`grid-${i}`,title:`grid ${i}`,ability:'skill',value:'value',taskIds:[`s${Math.min(3,Math.floor(i/3))}-m14`]})) };
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
      expect(stage.chains?.every(chain => (chain.completionReward?.coins ?? 0) <= 5)).toBe(true);
    }
  });

  it('validates a dense four-stage outline before requesting detailed stage content', () => {
    const outline = outlineFixture();
    expect(curriculumOutlineSchema.safeParse(outline).success).toBe(true);
    expect(validateCurriculumOutline(outline, { days:28, dailyMinutes:60 })).toBe(true);
    const underfilled = structuredClone(outline);
    underfilled.stages[0].mainline.pop();
    expect(validateCurriculumOutline(underfilled, { days:28, dailyMinutes:60 })).toBe(false);
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
    expect(validateCurriculumOutline(shortGoal, { days:2, dailyMinutes:15 })).toBe(true);
  });
});
