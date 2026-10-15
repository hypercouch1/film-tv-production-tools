const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadStore: (key) => ipcRenderer.invoke('store:load', key),
  saveStore: (key, data) => ipcRenderer.invoke('store:save', key, data),
  importFiles: (opts) => ipcRenderer.invoke('file:import', opts),
  exportFile: (opts) => ipcRenderer.invoke('file:export', opts),
  exportPdf: (opts) => ipcRenderer.invoke('file:exportPdf', opts),
  takePendingFile: () => ipcRenderer.invoke('file:takePending'),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, channel, arg) => cb(channel, arg)),
  onFileOpened: (cb) => ipcRenderer.on('file:opened', (_e, file) => cb(file)),
  platform: process.platform,
});
