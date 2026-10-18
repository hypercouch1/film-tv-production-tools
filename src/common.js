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
    return rows.filter((r) => r.some((f) => f.trim() !== ''));
  }
  function csvField(v) {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // ---- Debounced store saving that can be flushed before leaving the page ----
  function createStore(key, getData) {
    let timer = null;
    // The save message is sent synchronously, so it still lands if the page is closing.
    const flushNow = () => {
      if (timer) { clearTimeout(timer); timer = null; api.saveStore(key, getData()); }
    };
    window.addEventListener('beforeunload', flushNow);
    window.addEventListener('pagehide', flushNow);
    return {
      save() {
        clearTimeout(timer);
        timer = setTimeout(() => { timer = null; api.saveStore(key, getData()); }, 250);
      },
      async flush() {
        if (timer) { clearTimeout(timer); timer = null; await api.saveStore(key, getData()); }
      },
    };
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
  async function pickScript() {
    let docs = [];
    try {
      const data = await api.loadStore('scripts');
      docs = (data && Array.isArray(data.scripts) ? data.scripts : []).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
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

  const dismissedKey = 'update.dismissed';
  function showUpdateBanner({ required, current, latest, url, downloadUrl, minVersion }) {
    let banner = document.getElementById('updateBanner');
    if (banner) banner.remove();
    if (!required) {
      try { if (localStorage.getItem(dismissedKey) === latest) return; } catch { /* storage unavailable */ }
    }
    const close = () => {
      try { localStorage.setItem(dismissedKey, latest); } catch { /* storage unavailable */ }
      banner.remove();
    };
    banner = el('div', { class: 'update-banner' + (required ? ' required' : ''), id: 'updateBanner', role: 'status' },
      el('div', { class: 'update-text' },
        el('strong', {}, required ? 'Update required' : `Production Tools ${latest} is available`),
        el('span', {}, required
          ? `This version (${current}) is too old to sync shared projects. Version ${minVersion} or newer is needed.`
          : `You have ${current}.`)),
      url ? el('button', { class: 'ghost-btn', onclick: () => api.openRelease(url) }, "What's new") : null,
      el('button', { class: 'primary-btn', onclick: () => api.openRelease(downloadUrl || url) }, 'Download'),
      required ? null : el('button', { class: 'icon-btn', title: 'Remind me about the next version', onclick: close }, '✕'));
    document.body.append(banner);
  }

  // Every page calls this once: shows a banner when GitHub has a newer release, or when
  // the sync server says this version is too old.
  async function initUpdates() {
    let info = null;
    try { info = await api.getUpdateInfo(); } catch { /* offline */ }
    const show = (i) => {
      info = i || info;
      if (info && info.newer) showUpdateBanner({ current: info.current, latest: info.latest, url: info.url, downloadUrl: info.downloadUrl });
    };
    show(info);
    api.onUpdate(show);
    const server = window.Cloud && window.Cloud.serverUrl();
    if (!server || !info || !info.current) return;
    try {
      const res = await fetch(server + '/api/health');
      const health = await res.json();
      if (health.minClientVersion && compareVersions(info.current, health.minClientVersion) < 0) {
        showUpdateBanner({
          required: true, current: info.current, minVersion: health.minClientVersion,
          latest: info.latest, url: info.url, downloadUrl: info.downloadUrl || info.releasesUrl,
        });
      }
    } catch { /* offline: nothing to check */ }
  }

  window.Common = {
    api, uid, $, mod, esc, fmt, el, toast, relTime, safeFileName,
    parseCSV, csvField, createStore, goHome, wireDropdowns, onFileDrop, modal,
    setHandoff, takeHandoff, compareVersions, initUpdates, pickScript,
  };
})();
