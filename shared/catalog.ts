export type CollectionRarity = 'small-purple' | 'small-gold' | 'large-gold' | 'small-red' | 'large-red';
export type CollectionCategory = '电子设备' | '工具零件' | '医疗用品' | '贵重物' | '情报档案' | '研究样本' | '纪念物';
export interface CollectionItem {
  id: string; name: string; category: CollectionCategory; rarity: CollectionRarity;
  size: string; imageKey: string; description: string; displayValue: number; sellPrice: number;
  limited: boolean; sellable: boolean; seasonId: string | null; version: number;
}

const generatedRanges: Array<[string, number]> = [['small-purple',45],['small-gold',35],['large-gold',15],['small-red',35],['large-red',25]];
export const GENERATED_CATALOG_IMAGE_IDS = new Set(generatedRanges.flatMap(([rarity, count]) => Array.from({ length: count }, (_, index) => `${rarity}-${String(index + 1).padStart(2, '0')}`)));

const sets: Array<{ rarity: CollectionRarity; min: number; max: number; names: string[] }> = [
  { rarity: 'small-purple', min: 20_000, max: 80_000, names: '加固电路板,短波接收器,微型光谱仪,光纤探针,便携式测距仪,夜视目镜,储存芯片,信号放大器,精密罗盘,抗震记录仪,电池校准器,光学滤片,微型焊枪,加密钥匙,热成像模块,振动传感器,陶瓷保险丝,数据转接头,折叠瞄准镜,采样泵,陶瓷止血夹,脉冲计,压力表组件,防水手电,温度记录卡,镍钛扳手,钛合金套筒,微型棘轮,磁吸拾取器,绝缘剪钳,多功能探针,精密轴承,快速接头,纤维束带,校准砝码,滤毒芯,急救剪,止血带盒,应急电源,识别牌,旧电台旋钮,风向测量片,野外工具尺,压纹铭牌,磨砂镜片'.split(',') },
  { rarity: 'small-gold', min: 100_000, max: 300_000, names: '军规卫星电话,高精度惯导组件,稀有钽电容组,全景测绘镜头,耐压氧气阀,战地超声探头,钨钢刀具套装,加密存储阵列,光纤陀螺仪,低温冷却泵,便携式频谱仪,真空封装样本盒,多波段天线,复合陶瓷护板,碳纤维稳定架,军用级电芯,红外校验模块,脉冲电源单元,蓝宝石观察窗,钛合金阀组,无菌手术包,高通量采样管,应急定位信标,石英时间基准,航迹记录模块,激光反射棱镜,微型伺服机,金属分析探头,双频导航芯片,数据中继模块,记忆合金簧片,战地制冷剂,防磁存储匣,镀金接触片,陶瓷光纤端子'.split(',') },
  { rarity: 'large-gold', min: 400_000, max: 900_000, names: '原型相控阵雷达,高纯度单晶锭,深空导航核心,全谱成像阵列,钛铌超导环,量子计时模块,高能密封电池,精密惯性平台,军用卫星中继器,三维地质扫描仪,稀有同位素样本,零点校准台,钨铼合金转子,低温超导电缆,多源情报存储柜'.split(',') },
  { rarity: 'small-red', min: 600_000, max: 1_000_000, names: '前线行动日志,失联哨站底片,密封行动地图,匿名情报胶卷,战地医师手记,旧式加密本,边境电台录音,封存指挥令,褪色识别章,未寄出的家书,侦察员素描册,行动路线胶片,旧基地钥匙牌,加密坐标卡,最后一班列车票,无人机航迹带,撤离清单原件,潮湿电文副本,手工绘制地形图,封存语音芯片,医疗站值班簿,损坏的摄影机,空白身份卡,实验室门禁片,旧磁带录音,行动纪念章,遗失的罗盘盘面,抄录的频率表,现场粉笔拓片,纸质情报卷宗,封条残片,信号旗样本,深夜巡逻记录,观察哨望远镜盖,手写密码索引'.split(',') },
  { rarity: 'large-red', min: 1_000_000, max: 2_000_000, names: '零号档案原卷,远征队黑匣子,失落基地全息盘,首席研究员密札,深层设施总图,未公开试验记录,绝密通信主机,行动组原始胶片,封存样本核心,旧世界导航图,极地站最后日志,未解码卫星碎片,原型机控制晶片,边境撤离母带,完整观测站数据,指挥部手写底稿,未知合金核心,深海信标记录器,远征队纪念怀表,初代侦察徽章,最后一份样本,失踪航班黑匣子,封存实验母盘,地下城入口钥匙,行动档案总汇'.split(',') },
];
const categories: CollectionCategory[] = ['电子设备','工具零件','医疗用品','贵重物','情报档案','研究样本','纪念物'];
function categoryFor(name: string, index: number): CollectionCategory {
  if (/急救|止血|医疗|手术|氧气|超声|滤毒|创伤/.test(name)) return '医疗用品';
  if (/扳手|套筒|棘轮|拾取器|焊枪|剪钳|剪|轴承|接头|阀|转子|支架|工具尺|扳手|止血夹/.test(name)) return '工具零件';
  if (/样本|同位素|采样|研究员|实验|观测站|研究|光谱/.test(name)) return '研究样本';
  if (/合金|单晶|钽|钨|铌|蓝宝石|镀金|锭|贵重|超导|金属|宝石/.test(name)) return '贵重物';
  if (/纪念|徽章|怀表|家书|车票|识别牌|钥匙牌|铭牌|旧式|旋钮|底片|拓片/.test(name)) return '纪念物';
  if (/档案|日志|地图|胶片|录音|电文|手记|航迹|清单|记录|密码|坐标|底稿|黑匣子|母带|卷宗|数据|通信|情报|磁带/.test(name)) return '情报档案';
  if (/电话|接收器|测距|目镜|芯片|模块|传感器|电源|电台|导航|雷达|扫描|频谱|镜头|信标|计时|仪|阵列|天线|信号|相机|存储|定位|成像|显微/.test(name)) return '电子设备';
  return categories[index % categories.length];
}
const descriptions: Record<CollectionCategory, string> = {
  '电子设备': '耐用外壳内保留着可读的线路与接口，曾用于野外观测和通信。',
  '工具零件': '经过现场使用的精密部件，边缘留有真实磨损与维护痕迹。',
  '医疗用品': '封存完好的应急医疗物资，包装记录着一次具体的前线任务。',
  '贵重物': '来自旧设施的稀有材料，估值反映其收藏意义，不代表现金价值。',
  '情报档案': '从任务现场回收并妥善保存的纸本或数字记录。',
  '研究样本': '经安全容器封装的研究样本，仅作虚构收藏展示。',
  '纪念物': '带有个人经历痕迹的纪念收藏，记录着行动者曾经到过的地方。',
};
export const COLLECTION_CATALOG: CollectionItem[] = sets.flatMap(({ rarity, names, min, max }) => names.map((name, index) => {
  const category = categoryFor(name, index + sets.findIndex(set => set.rarity === rarity) * 2);
  const id = `${rarity}-${String(index + 1).padStart(2, '0')}`;
  const displayValue = min + Math.round(index * (max - min) / (names.length - 1));
  return { id, name, category, rarity, size: ['1×1','1×2','2×2','2×3'][index % 4], imageKey: GENERATED_CATALOG_IMAGE_IDS.has(id) ? id : index === 0 ? rarity : id,
    description: `${name} 用于野外的${category}检查与回收整理。${descriptions[category]}`, displayValue, sellPrice: Math.floor(displayValue * 0.65),
    limited: false, sellable: true, seasonId: null, version: 2 };
}));
export const CATALOG_RARITY_COUNTS = Object.fromEntries(sets.map(set => [set.rarity, set.names.length])) as Record<CollectionRarity, number>;
