# 九格行动设计

用户授权：生成一个 GitHub 仓库和可运行前端，参考三角洲赛季任务布局，输入详细学习目标后由 DeepSeek 生成阶段任务。

## 第一版范围

React + TypeScript + Vite 前端，Express 同源 API，本机持久化。默认 Python 情报归档示例，可无密钥体验。AI 生成必须显式点击，失败时保留当前赛季，不伪装成成功。新仓库默认 private。

白月光学习法用于因果问题、概念关系和下一条线索；learn-anything 用于前置依赖、模块与真实成果；RetainCraft 用于主动回忆、费曼复述和基于评分的复习。独立实现，不复制上游代码或指令。第一版复习是透明的 SM-2 风格简化算法，不宣称完整 FSRS 或实证验证。

## 体验

深灰蓝底色、薄边框、薄荷绿活动状态、橙色重点任务。顶部季节行动简报、战术网格插图；左侧阶段轨道和任务列表；中间任务详情、三个目标、行动步骤、回忆问题、证据提交；右侧九格知识保险箱与复习入口。窄屏改为顺序布局。

任务可浏览，完成需要满足前置任务、所有目标和非空证据。AI 验收失败不授予奖励，自评验收清楚标记。重复领取不增加 XP；所有任务的明确验收和阶段门槛可见。每个赛季含调查、回忆、实战与综合验收，九格按完成比例解锁。

## API 和存储

共享 Campaign/Task/GoalInput/Evaluation 类型。POST /api/generate 接收 {input:GoalInput, apiKey?:string, model?:string} 返回 {campaign:Campaign}；POST /api/evaluate 接收 {task:Task,evidence:string,apiKey?:string,model?:string} 返回 {evaluation:Evaluation}；GET /api/status 返回 {configured:boolean,model:string}。

密钥只在服务器 .env 或当前页面内存，绝不进入浏览器持久化、导出或仓库。固定 DeepSeek HTTPS 端点、JSON Output、thinking disabled、180 秒服务超时、客户端可取消。Zod 校验 AI 输出，校验 ID 唯一、依赖存在和无环，去除 AI 伪造进度。

前端 localStorage 保存赛季、任务记录、复习、概念笔记，JSON 可导入导出；导入完整校验并确认替换。每日时间和轮次用于预算提示与休息，不奖励过度连续在线。

## 验证

领域测试：前置锁、阶段锁、重复领取、证据要求、九格计算、复习低分重置和成功扩大间隔、导入损坏。API 测试：无密钥、非法输入、上游失败/空响应/截断、输出模式与真实业务 JSON 校验。生产构建和浏览器测试：导航、创建表单、任务完成、保存恢复、导出、响应式。
