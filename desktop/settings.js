const api = window.nineGridDesktop;
const result = document.querySelector('#result');

async function refresh() {
  const [settings, runtime] = await Promise.all([api.getSettings(), api.getRuntimeStatus()]);
  document.querySelector('#version').textContent = `${settings.version} · ${settings.sourceCommit ?? settings.commit} · ${settings.branch}`;
  document.querySelector('#service').textContent = runtime.service;
  document.querySelector('#ai').textContent = runtime.ai;
  document.querySelector('#data').textContent = settings.dataDirectory;
}
document.querySelector('#import').addEventListener('click', async () => {
  const ok = await api.importConfiguration();
  result.textContent = ok ? '配置已安全保存；不会显示密钥内容。完全退出并重新启动 NineGrid 后生效。' : '未更改配置。';
  await refresh();
});
document.querySelector('#logs').addEventListener('click', () => api.openLogs());
document.querySelector('#backups').addEventListener('click', () => api.openBackups());
document.querySelector('#backup').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  result.textContent = '正在生成一致性备份…';
  try { result.textContent = await api.createBackup(); }
  catch (error) { result.textContent = `备份失败：${error.message}`; }
  finally { event.currentTarget.disabled = false; }
});
void refresh();
