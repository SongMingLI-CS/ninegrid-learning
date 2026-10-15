const api = window.nineGridDesktop;
const detail = document.querySelector('#detail');
const error = document.querySelector('#error');
const progress = document.querySelector('#progress');
const actions = document.querySelector('#actions');

api.onStartupProgress(event => {
  detail.textContent = event.message;
  progress.style.width = `${Math.max(6, Math.min(100, event.percent))}%`;
  error.hidden = !event.error;
  error.textContent = event.error || '';
  actions.hidden = !event.error;
});
document.querySelector('#retry').addEventListener('click', () => api.retryStartup());
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
