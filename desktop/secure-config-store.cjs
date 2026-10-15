const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');

async function verifyEncryptedFile(bytes, { decrypt, validate }) {
  const plaintext = await decrypt(bytes);
  const values = JSON.parse(plaintext);
  if (!validate(values)?.ok) throw new Error('stored configuration fields are invalid');
  return values;
}

async function persistSecureConfiguration({
  filePath,
  values,
  encrypt,
  decrypt,
  validate,
  readFile = fs.readFile,
  writeFile = fs.writeFile,
  rename = fs.rename,
  unlink = fs.unlink,
  mkdir = fs.mkdir,
  onStage = () => {},
}) {
  const directory = require('node:path').dirname(filePath);
  const suffix = randomUUID();
  const temporaryPath = `${filePath}.${suffix}.tmp`;
  const rollbackPath = `${filePath}.${suffix}.rollback`;
  let originalBytes;
  let phase = 'read-existing';
  try {
    originalBytes = await readFile(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error('无法读取现有配置；未更改原文件。');
  }

  let replaced = false;
  onStage('write-started');
  try {
    phase = 'create-directory';
    await mkdir(directory, { recursive: true });
    phase = 'encrypt';
    const encrypted = await encrypt(JSON.stringify(values));
    phase = 'write-temporary-file';
    await writeFile(temporaryPath, encrypted, { flag: 'wx' });
    onStage('temporary-file-written');
    phase = 'verify-temporary-file';
    const temporaryValues = await verifyEncryptedFile(await readFile(temporaryPath), { decrypt, validate });
    if (JSON.stringify(temporaryValues) !== JSON.stringify(values)) throw new Error('temporary configuration does not match requested values');
    onStage('temporary-file-verified');

    phase = 'replace-file';
    await rename(temporaryPath, filePath);
    replaced = true;
    onStage('file-replaced');
    phase = 'verify-persisted-file';
    const persistedValues = await verifyEncryptedFile(await readFile(filePath), { decrypt, validate });
    if (JSON.stringify(persistedValues) !== JSON.stringify(values)) throw new Error('persisted configuration does not match requested values');
    onStage('readback-verified');
    return { ok: true, values: persistedValues };
  } catch (error) {
    onStage('persist-failed', { phase, code: typeof error?.code === 'string' ? error.code : 'VALIDATION' });
    if (replaced) {
      phase = 'restore-previous-file';
      try {
        if (originalBytes) {
          await writeFile(rollbackPath, originalBytes, { flag: 'wx' });
          await rename(rollbackPath, filePath);
        } else {
          await unlink(filePath);
        }
        onStage('previous-file-restored');
      } catch {
        onStage('rollback-failed');
        throw new Error('配置读回校验失败，且原配置恢复失败；请保留文件并打开日志。');
      }
      throw new Error('配置保存后的读回校验失败，原配置已恢复。');
    }
    throw new Error('配置加密或写入失败；原配置未更改。');
  } finally {
    await unlink(temporaryPath).catch(() => {});
    await unlink(rollbackPath).catch(() => {});
  }
}

module.exports = { persistSecureConfiguration };
