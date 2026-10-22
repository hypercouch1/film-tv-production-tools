// Helpers shared by every system page (home, call sheet, shot sheet, script writer).
(function () {
  // Outside Electron (plain browser preview) fall back to localStorage and downloads.
  const api = window.api || {
    loadStore: async (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
    saveStore: async (key, d) => { localStorage.setItem(key, JSON.stringify(d)); },
    importFiles: async () => [],
    exportFile: async ({ content, defaultName }) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([content]));
      a.download = defaultName; a.click();
      return defaultName;
    },
    exportPdf: async () => { window.print(); return null; },
    takePendingFile: async () => null,
    importScript: async () => ({ error: 'Script import needs the desktop app.' }),
    readDroppedScript: async () => ({ error: 'Script import needs the desktop app.' }),
    getUpdateInfo: async () => null,
    checkForUpdates: async () => null,
    onUpdate: () => {},
    openRelease: (url) => window.open(url, '_blank'),
    installUpdate: async () => false,
    pickMedia: async () => ({ files: [], truncated: false }),
    revealMedia: async () => false,
    onMenu: () => {},
    onFileOpened: () => {},
    platform: 'web',
  };

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const $ = (id) => document.getElementById(id);
  const mod = api.platform === 'darwin' ? '⌘' : 'Ctrl';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  // *text* renders as a yellow highlight
  function fmt(text) {
    return esc(text).replace(/\*([^*]+)\*/g, '<mark>$1</mark>');
  }
  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'value') n.value = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids) if (k != null && k !== false) n.append(k);
    return n;
  }
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }
  function relTime(ts) {
    const d = (Date.now() - ts) / 1000;
    if (d < 60) return 'just now';
    if (d < 3600) return Math.floor(d / 60) + 'm ago';
    if (d < 86400) return Math.floor(d / 3600) + 'h ago';
    return new Date(ts).toLocaleDateString();
  }
  function safeFileName(s, fallback = 'export') {
    return (s || fallback).replace(/[\\/:*?"<>|]+/g, '').trim() || fallback;
  }

  // ---- CSV ----
  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((f) => f.trim() !== '')).map((r) => r.map(uncsv));
  }
  // A cell starting with = + - @ (or a tab / return) would run as a formula in Excel or Sheets,
  // and shared projects hold text other people typed: such cells get a leading ' (which the
  // CSV import here removes again).
  const FORMULA = /^[=+\-@\t\r]/;
  function csvField(v) {
    let s = String(v == null ? '' : v);
    if (FORMULA.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const uncsv = (s) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);

  // ---- Debounced store saving that can be flushed before leaving the page ----
  // ---- Saving, and split screen ----
  // Another pane saved a store: listeners for that key hear about it.
  const storeListeners = [];
  function onStoreChanged(key, fn) { storeListeners.push({ key, fn }); }
  if (api && api.onStoreChanged) api.onStoreChanged((key, data, version) => storeListeners.forEach((l) => { if (l.key === key) l.fn(data, version); }));
  const openStores = [];

  // sync: { list, target, onChange } keeps this page in step with the other pane in split
  // screen. Saves say which version of the store they were made on, and the app merges them
  // (main.js). What the other pane changed in target()[list] (the page's live state) is
  // merged in here like a collaborator's edit, keeping this page's unsaved changes.
  function createStore(key, getData, sync) {
    let timer = null;
    let base = null; // { version, data }: the store as this page last knew it
    if (sync) api.loadStoreVersioned(key).then((b) => { if (!base) base = { version: b.version, data: b.data || {} }; });
    // Everything in `latest` that this page didn't know about goes into its live state.
    const mergeIn = (latest, version) => {
      if (!base || version <= base.version) return;
      const { diff, applyAll } = window.SyncCore;
      const ops = diff(base.data || {}, latest || {}).filter((op) => op.p[0] === sync.list);
      base = { version, data: latest || {} };
      const target = sync.target();
      if (target && ops.length && applyAll(target, ops).length) sync.onChange();
    };
    const write = async (data) => {
      if (!sync) return api.saveStore(key, data);
      const res = await api.saveStore(key, data, base ? base.version : undefined);
      if (!res || res.version == null) return;
      if (res.merged) mergeIn(res.merged, res.version);
      else if (!base || res.version > base.version) base = { version: res.version, data };
    };
    // The save message is sent synchronously, so it still lands if the page is closing.
    const flushNow = () => {
      if (timer) { clearTimeout(timer); timer = null; write(getData()); }
    };
    window.addEventListener('beforeunload', flushNow);
    window.addEventListener('pagehide', flushNow);
    const store = {
      save() {
        clearTimeout(timer);
        timer = setTimeout(() => { timer = null; write(getData()); }, 250);
      },
      async flush() {
        if (timer) { clearTimeout(timer); timer = null; await write(getData()); }
      },
    };
    if (sync) onStoreChanged(key, mergeIn);
    openStores.push(store);
    return store;
  }

  // Split screen: a "Split" button in the toolbar opens another page of the production
  // beside this one; in split screen it also swaps the sides or closes this side.
  const SPLIT_PAGES = [
    ['dashboard.html', 'Production home'], ['writer.html', 'Script'], ['shotsheet.html', 'Shot Sheet'], ['schedule.html', 'Schedule'],
    ['shotsheet.html', 'Cast & Crew', { view: 'people' }], ['callsheet.html', 'Call Sheets'], ['breakdown.html', 'Breakdown'],
    ['locations.html', 'Locations'], ['onset.html', 'On Set'], ['post.html', 'Post'], ['budget.html', 'Budget'], ['gear.html', 'Equipment'],
  ];
  async function initSplit() {
    if (!api || !api.split || /home\.html$/.test(location.pathname)) return;
    const P = window.Production;
    if (!P || !P.id()) return;
    const host = document.querySelector('.toolbar') || document.querySelector('.home .title-row');
    if (!host || host.querySelector('.split-wrap')) return;
    const btn = el('button', { class: 'ghost-btn split-btn', type: 'button', title: 'Split screen: open another page beside this one' }, '◫ Split');
    const menu = el('div', { class: 'menu split-menu', hidden: true });
    const wrap = el('div', { class: 'menu-wrap split-wrap' }, btn, menu);
    let state = { split: false, side: 'left' };
    const flushAll = () => Promise.all(openStores.map((s) => s.flush()));
    const fill = () => {
      menu.replaceChildren(
        el('div', { class: 'menu-label' }, state.split ? 'Show in the other side' : 'Open beside this page'),
        ...SPLIT_PAGES.map(([page, label, params]) => el('button', { type: 'button', onclick: async () => {
          menu.hidden = true;
          await flushAll();
          api.split.open(P.link(page, params));
        } }, label)),
        ...(state.split ? [
          el('hr'),
          el('button', { type: 'button', onclick: () => { menu.hidden = true; api.split.swap(); } }, '⇄ Swap sides'),
          el('button', { type: 'button', onclick: async () => { menu.hidden = true; await flushAll(); api.split.close(); } }, '✕ Close this side'),
        ] : []));
    };
    btn.addEventListener('click', (e) => { e.stopPropagation(); const open = menu.hidden; document.querySelectorAll('.menu').forEach((m) => { m.hidden = true; }); if (open) { fill(); menu.hidden = false; } });
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) menu.hidden = true; });
    const show = (s) => { state = s; btn.classList.toggle('active', s.split); btn.textContent = s.split ? '◫ Split ▾' : '◫ Split'; };
    api.split.onState(show);
    show(await api.split.state());
    const spacer = host.querySelector('.toolbar-spacer');
    if (spacer) spacer.after(wrap); else host.append(wrap);
  }

  async function goHome(store) {
    if (store) await store.flush();
    location.href = 'home.html';
  }

  // Menus: buttons with data-menu="<menuId>" toggle that menu; any outside click closes all.
  function wireDropdowns() {
    const btns = [...document.querySelectorAll('[data-menu]')];
    const closeAll = () => btns.forEach((b) => ($(b.dataset.menu).hidden = true));
    btns.forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const m = $(b.dataset.menu);
      const open = m.hidden;
      closeAll();
      m.hidden = !open;
    }));
    document.addEventListener('click', closeAll);
  }

  // Drag files from Finder/Explorer onto the window.
  function onFileDrop(cb) {
    document.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
    document.addEventListener('drop', async (e) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      cb(await Promise.all([...e.dataTransfer.files].map(async (f) => {
        const ext = (f.name.split('.').pop() || '').toLowerCase();
        return {
          name: f.name,
          ext,
          content: ext === 'pdf' ? '' : (await f.text()).replace(/^﻿/, ''),
          file: f,
        };
      })));
    });
  }

  // ---- Modal dialog ----
  function modal(title, body, { wide = false } = {}) {
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const overlay = el('div', { class: 'modal-overlay', onmousedown: (e) => { if (e.target === overlay) close(); } },
      el('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-label': title },
        el('div', { class: 'modal-head' },
          el('h2', {}, title),
          el('button', { class: 'icon-btn', title: 'Close', onclick: close }, '✕')),
        body));
    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
    const first = body.querySelector('input:not([type=hidden]):not([type=checkbox]), button');
    if (first) setTimeout(() => first.focus(), 0);
    return { close };
  }

  // ---- Undo / redo wiring shared by the system pages ----
  // history: from History.createHistory; textFieldsUndoNatively: in Call Sheet / Shot Sheet,
  // Ctrl+Z while typing in a field undoes that field's typing like any text box.
  function wireUndo(history, { textFieldsUndoNatively = true } = {}) {
    const undoBtn = $('undoBtn');
    const redoBtn = $('redoBtn');
    const typing = () => {
      const a = document.activeElement;
      return a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && !a.readOnly && a.type !== 'checkbox';
    };
    const run = (redo, fromMenu) => {
      if (fromMenu && textFieldsUndoNatively && typing()) {
        document.execCommand(redo ? 'redo' : 'undo');
        return;
      }
      if (!(redo ? history.redo() : history.undo())) toast(redo ? 'Nothing to redo' : 'Nothing to undo');
    };
    if (undoBtn) undoBtn.addEventListener('click', () => run(false, false));
    if (redoBtn) redoBtn.addEventListener('click', () => run(true, false));
    const update = () => {
      if (undoBtn) undoBtn.disabled = !history.canUndo;
      if (redoBtn) redoBtn.disabled = !history.canRedo;
    };
    update();
    return { run, update };
  }

  // ---- "Nothing here yet" screen shown when a system has no projects ----
  // actions: [{ label, onclick, primary }]
  function emptyState({ title, text, actions = [] }) {
    return el('div', { class: 'empty-state' },
      el('h2', {}, title),
      text ? el('p', {}, text) : null,
      el('div', { class: 'empty-actions' }, ...actions.map((a) => el('button', {
        class: a.primary ? 'primary-btn' : 'ghost-btn', type: 'button', onclick: a.onclick,
      }, a.label))));
  }

  // ---- Handing a script from one system to another (survives the page change) ----
  function setHandoff(payload) {
    try { sessionStorage.setItem('handoff', JSON.stringify(payload)); } catch { /* storage unavailable */ }
  }
  function takeHandoff(to) {
    try {
      const h = JSON.parse(sessionStorage.getItem('handoff'));
      if (!h || h.to !== to) return null;
      sessionStorage.removeItem('handoff');
      return h;
    } catch { return null; }
  }

  // ---- Choosing a script to import: one from the Script Writer, or a file ----
  // Resolves to { doc } (a Script Writer document) or { result } (from the file dialog).
  // filter: which Script Writer scripts to offer (e.g. this production's). from: the scripts to
  // choose from, if not the ones saved on this computer (e.g. a shared production's).
  async function pickScript(filter = () => true, from = null) {
    let docs = [];
    try {
      const all = from || ((await api.loadStore('scripts')) || {}).scripts;
      docs = (Array.isArray(all) ? all : []).filter(filter).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    } catch { /* no scripts yet */ }
    const fromFile = async () => {
      const result = await api.importScript();
      return result ? { result } : null;
    };
    if (!docs.length) return fromFile();
    return new Promise((resolve) => {
      const list = el('div', { class: 'pick-list' }, ...docs.map((d) => el('button', {
        class: 'pick-row', type: 'button',
        onclick: () => { m.close(); resolve({ doc: d }); },
      },
      el('strong', {}, d.title || 'Untitled Script'),
      el('span', {}, `${(d.elements || []).filter((e) => e.type === 'heading').length} scenes · edited ${relTime(d.updatedAt || Date.now())}`))));
      const file = el('button', { class: 'ghost-btn wide', type: 'button', onclick: async () => { m.close(); resolve(await fromFile()); } },
        'Choose a file instead (PDF, Final Draft, Fountain)…');
      const m = modal('Import script', el('div', {},
        el('p', { class: 'muted small' }, 'From your Script Writer scripts:'), list, file));
    });
  }

  // ---- Update notices ----
  // Compares "1.2.0" style versions: negative if a < b.
  function compareVersions(a, b) {
    const pa = String(a).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
    const pb = String(b).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    }
    return 0;
  }

  // The banner appears when a newer version is ready to install (it downloads itself in the
  // background), or, where the app can't update itself, when there's one to download.
  // While an automatic download is still running there's nothing to do, so no banner.
  const dismissedKey = 'update.dismissed';
  function showUpdateBanner({ required, current, latest, url, downloadUrl, minVersion, ready, reason }) {
    let banner = document.getElementById('updateBanner');
    if (banner) banner.remove();
    if (!required) {
      try { if (localStorage.getItem(dismissedKey) === latest + (ready ? ':ready' : '')) return; } catch { /* storage unavailable */ }
    }
    const close = () => {
      try { localStorage.setItem(dismissedKey, latest + (ready ? ':ready' : '')); } catch { /* storage unavailable */ }
      banner.remove();
    };
    const restart = el('button', { class: 'primary-btn', onclick: async () => {
      restart.disabled = true; restart.textContent = 'Restarting…';
      if (!(await api.installUpdate())) { restart.disabled = false; restart.textContent = 'Restart to update'; }
    } }, 'Restart to update');
    banner = el('div', { class: 'update-banner' + (required ? ' required' : ''), id: 'updateBanner', role: 'status' },
      el('div', { class: 'update-text' },
        el('strong', {}, required ? 'Update required' : ready ? `Production Tools ${latest} is ready to install` : `Production Tools ${latest} is available`),
        el('span', {}, required
          ? `This version (${current}) is too old to sync shared projects. Version ${minVersion} or newer is needed.`
          : ready ? 'Restart now, or it installs the next time you quit.' : `You have ${current}.${reason ? ' ' + reason : ''}`)),
      url ? el('button', { class: 'ghost-btn', onclick: () => api.openRelease(url) }, "What's new") : null,
      ready ? restart : el('button', { class: 'primary-btn', onclick: () => api.openRelease(downloadUrl || url) }, 'Download'),
      required ? null : el('button', { class: 'icon-btn', title: ready ? 'Install when I quit' : 'Remind me about the next version', onclick: close }, '✕'));
    document.body.append(banner);
  }

  function bannerFor(info) {
    const inst = info.install || {};
    const ready = !!(inst.auto && inst.state === 'ready');
    const waiting = inst.auto && inst.state !== 'error' && !ready; // downloading in the background
    return { ready, waiting, reason: inst.state === 'error' ? '' : inst.reason };
  }

  // Every page calls this once: shows a banner when GitHub has a newer release, or when
  // the sync server says this version is too old.
  // Narrow windows (and split screen): the sidebar is tucked away; ☰ slides it over the page
  // and clicking anywhere else puts it away. The page's own sidebar setting isn't changed.
  function initNarrowSidebar() {
    const app = $('app');
    const sidebar = $('sidebar');
    if (!app || !sidebar || !$('sidebarToggle')) return;
    const narrow = () => window.matchMedia('(max-width: 900px)').matches;
    const peek = (on) => app.classList.toggle('sidebar-peek', on);
    document.addEventListener('click', (e) => {
      if (!narrow()) return;
      if (e.target.closest('#sidebarToggle')) { e.stopImmediatePropagation(); e.preventDefault(); peek(!app.classList.contains('sidebar-peek')); return; }
      if (!app.classList.contains('sidebar-peek')) return;
      // Picking something in the sidebar opens it and puts the sidebar away.
      if (!e.target.closest('#sidebar') || e.target.closest('li')) setTimeout(() => peek(false), 0);
    }, true);
    window.matchMedia('(max-width: 900px)').addEventListener('change', () => peek(false));
    if (api && api.onMenu) api.onMenu((channel) => { if (channel === 'toggleSidebar' && narrow()) peek(!app.classList.contains('sidebar-peek')); });
  }

  async function initUpdates() {
    initSplit().catch(() => {});
    initNarrowSidebar();
    let info = null;
    let required = null;
    try { info = await api.getUpdateInfo(); } catch { /* offline */ }
    const show = (i) => {
      info = i || info;
      if (!info) return;
      const { ready, waiting, reason } = bannerFor(info);
      const base = { current: info.current, latest: info.latest, url: info.url, downloadUrl: info.downloadUrl, ready, reason };
      if (required) showUpdateBanner({ ...base, required: true, minVersion: required, downloadUrl: info.downloadUrl || info.releasesUrl });
      else if (info.newer && !waiting) showUpdateBanner(base);
    };
    show(info);
    api.onUpdate(show);
    const server = window.Cloud && window.Cloud.serverUrl();
    if (!server || !info || !info.current) return;
    try {
      const res = await fetch(server + '/api/health');
      const health = await res.json();
      if (health.minClientVersion && compareVersions(info.current, health.minClientVersion) < 0) {
        required = health.minClientVersion;
        show(info);
      }
    } catch { /* offline: nothing to check */ }
  }

  window.Common = {
    api, uid, $, mod, esc, fmt, el, toast, relTime, safeFileName,
    parseCSV, csvField, createStore, onStoreChanged, goHome, wireDropdowns, onFileDrop, modal,
    setHandoff, takeHandoff, compareVersions, initUpdates, pickScript, emptyState, wireUndo,
  };
})();
