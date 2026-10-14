import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dataRoot = 'F:\\Projects\\NineGridData';
const logRoot = path.join(dataRoot, 'logs');
const pidPath = path.join(logRoot, 'app.pid');
const stopPath = path.join(logRoot, 'app.stop');
const maxLogBytes = 5 * 1024 * 1024;
const maxLogs = 16;

mkdirSync(logRoot, { recursive: true });
if (existsSync(pidPath)) throw new Error('NineGrid app PID marker already exists. Use start.ps1 for managed idempotency checks.');
if (existsSync(stopPath)) unlinkSync(stopPath);
writeFileSync(pidPath, `${process.pid}\n`, { flag: 'wx' });

const runStamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
let logSequence = 0;
let output;
let outputBytes = 0;
function openLog() {
  logSequence += 1;
  const logPath = path.join(logRoot, `ninegrid-app-${runStamp}-${String(logSequence).padStart(2, '0')}.log`);
  output = createWriteStream(logPath, { flags: 'wx' });
  outputBytes = 0;
  const managed = readdirSync(logRoot).filter(name => /^ninegrid-app-\d{4}-\d{2}-\d{2}T.*\.log$/.test(name)).map(name => path.join(logRoot, name));
  managed.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  for (const file of managed.slice(maxLogs)) unlinkSync(file);
}
openLog();
const log = line => {
  const text = String(line).endsWith('\n') ? String(line) : `${line}\n`;
  if (outputBytes + Buffer.byteLength(text) > maxLogBytes && outputBytes > 0) {
    output.end();
    openLog();
  }
  outputBytes += Buffer.byteLength(text);
  output.write(text);
};

const child = spawn(process.execPath, [path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  cwd: repoRoot,
  env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: process.env.PORT || '8787', NINEGRID_APP_ROOT: repoRoot, NINEGRID_DATA_DIRECTORY: dataRoot },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
child.stdout.setEncoding('utf8').on('data', data => log(data));
child.stderr.setEncoding('utf8').on('data', data => log(data));

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  log('NineGrid local stop requested; forwarding SIGTERM to the API.');
  child.kill('SIGTERM');
  const deadline = setTimeout(() => {
    log('API did not exit within 20 seconds; leaving it running rather than terminating an unresponsive process abruptly.');
  }, 20_000);
  deadline.unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
const stopWatcher = setInterval(() => {
  if (existsSync(stopPath)) {
    unlinkSync(stopPath);
    stop();
  }
}, 250);

child.on('error', error => log(`API child failed to start: ${error.name}`));
child.on('exit', (code, signal) => {
  clearInterval(stopWatcher);
  log(`API child exited with code=${code ?? 'null'} signal=${signal ?? 'null'}.`);
  output.end();
  if (existsSync(pidPath)) unlinkSync(pidPath);
  if (existsSync(stopPath)) unlinkSync(stopPath);
  process.exitCode = code === 0 || stopping ? 0 : 1;
});

process.on('exit', () => {
  if (existsSync(pidPath)) unlinkSync(pidPath);
  if (existsSync(stopPath)) unlinkSync(stopPath);
});
