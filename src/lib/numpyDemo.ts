import type { Campaign, Stage, Task, TaskChain } from '../../shared/types';

type Unit = [title: string, point: string, action: string, artifact: string];
type TrackName = 'main' | 'branch';
const doc = 'https://numpy.org/doc/stable/user/quickstart.html';
const starterLesson = {
  purpose: '从你已学的 ndarray、shape、dtype 出发，闭卷预测后用 3×2 小数组检查 shape、类型和 axis。',
  explanation: 'An ndarray stores values in a regular grid. Its shape gives the length of each axis; dtype is the value representation. For shape (3, 2), there are 3 rows and 2 columns. axis=1 reduces each row and returns 3 values. 中文辅助：shape 是每个维度的长度；axis=1 沿每行计算，保留行数。',
  terms: [{ en:'array / ndarray', zh:'数组 / 多维数组', context:'np.array([[70,80],[60,90]]) creates a 2-D ndarray.' }, { en:'shape', zh:'形状', context:'This array has shape (2,2).' }, { en:'dtype', zh:'数据类型', context:'arr.dtype reports the stored numeric kind.' }, { en:'axis', zh:'轴', context:'axis=1 leaves one result per row.' }],
  example: { prompt:'Predict shape, dtype and row means.', code:'import numpy as np\nscores=np.array([[70,80,90],[60,75,85]])\nprint(scores.shape, scores.dtype)\nprint(scores.mean(axis=1))', walkthrough:'There are 2 rows and 3 columns, so shape is (2,3); axis=1 produces one mean per row.' },
  guidedPractice: { prompt:'A 4-row, 2-column array has shape ____. One result per row uses axis=____.', expected:'(4, 2); axis=1', hint:'Read rows first; axis=1 reduces across each row.' },
  challenge: { prompt:'Create a 3×2 integer score array. Print shape and dtype, then calculate one mean per row.', acceptance:'shape is (3,2); dtype is integer; there are 3 means and each matches one row.', hints:['Write three inner lists with two values each.','Check .shape.','Use axis=1 for one result per row.'] },
  language: 'mixed' as const, generatedAt:'2026-10-13T00:00:00.000Z', revision:1,
};
const units: Unit[][] = [
  [
    ['起点诊断：读数组契约','ndarray / shape / dtype','不看笔记预测给定数组的维度、shape 和 dtype，再运行核对。','预测表与一段核验代码'],
    ['从列表构造一维数组','np.array 与一维输入','将温度样本列表转为 ndarray，检查类型并说明为何仍是一维。','构造代码与 shape 输出'],
    ['构造规则二维数组','嵌套序列与规则网格','创建 3×2 虚构测量表，并断言每行列数一致。','二维数组与结构断言'],
    ['读取 ndim 与 size','ndim / size','分别对 1D、2D 数组打印维度数和元素总数，并写预测。','两组打印结果和解释'],
    ['拆读 shape 各轴','行列维度与 shape 元组','创建 4×3 表格，将 shape 两个数映射到行列并写断言。','shape 断言与行列说明'],
    ['检查 dtype 类型族','整数、浮点与布尔 dtype','创建三类数组并比较 dtype.kind，辨认表示差别。','dtype 对照表与脚本'],
    ['显式转换数值类型','astype 与精度损失','将浮点数组转整数前预测小数部分变化，记录转换后结果。','转换前后对比与风险说明'],
    ['创建零初始化数组','zeros 与目标 shape','为 5 个样本创建零初始化特征矩阵，验证 shape 和 dtype。','初始化代码与断言'],
    ['创建单位填充数组','ones 与初始化用途','构造指定 shape 的单位数组，再将其用于逐元素缩放演示。','数组结果与运算输出'],
    ['创建常数模板','full 与显式填充值','用 full 生成固定缺省值矩阵，验证不同 shape 参数。','可复用构造函数与测试'],
    ['构造等步长整数样本','arange 半开区间','用 arange 创建整数编号，预测终点是否包含并检查步长。','数列结果与边界说明'],
    ['构造等间隔测量点','linspace 与端点数量','在区间两端生成 6 个测量点，核对点数及首尾。','测量点数组和端点断言'],
    ['重塑数组而不改元素数','reshape 与元素总数','将 12 项序列重排为 3×4，重排前后断言 size 一致。','重塑代码与两项断言'],
    ['用 -1 推断一维长度','reshape(-1, n)','将 12 项数据整理为两列，比较推断行数与手工行数。','reshape(-1, 2) 实验'],
    ['行向量与列向量的维度','(n,) / (n,1) / (1,n)','构造三种表示，检查 shape 并说明下游拼接时的差异。','三种 shape 对照与独立数组检查作品'],
  ],
  [
    ['回忆诊断：索引坐标顺序','从 shape 推导有效下标','对 3×4 数组预测 arr[1,2]，并判断两个边界下标是否合法。','预测、运行输出和边界判断'],
    ['读取单个二维元素','arr[row, column]','按题目给定行列读取 3 个值，先写坐标再执行。','索引表达式与输出清单'],
    ['选择完整的一行','整数索引与轴压缩','比较 arr[1] 与 arr[1:2] 的 shape，解释整数索引压掉哪一轴。','两种结果的 shape 和说明'],
    ['切片起点与终点','半开区间边界','用 1:4 选择行，逐项标注纳入和排除的位置。','下标清单和切片结果'],
    ['同时切行与列','二维切片组合','从 5×4 数组取指定 2×2 子块，写出切片前预测 shape。','子数组、shape 与预测'],
    ['使用省略号保留尾部轴','ellipsis 索引','在三维小数组中固定首轴位置并选取最后一列，解释省略部分。','表达式、输出 shape 与解释'],
    ['区分负索引与越界','末尾索引和边界异常','用 -1 读取最后一行，并测试一个越界位置如何报错。','负索引结果及异常处理'],
    ['生成一维布尔掩码','比较表达式逐元素计算','用阈值比较生成 mask，核对其长度与输入一致。','mask 数组与长度断言'],
    ['用掩码筛选一维数据','布尔高级索引','筛选温度超过阈值的读数，按原位置核算结果。','筛选代码与人工核算'],
    ['组合两个条件','逐元素逻辑与/或','同时筛上下界区间，使用括号和 &，与手工预期逐项比对。','复合 mask 和结果验证'],
    ['从二维表筛选整行','any / all 条件聚合','筛选至少一科达标的学生行，解释条件先沿哪个轴聚合。','筛后行表及行数说明'],
    ['获取符合条件的位置','where 与 nonzero','取得超过阈值的坐标，和直接布尔筛选结果交叉核对。','坐标数组及一致性断言'],
    ['处理空筛选结果','空数组 shape 与下游代码','用不可能阈值制造空结果，确保后续统计逻辑仍能运行。','空结果测试与明确输出契约'],
    ['设计可复用筛选函数','参数、返回值与边界','实现输入矩阵和阈值参数，返回行及达标计数，并测试临界值。','带三组测试的函数'],
    ['主线验收：独立完成筛选器','索引、切片与掩码迁移','从新造数据开始完成指定列筛选、行保留和边界测试，不抄示例。','可运行函数、测试与解释报告'],
  ],
  [
    ['回忆诊断：预测 axis 输出','维度消去规则','在 3×2 数据上预测 sum(axis=0/1) 的 shape 和值。','预测表与实际核验'],
    ['按列汇总行样本','axis=0 聚合','计算每列均值并将两个结果对应回数据列语义。','聚合代码与列标签'],
    ['按行汇总观测','axis=1 聚合','计算每行总量，预测输出长度并用手算复核一行。','每行结果与手算记录'],
    ['选择聚合函数','sum / mean / min / max','对同一组值计算四类摘要，说明各自回答的问题。','四类摘要与适用问题'],
    ['保持维度便于广播','keepdims=True','对行求均值并保留轴，打印前后 shape。','两个 shape 与后续用途说明'],
    ['广播规则：尾轴对齐','维度为 1 的兼容规则','判断三组 shape 是否可广播，用代码验证其中两组。','兼容性预测表与验证脚本'],
    ['按列偏移中心值','二维数组减列均值','将每列中心化，验证结果各列均值接近零。','中心化代码和数值断言'],
    ['一维向量与二维矩阵广播','(n,) 对齐最后一轴','用列偏置调整每行，比较广播结果 shape 和目标。','广播表达式与 shape 断言'],
    ['显式扩展行列轴','None / np.newaxis','将一维 x、y 变成列与行，构造网格并解释结果 shape。','网格代码和 shape 推导'],
    ['定位广播错误','不兼容 shape 的诊断','复现两种不能广播的 shape，读错误并最小化修复。','失败用例、错误原因和修复'],
    ['比较循环与向量化','逐元素表达式','对同一转换分别写 Python 循环和数组表达式，核对逐项相同。','两版实现与等价断言'],
    ['用 where 编码分段规则','条件选择与向量计算','将低、中、高区间映射为标签，测试边界相等情况。','分段转换函数及边界用例'],
    ['向量化多列特征','列运算组合','对两列构造差值与比例特征，处理零分母并说明策略。','新特征矩阵与零值测试'],
    ['验证数值精度与归约','浮点误差与容差','比较精确相等与 allclose，选择适当容差核验结果。','数值检查代码和理由'],
    ['主线验收：向量化摘要函数','axis、广播和测试迁移','独立实现按列标准化与按行摘要，验证 shape、数值和零值边界。','带断言的小型可复用分析模块'],
  ],
  [
    ['项目诊断：定义输入输出契约','表格 schema 与检查','给虚构传感器数据定义行列含义、合法 dtype、异常值规则。','输入契约与两条断言'],
    ['生成可重复的模拟数据','default_rng 与随机种子','使用 default_rng 固定 seed 造样本，重复运行并比较完全一致。','随机数据脚本与复现证明'],
    ['拆分特征列与标签列','切片和列语义','从二维样本表分离特征矩阵 X 和目标 y，核对行数。','X/y 构造与 shape 断言'],
    ['检查缺失值分布','isnan 与有效计数','为模拟列插入 NaN，逐列统计缺失比例而不先填补。','缺失计数表和脚本'],
    ['选择明确的缺失策略','nanmean 与保留缺失','比较均值忽略缺失和保留标记的后果，写明适用假设。','策略对比和选择理由'],
    ['组合清洗步骤','筛选与列变换','先剔除不合法行，再计算派生列，逐步记录每步 shape。','分步 shape 日志'],
    ['验证数据范围','min / max 与断言','对列范围和非负字段添加验证，注入一个错误值确保检查触发。','数据质量检查与失败样例'],
    ['组织纯函数处理流程','输入不变性与返回值','将检查、筛选、汇总封装为函数，确认不意外修改原始数据。','函数代码和原数组比较'],
    ['测试零行与单行输入','边界 shape','以空数据和单条数据运行流程，保持返回列定义稳定。','两类边界测试'],
    ['写清楚分析结果','数值结果与上下文','生成包含样本量、阈值、摘要的文本报告并核对数字来源。','可复现结果简报'],
    ['检查结果可重复性','seed 与确定性处理','运行整个脚本两次并比较结果，区分随机生成和处理波动。','两次运行摘要及差异解释'],
    ['为关键步骤加回归测试','断言与测试样例','覆盖合法输入、阈值边界、空集和缺失值四类场景。','自动化测试文件'],
    ['解释向量化流程','数据流与中间形状','绘制输入到清洗、特征、摘要的 shape 变化图。','shape 流程图或文本图'],
    ['打包独立运行说明','环境、执行和预期输出','从干净 Python 会话运行脚本，补充依赖与预期摘要说明。','README 和一次运行记录'],
    ['赛季验收：独立完成数据准备作品','组合迁移与口头解释','对新给定虚构数据完成检查、筛选、特征、按轴统计、测试与说明。','脚本、测试结果、shape 图和逐步解释'],
  ],
];

