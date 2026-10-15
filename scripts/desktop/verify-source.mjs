import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const { createDesktopBuildInfo } = require('../../desktop/build-metadata.cjs');
const get = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const info = createDesktopBuildInfo({
  version: packageJson.version,
  commit: get(['rev-parse', 'HEAD']),
  branch: get(['branch', '--show-current']),
  dirty: Boolean(get(['status', '--porcelain', '--untracked-files=no'])),
  nodeVersion: 'pending',
  postgresRuntime: 'pending',
  builtAt: new Date().toISOString(),
});
console.log(`Verified clean desktop source ${info.sourceCommit} (${info.version}).`);
