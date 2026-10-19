const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { fileURLToPath } = require('url');
const { createUpdater } = require('./updates.js');

const isMac = process.platform === 'darwin';
let win = null;
let pendingOpenFile = null;

// The app used to be called "Call Sheet", and its data (projects, sign-in) lives in a
// folder named after the app. On first run under the new name, copy the old folder over.
function migrateFromOldName() {
  const current = app.getPath('userData');
  const old = path.join(app.getPath('appData'), 'Call Sheet');
  if (old === current || !fs.existsSync(old)) return;
  const hasData = (dir) => ['callsheets.json', 'shotsheets.json', 'Local Storage'].some((f) => fs.existsSync(path.join(dir, f)));
  if (hasData(current) || !hasData(old)) return;
  try {
    fs.cpSync(old, current, {
      recursive: true,
      force: false,
      errorOnExist: false,
      filter: (src) => !/^Singleton/.test(path.basename(src)), // the old app's single-instance lock
    });
  } catch (err) {
    console.error('Could not copy data from the old Call Sheet folder:', err);
  }
}
migrateFromOldName();

// Each system keeps its own store file in the user data folder.
const STORES = ['callsheets', 'shotsheets', 'scripts'];
const storePath = (key) => {
  if (!STORES.includes(key)) throw new Error('Unknown store: ' + key);
  return path.join(app.getPath('userData'), key + '.json');
};

// Which page handles a double-clicked file, by extension.
const PAGE_FOR_EXT = { callsheet: 'callsheet.html', shotsheet: 'shotsheet.html', fountain: 'writer.html', fdx: 'writer.html' };
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
    title: 'Production Tools',
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
  // The window only ever shows the app's own pages. Anything else (a dropped link, a
  // redirect) is quietly stopped. Without this, a web page loaded in the window would get
  // the app's private API (reading and overwriting saved projects). Links meant to open
  // in a new window go to the user's browser via the handler below.
  const guard = (e, url) => {
    if (!isAppUrl(url)) e.preventDefault();
  };
  win.webContents.on('will-navigate', guard);
  win.webContents.on('will-redirect', guard);
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url);
    return { action: 'deny' };
  });
  win.on('closed', () => { win = null; });
}

// ---- What the window may show and open ----
const APP_PAGES = path.join(__dirname, 'src') + path.sep;

function isAppUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'file:' && path.normalize(fileURLToPath(u)).toLowerCase().startsWith(APP_PAGES.toLowerCase());
  } catch {
    return false;
  }
}

// Only ordinary web links go to the browser; never file:, custom protocols, etc.
function openInBrowser(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(u.href);
  } catch { /* not a URL */ }
}

