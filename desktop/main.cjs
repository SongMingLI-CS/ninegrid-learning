const { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage, screen, shell } = require('electron');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const policy = require('./runtime-policy.cjs');
const { windowChromeOptions } = require('./window-chrome.cjs');
const { decryptStoredText } = require('./secure-config.cjs');
const { readSecureConfiguration } = require('./secure-config-loader.cjs');
const { createCloseGate } = require('./close-gate.cjs');

const execFileAsync = promisify(execFile);
const DEFAULT_DATA_ROOT = 'F:\\Projects\\NineGridData';
const API_ORIGIN = 'http://127.0.0.1:8787';
const EXPECTED_PG_MAJOR = '18';
const LOG_MAX_BYTES = 5 * 1024 * 1024;
const LOG_KEEP = 6;
app.setName('NineGrid');
app.setPath('userData', path.join(app.getPath('appData'), 'NineGrid'));
const singleton = app.requestSingleInstanceLock();
let startupWindow;
let mainWindow;
let settingsWindow;
let startPromise;
let backendChild;
let backendOwned = false;
let databaseOwned = false;
let databaseDataDirectory;
let runtimeEnv;
let settings = { dataDirectory: DEFAULT_DATA_ROOT, zoom: 1 };
let secrets = {};
let runtimeStatus = { service: '未启动', ai: '未检测', stage: 'idle' };
let allowQuit = false;
const closeGate = createCloseGate();
let secretValues = [];
let logRoot;
let appRoot;
let pgBin;
let nodeRuntime;
let buildInfo = { commit: 'unknown', branch: 'unknown', workingTreeModified: true };

function normalizedPath(value) { return path.win32.resolve(value).replaceAll('\\', '/').toLowerCase(); }

function redact(value) {
  let text = String(value ?? '');
  for (const secret of secretValues) if (secret && secret.length >= 3) text = text.replaceAll(secret, '[REDACTED]');
  return text
    .replace(/(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s/]+@/gi, '$1[REDACTED]@')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_API_KEY]');
}

