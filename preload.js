const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Only the app's own pages (loaded from disk) get the API. The main process also blocks
// navigation away from them and rejects IPC from anything else.
if (location.protocol === 'file:') contextBridge.exposeInMainWorld('api', {
  loadStore: (key) => ipcRenderer.invoke('store:load', key),
  saveStore: (key, data) => ipcRenderer.invoke('store:save', key, data),
  importFiles: (opts) => ipcRenderer.invoke('file:import', opts),
  exportFile: (opts) => ipcRenderer.invoke('file:export', opts),
  exportPdf: (opts) => ipcRenderer.invoke('file:exportPdf', opts),
  takePendingFile: () => ipcRenderer.invoke('file:takePending'),
  importScript: () => ipcRenderer.invoke('script:import'),
  // For a script dragged onto the window: the main process reads it by path.
  readDroppedScript: (file) => ipcRenderer.invoke('script:read', webUtils.getPathForFile(file)),
  getUpdateInfo: () => ipcRenderer.invoke('update:get'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  onUpdate: (cb) => ipcRenderer.on('update:status', (_e, info) => cb(info)),
  openRelease: (url) => ipcRenderer.invoke('update:open', url),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, channel, arg) => cb(channel, arg)),
  onFileOpened: (cb) => ipcRenderer.on('file:opened', (_e, file) => cb(file)),
  platform: process.platform,
});
