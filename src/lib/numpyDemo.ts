import type { Campaign, LessonContent, Stage, Task, TaskChain } from '../../shared/types';

const py = (path: string) => `https://numpy.org/doc/stable/${path}`;
const objective = (id: string, text: string) => ({ id, text });
const sampleLesson: LessonContent = {
  purpose: '先把一维和二维 ndarray 看成带有明确形状的数据盒子。你已接触 ndarray、shape 和 dtype；本课只从这三个已知概念出发，不假设会高级索引或机器学习。',
  explanation: 'An ndarray stores values in a regular grid. Its shape tells you the size along each axis; dtype tells you the kind of values stored. For a 2-D array, shape (3, 2) means 3 rows and 2 columns. Axis 0 moves down rows; axis 1 moves across columns. 中文辅助：shape 是每个维度的长度，dtype 是元素的数据类型。先看 shape，再决定如何沿某个轴操作；不要把 axis 0 想成“第 0 列”。',
  terms: [
    { en: 'array / ndarray', zh: '数组 / 多维数组', context: 'np.array([[70, 80], [90, 85]]) is a 2-D ndarray.' },
    { en: 'shape', zh: '形状', context: 'The example has shape (2, 2): two rows and two columns.' },
    { en: 'dtype', zh: '数据类型', context: 'arr.dtype may show int64; mixed decimal values may use a floating dtype.' },
    { en: 'axis', zh: '轴', context: 'axis=0 reduces rows; axis=1 reduces columns.' },
  ],
  example: {
    prompt: 'Predict the shape and row means before running this code.',
    code: 'import numpy as np\nscores = np.array([[70, 80, 90], [60, 75, 85]])\nprint(scores.shape)\nprint(scores.dtype)\nprint(scores.mean(axis=1))',
    walkthrough: 'There are 2 rows and 3 columns, so shape is (2, 3). axis=1 reduces each row across its columns, producing one mean per student: [80., 73.333…]. axis=0 would instead produce one mean per column.'
  },
  guidedPractice: { prompt: 'Complete the missing values: a 4-row, 2-column array has shape ____. To get one result per row, mean uses axis=____.', expected: '(4, 2); axis=1', hint: 'Shape lists row-count first and column-count second for a 2-D array.' },
  challenge: { prompt: 'Create a 3×2 integer score array. Print its shape and dtype, then compute one mean per row. Predict output length before running.', acceptance: 'The array has shape (3, 2); dtype is an integer kind; row means contain exactly 3 values and match the rows.', hints: ['Write three inner lists, each with two values.', 'Check .shape before choosing the axis.', 'axis=1 returns one value per row.'] },
  language: 'mixed', generatedAt: '2026-10-13T00:00:00.000Z', revision: 1,
};

function makeTask(input: { id: string; title: string; track?: 'main'|'branch'; chainId: string; kind: Task['kind']; minutes: number; prerequisites: string[]; brief: string; concept: string; objective: string; practice: string; acceptance: string; hint: string; question: string; teaching?: LessonContent }): Task {
  return {
    id: input.id, title: input.title, track: input.track ?? 'main', chainId: input.chainId, kind: input.kind, minutes: input.minutes, xp: input.kind === 'boss' ? 180 : 70,
    prerequisites: input.prerequisites, objectives: [objective(`${input.id}-outcome`, input.objective)], brief: input.brief,
    curiosity: input.concept, steps: [input.brief, input.practice], acceptance: input.acceptance,
    recallQuestion: input.question, hint: input.hint, resources: [{ title: 'NumPy 官方文档', url: py('user/quickstart.html') }],
    ...(input.teaching ? { teaching: input.teaching } : {}),
  };
}

function chain(id: string, title: string, taskIds: string[], track: 'main'|'branch' = 'main'): TaskChain { return { id, title, track, taskIds }; }

