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
- 服务端按课程时长发放确定性经验和哈弗币；有效任务、任务链、阶段与赛季成果可发放图鉴藏品，学习、复习与升级验收各自去重并保留来源。
- 登录账号的赛季档案保存于 PostgreSQL；赛季读写按 `owner_user_id` 校验并使用 revision 乐观并发控制，浏览器 localStorage 仅作辅助缓存。每个新蓝图会创建独立赛季。
- 任务结算由服务器检查任务解锁、当前证据和自评/服务端 AI 评价；数据库事务写入赛季进度、奖励流水、钱包与仓库，唯一领取键用于重复请求去重。
- 学习图片保存在私有持久目录，按用户/赛季/任务授权访问；上传校验实际图片格式并重编码，视觉分析经服务端将实际图片内容发送给 `deepseek-flash`。图片本身不会通过验收。
- `/inventory` 是跨赛季账号仓库，支持图鉴、详情、收藏锁定、主页展示选择与事务出售；`/shop` 负责保险箱购买与服务端随机开箱，`/challenges` 提供可选的三档学习挑战，`/profile` 展示私有成长档案。
- 保险箱售价、掉落池、概率与固定回收价使用版本化配置，完整概率精确求和为 1，回收期望低于售价。挑战验收依赖已配置的 AI 服务，服务故障会退回一次入场费。
- 预置 NumPy 学习行动从已学 ndarray、shape、dtype 开始，不假定掌握高级索引或机器学习。原 Python 赛季仍作为示例与可切换档案。

## 验证

    npm test
    npm run build

测试覆盖 API Schema 与提示、任务进度/奖励/复习/多目标切换、自然语言字段提取、视频总预算和仓库界面，以及 NumPy 学习流程。若未配置 DeepSeek Key，外部生成、评价和视觉分析不可用；本地 NumPy 预置课程与模拟接口均明确区分。

界面截图：[1366×768 课程总览](output/playwright/ninegrid-overview.png) · [1920×1080 学习工作区](output/playwright/ninegrid-workspace.png)

## 构建

    npm run build

## Windows 本机持久运行

本项目按单用户本机使用。生产前端由 `npm run build` 构建，账号 API 通过 `npm start` 提供；PostgreSQL、私有附件、备份和日志统一位于 `F:\Projects\NineGridData`。数据库和 API 只监听 `127.0.0.1`，不会向局域网或公网开放。首次迁移与一键操作说明见 [Windows 本机运行手册](docs/windows-local.md)。

桌面快捷方式“九格行动本机版”会启动本地数据库和生产应用，并打开 `http://127.0.0.1:8787/`。修改代码后需要重新运行 `npm run build`；`npm run dev` 保留给开发，不作为日常使用方式。备份包含 PostgreSQL 与附件，并带 SHA-256 清单；恢复始终写入独立的新数据库和新附件目录，不会自动切换当前账号库。

`npm run test:postgres` 在本机启动隔离的原生 PostgreSQL 实例，并验证重复迁移、注册/登录、所有权隔离、存档读写、并发奖励、证据版本、私有附件、重启和独立备份恢复；Windows 使用 PostgreSQL 18 客户端工具。浏览器端保留原始本机档案，确认导入时服务器会将旧成果记为自行完成，不采信旧钱包或 AI 标记。

## 方法出处

- [白月光学习法](https://github.com/zhiliscope/baiyueguang-learning-skill)
- [Learn-Anything](https://github.com/d-wwei/learn-anything)
- [RetainCraft](https://github.com/kaixiad/RetainCraft)
- [Python 官方教程](https://docs.python.org/3/tutorial/index.html)
- [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)

## 许可

MIT，详见 LICENSE。
