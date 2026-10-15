// Helpers shared by every system page (home, call sheet, shot sheet).
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

  window.Common = {
    api, uid, $, mod, esc, fmt, el, toast, relTime, safeFileName,
    parseCSV, csvField, createStore, goHome, wireDropdowns, onFileDrop, modal,
  };
})();
