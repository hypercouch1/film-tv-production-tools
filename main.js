const { app, BrowserWindow, WebContentsView, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { fileURLToPath } = require('url');
const { createUpdater } = require('./updates.js');

const isMac = process.platform === 'darwin';
let win = null;
let pendingOpenFile = null;

// ---- Split screen ----
// The window's own page (frame.html) is only a backdrop with the divider. The app's pages
// are shown in panes on top of it: one filling the window, or two side by side. Each pane is
// a full page of its own (its own live connection to shared documents); pages on this
// computer are kept in step between the panes through the store (see store:save).
let panes = [];            // [left, right] WebContentsViews (one when not split)
let focused = null;        // the pane last used; menu commands go to it
let ratio = 0.5;           // the left pane's share of the width
const DIVIDER = 6;
const MIN_PANE = 360;
const pagePrefs = () => ({
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  // Keep timers running at normal speed while minimised or hidden, so live projects'
  // keep-alive pings carry on and the connection stays up.
  backgroundThrottling: false,
});
const mainPage = () => (panes[0] ? panes[0].webContents : null);
const activePage = () => ((focused && panes.includes(focused)) ? focused : panes[0] || { webContents: null }).webContents;
const allPages = () => panes.map((v) => v.webContents).filter((wc) => !wc.isDestroyed());

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
const STORES = ['callsheets', 'shotsheets', 'scripts', 'post', 'budget', 'onset', 'gear'];
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

const pageOf = (wc) => (wc ? path.basename(decodeURIComponent(new URL(wc.getURL() || 'file:///x').pathname)) : '');

function sendOpenFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  const page = PAGE_FOR_EXT[path.extname(filePath).toLowerCase().slice(1)] || 'callsheet.html';
  const wc = mainPage();
  if (wc && !wc.isLoading() && pageOf(wc) === page) {
    wc.send('file:opened', readFileForRenderer(filePath));
  } else {
    // The page asks for this file once it has finished starting up.
    pendingOpenFile = filePath;
    if (wc) wc.loadFile(path.join(__dirname, 'src', page));
  }
}

// The window only ever shows the app's own pages. Anything else (a dropped link, a
// redirect) is quietly stopped. Without this, a web page loaded in the window would get
// the app's private API (reading and overwriting saved projects). Links meant to open
// in a new window go to the user's browser.
function guardContents(wc) {
  const guard = (e, url) => {
    if (!isAppUrl(url)) e.preventDefault();
  };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', guard);
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.setWindowOpenHandler(({ url }) => {
    openInBrowser(url);
    return { action: 'deny' };
  });
}

function createPane(page, search) {
  const view = new WebContentsView({ webPreferences: pagePrefs() });
  view.setBackgroundColor('#0c0a08');
  guardContents(view.webContents);
  view.webContents.on('focus', () => { focused = view; });
  win.contentView.addChildView(view);
  view.webContents.loadFile(path.join(__dirname, 'src', page), search ? { search } : undefined);
  return view;
}

// Places the panes (and tells the divider and the pages where things are).
function layout() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  if (panes.length === 1) {
    panes[0].setBounds({ x: 0, y: 0, width: w, height: h });
  } else if (panes.length === 2) {
    const min = Math.min(MIN_PANE, Math.floor((w - DIVIDER) / 2));
    const left = Math.max(min, Math.min(w - DIVIDER - min, Math.round((w - DIVIDER) * ratio)));
    panes[0].setBounds({ x: 0, y: 0, width: left, height: h });
    panes[1].setBounds({ x: left + DIVIDER, y: 0, width: w - left - DIVIDER, height: h });
    win.webContents.send('split:layout', { split: true, x: left, width: DIVIDER });
  }
  if (panes.length < 2) win.webContents.send('split:layout', { split: false });
  panes.forEach((v, i) => { if (!v.webContents.isDestroyed()) v.webContents.send('split:state', { split: panes.length > 1, side: i ? 'right' : 'left' }); });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 500,
    backgroundColor: '#0c0a08',
    title: 'Production Tools',
    webPreferences: pagePrefs(),
  });
  guardContents(win.webContents);
  win.loadFile(path.join(__dirname, 'src', 'frame.html'));
  // A file opened before the window existed (macOS open-file) decides the first page.
  const startPage = pendingOpenFile
    ? PAGE_FOR_EXT[path.extname(pendingOpenFile).toLowerCase().slice(1)] || 'home.html'
    : 'home.html';
  panes = [createPane(startPage)];
  focused = panes[0];
  layout();
  for (const ev of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, layout);
  // Coming back to the window: typing goes to the pane last used.
  win.on('focus', () => { const wc = activePage(); if (wc && !wc.isDestroyed()) wc.focus(); });
  win.on('closed', () => { win = null; panes = []; focused = null; });
}

