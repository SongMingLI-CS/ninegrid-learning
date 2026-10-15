import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const { createDesktopBuildInfo } = require('../../desktop/build-metadata.cjs');
const staged = path.join(root, 'desktop-runtime');
const expectedNodeVersion = 'v24.11.1';
const nodeSource = path.join(root, 'node_modules', 'node', 'bin', 'node.exe');
const pgSource = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PostgreSQL', '18');
const pgVersion = await (await import('node:fs/promises')).readFile(path.join(pgSource, 'bin', 'postgres.exe')).then(async () =>
  execFileSync(path.join(pgSource, 'bin', 'postgres.exe'), ['--version'], { encoding: 'utf8', windowsHide: true }).trim());

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('The Windows x64 desktop package must be built on Windows x64.');
const stagedNodeVersion = execFileSync(nodeSource, ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
if (stagedNodeVersion !== expectedNodeVersion) throw new Error(`Bundled Node runtime must be ${expectedNodeVersion}; found ${stagedNodeVersion}.`);
if (!pgVersion.includes('18.')) throw new Error(`PostgreSQL 18 runtime was expected; found ${pgVersion}.`);
execFileSync(nodeSource, ['-e', "require('argon2'); require('sharp'); console.log('native-runtime-ok')"], { cwd: root, stdio: 'ignore', windowsHide: true });
const tsxVersion = execFileSync(nodeSource, ['node_modules/tsx/dist/cli.mjs', '--version'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
if (!tsxVersion.startsWith('tsx ')) throw new Error(`Bundled Node could not run the production TypeScript launcher: ${tsxVersion}`);

await mkdir(path.join(staged, 'postgresql18'), { recursive: true });
await cp(nodeSource, path.join(staged, 'node.exe'));
for (const directory of ['bin', 'lib', 'share']) {
  await cp(path.join(pgSource, directory), path.join(staged, 'postgresql18', directory), { recursive: true, force: true });
}
const get = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const info = createDesktopBuildInfo({
  version: packageJson.version,
  commit: get(['rev-parse', 'HEAD']),
  branch: get(['branch', '--show-current']),
  dirty: Boolean(get(['status', '--porcelain', '--untracked-files=no'])),
  nodeVersion: stagedNodeVersion,
  postgresRuntime: pgVersion,
  builtAt: new Date().toISOString(),
});
await writeFile(path.join(root, 'desktop-build-info.json'), `${JSON.stringify(info, null, 2)}\n`, { encoding: 'utf8' });
const [node, pgBin, pgLib, pgShare] = await Promise.all([
  stat(path.join(staged, 'node.exe')),
  stat(path.join(staged, 'postgresql18', 'bin', 'postgres.exe')),
  stat(path.join(staged, 'postgresql18', 'lib')),
  stat(path.join(staged, 'postgresql18', 'share')),
]);
console.log(`Staged Node ${stagedNodeVersion} (${Math.round(node.size / 1048576)} MiB) and ${pgVersion} runtime in ${staged}.`);
console.log(`PostgreSQL bin is present (${Math.round(pgBin.size / 1048576)} MiB); lib/share directories ${pgLib.isDirectory() && pgShare.isDirectory() ? 'verified' : 'missing'}.`);
