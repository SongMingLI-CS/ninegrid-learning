async function readSecureConfiguration({ filePath, readFile, isEncryptionAvailable, decrypt, validate, fileExists, onStage = () => {} }) {
  let encrypted;
  try {
    encrypted = await readFile(filePath);
  } catch (error) {
    const details = {
      code: typeof error?.code === 'string' ? error.code : 'UNKNOWN',
      syscall: typeof error?.syscall === 'string' ? error.syscall : undefined,
      path: typeof error?.path === 'string' ? error.path : filePath,
    };
    if (error?.code === 'ENOENT' && fileExists) {
      let stillExists;
      try { stillExists = await fileExists(filePath); } catch { stillExists = undefined; }
      if (stillExists === true) {
        onStage('file-read-failed', { ...details, fileStillExists: true });
        return { ok: false, reason: 'read-failed' };
      }
      if (stillExists !== false) {
        onStage('file-read-failed', { ...details, fileStillExists: 'unknown' });
        return { ok: false, reason: 'read-failed' };
      }
      onStage('file-missing', { ...details, fileStillExists: false });
      return { ok: false, reason: 'missing' };
    }
    if (error?.code === 'ENOENT') {
      onStage('file-missing', details);
      return { ok: false, reason: 'missing' };
    }
    onStage('file-read-failed', details);
    return { ok: false, reason: 'read-failed' };
  }
  onStage('file-present');

  try {
    if (!await isEncryptionAvailable()) {
      onStage('encryption-unavailable');
      return { ok: false, reason: 'encryption-unavailable' };
    }
  } catch {
    onStage('encryption-unavailable');
    return { ok: false, reason: 'encryption-unavailable' };
  }

  let plaintext;
  try {
    plaintext = await decrypt(encrypted);
    onStage('decrypted');
  } catch {
    onStage('decrypt-failed');
    return { ok: false, reason: 'decrypt-failed' };
  }

  let values;
  try {
    values = JSON.parse(plaintext);
    onStage('parsed');
  } catch {
    onStage('parse-failed');
    return { ok: false, reason: 'parse-failed' };
  }

  try {
    const validation = validate(values);
    if (!validation?.ok) {
      onStage('validation-failed');
      return { ok: false, reason: 'invalid-fields' };
    }
  } catch {
    onStage('validation-failed');
    return { ok: false, reason: 'invalid-fields' };
  }

  onStage('validated');
  return { ok: true, values };
}

module.exports = { readSecureConfiguration };
