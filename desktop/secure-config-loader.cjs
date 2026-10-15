async function readSecureConfiguration({ filePath, readFile, isEncryptionAvailable, decrypt, validate, onStage = () => {} }) {
  let encrypted;
  try {
    encrypted = await readFile(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      onStage('file-missing');
      return { ok: false, reason: 'missing' };
    }
    onStage('file-read-failed');
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