const stages: Stage[] = [
  {
    id: 'numpy-foundation', title: '先读懂数据形状', description: '从已知 ndarray、shape、dtype 出发，确认数组如何组织，再进入筛选。', mainlineTaskIds: ['numpy-read-shape', 'numpy-build-array'], gateTaskIds: ['numpy-read-shape', 'numpy-build-array'],
    chains: [chain('foundation-main', '主线 · 数组识读', ['numpy-read-shape', 'numpy-build-array']), chain('foundation-repair', '补强支线 · 类型辨析', ['numpy-dtype-repair'], 'branch')],
    reward: { xp: 40, coins: 10, items: [] }, tasks: [
      makeTask({ id: 'numpy-read-shape', title: '校准仪表：读懂 shape 与 axis', chainId: 'foundation-main', kind: 'investigate', minutes: 25, prerequisites: [], brief: '先预测二维 ndarray 的行列数、dtype 和 axis 方向，再用小数组验证。', concept: 'shape 描述几何结构；axis 表示沿哪个维度聚合。', objective: '独立创建 3×2 数组并正确解释 shape、dtype 与 axis=0/1 的差别。', practice: '补全 4×2 的 shape，预测 mean(axis=1) 的结果数量；然后关闭讲解独立写一段检查程序。', acceptance: '代码输出 shape=(3, 2)，能说明 axis=1 留下每行一个值，并贴预测和实测。', hint: '先画 3 行 2 列的小表格。axis=1 沿着每一行横向计算。', question: '一个 shape=(2, 3) 的数组做 sum(axis=0)，结果有几个数？', teaching: sampleLesson }),
      makeTask({ id: 'numpy-build-array', title: '建立测量样本：从 Python 列表创建数组', chainId: 'foundation-main', kind: 'practice', minutes: 30, prerequisites: ['numpy-read-shape'], brief: '从几组练习成绩创建 ndarray，观察均匀列表与不规则列表的差异。', concept: '规则网格适合数组运算；输入数据的结构会影响可用表示。', objective: '创建结构正确的二维分数数组，检查行数、列数和 dtype。', practice: '给 3 位学生各录入 2 门分数，写出 shape 断言，再试一次不规则长度并记录 NumPy 的处理方式。', acceptance: '展示构造代码与 shape/dtype 实际结果，说明为何需要先检查数据是否规则。', hint: '外层列表表示行；每个内层列表必须有相同的项目数。', question: '为什么 [ [1,2], [3] ] 不能被当作普通的 2×2 数值表？' }),
      makeTask({ id: 'numpy-dtype-repair', title: '补给支线：辨析 dtype 与隐式转换', track: 'branch', chainId: 'foundation-repair', kind: 'investigate', minutes: 20, prerequisites: ['numpy-read-shape'], brief: '对比整数、浮点数和混合输入，预测 dtype 如何变化。', concept: 'dtype 影响内存表示与运算精度，不能只看打印出来像不像整数。', objective: '用 .dtype 检查三种数组并解释一次隐式类型提升。', practice: '分别创建整数数组、含 2.5 的数组和混合类型数组，记录 dtype 与一个运算结果。', acceptance: '提交三种 dtype 和解释，指出需要精度时为何不应意外转回整数。', hint: '试试 np.array([1, 2.5])，先预测再执行。', question: '小数被存成整数时可能丢失什么信息？' }),
    ],
  },
  {
    id: 'numpy-filter', title: '把筛选规则变成数组操作', description: '从单个位置到区间，再到布尔掩码；主线最后独立交付可验证的数据筛选函数。', mainlineTaskIds: ['numpy-index', 'numpy-slice', 'numpy-mask', 'numpy-filter-boss'], gateTaskIds: ['numpy-index', 'numpy-slice', 'numpy-mask', 'numpy-filter-boss'],
    chains: [chain('filter-main', '主线 · 索引到独立筛选', ['numpy-index', 'numpy-slice', 'numpy-mask', 'numpy-filter-boss']), chain('filter-app', '应用支线 · 成绩分析', ['numpy-score-report'], 'branch'), chain('filter-repair', '纠错支线 · 形状与边界', ['numpy-index-repair'], 'branch'), chain('filter-advanced', '进阶支线 · view 与 copy', ['numpy-view-copy'], 'branch')],
    reward: { xp: 100, coins: 25, items: [] }, tasks: [
      makeTask({ id: 'numpy-index', title: '定位数据：二维数组索引', chainId: 'filter-main', kind: 'investigate', minutes: 25, prerequisites: ['numpy-build-array'], brief: '用 3×3 小数组定位一个元素，明确 Python 从 0 开始计数以及二维坐标顺序。', concept: '先行后列：arr[row, column]。索引越界应尽早发现。', objective: '准确读取两个指定坐标，解释 row/column 顺序并识别一个越界索引。', practice: '不运行先预测 arr[1, 2]；再分别试 arr[0] 与 arr[0, 0]，比较维度变化。', acceptance: '代码与预测一致，解释索引从 0 开始并指出越界位置。', hint: 'arr[行, 列]；shape=(3,3) 的有效位置为 0 到 2。', question: 'arr[1,0] 选中第几行第几列？' }),
      makeTask({ id: 'numpy-slice', title: '截取数据：切片与终点边界', chainId: 'filter-main', kind: 'practice', minutes: 25, prerequisites: ['numpy-index'], brief: '用切片选择连续行列，预测起点包含、终点不包含的结果形状。', concept: '切片边界可组合；只切一轴与同时切两轴的结果形状不同。', objective: '写出一个 2×2 子数组切片并用 shape 验证。', practice: '对 4×3 数组执行 arr[1:3, 0:2]，列出选中行列和结果 shape。', acceptance: '得到 shape=(2,2)，能够解释 3 这个停止位置不被选中。', hint: '先独立画出行索引 1、2 与列索引 0、1。', question: '为什么 1:3 会选择两个位置而不是三个？' }),
      makeTask({ id: 'numpy-mask', title: '生成布尔掩码：让条件筛选数据', chainId: 'filter-main', kind: 'practice', minutes: 30, prerequisites: ['numpy-slice'], brief: '比较 scores >= threshold 得到的布尔数组与原始成绩，再用掩码选择元素。', concept: '布尔掩码的形状与被筛数组对应，条件表达式逐元素计算。', objective: '独立生成阈值掩码，筛出达标分数并核对选择结果。', practice: '给二维成绩设置阈值 80，打印掩码和 scores[mask]，再试每行达标人数。', acceptance: '掩码与原数组 shape 相同，筛出的成绩准确，解释 True/False 如何对应原位置。', hint: '先看 mask 的 shape，再看 True 的位置；不要把 Python and 用在数组比较上。', question: 'mask 中某个位置为 True，代表原数组哪个位置会被保留？' }),
      makeTask({ id: 'numpy-filter-boss', title: '阶段验收：独立完成成绩筛选', chainId: 'filter-main', kind: 'boss', minutes: 40, prerequisites: ['numpy-mask'], brief: '关掉示例，完成一个可复用函数：筛选达标学生，返回原始行和每人达标科目数。', concept: '迁移验证要组合输入结构、比较、掩码与解释，不靠在线时长或勾选结算。', objective: '交付筛选函数、边界测试和逐行解释，全部由自己编写。', practice: '使用 4×3 成绩数组和阈值；测试全达标、无人达标、恰好临界分数以及空输入。', acceptance: '结果与独立写出的预期一致；四类边界均有验证，说明返回 shape 与掩码规则。', hint: '提示 1：先写输入 shape 与输出契约。提示 2：用 >= 保留临界分数。提示 3：空输入时也保持二维结构。', question: '如何验证函数不会因数据恰好全达标而错误地改变输出维度？' }),
      makeTask({ id: 'numpy-score-report', title: '应用支线：生成达标学生统计简报', track: 'branch', chainId: 'filter-app', kind: 'practice', minutes: 25, prerequisites: ['numpy-mask'], brief: '把布尔筛选用于小型模拟成绩表，产出达标名单和统计数字。', concept: '应用支线练把数组结果转成可解释摘要，不影响主线通关。', objective: '生成达标名单、人数与平均分，并对结果进行人工核算。', practice: '定义数组和阈值，筛选行，打印清晰摘要，与手算结果对比。', acceptance: '名单、人数与均值一致，标明列含义和阈值；不访问任何真实学生数据。', hint: '先用一列达标条件生成 mask，再按行筛选。', question: '平均分应对所有学生算，还是只对达标学生算？题目契约怎样决定？' }),
      makeTask({ id: 'numpy-index-repair', title: '纠错支线：诊断维度与切片错误', track: 'branch', chainId: 'filter-repair', kind: 'investigate', minutes: 18, prerequisites: ['numpy-index'], brief: '观察选单行与行切片的 shape 差异，修复一个错误的广播/拼接前置判断。', concept: '维度被压缩或保留会影响后续数组形状兼容。', objective: '用 shape 断言定位一处维度错误并修复。', practice: '比较 arr[1]、arr[1:2] 和 arr[1, :] 的 shape。', acceptance: '贴出每种 shape 和解释，修复代码后测试实际预期维度。', hint: '整数索引通常压缩该轴；切片通常保留轴。', question: '何时应该用 1:2 而不是整数 1？' }),
      makeTask({ id: 'numpy-view-copy', title: '进阶支线：观察视图与副本', track: 'branch', chainId: 'filter-advanced', kind: 'practice', minutes: 25, prerequisites: ['numpy-slice'], brief: '通过小型可重复实验观察切片修改是否影响原数组，避免只记“切片一定是视图”。', concept: 'view/copy 行为取决于操作；使用 .copy() 明确独立数据需求。', objective: '完成切片别名实验，观察原数组变化并用 copy 对照。', practice: '创建 arr，取切片与显式副本，修改各自首项，打印原数组并说明结果。', acceptance: '代码与运行结果对应，说明为何重要数据修改前应明确复制策略。', hint: '先实验基本切片；高级索引可能有不同复制行为，不能过度推广。', question: '如何在需要独立修改时表达明确意图？' }),
    ],
  },
  {
    id: 'numpy-prepare', title: '汇总并交付数据准备流程', description: '先建立按轴聚合的正确心智模型，再组合筛选、统计和结果说明，为后续机器学习做数据准备。', mainlineTaskIds: ['numpy-reduce', 'numpy-project'], gateTaskIds: ['numpy-reduce', 'numpy-project'],
    chains: [chain('prepare-main', '主线 · 汇总与独立交付', ['numpy-reduce', 'numpy-project']), chain('prepare-extra', '实践支线 · 缺失数据探索', ['numpy-missing'], 'branch')],
    tasks: [
      makeTask({ id: 'numpy-reduce', title: '计算摘要：按行与按列汇总', chainId: 'prepare-main', kind: 'practice', minutes: 30, prerequisites: ['numpy-filter-boss'], brief: '使用 sum、mean、min 和 max 计算每位学生与每门科目的摘要。', concept: 'axis 选择决定结果保留哪一维；先说出结果形状再调用函数。', objective: '实现两种轴方向的摘要，解释结果 shape。', practice: '对 3×2 数组分别求 axis=0、axis=1 的 mean，并将每个结果映射回数据含义。', acceptance: '数值正确，说明 axis 与输出 shape，不把“方向”含混说成行或列。', hint: '沿 axis=1 消去列，结果留下每行一个值；用纸面小表核对。', question: '如果要得到每个科目平均分，应该消去哪一个轴？' }),
      makeTask({ id: 'numpy-project', title: '终局验收：交付可解释的数据清洗简报', chainId: 'prepare-main', kind: 'boss', minutes: 45, prerequisites: ['numpy-reduce'], brief: '从简单模拟数组开始，交付输入检查、掩码筛选、按轴汇总与结果说明。', concept: '最终成果是可复现的分析程序，不是“已经看过教程”。', objective: '独立编写 NumPy 分析脚本与测试数据，证明输出结构和数值都正确。', practice: '用虚构分数数据构造二维数组，检查 shape/dtype，按规则筛选，再计算列摘要并解释边界。', acceptance: '提交可重复运行的代码、预测与实际结果、空集和临界值测试；能口述每个 axis 的语义。', hint: '先定义输入和输出契约；分段检查 shape；遇到不确定先用 2×2 小例子。', question: '你的脚本还依赖什么假设？如何增加一列时发现并处理变化？' }),
      makeTask({ id: 'numpy-missing', title: '实践支线：探索缺失值标记', track: 'branch', chainId: 'prepare-extra', kind: 'investigate', minutes: 25, prerequisites: ['numpy-reduce'], brief: '用 NaN 小样本观察普通 mean 与 nanmean 的区别。', concept: '缺失值处理是带语义的数据决定，不能无说明地自动填补。', objective: '展示 NaN 对结果的影响，并解释一种谨慎处理方式。', practice: '创建含 np.nan 的数组，比较 np.mean 与 np.nanmean，并统计有效值数量。', acceptance: '标明缺失值假设，不把 nanmean 当作通用数据修复。', hint: '统计有效数量也很重要，只看跳过 NaN 的均值可能误导。', question: '何时跳过缺失数据会让平均值产生偏差？' }),
    ],
  },
];