// IPC handlers only answer the app's own pages.
function handle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    const from = (e.senderFrame && e.senderFrame.url) || e.sender.getURL();
    if (!isAppUrl(from)) throw new Error('Not allowed');
    return fn(e, ...args);
  });
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
    {
      // Undo/Redo go to the page, which keeps its own history (per project, collaboration-aware).
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: menuSend('undo') },
        { label: 'Redo', accelerator: isMac ? 'Shift+Cmd+Z' : 'Ctrl+Y', click: menuSend('redo') },
        ...(isMac ? [] : [{ label: 'Redo', accelerator: 'Ctrl+Shift+Z', click: menuSend('redo'), visible: false, acceleratorWorksWhenHidden: true }]),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Comments', accelerator: 'CmdOrCtrl+Alt+M', click: menuSend('comments') },
      ],
    },
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
    {
      label: 'Help',
      submenu: [
        { label: 'Check for Updates…', click: () => checkForUpdatesInteractive() },
        { label: 'Release Notes', click: () => shell.openExternal(updater.releasesUrl) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- Updates ----
// The GitHub repo whose Releases are checked, from package.json "repository".
const pkg = require('./package.json');
const repoSlug = String((pkg.repository && pkg.repository.url) || pkg.repository || '')
  .replace(/^.*github\.com[/:]/, '').replace(/\.git$/, '');
const updater = createUpdater({
  repo: repoSlug,
  onChange: (info) => { if (win) win.webContents.send('update:status', info); },
});

async function checkForUpdatesInteractive() {
  const info = await updater.check();
  if (info.error) {
    dialog.showMessageBox(win, { type: 'warning', message: "Couldn't check for updates", detail: `${info.error}\n\nCheck your internet connection and try again.` });
  } else if (info.newer && info.install.auto && info.install.state === 'ready') {
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      message: `Production Tools ${info.latest} is ready to install`,
      detail: `You have version ${info.current}. Restart now, or it installs the next time you quit.`,
      buttons: ['Restart to update', "What's new", 'Later'],
      defaultId: 0,
      cancelId: 2,
    });
    if (response === 0) updater.installNow();
    if (response === 1) openInBrowser(info.url);
  } else if (info.newer && info.install.auto && info.install.state === 'downloading') {
    dialog.showMessageBox(win, {
      type: 'info',
      message: `Downloading Production Tools ${info.latest}…`,
      detail: `${info.install.progress || 0}% done. You'll be asked to restart when it's ready.`,
    });
  } else if (info.newer) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      message: `Production Tools ${info.latest} is available`,
      detail: `You have version ${info.current}.` + (info.install.error ? `\n\nThe automatic update didn't work (${info.install.error}).` : info.install.reason ? `\n\n${info.install.reason}` : ''),
      buttons: ['Download', "What's new", 'Later'],
      defaultId: 0,
      cancelId: 2,
    });
    if (response === 0) openInBrowser(info.downloadUrl);
    if (response === 1) openInBrowser(info.url);
  } else {
    dialog.showMessageBox(win, { type: 'info', message: "You're up to date", detail: `Production Tools ${info.current} is the latest version.` });
  }
}

// ---- IPC ----

handle('store:load', (_e, key) => {
  try {
    return JSON.parse(fs.readFileSync(storePath(key), 'utf8'));
  } catch {
    return null;
  }
});

handle('store:save', (_e, key, data) => {
  const target = storePath(key);
  const tmp = target + '.tmp';
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, target);
  return true;
});

handle('file:import', async (_e, { label = 'Files', extensions = ['*'] } = {}) => {
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

handle('file:export', async (_e, { defaultName, ext, label, content }) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Export',
    defaultPath: defaultName,
    filters: [{ name: label, extensions: [ext] }],
  });
  if (res.canceled || !res.filePath) return null;
  fs.writeFileSync(res.filePath, content, 'utf8');
  return res.filePath;
});

handle('file:exportPdf', async (_e, { defaultName }) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Export PDF',
    defaultPath: defaultName,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (res.canceled || !res.filePath) return null;
  const pdf = await win.webContents.printToPDF({
    printBackground: true,
    pageSize: 'Letter',
    // Pages lay out their own margins; Electron's default margin would show as a dark border.
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
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

handle('script:import', async () => {
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
handle('script:read', (_e, filePath) => scriptResult(readScript(String(filePath || ''))));

// Called by a page after startup: hands over a double-clicked file meant for it.
handle('update:get', () => updater.get());
handle('update:check', () => updater.check());
handle('update:install', () => updater.installNow());
// Only GitHub links (release pages and downloads) are opened from the update banner.
handle('update:open', (_e, url) => {
  try {
    const u = new URL(String(url));
    if (u.protocol === 'https:' && /(^|\.)github\.com$/.test(u.hostname)) shell.openExternal(u.href);
  } catch { /* not a URL */ }
});

handle('file:takePending', (e) => {
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
    // Look for a newer release shortly after launch, then every 6 hours.
    if (repoSlug) {
      setTimeout(() => updater.check(), 4000);
      setInterval(() => updater.check(), 6 * 60 * 60 * 1000);
    }
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
