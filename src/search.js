// Search the whole production: script, scenes and shots, cast and crew, schedule, breakdown,
// locations, call sheets, on-set notes, post, budget and equipment. Ctrl/⌘+K (or the
// search box on the production home) opens it; a result opens the page it's on.
// Documents are read as they are now (on this computer, or from the server for a shared
// production); nothing is kept between searches.
(function () {
  const { api, el, modal } = window.Common;
  const P = window.Production;
  const str = (v) => (v == null ? '' : String(v));
  const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);

  // ---- Reading the production ----
  async function localDocs(store, key, pid) {
    const data = (await api.loadStore(store)) || {};
    return list(data[key]).filter((d) => d.productionId === pid);
  }
  async function cloudDocs(kind, pid) {
    if (!window.Cloud || !window.Cloud.signedIn) return [];
    const kids = await window.Cloud.projects(kind, pid).catch(() => []);
    return (await Promise.all(kids.map((k) => window.Cloud.doc(k.id).then((d) => ({ ...d, id: k.id })).catch(() => null)))).filter(Boolean);
  }
  async function gather(pid) {
    const shots = (await api.loadStore('shotsheets')) || {};
    let prod = list(shots.projects).find((p) => p.id === pid);
    const shared = !prod;
    if (shared) prod = await window.Cloud.doc(pid).catch(() => null);
    if (!prod) return null;
    const docs = async (kind, store, key) => (shared ? cloudDocs(kind, pid) : localDocs(store, key, pid));
    const [scripts, sheets, post, budget, onset, gear] = await Promise.all([
      docs('script', 'scripts', 'scripts'), docs('callsheet', 'callsheets', 'sheets'), docs('post', 'post', 'docs'),
      docs('budget', 'budget', 'docs'), docs('onset', 'onset', 'docs'), docs('gear', 'gear', 'docs'),
    ]);
    return { prod: { ...prod, id: pid }, scripts, sheets, post, budget, onset, gear };
  }

  // ---- What can be found: { page, params, where, text } ----
  function entries(all) {
    const out = [];
    const add = (page, params, where, ...texts) => {
      for (const t of texts) { const s = str(t).trim(); if (s) out.push({ page, params, where, text: s }); }
    };
    const p = all.prod;
    const tv = p.type === 'tv';
    const ep = (id) => list(p.episodes).find((e) => e.id === id);
    const code = (s) => { const e = tv && ep(s.episodeId); return e ? `${e.number}-${s.number}` : str(s.number); };
    const days = list(p.days).sort((a, b) => str(a.date).localeCompare(str(b.date)));
    add('dashboard.html', {}, 'Production', p.title);
    for (const e of list(p.episodes)) add('dashboard.html', {}, `Episode ${e.number}`, e.title);
    for (const s of list(p.scenes)) {
      const epParam = tv ? { episode: s.episodeId } : {};
      add('shotsheet.html', epParam, `Scene ${code(s)}`, s.heading, s.synopsis, s.props, s.equipment);
      list(s.shots).forEach((sh, i) => add('shotsheet.html', epParam, `Shot ${code(s)}${String.fromCharCode(65 + (i % 26))}`, sh.desc && sh.desc.replace(/\*/g, ''), sh.notes));
    }
    for (const c of list(p.characters)) add('shotsheet.html', { view: 'people' }, 'Cast', c.name, c.actor, c.contact);
    for (const k of list(p.crew)) add('shotsheet.html', { view: 'people' }, 'Crew', k.name, k.role, k.contact);
    days.forEach((d, i) => add('schedule.html', { date: d.date }, `Shoot day ${i + 1} (${d.date})`, d.location, d.notes, d.equipment, d.parking, d.hospital));
    for (const l of list(p.locations)) add('locations.html', {}, `Location: ${str(l.name) || 'unnamed'}`, l.name, l.address, l.contact, l.parking, l.hospital, l.power, l.permitNotes, l.notes, ...(l.sets || []));
    for (const e of list(p.elements)) add('breakdown.html', { view: 'elements' }, 'Breakdown', e.name, e.notes);
    for (const sc of all.scripts) {
      const title = str(sc.title) || 'Script';
      let scene = '';
      for (const e of list(sc.elements)) {
        if (e.type === 'heading') scene = str(e.text);
        add('writer.html', tv && sc.episodeId ? { episode: sc.episodeId } : {}, `Script: ${title}${scene ? ' · ' + scene : ''}`, e.text);
      }
    }
    for (const sh of all.sheets) for (const sec of list(sh.sections)) for (const it of list(sec.items)) add('callsheet.html', {}, `Call sheet: ${str(sh.title)} · ${str(sec.title)}`, it.text);
    for (const d of all.post) {
      for (const t of list(d.takes)) add('post.html', { view: 'takes' }, 'Take log', t.clip, t.roll, t.notes);
      for (const m of list(d.media)) add('post.html', { view: 'media' }, 'Media', m.name, m.notes, m.tags);
      for (const t of list(d.tasks)) add('post.html', { view: 'tracker' }, 'Post tracker', t.title, t.notes, t.assignee);
      for (const v of list(d.versions)) {
        add('post.html', { view: 'cuts' }, `Cut: ${str(v.name)}`, v.name);
        for (const n of list(v.notes)) add('post.html', { view: 'cuts' }, `Cut: ${str(v.name)}`, n.text);
      }
    }
    for (const b of all.budget) {
      for (const l of list(b.lines)) add('budget.html', { view: 'detail' }, 'Budget', l.desc, l.notes);
      for (const c of list(b.costs)) add('budget.html', { view: 'costs' }, 'Expenses', c.vendor, c.desc, c.ref, c.paidBy);
    }
    for (const o of all.onset) {
      for (const r of list(o.reports)) {
        const d = days.find((x) => x.id === r.dayId);
        add('onset.html', { day: r.dayId }, `Production report${d ? ' ' + d.date : ''}`, r.media, r.delays, r.incidents, r.equipment, r.notes,
          ...Object.values(r.scenes || {}).map((x) => x && x.note), ...Object.values(r.cast || {}).map((x) => x && x.note));
      }
      for (const n of list(o.notes)) add('onset.html', { view: 'continuity' }, 'Continuity', n.text, n.take);
    }
    for (const g of all.gear) for (const i of list(g.items)) add('gear.html', {}, 'Equipment', i.name, i.vendor, i.serial, i.holder, i.notes);
    return out;
  }

  // Every word must appear (in any order, any case).
  function find(all, query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return all.filter((e) => { const t = e.text.toLowerCase(); return words.every((w) => t.includes(w)); });
  }
  // A short piece of the text around the first match, with matches marked.
  function snippet(text, query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const lower = text.toLowerCase();
    const first = Math.min(...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0));
    const start = Math.max(0, first - 50);
    const piece = (start ? '…' : '') + text.slice(start, start + 160) + (start + 160 < text.length ? '…' : '');
    const re = new RegExp('(' + words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'ig');
    return piece.split(re).map((part, i) => (i % 2 ? el('mark', {}, part) : part));
  }

  const PAGE_NAMES = {
    'dashboard.html': 'Production', 'shotsheet.html': 'Shot Sheet', 'schedule.html': 'Schedule', 'locations.html': 'Locations', 'breakdown.html': 'Breakdown',
    'writer.html': 'Script', 'callsheet.html': 'Call Sheets', 'post.html': 'Post', 'budget.html': 'Budget', 'onset.html': 'On Set', 'gear.html': 'Equipment',
  };

  async function open(initial = '') {
    const pid = P && P.id();
    if (!pid || document.querySelector('.search-box')) return;
    const input = el('input', { class: 'field search-input', type: 'search', placeholder: 'Search the script, scenes, people, locations, notes…', value: initial, autocomplete: 'off' });
    const status = el('div', { class: 'muted small search-status' }, 'Reading the production…');
    const results = el('div', { class: 'search-results' });
    const body = el('div', { class: 'search-box' }, input, status, results);
    const m = modal('Search', body, { wide: true });
    let index = [];
    let picked = 0;
    const go = (r) => {
      m.close();
      const flush = window.Common.flushStores ? window.Common.flushStores() : Promise.resolve();
      flush.then(() => { location.href = P.link(r.page, r.params); });
    };
    const draw = () => {
      const q = input.value.trim();
      const found = find(index, q).slice(0, 200);
      status.textContent = !q ? `Type to search ${index.length.toLocaleString()} things in this production.` : found.length ? `${found.length >= 200 ? '200+' : found.length} result${found.length === 1 ? '' : 's'}` : 'Nothing found.';
      picked = Math.min(picked, Math.max(0, found.length - 1));
      const groups = new Map();
      found.forEach((r, i) => { const g = PAGE_NAMES[r.page] || r.page; if (!groups.has(g)) groups.set(g, []); groups.get(g).push([r, i]); });
      results.replaceChildren(...[...groups].map(([name, rows]) => el('div', { class: 'search-group' },
        el('div', { class: 'search-group-name' }, name),
        ...rows.map(([r, i]) => el('button', { class: 'search-hit' + (i === picked ? ' picked' : ''), type: 'button', onclick: () => go(r) },
          el('span', { class: 'search-where' }, r.where), el('span', { class: 'search-text' }, ...snippet(r.text, q)))))));
      results._found = found;
    };
    input.addEventListener('input', () => { picked = 0; draw(); });
    input.addEventListener('keydown', (e) => {
      const found = results._found || [];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        picked = Math.max(0, Math.min(found.length - 1, picked + (e.key === 'ArrowDown' ? 1 : -1)));
        draw();
        const n = results.querySelector('.picked'); if (n) n.scrollIntoView({ block: 'nearest' });
      }
      if (e.key === 'Enter' && found[picked]) go(found[picked]);
    });
    setTimeout(() => input.focus(), 0);
    try {
      const all = await gather(pid);
      index = all ? entries(all) : [];
      if (!all) status.textContent = 'Couldn’t read this production.';
      else draw();
    } catch (err) { status.textContent = err.message; }
  }

  // Ctrl/⌘+K anywhere in a production (Edit → Search Production…).
  if (api && api.onMenu) api.onMenu((channel) => { if (channel === 'search') open(); });
  window.Search = { open, entries, find };
})();
