const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Only the app's own pages (loaded from disk) get the API. The main process also blocks
// navigation away from them and rejects IPC from anything else.
if (location.protocol === 'file:') contextBridge.exposeInMainWorld('api', {
  loadStore: (key) => ipcRenderer.invoke('store:load', key),
  // baseVersion (split screen): the version these changes were made on (see main.js).
  saveStore: (key, data, baseVersion) => ipcRenderer.invoke('store:save', key, data, baseVersion),
  loadStoreVersioned: (key) => ipcRenderer.invoke('store:loadVersioned', key),
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
  // Media catalogue: pick files or a folder (names, paths, sizes, dates); show one in its folder.
  pickMedia: (opts) => ipcRenderer.invoke('media:pick', opts),
  revealMedia: (filePath) => ipcRenderer.invoke('media:reveal', filePath),
  // Continuity photos on this computer (JPEG bytes by id).
  savePhoto: (id, bytes) => ipcRenderer.invoke('photo:save', id, bytes),
  loadPhoto: (id) => ipcRenderer.invoke('photo:load', id),
  deletePhoto: (id) => ipcRenderer.invoke('photo:delete', id),
  // Email from the person's own Gmail (mail.js), or their email app.
  mail: {
    status: () => ipcRenderer.invoke('mail:status'),
    connect: () => ipcRenderer.invoke('mail:connect'),
    disconnect: () => ipcRenderer.invoke('mail:disconnect'),
    send: (messages) => ipcRenderer.invoke('mail:send', messages),
    compose: (msg) => ipcRenderer.invoke('mail:compose', msg),
  },
  // Split screen: two pages side by side in the window.
  split: {
    state: () => ipcRenderer.invoke('split:state'),
    open: (target) => ipcRenderer.invoke('split:open', target),
    close: () => ipcRenderer.invoke('split:close'),
    swap: () => ipcRenderer.invoke('split:swap'),
    resize: (x) => ipcRenderer.invoke('split:resize', x),
    onState: (cb) => ipcRenderer.on('split:state', (_e, s) => cb(s)),
    onLayout: (cb) => ipcRenderer.on('split:layout', (_e, l) => cb(l)),
  },
  // Another pane saved a store this page may have open.
  onStoreChanged: (cb) => ipcRenderer.on('store:changed', (_e, key, data, version) => cb(key, data, version)),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, channel, arg) => cb(channel, arg)),
  onFileOpened: (cb) => ipcRenderer.on('file:opened', (_e, file) => cb(file)),
  platform: process.platform,
});