export const NUMPY_DEMO_CAMPAIGN: Campaign = {
  id: 'numpy-first-analysis', title: 'NumPy 数据准备行动',
  subtitle: '从 ndarray、shape、dtype 这些已学起点出发，四周做出可解释、可复现的基础数据分析。',
  goal: '四周内独立完成基础 NumPy 数据处理，为机器学习的数据准备打下基础。起点：已学 ndarray、shape、dtype；讲解能听懂但独立写代码会卡住。',
  level: '会创建 ndarray 并读 shape、dtype；尚未掌握索引、筛选、聚合与机器学习。', days: 28, dailyMinutes: 60,
  ultimateReward: '交付一份可独立运行的 NumPy 数据筛选与汇总脚本，并能解释每一步结果。',
  desiredArtifact: '使用虚构成绩数据完成过滤、聚合、边界测试并解释输出的 Python 脚本。', language: 'mixed',
  prerequisites: ['Python 3 已安装', '了解基本列表、数字和 print；不要求机器学习背景'],
  createdAt: '2026-10-13T00:00:00.000Z', source: 'demo', stages,
  nineGrid: [
    ['shape解释', '读懂数组维度', ['numpy-read-shape']], ['array构造', '创建规则数据', ['numpy-build-array']], ['dtype核验', '检查数据表示', ['numpy-build-array']],
    ['整数索引', '定位单个元素', ['numpy-index']], ['切片选择', '按范围取子数组', ['numpy-slice']], ['布尔筛选', '按条件选择数据', ['numpy-mask']],
    ['二维筛选', '独立交付筛选函数', ['numpy-filter-boss']], ['axis聚合', '按行列解释统计', ['numpy-reduce']], ['数据准备作品', '交付并验证小型分析脚本', ['numpy-project']],
  ].map(([title, ability, unlockTaskIds], index) => ({ id: `numpy-grid-${index + 1}`, title: String(title), ability: String(ability), value: '可复用的基础 NumPy 数据处理能力', unlockTaskIds: unlockTaskIds as string[] })),
};