const branchUnits: Unit[][][] = [
  [
    [['应用：整理问卷评分','二维录入','创建 4 人×3 题评分表并为行列添加标签。','标注清楚的评分数组'],['应用：汇总每人得分','行汇总','计算每人总分并按手算核对两人。','分数表和核算记录'],['应用：产出评分小报','摘要解释','组合人数、均分和最高分生成简短报告。','可复现的问卷摘要']],
    [['错误诊断：不规则输入','嵌套列表长度','复现不规则嵌套输入并检查 ragged 行为及修复方案。','错误样例与结构校验'],['错误诊断：索引越界','边界下标','给出错误索引，依据 shape 推导合法范围并修复。','修正版索引和边界断言'],['错误诊断：类型截断','astype 精度','定位浮点转整数造成的截断，修改转换策略并测试。','问题复现和无损修复']],
    [['探索：数组内存估算','nbytes 与 size','比较相同元素数的 int32/float64 数组字节数。','内存估算表'],['探索：随机数种子','default_rng','使用同 seed 和不同 seed 各生成一次并解释复现性。','随机实验与比较'],['探索：数组复制实验','copy 与别名','修改副本和视图并对照原数组，记录本次实验观察。','代码与结果说明']],
  ],
  [
    [['应用：筛选活动记录','二维条件','按日期区间筛选模拟活动记录。','日期筛选函数'],['应用：组合筛选指标','多列掩码','组合状态和数值条件并统计符合记录数。','复合条件统计'],['应用：交付筛选摘要','输出解释','输出被选行、条件和结果计数并人工抽样验证。','筛选审计摘要']],
    [['错误诊断：终点遗漏','切片半开区间','定位切片终点漏掉一项的原因并增加边界测试。','修复与边界测试'],['错误诊断：and 与 &','数组逻辑运算','复现布尔数组逻辑错误，修正括号和运算符。','失败和修正代码'],['错误诊断：掩码形状','mask 与目标维度','制造长度不匹配掩码并写出触发断言。','形状错误保护']],
    [['进阶探索：视图修改','基本切片行为','观察切片赋值影响原数组的行为，不泛化至所有索引。','实验日志'],['进阶探索：高级索引复制','整数数组索引','对比整数数组索引与基本切片的修改行为。','对照实验和结论'],['进阶探索：显式副本边界','copy()','将修改隔离到副本，并测试原输入保持不变。','安全修改函数']],
  ],
  [
    [['应用：汇总商品销量','按轴统计','计算每品类销量并映射回标签。','销量摘要表'],['应用：构造相对指标','广播与中心化','逐列减去基线，核对每列基线关系。','相对指标矩阵'],['应用：解释可视指标','聚合语义','撰写各指标计算轴及含义，附一组手算核对。','指标说明卡']],
    [['错误诊断：轴选反','axis 输出','找出按列误写为按行的结果并设计 shape 检查。','错误复现和断言'],['错误诊断：广播错位','尾轴对齐','用不同列数的样本暴露向量错位，重塑成明确方向。','维度修复和证明'],['错误诊断：除零与容差','数值边界','处理零标准差并用 allclose 验证归一化结果。','边界实现和容差测试']],
    [['进阶探索：可广播形状','维度补 1','构造兼容的 (m,1) 与 (1,n)，预测结果 shape。','shape 推理与网格'],['进阶探索：内存与 dtype','dtype 转换成本','对比转换前后 nbytes 和小数保留情况。','成本记录与风险说明'],['进阶探索：随机模拟分布','均匀与正态采样','固定随机种子生成两类样本并比较 min/mean/std。','可复现统计实验']],
  ],
  [
    [['应用：模拟设备数据管线','模拟测量数据','固定 seed 生成带异常值的设备测量表。','可重复样本生成器'],['应用：筛选异常并汇总','掩码和归约','按规则标记异常并汇总有效值与剔除数。','异常分析摘要'],['应用：出具项目简报','端到端解释','将规则、样本数、结果和局限整合成简报。','简报及可运行脚本']],
    [['错误诊断：输入契约漏洞','结构断言','注入错误列数、dtype 和空输入并定位缺少检查。','输入校验测试'],['错误诊断：缺失被忽略','NaN 策略','对比普通 mean 与 nanmean，避免掩盖缺失规模。','缺失分析和明确决策'],['错误诊断：结果不可复现','随机状态','找出未固定 seed 的步骤并建立稳定回归测试。','修正后的复现测试']],
    [['进阶探索：批大小内存','数组 nbytes','估算批量扩大 10 倍后的内存占用。','容量估算和假设'],['进阶探索：随机采样误差','均值与标准差','改变样本量观察统计波动并记录 seed。','样本量实验表'],['进阶探索：模块化作品','函数边界','把数据造样、清洗与报告拆成独立函数并测试输入不变。','模块化项目提交']],
  ],
];

