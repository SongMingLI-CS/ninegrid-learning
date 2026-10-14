const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nineGridDesktop', Object.freeze({
  retryStartup: () => ipcRenderer.invoke('ninegrid:retry-startup'),
  chooseDataDirectory: () => ipcRenderer.invoke('ninegrid:choose-data-directory'),
  importConfiguration: () => ipcRenderer.invoke('ninegrid:import-configuration'),
  getSettings: () => ipcRenderer.invoke('ninegrid:get-settings'),
  getRuntimeStatus: () => ipcRenderer.invoke('ninegrid:get-runtime-status'),
  openLogs: () => ipcRenderer.invoke('ninegrid:open-logs'),
  openBackups: () => ipcRenderer.invoke('ninegrid:open-backups'),
  createBackup: () => ipcRenderer.invoke('ninegrid:create-backup'),
  openSettings: () => ipcRenderer.invoke('ninegrid:open-settings'),
  setZoom: value => ipcRenderer.invoke('ninegrid:set-zoom', value),
  openExternal: value => ipcRenderer.invoke('ninegrid:open-external', value),
  confirmClose: () => ipcRenderer.invoke('ninegrid:confirm-close'),
  onRequestClose: callback => {
    if (typeof callback !== 'function') return () => {};
    const handler = () => callback();
    ipcRenderer.on('ninegrid:request-close', handler);
    return () => ipcRenderer.removeListener('ninegrid:request-close', handler);
  },
  onStartupProgress: callback => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('ninegrid:startup-progress', handler);
    return () => ipcRenderer.removeListener('ninegrid:startup-progress', handler);
  },
}));