function rotateLogs() {
  if (!logRoot) return;
  const current = path.join(logRoot, 'ninegrid-desktop.log');
  try {
    if (fs.statSync(current).size < LOG_MAX_BYTES) return;
  } catch { return; }
  const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
  try { fs.renameSync(current, path.join(logRoot, `ninegrid-desktop-${stamp}.log`)); } catch { return; }
  const rotated = fs.readdirSync(logRoot)
    .filter(name => /^ninegrid-desktop-\d{4}-\d{2}-\d{2}T.*\.log$/.test(name))
    .map(name => ({ name, time: fs.statSync(path.join(logRoot, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  for (const item of rotated.slice(LOG_KEEP)) {
    try { fs.unlinkSync(path.join(logRoot, item.name)); } catch { /* Keep unreadable logs. */ }
  }
}

function log(level, message) {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${redact(message)}\n`;
  try {
    if (logRoot) {
      fs.mkdirSync(logRoot, { recursive: true });
      rotateLogs();
      fs.appendFileSync(path.join(logRoot, 'ninegrid-desktop.log'), line, 'utf8');
    }
  } catch { /* Logging must not prevent startup or shutdown. */ }
}

function report(message, percent, error) {
  runtimeStatus.stage = error ? 'error' : message;
  if (startupWindow && !startupWindow.isDestroyed()) {
    startupWindow.webContents.send('ninegrid:startup-progress', { message, percent, error: error ? redact(error) : null });
  }
}

function getDataPaths() { return policy.resolveDataPaths(settings.dataDirectory); }
function encryptedConfigPath() { return path.join(app.getPath('userData'), 'secure-config.bin'); }
function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }

async function readSettings() {
  try {
    const stored = JSON.parse(await fsp.readFile(settingsPath(), 'utf8'));
    if (typeof stored.dataDirectory === 'string' && path.isAbsolute(stored.dataDirectory)) settings.dataDirectory = stored.dataDirectory;
    if (typeof stored.zoom === 'number' && stored.zoom >= 0.7 && stored.zoom <= 1.6) settings.zoom = stored.zoom;
  } catch (error) {
    if (error.code !== 'ENOENT') log('warn', 'Settings file could not be read; safe defaults are active.');
  }
}

async function saveSettings() {
  await fsp.mkdir(app.getPath('userData'), { recursive: true });
  const temp = `${settingsPath()}.tmp`;
  await fsp.writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
  await fsp.rename(temp, settingsPath());
}

async function saveSecrets(values) {
  if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Windows 安全存储暂不可用，密钥没有保存。');
  const bytes = await safeStorage.encryptStringAsync(JSON.stringify(values));
  const target = encryptedConfigPath();
  const temp = `${target}.tmp`;
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(temp, bytes);
  await fsp.rename(temp, target);
  secrets = values;
  secretValues = Object.values(secrets).filter(value => typeof value === 'string');
}

async function loadSecrets() {
  const configPath = encryptedConfigPath();
  const loaded = await readSecureConfiguration({
    filePath: configPath,
    readFile: file => fsp.readFile(file),
    isEncryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
    decrypt: encrypted => decryptStoredText(encrypted, safeStorage),
    validate: values => policy.validateDesktopConfig(values),
    onStage: stage => log(stage === 'file-missing' ? 'warn' : 'info', `startup.config.${stage} path=${configPath}`),
  });
  if (!loaded.ok) {
    if (loaded.reason === 'missing') return false;
    const messages = {
      'read-failed': '本机加密配置文件存在，但无法读取；原文件已保留。请检查当前 Windows 用户对配置目录的访问权限。',
      'encryption-unavailable': '本机加密配置文件存在，但当前 Windows 用户的 DPAPI 安全存储不可用；原文件已保留。',
      'decrypt-failed': '本机加密配置文件无法由当前 Windows 用户解密；原文件已保留。请使用原 Windows 用户或导入现有 .env 配置。',
      'parse-failed': '本机配置已解密，但内容格式无效；原文件已保留。请导入现有 .env 配置。',
      'invalid-fields': '本机配置格式可读，但数据库连接或会话密钥字段不符合要求；原文件已保留。请导入现有 .env 配置。',
    };
    throw new Error(messages[loaded.reason] ?? '本机配置加载失败；原文件已保留。');
  }
  secrets = loaded.values;
  secretValues = Object.values(secrets).filter(value => typeof value === 'string');
  return true;
}

async function importConfiguration() {
  const result = await dialog.showOpenDialog(startupWindow ?? settingsWindow ?? mainWindow, {
    title: '选择 NineGrid 的现有 .env 配置',
    properties: ['openFile'],
    filters: [{ name: '环境配置', extensions: ['env', 'txt'] }, { name: '所有文件', extensions: ['*'] }],
  });
  if (result.canceled || !result.filePaths[0]) return false;
  const selectedPath = result.filePaths[0];
  if ((await fsp.stat(selectedPath)).size > 1024 * 1024) throw new Error('配置文件超过 1 MiB；没有读取或保存。');
  const parsed = policy.parseEnvironmentText(await fsp.readFile(selectedPath, 'utf8'));
  log('info', 'startup.config.import-parsed');
  if (!policy.validateDesktopConfig(parsed).ok) throw new Error('所选文件中的 DATABASE_URL、DATABASE_ADMIN_URL 或 SESSION_SECRET 缺失或不符合本机配置要求；原加密配置未更改。');
  log('info', 'startup.config.import-validated');
  await saveSecrets(parsed);
  log('info', 'startup.config.import-saved-and-memory-updated; encrypted with Windows DPAPI.');
  return true;
}

async function readBuildInfo() {
  try {
    const candidate = app.isPackaged ? path.join(process.resourcesPath, 'build-info.json') : path.join(appRoot, 'desktop-build-info.json');
    buildInfo = JSON.parse(await fsp.readFile(candidate, 'utf8'));
  } catch {
    try {
      const { stdout: commit } = await execFileAsync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: appRoot, windowsHide: true });
      const { stdout: branch } = await execFileAsync('git', ['branch', '--show-current'], { cwd: appRoot, windowsHide: true });
      buildInfo = { commit: commit.trim(), branch: branch.trim(), workingTreeModified: true };
    } catch { /* Dev source metadata is optional. */ }
  }
}

function createStartupWindow() {
  if (startupWindow && !startupWindow.isDestroyed()) { startupWindow.focus(); return startupWindow; }
  startupWindow = new BrowserWindow({
    width: 760, height: 590, minWidth: 620, minHeight: 460, show: false,
    ...windowChromeOptions(), title: '九格行动',
    icon: path.join(appRoot, 'desktop', 'assets', 'ninegrid.png'),
    webPreferences: { preload: path.join(appRoot, 'desktop', 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  installWindowShortcuts(startupWindow);
  startupWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const startupPage = path.resolve(appRoot, 'desktop', 'startup.html').toLowerCase();
  startupWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const requested = path.resolve(require('node:url').fileURLToPath(url)).toLowerCase();
      if (requested !== startupPage) event.preventDefault();
    } catch { event.preventDefault(); }
  });
  void startupWindow.loadFile(path.join(appRoot, 'desktop', 'startup.html'));
  startupWindow.once('ready-to-show', () => startupWindow?.show());
  startupWindow.on('closed', () => { startupWindow = undefined; });
  return startupWindow;
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.focus(); return mainWindow; }
  const geometry = policy.computeWindowGeometry(screen.getPrimaryDisplay().workAreaSize);
  const win = new BrowserWindow({
    ...geometry, show: false,
    ...windowChromeOptions(), title: '九格行动',
    icon: path.join(appRoot, 'desktop', 'assets', 'ninegrid.png'),
    webPreferences: { preload: path.join(appRoot, 'desktop', 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  mainWindow = win;
  win.on('close', event => {
    if (allowQuit) return;
    if (!closeGate.shouldIntercept()) return;
    event.preventDefault();
    if (!win.isDestroyed()) win.webContents.send('ninegrid:request-close');
  });
  win.webContents.setZoomFactor(settings.zoom);
  installWindowShortcuts(win);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (policy.validateExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(`${API_ORIGIN}/`)) return;
    event.preventDefault();
    if (policy.validateExternalUrl(url)) void shell.openExternal(url);
  });
  win.webContents.on('did-fail-load', (_event, errorCode, description, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || !validatedURL.startsWith(API_ORIGIN)) return;
    log('error', `Main page failed to load: ${description}`);
    report('服务已启动，但页面载入失败。可以重试或打开日志查看原因。', 100, '本机前端页面无法载入');
    if (!win.isDestroyed()) void win.loadFile(path.join(appRoot, 'desktop', 'startup.html'));
    createStartupWindow();
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = undefined;
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
  });
  void win.loadURL(API_ORIGIN);
  return win;
}

function installMenu() {
  Menu.setApplicationMenu(null);
}

function installWindowShortcuts(win) {
  win.webContents.on('before-input-event', (event, input) => {
    if (!(input.control || input.meta) || input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    if (key === ',') { event.preventDefault(); openSettings(); return; }
    if (!['0', '+', '=', 'add', '-', 'subtract'].includes(key)) return;
    event.preventDefault();
    if (key === '0') { void setZoom(1); return; }
    if (key === '+' || key === '=' || key === 'add') { void setZoom(Math.min(1.6, settings.zoom + 0.1)); return; }
    void setZoom(Math.max(0.7, settings.zoom - 0.1));
  });
}

function isTrustedIpc(event) {
  try {
    const allowedSenders = [mainWindow?.webContents, startupWindow?.webContents, settingsWindow?.webContents].filter(Boolean);
    if (!allowedSenders.includes(event.sender) || event.senderFrame !== event.sender.mainFrame) return false;
    const senderUrl = event.senderFrame?.url;
    if (!senderUrl) return false;
    if (new URL(senderUrl).origin === API_ORIGIN) return true;
    const localPath = path.resolve(require('node:url').fileURLToPath(senderUrl)).toLowerCase();
    return [path.join(appRoot, 'desktop', 'startup.html'), path.join(appRoot, 'desktop', 'settings.html')]
      .some(allowed => localPath === path.resolve(allowed).toLowerCase());
  } catch { return false; }
}

function installIpc() {
  const handlers = new Map();
  const handle = (channel, fn) => {
    const guarded = async (event, ...args) => {
      if (!isTrustedIpc(event)) throw new Error('不受信任的桌面调用来源。');
      return fn(...args);
    };
    handlers.set(channel, guarded);
    ipcMain.handle(channel, guarded);
  };
  handle('ninegrid:retry-startup', async () => { void startRuntime(); return true; });
  handle('ninegrid:confirm-close', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    closeGate.approveOnce();
    mainWindow.close();
    return true;
  });
  handle('ninegrid:choose-data-directory', async () => chooseDataDirectory());
  handle('ninegrid:import-configuration', async () => importConfiguration());
  handle('ninegrid:get-settings', async () => ({
    version: app.getVersion(), commit: buildInfo.commit, sourceCommit: buildInfo.sourceCommit ?? buildInfo.commit, branch: buildInfo.branch,
    dataDirectory: settings.dataDirectory, zoom: settings.zoom,
  }));
  handle('ninegrid:get-runtime-status', async () => {
    let ai = secrets.DEEPSEEK_API_KEY ? '已配置' : '未配置';
    try {
      const response = await fetch(`${API_ORIGIN}/api/status`, { signal: AbortSignal.timeout(2500) });
      if (response.ok) { const status = await response.json(); ai = status.aiMode === 'ready' ? '已配置' : '未配置'; }
    } catch { /* The explicit service value below reports the failure. */ }
    return { service: runtimeStatus.service, ai };
  });
  handle('ninegrid:open-logs', async () => openLocalDirectory(getDataPaths().logs));
  handle('ninegrid:open-backups', async () => openLocalDirectory(getDataPaths().backups));
  handle('ninegrid:open-settings', async () => { openSettings(); return true; });
  handle('ninegrid:create-backup', async () => createBackupBundle());
  handle('ninegrid:set-zoom', async value => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('缩放值无效。');
    return setZoom(value);
  });
  handle('ninegrid:open-external', async value => {
    if (typeof value !== 'string' || value.length > 2048 || !policy.validateExternalUrl(value)) throw new Error('只允许打开有效的 http 或 https 链接。');
    await shell.openExternal(value);
    return true;
  });
}

function setZoom(value) {
  settings.zoom = Math.max(0.7, Math.min(1.6, Math.round(value * 10) / 10));
  for (const win of [mainWindow, startupWindow, settingsWindow]) {
    if (win && !win.isDestroyed()) win.webContents.setZoomFactor(settings.zoom);
  }
  return saveSettings().then(() => settings.zoom);
}

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.focus(); return; }
  const available = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(720, Math.max(520, available.width - 40));
  const height = Math.min(720, Math.max(520, available.height - 48));
  settingsWindow = new BrowserWindow({
    width, height, minWidth: Math.min(600, width), minHeight: Math.min(580, height), parent: mainWindow ?? startupWindow, modal: false,
    ...windowChromeOptions(), title: '九格行动 · 设置',
    icon: path.join(appRoot, 'desktop', 'assets', 'ninegrid.png'),
    webPreferences: { preload: path.join(appRoot, 'desktop', 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  installWindowShortcuts(settingsWindow);
  settingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  settingsWindow.webContents.on('will-navigate', event => event.preventDefault());
  void settingsWindow.loadFile(path.join(appRoot, 'desktop', 'settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = undefined; });
}

async function openLocalDirectory(directory) {
  await fsp.mkdir(directory, { recursive: true });
  const error = await shell.openPath(directory);
  if (error) throw new Error(`无法打开目录：${error}`);
  return true;
}

async function chooseDataDirectory() {
  const result = await dialog.showOpenDialog(startupWindow, {
    title: '选择包含 PostgreSQL 18 数据集群的 NineGrid 数据根目录',
    defaultPath: settings.dataDirectory,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return false;
  const selected = result.filePaths[0];
  const clusterPath = path.join(selected, 'postgres');
  let version = null;
  try { version = await fsp.readFile(path.join(clusterPath, 'PG_VERSION'), 'utf8'); } catch { /* Existing cluster is required. */ }
  const check = policy.validateExistingCluster({ rootExists: Boolean(version), pgVersion: version });
  if (!check.ok) throw new Error(check.code === 'version_mismatch'
    ? '所选目录不是 PostgreSQL 18 数据集群；为防止误开空档案，数据目录未更改。'
    : '所选目录中没有 postgres/PG_VERSION。请选择已有 NineGrid 数据根目录；当前不会初始化新数据库。');
  settings.dataDirectory = selected;
  await saveSettings();
  log('info', 'Existing PostgreSQL data root was selected.');
  void startRuntime();
  return true;
}

function getDatabaseConfig() {
  const url = new URL(secrets.DATABASE_URL);
  const adminUrl = secrets.DATABASE_ADMIN_URL ? new URL(secrets.DATABASE_ADMIN_URL) : null;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || Number(url.port || 5432) !== 5433) throw new Error('数据库配置必须指向本机 127.0.0.1:5433；没有启动服务。');
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database || !url.username || !url.password) throw new Error('数据库连接配置不完整；没有启动服务。');
  return {
    host: url.hostname === 'localhost' ? '127.0.0.1' : url.hostname,
    port: Number(url.port || 5432), database,
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    connectionString: secrets.DATABASE_URL,
    admin: adminUrl ? { host: adminUrl.hostname, port: Number(adminUrl.port || 5432), database: decodeURIComponent(adminUrl.pathname.replace(/^\//, '')), user: decodeURIComponent(adminUrl.username), password: decodeURIComponent(adminUrl.password) } : null,
  };
}

async function tcpPortInUse(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(700, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function runTool(file, args, env = {}, timeout = 30000) {
  try {
    const result = await execFileAsync(file, args, { cwd: appRoot, env: { ...process.env, ...env }, windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (error) {
    return { ok: false, stdout: String(error.stdout ?? '').trim(), stderr: String(error.stderr ?? error.message).trim(), code: error.code };
  }
}

async function readPostgresIdentity(db) {
  const inspector = db.admin ?? db;
  const query = `SELECT current_setting('data_directory'), substring(current_setting('server_version') from '^[0-9]+'), current_setting('port'), (SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = '${db.database}')), current_setting('listen_addresses')`;
  const result = await runTool(path.join(pgBin, 'psql.exe'), ['--no-password', '--no-psqlrc', '--tuples-only', '--no-align', '--field-separator', '\t', '--host', inspector.host, '--port', String(inspector.port), '--username', inspector.user, '--dbname', inspector.database, '--command', query], { PGPASSWORD: inspector.password }, 10000);
  if (!result.ok) return null;
  const [dataDirectory, major, port, databasePresent, listenAddresses] = result.stdout.split('\t');
  return { dataDirectory, major, port: Number(port), database: databasePresent === 't' ? db.database : '', listenAddresses };
}

async function ensureDatabase(db, paths) {
  report('检查 F 盘数据目录和 PostgreSQL 主版本…', 14);
  let version = null;
  try { version = await fsp.readFile(path.join(paths.postgres, 'PG_VERSION'), 'utf8'); } catch { /* Reported below. */ }
  const cluster = policy.validateExistingCluster({ rootExists: Boolean(version), pgVersion: version });
  if (!cluster.ok) throw new Error(cluster.code === 'version_mismatch'
    ? 'F 盘集群不是 PostgreSQL 18。应用不会升级或覆盖数据。请在设置中选择现有兼容集群。'
    : `找不到现有 PostgreSQL 18 集群：${paths.postgres}。应用不会创建空数据库。请连接 F 盘或选择已有数据根目录。`);
  for (const directory of [paths.uploads, paths.backups, paths.logs]) await fsp.mkdir(directory, { recursive: true });
  logRoot = paths.logs;
  const portBusy = await tcpPortInUse(db.port);
  const pgCtl = path.join(pgBin, 'pg_ctl.exe');
  const clusterStatus = await runTool(pgCtl, ['-D', paths.postgres, 'status'], {}, 10000);
  const clusterRunning = clusterStatus.ok;
  if (portBusy) {
    const identity = await readPostgresIdentity(db);
    const decision = policy.classifyDatabaseListener(true, identity && { running: true, dataDirectory: identity.dataDirectory, major: identity.major }, paths.postgres);
    if (decision.action !== 'reuse' || identity.port !== db.port || identity.database !== db.database || !policy.isLoopbackOnly(identity.listenAddresses)) {
      throw new Error(`数据库端口 ${db.port} 已占用，但无法核实为当前 NineGrid 的 F 盘 PostgreSQL 18 数据集群。该服务保持原样。`);
    }
    databaseOwned = databaseOwned && normalizedPath(databaseDataDirectory ?? '') === normalizedPath(paths.postgres);
    databaseDataDirectory = paths.postgres;
    runtimeStatus.service = '复用已核实的 PostgreSQL 18';
    log('info', `Reusing verified PostgreSQL cluster at ${paths.postgres}; process was not started by this app.`);
  } else {
    if (clusterRunning) throw new Error('F 盘 PostgreSQL 集群状态显示仍在运行，但 5433 端口不可连接。为避免重复启动，应用已停止启动流程。');
    report('正在启动 F 盘 PostgreSQL 18…', 28);
    const pgLog = path.join(paths.logs, 'postgres-startup.log');
    const start = await runTool(pgCtl, ['-D', paths.postgres, '-l', pgLog, '-o', `-h 127.0.0.1 -p ${db.port}`, '-w', '-t', '30', 'start'], {}, 40000);
    if (!start.ok) throw new Error(`PostgreSQL 无法启动。数据目录未更改；请查看 ${pgLog}。`);
    const identity = await readPostgresIdentity(db);
    if (!identity || normalizedPath(identity.dataDirectory) !== normalizedPath(paths.postgres) || identity.major !== EXPECTED_PG_MAJOR || identity.port !== db.port || !policy.isLoopbackOnly(identity.listenAddresses)) {
      throw new Error('启动后的数据库身份校验失败；没有启动应用后端。');
    }
    databaseOwned = true;
    databaseDataDirectory = paths.postgres;
    runtimeStatus.service = '已启动 PostgreSQL 18';
    log('info', `Started owned PostgreSQL cluster PID ${readPostmasterPid(paths.postgres)} at ${paths.postgres}.`);
  }
}

function readPostmasterPid(dataDirectory) {
  try { return Number(fs.readFileSync(path.join(dataDirectory, 'postmaster.pid'), 'utf8').split(/\r?\n/)[0]); }
  catch { return null; }
}

async function expectedApiStatus(db) {
  try {
    const response = await fetch(`${API_ORIGIN}/api/status`, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
}

function appBackendEnv(db, paths) {
  return {
    NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '8787',
    APP_ORIGIN: API_ORIGIN, DATABASE_URL: secrets.DATABASE_URL,
    SESSION_SECRET: secrets.SESSION_SECRET,
    ...(secrets.DEEPSEEK_API_KEY ? { DEEPSEEK_API_KEY: secrets.DEEPSEEK_API_KEY } : {}),
    ...(secrets.YOUTUBE_API_KEY ? { YOUTUBE_API_KEY: secrets.YOUTUBE_API_KEY } : {}),
    UPLOAD_DIR: paths.uploads, ATTACHMENT_DIRECTORY: paths.uploads,
    NINEGRID_DATA_DIRECTORY: paths.root, NINEGRID_APP_ROOT: appRoot,
    NINEGRID_COMMIT: buildInfo.commit, NINEGRID_BRANCH: buildInfo.branch,
    NINEGRID_BUILD_DIRTY: String(buildInfo.workingTreeModified),
    npm_package_version: app.getVersion(),
  };
}

async function ensureApi(db, paths) {
  report('检查本机账号服务与数据库身份…', 42);
  const busy = await tcpPortInUse(8787);
  if (busy) {
    const status = await expectedApiStatus(db);
    const decision = policy.classifyApiListener(true, status, { host: db.host, port: db.port, database: db.database }, paths.root, { version: app.getVersion(), commit: buildInfo.commit });
    if (decision.action !== 'reuse') throw new Error('8787 端口已被占用，但该服务没有提供兼容的 NineGrid 生产账号和数据库身份。没有接管或结束该进程。');
    backendOwned = Boolean(backendOwned && backendChild && backendChild.exitCode === null);
    runtimeStatus.service = '复用已核实的 NineGrid 账号服务';
    runtimeStatus.ai = status.aiMode === 'ready' ? '已配置' : '未配置';
    log('info', 'Reusing compatible production NineGrid API; process was not started by this app.');
    return status;
  }
  report('正在启动 NineGrid 独立后端…', 56);
  const expectedRuntime = { version: app.getVersion(), commit: buildInfo.commit };
  const pendingMigrations = await getPendingMigrations(db);
  if (pendingMigrations.length) {
    report(`发现 ${pendingMigrations.length} 个待应用数据库迁移，先创建数据库与附件备份…`, 50);
    await createBackupBundle();
    log('info', `Completed pre-migration backup for ${pendingMigrations.length} pending migration(s).`);
  }
  const tsx = path.join(appRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const entry = path.join(appRoot, 'server', 'index.ts');
  if (!fs.existsSync(tsx) || !fs.existsSync(entry) || !fs.existsSync(path.join(appRoot, 'dist', 'index.html'))) {
    throw new Error('安装包缺少生产后端或前端资源；请重新安装完整的 NineGrid 安装包。');
  }
  runtimeEnv = appBackendEnv(db, paths);
  backendChild = spawn(nodeRuntime, [tsx, entry], {
    cwd: appRoot, env: { ...process.env, ...runtimeEnv }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
  });
  backendOwned = true;
  backendChild.stdout.setEncoding('utf8').on('data', data => data.split(/\r?\n/).filter(Boolean).forEach(line => log('info', `api: ${line}`)));
  backendChild.stderr.setEncoding('utf8').on('data', data => data.split(/\r?\n/).filter(Boolean).forEach(line => log('error', `api: ${line}`)));
  backendChild.once('error', error => log('error', `API process launch failed: ${error.message}`));
  backendChild.once('exit', (code, signal) => {
    log('warn', `API child exited (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`);
    if (backendOwned && !allowQuit && mainWindow && !mainWindow.isDestroyed()) {
      report('NineGrid 服务已退出。你的答案仍保存在数据库中，可重试启动。', 100, '后端进程已退出');
      createStartupWindow();
    }
  });
  const deadline = Date.now() + 45000;
  let status = null;
  while (Date.now() < deadline) {
    if (backendChild.exitCode !== null) throw new Error('后端在启动期间退出。请打开日志查看错误原因。');
    status = await expectedApiStatus(db);
    const decision = policy.classifyApiListener(Boolean(status), status, { host: db.host, port: db.port, database: db.database }, paths.root, expectedRuntime);
    if (status && decision.action === 'reuse') break;
    report('等待数据库迁移与账号服务健康检查…', 68);
    await new Promise(resolve => setTimeout(resolve, 600));
  }
  if (!status || policy.classifyApiListener(true, status, { host: db.host, port: db.port, database: db.database }, paths.root, expectedRuntime).action !== 'reuse') {
    throw new Error('本机账号服务在 45 秒内未通过身份和健康检查；请查看 NineGrid 日志后重试。');
  }
  runtimeStatus.service = 'NineGrid 账号服务已就绪';
  runtimeStatus.ai = status.aiMode === 'ready' ? '已配置' : '未配置';
  log('info', `Started owned NineGrid backend PID ${backendChild.pid}; API identity verified.`);
  return status;
}

async function startRuntime() {
  if (startPromise) return startPromise;
  startPromise = startRuntimeInternal().catch(error => {
    const message = redact(error.message || 'NineGrid 启动失败。');
    runtimeStatus.service = '启动失败';
    log('error', message);
    report('启动未完成；服务错误不会切换成演示档案。', 100, message);
  }).finally(() => { startPromise = undefined; });
  return startPromise;
}

async function startRuntimeInternal() {
  report('读取本机配置与运行版本…', 5);
  await readSettings();
  await readBuildInfo();
  log('info', `startup.build-info version=${app.getVersion()} commit=${buildInfo.commit} branch=${buildInfo.branch} dirty=${buildInfo.workingTreeModified}`);
  let configured = await loadSecrets();
  if (!configured && !app.isPackaged) {
    const devEnvPath = path.join(appRoot, '.env');
    try {
      const parsed = policy.parseEnvironmentText(await fsp.readFile(devEnvPath, 'utf8'));
      if (policy.validateDesktopConfig(parsed).ok) { await saveSecrets(parsed); configured = true; }
    } catch (error) { if (error.code !== 'ENOENT') log('warn', 'Development environment file was not imported.'); }
  }
  if (!configured) throw new Error('未找到本机加密配置文件。请从启动页导入现有 .env；不会自动创建空数据库或重置会话密钥。');
  const paths = getDataPaths();
  const db = getDatabaseConfig();
  log('info', `startup.stage=database-check path=${paths.postgres}`);
  await ensureDatabase(db, paths);
  log('info', 'startup.stage=database-ready');
  report('确认现有数据附件目录…', 38);
  for (const directory of [paths.uploads, paths.backups, paths.logs]) await fsp.mkdir(directory, { recursive: true });
  log('info', 'startup.stage=api-start');
  const status = await ensureApi(db, paths);
  log('info', 'startup.stage=api-ready');
  runtimeStatus.service = status.accounts ? '账号服务在线' : '账号服务不可用';
  runtimeStatus.ai = status.aiMode === 'ready' ? '已配置' : '未配置';
  if (!status.accounts || status.environment !== 'production') throw new Error('服务没有进入生产账号模式；为保护存档，桌面端不会继续加载页面。');
  report('账号服务和数据目录已核验，正在打开九格行动…', 94);
  if (startupWindow && !startupWindow.isDestroyed()) startupWindow.close();
  createMainWindow();
  report('九格行动已就绪。', 100);
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function getPendingMigrations(db) {
  const directory = path.join(appRoot, 'server', 'migrations');
  const migrationFiles = (await fsp.readdir(directory)).filter(name => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort();
  const query = await runTool(path.join(pgBin, 'psql.exe'), [
    '--no-password', '--no-psqlrc', '--tuples-only', '--no-align', '--host', db.host, '--port', String(db.port),
    '--username', db.user, '--dbname', db.database, '--command', 'SELECT name FROM schema_migrations ORDER BY name',
  ], { PGPASSWORD: db.password }, 10000);
  if (!query.ok) {
    if (/relation .*schema_migrations.* does not exist/i.test(`${query.stderr}\n${query.stdout}`)) return migrationFiles;
    throw new Error('无法读取数据库迁移状态；为保护现有存档，没有启动后端。');
  }
  const applied = new Set(query.stdout.split(/\r?\n/).map(name => name.trim()).filter(Boolean));
  return migrationFiles.filter(name => !applied.has(name));
}

async function runSnapshot(db, uploadDirectory) {
  const script = path.join(appRoot, 'scripts', 'windows', 'db-snapshot.mjs');
  const result = await runTool(nodeRuntime, [script], {
    ...runtimeEnv, NINEGRID_DATABASE_URL: db.connectionString, NINEGRID_UPLOAD_DIR: uploadDirectory,
  }, 120000);
  if (!result.ok) throw new Error('附件与数据库快照检查失败；没有标记备份完成。');
  try { return JSON.parse(result.stdout); } catch { throw new Error('备份快照未返回有效清单。'); }
}

async function createBackupBundle() {
  const db = getDatabaseConfig();
  const paths = getDataPaths();
  await fsp.mkdir(paths.backups, { recursive: true });
  const before = await runSnapshot(db, paths.uploads);
  if (before.attachmentMismatchCount !== 0) throw new Error('数据库附件哈希与文件不一致；备份已拒绝。');
  const stamp = new Date().toISOString().replaceAll('-', '').replaceAll(':', '').replaceAll('.', '').replace('Z', 'Z');
  const bundle = path.join(paths.backups, `ninegrid-backup-${stamp}`);
  await fsp.mkdir(bundle, { recursive: false });
  const dump = path.join(bundle, 'database.dump');
  const archive = path.join(bundle, 'uploads.tar.gz');
  const dumpResult = await runTool(path.join(pgBin, 'pg_dump.exe'), [
    '--no-password', '--host', db.host, '--port', String(db.port), '--username', db.user,
    '--dbname', db.database, '--format=custom', '--no-owner', '--file', dump,
  ], { PGPASSWORD: db.password }, 10 * 60 * 1000);
  if (!dumpResult.ok) throw new Error('PostgreSQL 备份失败；不完整文件已保留供检查。');
  const tarExe = path.join(process.env.WINDIR ?? 'C:\\Windows', 'System32', 'tar.exe');
  if (!fs.existsSync(tarExe)) throw new Error('Windows tar.exe 不可用；数据库已导出，但附件归档未完成。');
  const tarResult = await runTool(tarExe, ['-czf', archive, '-C', paths.uploads, '.'], {}, 10 * 60 * 1000);
  if (!tarResult.ok) throw new Error('附件归档失败；不完整备份目录已保留供检查。');
  const after = await runSnapshot(db, paths.uploads);
  if (JSON.stringify(before.counts) !== JSON.stringify(after.counts) || JSON.stringify(before.uploadManifest) !== JSON.stringify(after.uploadManifest)) {
    throw new Error('备份期间数据库或附件发生变化；未将该备份标记为完整。请稍后重试。');
  }
  const manifest = {
    formatVersion: 1, createdAtUtc: new Date().toISOString(),
    policy: 'Keep up to 14 daily bundles; older backups require manual review and are never automatically deleted.',
    database: before.runtime.database, postgresVersion: before.runtime.server_version,
    sourceDataDirectory: before.runtime.data_directory, tableCount: before.tableCount, counts: before.counts,
    uploadFileCount: before.uploadFileCount, attachmentCount: before.attachmentCount, uploadManifest: before.uploadManifest,
    databaseDumpSha256: await sha256(dump), uploadsArchiveSha256: await sha256(archive),
  };
  await fsp.writeFile(path.join(bundle, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const all = await fsp.readdir(paths.backups);
  const count = all.filter(name => name.startsWith('ninegrid-backup-')).length;
  log('info', `Created verified database and attachment bundle ${bundle}.`);
  return `备份完成：${bundle}\n表 ${before.tableCount} · 附件 ${before.attachmentCount} · SHA-256 已写入清单。${count > 14 ? ` 当前有 ${count} 份备份；超过 14 份时请人工核对保留策略。` : ''}`;
}

async function stopOwnedServices() {
  if (backendChild && backendChild.exitCode === null && policy.mayStopOwnedProcess({ owned: backendOwned, pid: backendChild.pid })) {
    const child = backendChild;
    log('info', `Stopping owned API child PID ${child.pid}.`);
    try {
      if (!child.connected || typeof child.send !== 'function') {
        log('warn', 'Owned API child has no live IPC channel; waiting before the owned-process fallback.');
      } else {
        child.send({ type: 'ninegrid-shutdown' }, error => {
          if (error) log('warn', `Graceful API shutdown IPC was not delivered: ${error.message}`);
          else log('info', 'Graceful API shutdown IPC was delivered.');
        });
      }
    } catch (error) { log('warn', `Graceful API shutdown IPC failed: ${error.message}`); }
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 20000)),
    ]);
    if (child.exitCode === null) { log('warn', 'API did not exit gracefully within 20 seconds; terminating only its owned child handle.'); child.kill(); }
  }
  backendChild = undefined;
  const postmasterPid = databaseDataDirectory ? readPostmasterPid(databaseDataDirectory) : null;
  if (databaseDataDirectory && policy.mayStopOwnedProcess({ owned: databaseOwned, pid: postmasterPid })) {
    log('info', `Stopping owned PostgreSQL cluster PID ${postmasterPid}.`);
    const result = await runTool(path.join(pgBin, 'pg_ctl.exe'), ['-D', databaseDataDirectory, '-m', 'fast', '-w', '-t', '30', 'stop'], {}, 40000);
    if (!result.ok) log('error', 'Owned PostgreSQL cluster did not report a clean shutdown; inspect the startup log.');
  }
  backendOwned = false;
  databaseOwned = false;
}

if (!singleton) {
  app.quit();
} else {
  app.on('second-instance', () => {
    allowQuit = false;
    closeGate.reset();
    if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
    else if (startupWindow && !startupWindow.isDestroyed()) { if (startupWindow.isMinimized()) startupWindow.restore(); startupWindow.focus(); }
    else { createStartupWindow(); void startRuntime(); }
  });

  app.whenReady().then(async () => {
    app.setName('NineGrid');
    app.setAppUserModelId('com.ninegrid.learning');
    appRoot = app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..');
    pgBin = app.isPackaged ? path.join(process.resourcesPath, 'postgresql18', 'bin') : path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PostgreSQL', '18', 'bin');
    nodeRuntime = app.isPackaged ? path.join(process.resourcesPath, 'runtime', 'node.exe') : path.join(appRoot, 'node_modules', 'node', 'bin', 'node.exe');
    logRoot = path.join(DEFAULT_DATA_ROOT, 'logs');
    await readSettings();
    logRoot = getDataPaths().logs;
    await fsp.mkdir(logRoot, { recursive: true }).catch(() => {});
    await readBuildInfo();
    installMenu();
    installIpc();
    createStartupWindow();
    void startRuntime();
  }).catch(error => {
    log('error', `Electron initialization failed: ${error.message}`);
    if (!startupWindow) createStartupWindow();
    report('桌面程序无法完成初始化。', 100, '请查看日志并重试。');
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (allowQuit) return;
    event.preventDefault();
    void stopOwnedServices().finally(() => { allowQuit = true; app.quit(); });
  });
  process.on('uncaughtException', error => { log('error', `Uncaught exception: ${error.message}`); });
  process.on('unhandledRejection', error => { log('error', `Unhandled rejection: ${error instanceof Error ? error.message : 'unknown error'}`); });
}