function task(id: string, unit: Unit, chainId: string, track: TrackName, minutes: number, prerequisites: string[], index: number): Task {
  const [title, point, action, artifact] = unit;
  const outcomeId = `${id}-outcome`;
  return {
    id, title, track, chainId, kind: index === 14 && track === 'main' ? 'boss' : index === 0 ? 'investigate' : 'practice',
    minutes, xp: index === 14 && track === 'main' ? 160 : 35,
    prerequisites, objectives: [{ id: outcomeId, text: artifact }],
    brief: `${point}。${action}`, curiosity: `好奇问题：什么会改变 ${point} 的结果？先预测，再用最小数据实验验证。`,
    steps: [`闭卷写下你对 ${point} 的预测。`, `运行或手算一个最小例子：${action}`, `比较预测与实测，记录差异与原因。`],
    acceptance: `交付${artifact}；包含输入与预期，附实际输出，并能解释 ${point} 的关键选择。`,
    recallQuestion: `${point} 的关键规则是什么？给出一个反例或边界情况。`,
    hint: `先把输入 shape 和期望输出写下来，再试最小样本。${action}`,
    resources: [{ title: 'NumPy 官方快速入门', url: doc }],
    knowledgePoints: [point], knownBasis: '已学 Python 列表、数字与 ndarray / shape / dtype；本任务只依赖其明确列出的前置任务。',
    deliverable: `提交：${artifact}`,
    hints: ['先画出输入的维度与数据标签。', `用 2–4 个值构造最小例子，验证：${action}`, '把边界输入也写成断言，解释失败意味着什么。'],
  };
}