// A page opened beside this one: 'writer.html?production=…' (an app page and its query).
function splitTarget(target) {
  const m = String(target || '').match(/^([a-z-]+\.html)(?:\?([^#]*))?$/);
  if (!m || m[1] === 'frame.html' || !fs.existsSync(path.join(__dirname, 'src', m[1]))) throw new Error('Unknown page');
  return { page: m[1], search: m[2] || '' };
}
const paneOf = (wc) => panes.find((v) => v.webContents === wc);

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
  return () => { const wc = activePage(); if (wc && !wc.isDestroyed()) wc.send('menu', channel, arg); };
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
        { type: 'separator' },
        // Split screen: closes the side last used (the other fills the window).
        { label: 'Close This Side of Split Screen', accelerator: 'CmdOrCtrl+Shift+W', click: menuSend('closeSplit') },
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
  onChange: (info) => allPages().forEach((wc) => wc.send('update:status', info)),
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

function readStore(key) {
  try {
    return JSON.parse(fs.readFileSync(storePath(key), 'utf8'));
  } catch {
    return null;
  }
}
function writeStore(key, data) {
  const target = storePath(key);
  const tmp = target + '.tmp';
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, target);
}

// Split screen: two pages can save the same store. Each save is numbered, and a page says
// which version its changes were made on. A save made on an older version is merged into
// the current one (only what that page changed is applied, as with live editing), so
// neither page overwrites the other; the other pane is sent the result.
require('./src/sync-core.js');
const { diff, applyAll, clone } = globalThis.SyncCore;
const versions = new Map(); // key → { v, snaps: Map(version → data) }
function versionsOf(key) {
  if (!versions.has(key)) versions.set(key, { v: 0, snaps: new Map([[0, readStore(key)]]) });
  return versions.get(key);
}

handle('store:load', (_e, key) => readStore(key));
handle('store:loadVersioned', (_e, key) => { const s = versionsOf(key); return { version: s.v, data: s.snaps.get(s.v) }; });

handle('store:save', (e, key, data, baseVersion) => {
  storePath(key); // unknown stores are refused
  const s = versionsOf(key);
  let out = data;
  if (Number.isInteger(baseVersion) && baseVersion !== s.v && s.snaps.has(baseVersion)) {
    out = clone(s.snaps.get(s.v) || {});
    applyAll(out, diff(s.snaps.get(baseVersion) || {}, data));
  }
  writeStore(key, out);
  s.v++;
  s.snaps.set(s.v, out);
  for (const v of s.snaps.keys()) if (v < s.v - 30) s.snaps.delete(v);
  for (const wc of allPages()) if (wc !== e.sender) wc.send('store:changed', key, out, s.v);
  return { version: s.v, merged: out !== data ? out : null };
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

handle('file:exportPdf', async (e, { defaultName }) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Export PDF',
    defaultPath: defaultName,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (res.canceled || !res.filePath) return null;
  // The page that asked (in split screen, just that pane).
  const pdf = await e.sender.printToPDF({
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

// ---- Media catalogue (Post page) ----
// Lists files the person picks (or every file in a folder they pick): name, path, size and
// date only. Nothing is opened, read or copied.
const MEDIA_LIMIT = 5000;
handle('media:pick', async (_e, { folder = false } = {}) => {
  const res = await dialog.showOpenDialog(win, {
    title: folder ? 'Add a folder of footage and files' : 'Add files',
    properties: folder ? ['openDirectory'] : ['openFile', 'multiSelections'],
  });
  if (res.canceled || !res.filePaths.length) return { files: [], truncated: false };
  const files = [];
  const addFile = (p) => {
    try {
      const st = fs.statSync(p);
      if (st.isFile()) files.push({ name: path.basename(p), path: p, size: st.size, modified: st.mtimeMs });
    } catch { /* unreadable: skip */ }
  };
  if (!folder) { res.filePaths.forEach(addFile); return { files, truncated: false }; }
  // Folder: walk it (skipping hidden and system folders), up to MEDIA_LIMIT files.
  const skip = (name) => name.startsWith('.') || /^(\$RECYCLE\.BIN|System Volume Information|node_modules)$/i.test(name);
  const walk = (dir, depth) => {
    if (depth > 12 || files.length >= MEDIA_LIMIT) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (files.length >= MEDIA_LIMIT) return;
      if (skip(ent.name)) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p, depth + 1);
      else if (ent.isFile()) addFile(p);
    }
  };
  walk(res.filePaths[0], 0);
  return { files, truncated: files.length >= MEDIA_LIMIT, root: res.filePaths[0] };
});
// Shows a catalogued file in Explorer / Finder (never opens it). False if it isn't there
// (e.g. the drive isn't connected).
handle('media:reveal', (_e, filePath) => {
  const p = String(filePath || '');
  // Only local paths. A network path (\\server\share, //server) in a shared production's
  // catalogue would make Windows connect to that server when checking it, which can send
  // it the user's login hash.
  if (/^[\\/]{2}/.test(p) || !path.isAbsolute(p)) return false;
  if (!fs.existsSync(p)) return false;
  shell.showItemInFolder(p);
  return true;
});

// ---- Continuity photos (On Set page) ----
// JPEGs the page has already made smaller, kept by id in the app's data folder.
const photoPath = (id) => {
  if (!/^[\w-]{8,40}$/.test(String(id))) throw new Error('Invalid photo id');
  return path.join(app.getPath('userData'), 'photos', id + '.jpg');
};
handle('photo:save', (_e, id, bytes) => {
  const buf = Buffer.from(bytes);
  if (buf.length > 3_000_000 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) throw new Error('Photos must be JPEG images.');
  const target = photoPath(id);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buf);
  return true;
});
handle('photo:load', (_e, id) => { try { return fs.readFileSync(photoPath(id)); } catch { return null; } });
handle('photo:delete', (_e, id) => { try { fs.unlinkSync(photoPath(id)); } catch { /* already gone */ } return true; });

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

// ---- Split screen ----
handle('split:state', (e) => ({ split: panes.length > 1, side: panes.indexOf(paneOf(e.sender)) === 1 ? 'right' : 'left' }));
// Opens a page beside the one asking (or, when split already, in the other pane).
handle('split:open', (e, target) => {
  const { page, search } = splitTarget(target);
  const from = paneOf(e.sender);
  if (!from) return false;
  if (panes.length === 2) {
    const other = panes.find((v) => v !== from);
    other.webContents.loadFile(path.join(__dirname, 'src', page), search ? { search } : undefined);
  } else {
    panes.push(createPane(page, search));
  }
  layout();
  return true;
});
// Closes the pane asking; the other one fills the window.
handle('split:close', (e) => {
  const view = paneOf(e.sender);
  if (!view || panes.length < 2) return false;
  panes = panes.filter((v) => v !== view);
  focused = panes[0];
  win.contentView.removeChildView(view);
  // (The page saved its changes before asking.)
  view.webContents.close();
  layout();
  panes[0].webContents.focus();
  return true;
});
handle('split:swap', () => { if (panes.length === 2) { panes.reverse(); layout(); } return true; });
// The divider (frame.html) being dragged: x is where it is now; null puts it back in the middle.
handle('split:resize', (_e, x) => {
  if (!win || panes.length < 2) return false;
  const [w] = win.getContentSize();
  ratio = x == null ? 0.5 : Math.max(0.15, Math.min(0.85, Number(x) / Math.max(1, w - DIVIDER)));
  layout();
  return true;
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
