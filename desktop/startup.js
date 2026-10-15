const api = window.nineGridDesktop;
const detail = document.querySelector('#detail');
const error = document.querySelector('#error');
const progress = document.querySelector('#progress');
const actions = document.querySelector('#actions');
const retryButton = document.querySelector('#retry');
let retryInProgress = false;

api.onStartupProgress(event => {
  detail.textContent = event.message;
  progress.style.width = `${Math.max(6, Math.min(100, event.percent))}%`;
  error.hidden = !event.error;
  error.textContent = event.error || '';
  actions.hidden = !event.error;
});
retryButton.addEventListener('click', async () => {
  if (retryInProgress) return;
  retryInProgress = true;
  retryButton.disabled = true;
  const label = retryButton.textContent;
  retryButton.textContent = '正在重试…';
  try { await api.retryStartup(); }
  catch (reason) {
    error.textContent = reason instanceof Error ? reason.message : '启动重试失败。';
    error.hidden = false;
    actions.hidden = false;
  }
  finally {
    retryInProgress = false;
    retryButton.disabled = false;
    retryButton.textContent = label;
  }
});
async function runAction(action) {
  try { await action(); }
  catch (reason) {
    error.textContent = reason instanceof Error ? reason.message : '操作失败。';
    error.hidden = false;
    actions.hidden = false;
  }
}
document.querySelector('#chooseData').addEventListener('click', () => runAction(() => api.chooseDataDirectory()));
document.querySelector('#importConfig').addEventListener('click', () => runAction(async () => {
  if (await api.importConfiguration()) await api.retryStartup();
}));