const stageNames = ['数组构造、形状与数据类型','索引、切片与条件筛选','按轴运算、广播与向量化','小型数据处理项目与综合验收'];
const stageIds = ['numpy-v3-foundation','numpy-v3-selection','numpy-v3-compute','numpy-v3-project'];
const stages: Stage[] = units.map((mainUnits, stageIndex) => {
  const stageId = stageIds[stageIndex]; const mainChainId = `${stageId}-main`;
  const legacyTaskIds = stageIndex === 0 ? ['numpy-read-shape','numpy-build-array'] : stageIndex === 1 ? ['numpy-index','numpy-slice'] : stageIndex === 2 ? ['numpy-reduce','numpy-broadcast'] : ['numpy-project-start','numpy-project'];
  const mainIds = mainUnits.map((_, i) => legacyTaskIds[i] ?? `${stageId}-m${String(i+1).padStart(2,'0')}`);
  if (stageIndex === 0) mainUnits[0] = ['校准仪表：读懂 shape 与 axis','ndarray / shape / dtype','不看笔记预测给定数组的维度、shape 和 dtype，再运行核对。','预测表与一段核验代码'];
  if (stageIndex === 0) mainUnits[1] = ['建立测量样本：从 Python 列表创建数组','np.array 与二维规则输入','从成绩列表创建规则二维 ndarray，检查行数、列数和 dtype。','构造代码与 shape 实际结果'];
  const tasks = mainUnits.map((unit, i) => ({ ...task(mainIds[i], unit, mainChainId, 'main', i === 14 ? 35 : 12, i ? [mainIds[i-1]] : stageIndex ? [stageIds[stageIndex-1]+'-m15'] : [], i), ...(stageIndex === 0 && i === 0 ? { teaching: starterLesson, recallQuestion: '一个 shape=(2, 3) 的数组做 sum(axis=0)，结果有几个数？' } : {}) }));
  const chains: TaskChain[] = [{ id: mainChainId, title: `主线 · ${stageNames[stageIndex]}`, track: 'main', taskIds: mainIds, completionReward: { xp: 90, coins: 4, items: [] } }];
  const branchNames = ['应用探索','错误诊断','内存与随机数据探索'];
  branchUnits[stageIndex].forEach((branch, branchIndex) => {
    const chainId = `${stageId}-branch-${branchIndex+1}`;
    const ids = branch.map((_, i) => `${chainId}-t${i+1}`);
    const anchor = mainIds[[3,7,11][branchIndex]];
    chains.push({ id: chainId, title: `支线 · ${branchNames[branchIndex]}`, track: 'branch', taskIds: ids, completionReward: { xp: 25, coins: 2, items: [] } });
    branch.forEach((unit, i) => tasks.push(task(ids[i], unit, chainId, 'branch', [12,15,18][i], [i ? ids[i-1] : anchor], i)));
  });
  return { id: stageId, title: stageNames[stageIndex], description: `${stageNames[stageIndex]}：主线 15 项推动阶段能力验收；应用、纠错、探索三条支线各 3 项，可选且不阻塞后续阶段。主线约 ${tasks.filter(t=>t.track==='main').reduce((s,t)=>s+t.minutes,0)} 分钟；支线另计。`, tasks, chains, mainlineTaskIds: mainIds, gateTaskIds: [mainIds[14]], reward: { xp: 100, coins: 8, items: [] } };
});

