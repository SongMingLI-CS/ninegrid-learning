# 九格行动：Windows 本机运行与数据保护

项目面向当前 Windows 用户单机运行，不部署 Ubuntu 或公网服务。仓库留在 D 盘；应用和数据库绑定回环地址。

## 固定持久目录

| 内容 | 目录 |
| --- | --- |
| PostgreSQL 18 集群 | `F:\Projects\NineGridData\postgres` |
| 私有学习附件 | `F:\Projects\NineGridData\uploads` |
| 数据库与附件备份 | `F:\Projects\NineGridData\backups` |
| PostgreSQL 与应用日志 | `F:\Projects\NineGridData\logs` |

本机忽略文件 `.env` 保留在仓库根目录。它保存数据库连接和现有密钥；启动、迁移和备份脚本不会把其值打印到控制台或写入 Git。

## 首次迁移

在仓库 PowerShell 中执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/migrate-storage.ps1
```

迁移先要求本项目 Vite/API 已正常停止，之后会：

1. 将数据库和上传目录做成同一备份包，并记录 23 张表的行数、附件文件 SHA-256 与归档校验值。
2. 把该包恢复到临时隔离的 PostgreSQL 18 集群，逐表比较计数和文件散列；通过后才继续。
3. 在 F 盘初始化新的 PostgreSQL 集群，恢复账号库，先在备用回环端口核对数据，再切换到 5433。
4. 只更新被忽略的 `.env` 路径设置，保留会话密钥和 DeepSeek/YouTube 配置。
5. 保留原 D 盘数据库和上传目录作为回滚副本，不会自动删除。

若旧数据目录或 F 盘目标非空、端口被其他程序占用、备份比较不一致，脚本会停止而不覆盖目标或停止陌生进程。

## 日常操作

| 操作 | 命令 |
| --- | --- |
| 启动 PostgreSQL 和生产应用并打开页面 | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/start.ps1` |
| 停止本机 API 和 F 盘数据库 | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/stop.ps1` |
| 只停止 API | 在 `stop.ps1` 后加 `-AppOnly` |
| 检查账号/AI模式、端口和实际数据目录 | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/status.ps1` |
| 创建一致数据库与附件备份 | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/backup.ps1` |
| 将备份恢复到隔离数据库 | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/restore.ps1 -BundlePath 'F:\Projects\NineGridData\backups\ninegrid-backup-时间戳' -DatabaseName ninegrid_restore_01` |

`backup.ps1` 会在需要时暂时停止脚本管理的 API，数据库和附件打包后再恢复应用。备份清单核对 SHA-256；不匹配时不会标记为完整备份。恢复会创建新数据库 `ninegrid_restore_01` 及 `uploads\restore-ninegrid_restore_01`，比较全部表计数和附件文件散列，绝不覆盖当前库，也不会自动修改 `.env`。确认恢复库正确后，才可手动变更连接配置。

建议在重要学习/交易后创建备份，常用保留目标为最近 14 份；超过数量时脚本只提示，不自动删除历史备份。F 盘上的备份可用于误操作恢复，但无法抵御 F 盘或整块硬盘故障；本机不会自动向其他磁盘大批复制数据。

应用日志按 5 MB 分卷并最多保留 16 个文件；PostgreSQL 日志按每日或 20 MB 分卷，本机启动时删除超过 30 天且具有 NineGrid 专属文件前缀的日志。启动脚本不会清理其他目录。

## 开发模式与故障说明

- 日常使用访问 `http://127.0.0.1:8787/`，由 Express 提供 `dist/` 生产构建。桌面快捷方式“九格行动本机版”会检查 F 盘数据库、启动本机 API 并打开此地址，不设置开机启动。
- 修改前端后重新运行 `npm run build`；开发仍使用 `npm run dev`。开发 Vite 端口为 5173，与日常生产入口区分。
- `.env` 中 `NODE_ENV=development` 是 Vite 支持的本机配置；生产 runner 启动 API 子进程时明确覆盖为 `production`。数据库或会话配置不可用时，生产 API 拒绝启动，不会退回本地演示存档。AI 不可用会显示实际 `aiMode` 状态；账户数据仍保存在 F 盘数据库。
- 如果 5433 或 8787 被其他进程占用，脚本报告监听地址/PID 并退出，不会终止该进程。
- 本机备份与数据库同在 F 盘；硬盘故障需要用户另行决定离线/异机备份策略。
