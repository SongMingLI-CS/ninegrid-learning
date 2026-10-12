# 九格行动 · NINEGRID

把自然语言学习需求编排成“学习赛季 → 阶段 → 主线/支线 → 任务链 → 具体任务”。先预览并确认课程蓝图，再按日预算推进主线；支线自愿，按需解锁。进入任务后才生成并缓存完整讲解、示例、引导练习、独立挑战和提示。答案可自评记录，或由配置好的 DeepSeek 核验；只有 AI 验证的能力成果会解锁九格。

界面参考你提供的《三角洲行动》赛季任务截图，用原创的深色战术视觉、阶段目录、任务详情和九格奖励呈现学习行动。页面不使用游戏截图、商标或素材。

## 方法设计

- 白月光学习法：把“背完概念”换成追踪来源、关联和下一条线索。参照 [baiyueguang-learning-skill](https://github.com/zhiliscope/baiyueguang-learning-skill)。
- Learn-Anything：让目标变成有先后依赖、进度存档和真实产出的学习地图。参照 [learn-anything](https://github.com/d-wwei/learn-anything)。
- RetainCraft：把主动回忆、解释和间隔复习放进任务完成后的循环。参照 [RetainCraft](https://github.com/kaixiad/RetainCraft)。
- 九格保险箱：任务奖励只由达成检查点解锁。超过时间不加分，也不鼓励连续十几个小时硬撑。

只借鉴公开的学习理念；此项目的数据模型、规则、前端和服务端独立编写。复习安排是简化的 SM-2 风格调度，不是 FSRS，也没有在本产品中验证过效果。AI 反馈只辅助学习；重要结论仍需对照权威资料。

## 快速体验

安装 Node.js 20.19+ 或 22.12+，然后在 PowerShell 中运行：

    npm install
    npm run dev

打开 Vite 显示的本机地址即可体验预置 NumPy 赛季，无需 API Key，也不会向 DeepSeek 发送内容。预置示例从 ndarray、shape、dtype 起步，覆盖索引、切片、布尔筛选与聚合；自评完成不会被显示为 AI 掌握分。

## 接入 DeepSeek

1. 从 DeepSeek 官方控制台取得 API Key。
2. 将 .env.example 复制成 .env 并填写 DEEPSEEK_API_KEY。该文件已在 .gitignore 中。
3. 重启 npm run dev，应用会自动连接本机服务。也可以通过“连接设置”在当前页面临时输入 Key；临时 Key 只在内存中保存，刷新或关闭页面即清除。
4. 输入学习需求、粘贴材料，并调整当前基础、最终作品、每日预算、周期及语言偏好；预览 AI 蓝图后再确认部署。

服务端调用官方 DeepSeek Chat Completions JSON Output 接口，验证返回数据和无环前置关系后才启用新赛季。失败会保留原赛季。

密钥从本地 Express 服务发往固定的 https://api.deepseek.com/chat/completions，不会暴露给 Vite 浏览器、不写入 localStorage 或导出档案。目标、任务文本和证据会在生成或 AI 验收时发送给 DeepSeek。不要提交他人的敏感资料。服务默认绑定 127.0.0.1；不要直接暴露到公网。

可在本机 .env 中配置：

    DEEPSEEK_API_KEY=your-key
    DEEPSEEK_MODEL=deepseek-flash
    PORT=8787
    HOST=127.0.0.1

参考 [Chat Completions 文档](https://api-docs.deepseek.com/api/create-chat-completion/) 和 [JSON Output 指南](https://api-docs.deepseek.com/guides/json_mode/)。

## 项目能力

- 今日节目表按预算安排复习、主线与可选支线；学习工作区提供 16px 起正文、术语解释、示例、挑战、验收和提示。
- 课程规划、日程、任务讲解、提示、验收与学习调整分别走服务端 API；AI 结果由 Zod Schema 和任务依赖关系校验。
- 确定性奖励规则为任务、任务链、阶段与赛季发 XP、学习币和占位道具；流水可追溯且防重复。九格能力成果与钱包/道具仓库分开。
- 完成记录、答案、复习历史、课程内容缓存、多个目标档案及奖励流水保存于当前浏览器，可导出/校验导入；不提供云同步或加密。
- 预置 NumPy 学习行动从已学 ndarray、shape、dtype 开始，不假定掌握高级索引或机器学习。原 Python 赛季仍作为示例与可切换档案。

## 验证

    npm test
    npm run build

测试覆盖 API Schema 与提示、任务进度/奖励/复习/多目标切换、自然语言字段提取，以及 NumPy 界面流程。若未配置 DeepSeek Key，API 端到端生成和 AI 验收不会发生；本地 NumPy 预置课程也不会伪装成真实 AI 输出。

界面截图：[课程总览](output/playwright/course-overview.png) · [NumPy 学习工作区](output/playwright/numpy-learning-workspace.png)

## 构建

    npm run build

本版本的学习档案仅存于当前浏览器，没有账号、云同步或数据库。清理浏览器数据前请先导出。

## 方法出处

- [白月光学习法](https://github.com/zhiliscope/baiyueguang-learning-skill)
- [Learn-Anything](https://github.com/d-wwei/learn-anything)
- [RetainCraft](https://github.com/kaixiad/RetainCraft)
- [Python 官方教程](https://docs.python.org/3/tutorial/index.html)
- [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)

## 许可

MIT，详见 LICENSE。