const gridLabels: [string,string,string][] = [
  ['shape解释','读懂维度','numpy-read-shape'],['array构造','创建规则数据','numpy-build-array'],['dtype核验','检查表示与转换','numpy-v3-foundation-m07'],
  ['整数索引','定位数组元素','numpy-v3-selection-m02'],['切片选择','按范围取得子数组','numpy-v3-selection-m05'],['布尔筛选','按条件选择记录','numpy-v3-selection-m10'],
  ['筛选作品','独立交付筛选器','numpy-v3-selection-m15'],['广播与向量化','建立兼容计算','numpy-v3-compute-m15'],['数据处理作品','交付可复现项目','numpy-v3-project-m15'],
];

export const NUMPY_DEMO_CAMPAIGN: Campaign = {
  id: 'numpy-data-ops-v3', curriculumRulesVersion: 3,
  title: 'NumPy 数据准备行动', subtitle: '课程版本 3 · 从已学 ndarray、shape、dtype 开始，四阶段建立独立数据处理能力。',
  goal: '四周内独立完成基础 NumPy 数据处理，为机器学习做准备；当前已学 ndarray、shape、dtype，看懂讲解但独立写代码会卡。',
  level: '已学 ndarray、shape、dtype；需要诊断索引、筛选、按轴运算和独立编程，不默认掌握机器学习。',
  days: 28, dailyMinutes: 60, ultimateReward: '交付可运行、可测试、可解释的 NumPy 数据处理项目。',
  desiredArtifact: '用虚构数据完成检查、筛选、特征处理、聚合、边界测试和简报的独立 Python 项目。',
  language: 'mixed', prerequisites: ['Python 3 与基础列表、数字、print'],
  createdAt: '2026-10-13T00:00:00.000Z', source: 'demo', stages,
  nineGrid: gridLabels.map(([title,ability,taskId], i) => ({ id:`numpy-v3-grid-${i+1}`, title, ability, value:'经作品或独立挑战验证的 NumPy 能力', unlockTaskIds:[taskId] })),
};
