import { describe, expect, it } from 'vitest';
import { NUMPY_DEMO_CAMPAIGN } from '../src/lib/numpyDemo';
import { campaignSchema } from '../shared/schema';
import { analyzeCurriculumGoalScope, curriculumOutlineSchema, defaultArtifactForGoal, normalizeGeneratedCurriculumOutline, normalizeLegacyGoalArtifact, normalizeMissingStageGates, validateCurriculumOutline, validateCurriculumGoalScope } from '../shared/curriculum';
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
  it('uses subject-relevant suggested outcomes and normalizes only the historical tool default', () => {
    const goal = '雅思听力与阅读训练';
    expect(defaultArtifactForGoal(goal)).toMatch(/雅思听说读写/);
    expect(normalizeLegacyGoalArtifact({ goal, ultimateReward: '把第一个真正能用的小工具部署起来' }).ultimateReward).toMatch(/雅思听说读写/);
    expect(normalizeLegacyGoalArtifact({ goal, ultimateReward: '雅思阅读能力与错题复盘报告' }).ultimateReward).toBe('雅思阅读能力与错题复盘报告');
  });

  it('keeps programming out of a language-learning core unless the learner explicitly asks for it', () => {
    const outline = outlineFixture();
    outline.title = '雅思四科训练路线';
    outline.subtitle = '逐步完成听说读写练习与个人复盘';
    outline.stages.forEach((stage, index) => {
      stage.title = `雅思训练阶段 ${index + 1}`;
      stage.description = '围绕雅思听力、阅读、写作与口语练习。';
    });
    outline.stages[0].branches[0].tasks[0].title = '可选支线：编写雅思错题脚本';
    const input = { goal: '雅思，现在是六级430分水平，从来没做过雅思真题', desiredArtifact: '把第一个真正能用的小工具部署起来' };

    expect(validateCurriculumGoalScope(outline, input)).toBe(true);

    const misplaced = structuredClone(outline);
    misplaced.stages[0].mainline[0].title = '运行环境与第一个脚本';
    expect(validateCurriculumGoalScope(misplaced, input)).toBe(false);

    const mismatchedOutcome = structuredClone(outline);
    mismatchedOutcome.nineGrid[7].ability = '编写并部署雅思学习工具';
    expect(validateCurriculumGoalScope(mismatchedOutcome, input)).toBe(false);

    expect(validateCurriculumGoalScope(misplaced, { goal: '雅思备考，同时学习 Python 并开发计时工具' })).toBe(true);
  });

  it('checks task actions and deliverables instead of trusting a normal title or a technology keyword', () => {
    const input = { goal: '雅思听说读写提升', desiredArtifact: '雅思四科练习证据与复盘' };
    const hiddenBuild = outlineFixture() as any;
    hiddenBuild.title = '雅思四科训练路线';
    hiddenBuild.stages[0].title = '雅思阅读训练';
    hiddenBuild.stages[0].description = '阅读英文材料并定位证据。';
    Object.assign(hiddenBuild.stages[0].mainline[0], {
      title: '雅思阅读：主旨与证据',
      knowledgePoint: '主旨判断与证据定位',
      action: '打包并部署一个可运行的雅思练习软件',
      deliverable: '安装后可用的练习应用',
      acceptance: '提交应用启动截图和依赖清单。',
    });
    expect(validateCurriculumGoalScope(hiddenBuild, input)).toBe(false);

    const mathematicalTool = outlineFixture() as any;
    mathematicalTool.stages[0].mainline[0].title = '线性代数：选择计算工具';
    mathematicalTool.stages[0].mainline[0].knowledgePoint = '用矩阵工具核验特征值推导';
    mathematicalTool.stages[0].mainline[0].action = '选择合适的数学工具计算小矩阵';
    mathematicalTool.stages[0].mainline[0].deliverable = '计算过程、结果与手算核对';
    expect(validateCurriculumGoalScope(mathematicalTool, { goal: '理解线性代数中的特征值', desiredArtifact: '一组有推导和验证的练习' })).toBe(true);

    const numpyPractice = outlineFixture() as any;
    numpyPractice.stages[0].mainline[0].title = 'NumPy：切片与布尔索引';
    numpyPractice.stages[0].mainline[0].knowledgePoint = '数组索引';
    numpyPractice.stages[0].mainline[0].action = '运行短代码观察切片结果并解释索引边界';
    numpyPractice.stages[0].mainline[0].deliverable = '代码片段、输出和解释';
    expect(validateCurriculumGoalScope(numpyPractice, { goal: '学习 NumPy 数组索引', desiredArtifact: '能够解释数组操作结果' })).toBe(true);

    const contextualMention = outlineFixture() as any;
    contextualMention.stages[0].mainline[0].title = '雅思阅读：识别论证结构';
    contextualMention.stages[0].mainline[0].knowledgePoint = '阅读一段介绍软件依赖的文章';
    contextualMention.stages[0].mainline[0].action = '标出作者主张和两条原文依据';
    contextualMention.stages[0].mainline[0].deliverable = '主旨句与原文证据';
    expect(validateCurriculumGoalScope(contextualMention, input)).toBe(true);

    const ambiguousTool = outlineFixture() as any;
    ambiguousTool.stages[0].mainline[0].title = '小工具数据建模与反馈生成';
    ambiguousTool.stages[0].mainline[0].action = '分析一组练习结果并说明反馈依据';
    ambiguousTool.stages[0].mainline[0].deliverable = '正确率变化和薄弱项分析';
    const findings = analyzeCurriculumGoalScope(ambiguousTool, input);
    expect(findings.some(item => item.severity === 'blocking')).toBe(false);
    expect(findings.some(item => item.severity === 'review')).toBe(true);
  });

  it('distinguishes learning about software terms from being required to build software', () => {
    const reading = outlineFixture() as any;
    Object.assign(reading.stages[0].mainline[0], {
      title: '雅思阅读：软件安装文章的观点与证据',
      knowledgePoint: '作者如何说明应用安装步骤',
      action: '阅读一段介绍软件安装方式的英文材料，概括作者观点并定位两处原文证据。',
      deliverable: '英文主旨概括与两处定位证据',
      acceptance: '主旨准确，且两处证据都来自材料并能支持判断。',
    });

    const findings = analyzeCurriculumGoalScope(reading, {
      goal: '提升雅思阅读理解能力',
      desiredArtifact: '可核对的阅读练习与证据档案',
    });

    expect(findings.some(item => item.severity === 'blocking')).toBe(false);
  });

  it('rejects a required website project for linear algebra while allowing a mathematical calculation tool', () => {
    const webProject = outlineFixture() as any;
    Object.assign(webProject.stages[0].mainline[0], {
      title: '特征值结果与误差分析',
      knowledgePoint: '数值误差与特征值',
      action: '开发并部署一个特征值计算网页。',
      deliverable: '可访问的特征值计算网站',
      acceptance: '提交网页地址、源代码和部署截图。',
    });
    expect(validateCurriculumGoalScope(webProject, {
      goal: '学习线性代数中的特征值',
      desiredArtifact: '包含推导过程和核验结果的练习集',
    })).toBe(false);

    const numpyApp = outlineFixture() as any;
    Object.assign(numpyApp.stages[0].mainline[0], {
      title: '数组索引练习应用',
      knowledgePoint: '数组切片与索引',
      action: '构建并部署一个数组索引练习应用。',
      deliverable: '可安装的练习应用与发布包',
      acceptance: '提交安装包和发布链接。',
    });
    expect(validateCurriculumGoalScope(numpyApp, {
      goal: '学习 NumPy 数组索引',
      desiredArtifact: '可解释的索引练习与运行结果',
    })).toBe(false);
  });

  it('rejects an explicit code-work task title in a non-programming course outside language learning too', () => {
    const unrelatedTask = outlineFixture() as any;
    unrelatedTask.stages[0].mainline[0].title = '运行环境与第一个脚本';
    const findings = analyzeCurriculumGoalScope(unrelatedTask, {
      goal: '学习中国古典诗词鉴赏',
      desiredArtifact: '一份有文本证据的诗词分析作品集',
    });

    expect(findings.some(item => item.severity === 'blocking')).toBe(true);
  });

  it('does not treat a programming tool mentioned as an IELTS aid as a second programming subject', () => {
    const outline = outlineFixture() as any;
    outline.stages[0].mainline[0].title = '运行环境与第一个脚本';
    const findings = analyzeCurriculumGoalScope(outline, {
      goal: '雅思听说读写提升，日常用 Python 辅助整理错题。',
      desiredArtifact: '四科练习证据与个人薄弱项复盘',
    });

    expect(findings.some(item => item.severity === 'blocking')).toBe(true);
  });

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
    const mixedGrid = structuredClone(outline);
    mixedGrid.nineGrid[0].taskIds = [mixedGrid.stages[0].mainline[0].id, mixedGrid.stages[0].branches[0].tasks[0].id];
    expect(validateCurriculumOutline(mixedGrid, { days:28, dailyMinutes:60 })).toBe(false);
    const recoveredMixedGrid = normalizeGeneratedCurriculumOutline(mixedGrid) as typeof outline;
    expect(recoveredMixedGrid.nineGrid[0].taskIds).toEqual([mixedGrid.stages[0].mainline[0].id]);
    expect(validateCurriculumOutline(recoveredMixedGrid, { days:28, dailyMinutes:60 })).toBe(true);
    const recoveredBranchOnlyGrid = normalizeGeneratedCurriculumOutline(branchOnlyGrid) as typeof outline;
    expect(curriculumOutlineSchema.safeParse(recoveredBranchOnlyGrid).success).toBe(false);
    const shortGoal = { ...underfilled, stages: [{ ...underfilled.stages[0], mainline: [underfilled.stages[0].mainline[0]], gateTaskId: underfilled.stages[0].mainline[0].id, branches: [] }], nineGrid: outline.nineGrid.map(grid => ({ ...grid, taskIds: [`s0-m0`] })), densityRationale:'仅有两天预算，本路线只保留最关键主线能力。' };
    expect(validateCurriculumOutline(shortGoal, { days:2, dailyMinutes:15 })).toBe(false);
  });

  it('requires version 5 task-to-capability links to point to declared goal outcomes', () => {
    const outline = outlineFixture() as any;
    outline.curriculumRulesVersion = 5;
    outline.goalCapabilities = [{ id: 'reading', title: '雅思阅读证据定位', description: '概括主旨并以原文支持判断。' }];
    for (const stage of outline.stages) for (const task of [...stage.mainline, ...stage.branches.flatMap((branch: any) => branch.tasks)]) {
      task.goalCapabilityIds = ['missing-capability'];
      task.goalRelevance = '该任务直接训练并留下可检查的目标能力证据。';
      task.action = '完成一项有明确输入和检查步骤的练习。';
      task.deliverable = '提交练习结果与理由。';
      task.acceptance = '结果正确，且理由引用了对应证据。';
    }
    expect(validateCurriculumOutline(outline, { days: 28, dailyMinutes: 60 })).toBe(false);
    for (const stage of outline.stages) for (const task of [...stage.mainline, ...stage.branches.flatMap((branch: any) => branch.tasks)]) task.goalCapabilityIds = ['reading'];
    expect(validateCurriculumOutline(outline, { days: 28, dailyMinutes: 60 })).toBe(true);
    expect(curriculumOutlineSchema.safeParse(outline).success).toBe(true);
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

  it('keeps natural-language prerequisites at course level instead of rejecting them as broken task IDs', () => {
    const input = outlineFixture() as unknown as Record<string, any>;
    input.prerequisites = ['能用 Python 嵌套列表表示矩阵'];
    input.stages[0].mainline[0].prerequisites = ['Python 嵌套列表表示矩阵'];
    const normalized = normalizeGeneratedCurriculumOutline(input) as any;
    expect(normalized.stages[0].mainline[0].prerequisites).toEqual([]);
    expect(curriculumOutlineSchema.safeParse(normalized).success).toBe(true);
    expect(validateCurriculumOutline(normalized, { days: 28, dailyMinutes: 60 })).toBe(true);
  });

  it('moves readable but non-ID task prerequisites into course prerequisites and keeps valid task edges', () => {
    const input = outlineFixture() as unknown as Record<string, any>;
    input.stages[0].mainline[1].prerequisites = ['s0-m0', 'Python 嵌套列表', '能读懂 shape 输出'];
    const normalized = normalizeGeneratedCurriculumOutline(input) as any;
    expect(normalized.stages[0].mainline[1].prerequisites).toEqual(['s0-m0']);
    expect(normalized.prerequisites).toContain('Python 嵌套列表');
    expect(normalized.prerequisites).toContain('能读懂 shape 输出');
    expect(curriculumOutlineSchema.safeParse(normalized).success).toBe(true);
    expect(validateCurriculumOutline(normalized, { days: 28, dailyMinutes: 60 })).toBe(true);
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
