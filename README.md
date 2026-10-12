# 九格行动 · NINEGRID

把一个想完成的学习目标变成像赛季任务一样清楚的多阶段行动线：先追查一条有意思的线索，再动手做、关上资料回忆，最终拿真实作品撤离。每项任务有明确目标、操作路线、验收标准和 XP 奖励；完成赛季行动逐步点亮九格保险箱，并安排间隔复习。

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

打开 Vite 显示的本机地址即可体验预置赛季，无需 API Key，也不会向 DeepSeek 发送内容。完成任务需要勾选目标并提交至少 20 字的答案、过程或作品记录，再选择自我检查或 AI 核验。

## 接入 DeepSeek

1. 从 DeepSeek 官方控制台取得 API Key。
2. 将 .env.example 复制成 .env 并填写 DEEPSEEK_API_KEY。该文件已在 .gitignore 中。
3. 重启 npm run dev，应用会自动连接本机服务。也可以通过“连接设置”在当前页面临时输入 Key；临时 Key 只在内存中保存，刷新或关闭页面即清除。
4. 输入最终成果、当前基础、时间预算和九格战利品，选择 DeepSeek Flash 或 V4 Pro，然后点击“部署新行动线”。

服务端调用官方 DeepSeek Chat Completions JSON Output 接口，验证返回数据和无环前置关系后才启用新赛季。失败会保留原赛季。

密钥从本地 Express 服务发往固定的 https://api.deepseek.com/chat/completions，不会暴露给 Vite 浏览器、不写入 localStorage 或导出档案。目标、任务文本和证据会在生成或 AI 验收时发送给 DeepSeek。不要提交他人的敏感资料。服务默认绑定 127.0.0.1；不要直接暴露到公网。

可在本机 .env 中配置：

    DEEPSEEK_API_KEY=your-key
    DEEPSEEK_MODEL=deepseek-flash
    PORT=8787
    HOST=127.0.0.1

参考 [Chat Completions 文档](https://api-docs.deepseek.com/api/create-chat-completion/) 和 [JSON Output 指南](https://api-docs.deepseek.com/guides/json_mode/)。

## 项目能力

- 桌面端任务目录、阶段进度、任务详情、知识保险箱和复习信号室，适配窄屏。
- 用户目标动态生成阶段、前置任务、调查问题、操作步骤、验收标准、复习题和来源。
- 不能越过尚未完成的任务依赖；自我验收与 AI 核验显示不同标记。
- 任务结算一次性发放 XP，逐步解锁九格并进入间隔复习。
- 学习记录存在当前浏览器，可导出和验证后导入 JSON。
- 预置四阶段、十二个任务的 Python 学习赛季，引用官方文档。

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
