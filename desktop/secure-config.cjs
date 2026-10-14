async function decryptStoredText(encrypted, storage) {
  const normalize = value => {
    if (typeof value === 'string') return { result: value, shouldReEncrypt: false };
    if (!value || typeof value.result !== 'string') throw new Error('Windows 安全存储返回了无效数据。');
    return value;
  };
  let decoded = normalize(await storage.decryptStringAsync(encrypted));
  if (decoded.shouldReEncrypt) decoded = normalize(await storage.decryptStringAsync(encrypted));
  return decoded.result;
}

module.exports = { decryptStoredText };
