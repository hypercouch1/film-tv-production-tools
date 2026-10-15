const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const isMac = process.platform === 'darwin';
let win = null;
let pendingOpenFile = null;

// Each system keeps its own store file in the user data folder.
const STORES = ['callsheets', 'shotsheets'];
const storePath = (key) => {
  if (!STORES.includes(key)) throw new Error('Unknown store: ' + key);
  return path.join(app.getPath('userData'), key + '.json');
};

// Which page handles a double-clicked file, by extension.
const PAGE_FOR_EXT = { callsheet: 'callsheet.html', shotsheet: 'shotsheet.html' };
const OPENABLE = Object.keys(PAGE_FOR_EXT).map((e) => '.' + e);
const isOpenable = (a) => OPENABLE.some((ext) => a.toLowerCase().endsWith(ext));

function readFileForRenderer(filePath) {
  return {
    name: path.basename(filePath),
    ext: path.extname(filePath).toLowerCase().replace('.', ''),
    // Windows tools often save UTF-8 with a BOM, which JSON.parse rejects.
    content: fs.readFileSync(filePath, 'utf8').replace(/^﻿/, ''),
  };
}

const currentPage = () => (win ? path.basename(decodeURIComponent(new URL(win.webContents.getURL() || 'file:///x').pathname)) : '');

function sendOpenFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  const page = PAGE_FOR_EXT[path.extname(filePath).toLowerCase().slice(1)] || 'callsheet.html';
  if (win && !win.webContents.isLoading() && currentPage() === page) {
    win.webContents.send('file:opened', readFileForRenderer(filePath));
  } else {
    // The page asks for this file once it has finished starting up.
    pendingOpenFile = filePath;
    if (win) win.loadFile(path.join(__dirname, 'src', page));
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 500,
    backgroundColor: '#0c0a08',
    title: 'Call Sheet',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // A file opened before the window existed (macOS open-file) decides the first page.
  const startPage = pendingOpenFile
    ? PAGE_FOR_EXT[path.extname(pendingOpenFile).toLowerCase().slice(1)] || 'home.html'
    : 'home.html';
  win.loadFile(path.join(__dirname, 'src', startPage));
  // Open external links in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => { win = null; });
}

function menuSend(channel, arg) {
  return () => win && win.webContents.send('menu', channel, arg);
}

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Home', accelerator: 'CmdOrCtrl+H', click: menuSend('home') },
        { type: 'separator' },
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: menuSend('new') },
        { label: 'Duplicate', accelerator: 'CmdOrCtrl+D', click: menuSend('duplicate') },
        { type: 'separator' },
        { label: 'Import…', accelerator: 'CmdOrCtrl+O', click: menuSend('import') },
        { label: 'Import Script (PDF, Final Draft, Fountain)…', accelerator: 'CmdOrCtrl+Shift+O', click: menuSend('importScript') },
        { label: 'Export (native file)', accelerator: 'CmdOrCtrl+S', click: menuSend('export', 'native') },
        { label: 'Export PDF', accelerator: 'CmdOrCtrl+P', click: menuSend('export', 'pdf') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Sheet',
      submenu: [
        { label: 'Toggle Edit Mode', accelerator: 'CmdOrCtrl+E', click: menuSend('toggleEdit') },
        { label: 'Reset Checkboxes', accelerator: 'CmdOrCtrl+Shift+R', click: menuSend('reset') },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: menuSend('toggleSidebar') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- IPC ----

ipcMain.handle('store:load', (_e, key) => {
  try {
    return JSON.parse(fs.readFileSync(storePath(key), 'utf8'));
  } catch {
    return null;
  }
});

ipcMain.handle('store:save', (_e, key, data) => {
  const target = storePath(key);
  const tmp = target + '.tmp';
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, target);
  return true;
});

ipcMain.handle('file:import', async (_e, { label = 'Files', extensions = ['*'] } = {}) => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Import ' + label,
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: label, extensions },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (res.canceled) return [];
  return res.filePaths.map(readFileForRenderer);
});

ipcMain.handle('file:export', async (_e, { defaultName, ext, label, content }) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Export Call Sheet',
    defaultPath: defaultName,
    filters: [{ name: label, extensions: [ext] }],
  });
  if (res.canceled || !res.filePath) return null;
  fs.writeFileSync(res.filePath, content, 'utf8');
  return res.filePath;
});

ipcMain.handle('file:exportPdf', async (_e, { defaultName }) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Export PDF',
    defaultPath: defaultName,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (res.canceled || !res.filePath) return null;
  const pdf = await win.webContents.printToPDF({
    printBackground: true,
    pageSize: 'Letter',
    margins: { marginType: 'none' },
  });
  fs.writeFileSync(res.filePath, pdf);
  return res.filePath;
});

// ---- Screenplay import ----
const SCRIPT_EXTS = ['pdf', 'fdx', 'fountain', 'spmd', 'txt'];

async function readScript(filePath) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  if (!SCRIPT_EXTS.includes(ext)) throw new Error('Choose a PDF, Final Draft (.fdx) or Fountain script.');
  const name = path.basename(filePath);
  if (ext === 'pdf') {
    const { extractPdfLines } = require('./pdf-text.js');
    return { name, kind: 'pdf', lines: await extractPdfLines(filePath) };
  }
  const text = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
  return ext === 'fdx' ? { name, kind: 'fdx', xml: text } : { name, kind: 'text', text };
}

// Errors are returned rather than thrown so the page gets a readable message.
const scriptResult = (p) => p.then((script) => ({ script }), (err) => ({ error: err.message || String(err) }));

ipcMain.handle('script:import', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Import Script',
    properties: ['openFile'],
    filters: [
      { name: 'Scripts', extensions: SCRIPT_EXTS },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return scriptResult(readScript(res.filePaths[0]));
});

// A script file dragged onto the window.
ipcMain.handle('script:read', (_e, filePath) => scriptResult(readScript(String(filePath || ''))));

// Called by a page after startup: hands over a double-clicked file meant for it.
ipcMain.handle('file:takePending', (e) => {
  if (!pendingOpenFile) return null;
  const page = path.basename(decodeURIComponent(new URL(e.sender.getURL()).pathname));
  if (PAGE_FOR_EXT[path.extname(pendingOpenFile).toLowerCase().slice(1)] !== page) return null;
  const file = pendingOpenFile;
  pendingOpenFile = null;
  try { return readFileForRenderer(file); } catch { return null; }
});

// ---- App lifecycle ----

// macOS: double-clicked .callsheet files
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  sendOpenFile(filePath);
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // Windows: second launch via double-clicked file
  app.on('second-instance', (_e, argv) => {
    const file = argv.find(isOpenable);
    if (file) sendOpenFile(file);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    buildMenu();
    createWindow();
    const fileArg = process.argv.slice(1).find(isOpenable);
    if (fileArg) sendOpenFile(fileArg);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
