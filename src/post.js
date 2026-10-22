// Post production for one production: take log, media catalogue, post tracker, cuts & notes.
// Its data is a separate post document (see post-formats.js); the production itself (scenes,
// shots, shoot days, breakdown) is read here, not changed.
(function () {
  const { api, $, el, toast } = window.Common;
  const P = window.Production;
  const PF = window.PostFormats;
  const SF = window.ShotFormats;

  let state = { docs: [], activeId: null };
  let prod = null;        // the production (read-only on this page)
  let cloudProd = false;  // a shared production: the post document lives on the server
  let view = 'takes';     // 'takes' | 'media' | 'tracker' | 'cuts'
  let dayFilter = null;   // take log: a shoot day id, or 'all'
  let mediaSearch = '';
  let mediaKind = '';
  let taskFilter = 'open';
  let showResolved = false;
  let message = null;     // shown instead of the page (e.g. nothing to open yet)

  const store = window.Common.createStore('post', () => ({ ...state, docs: collab.localOnly(state.docs) }),
    { list: 'docs', target: () => state, onChange: () => render({ keepScroll: true, remote: true }) });
  const active = () => state.docs.find((d) => d.id === state.activeId);
  function save() {
    const d = active();
    if (d) d.updatedAt = Date.now();
    store.save();
    collab.changed();
    history.record();
    undoUi.update();
  }

  // ---------- Undo / redo ----------
  const history = window.History.createHistory({ getDoc: () => active(), onApply: () => { save(); render({ keepScroll: true }); } });
  const undoUi = window.Common.wireUndo(history);

  // ---------- Collaboration (a shared production's post document) ----------
  const collab = window.Collab.attach({
    kind: 'post',
    listKey: 'docs',
    noun: 'post document',
    nounPlural: 'post documents',
    getState: () => state,
    render: (opts = {}) => render(opts),
    renderSidebar: () => {},
    save: () => store.save(),
    normalize: (doc) => PF.normalizePost(doc),
    selectLocal: () => P.goHome(store),
    onRoleChange: () => render(),
    production: true,
    parent: () => (cloudProd ? prod.id : null),
    productionTitle: () => (cloudProd ? prod.title : null),
    share: async () => { await store.flush(); if (await P.share(prod.id)) location.reload(); },
  });
  const ro = () => collab.readOnly();
  function blocked() {
    if (!ro()) return false;
    toast('You have view-only access to this production');
    return true;
  }

  // ---------- The production's scenes, shots and days ----------
  const isTv = () => prod.type === 'tv';
  const epOf = (s) => (isTv() ? prod.episodes.find((e) => e.id === s.episodeId) : null);
  const sceneCode = (s) => { const e = epOf(s); return e ? `${e.number}-${s.number}` : s.number; };
  const sortedDays = () => [...prod.days].sort((a, b) => a.date.localeCompare(b.date));
  const dayNum = (id) => sortedDays().findIndex((d) => d.id === id) + 1;
  const fmtDate = (s, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => new Date(s + 'T00:00').toLocaleDateString(undefined, opts);
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  // Every shot: Map(shotId → { shot, scene, code }).
  function shotIndex() {
    const map = new Map();
    for (const s of prod.scenes) s.shots.forEach((shot, i) => map.set(shot.id, { shot, scene: s, code: sceneCode(s) + SF.shotLetter(i) }));
    return map;
  }
  const sceneById = (id) => prod.scenes.find((s) => s.id === id);
  const helpers = () => {
    const shots = shotIndex();
    return {
      codeOf: (id) => (shots.get(id) || {}).code || '',
      sceneOf: (id) => { const s = sceneById(id); return s ? sceneCode(s) : ''; },
      dayOf: (id) => { const d = prod.days.find((x) => x.id === id); return d ? `Day ${dayNum(id)} (${d.date})` : ''; },
      scenesOf: (ids) => ids.map(sceneById).filter(Boolean).map(sceneCode).join(', '),
    };
  };

  // A text box that writes straight into an object as you type (no re-render, keeps focus).
  function input(obj, key, attrs = {}) {
    return el('input', {
      class: 'field', value: obj[key] || '', disabled: ro(), ...attrs,
      oninput: (e) => { obj[key] = e.target.value; save(); },
    });
  }
  function select(options, value, onchange, cls = 'field') {
    const s = el('select', { class: cls, disabled: ro(), onchange: (e) => onchange(e.target.value) },
      ...options.map(([v, label]) => el('option', { value: v }, label)));
    s.value = value || '';
    return s;
  }
  const add = (node, ...kids) => { node.append(...kids.filter((k) => k != null && k !== false)); return node; };

  // ---------- Take log ----------
  function renderTakes(d) {
    const days = sortedDays();
    if (!dayFilter || (dayFilter !== 'all' && !days.some((x) => x.id === dayFilter))) {
      const today = days.find((x) => x.date === todayStr()) || days.find((x) => x.date >= todayStr()) || days[days.length - 1];
      dayFilter = today ? today.id : 'all';
    }
    const wrap = el('div', { class: 'post-takes' });
    add(wrap, el('nav', { class: 'daybar post-daybar' },
      ...days.map((x) => el('button', { class: 'day-chip' + (dayFilter === x.id ? ' active' : ''), onclick: () => { dayFilter = x.id; render(); } },
        `DAY ${dayNum(x.id)}`, el('span', { class: 'chip-sub' }, fmtDate(x.date)))),
      el('button', { class: 'day-chip' + (dayFilter === 'all' ? ' active' : ''), onclick: () => { dayFilter = 'all'; render(); } }, 'ALL SHOTS')));

    const scenes = prod.scenes
      .map((s) => ({ s, shots: s.shots.map((shot, i) => ({ shot, code: sceneCode(s) + SF.shotLetter(i) })).filter((x) => dayFilter === 'all' || x.shot.dayId === dayFilter) }))
      .filter((x) => x.shots.length);
    const inView = new Set(scenes.flatMap((x) => x.shots.map((y) => y.shot.id)));
    const takes = d.takes.filter((t) => inView.has(t.shotId) && (dayFilter === 'all' || t.dayId === dayFilter || !t.dayId));
    add(wrap, el('p', { class: 'muted small' },
      `${takes.length} take${takes.length === 1 ? '' : 's'} logged · ${takes.filter((t) => t.status === 'circle').length} circled. `
      + 'Log each take as it’s shot: roll or card, clip name, timecode, and circle the good ones. The editor gets it as CSV (Export).'));
    if (!scenes.length) {
      wrap.append(el('div', { class: 'empty' }, days.length
        ? 'No shots on this day. Schedule shots in the Schedule page, or choose ALL SHOTS.'
        : 'No shoot days yet. Add them in the Schedule page, or choose ALL SHOTS.'));
      return wrap;
    }
    // The roll / card most recently used on this day, for the next take.
    const lastRoll = () => { const t = [...d.takes].reverse().find((x) => x.roll && (dayFilter === 'all' || x.dayId === dayFilter)); return t ? t.roll : ''; };
    for (const { s, shots } of scenes) {
      const section = el('section', { class: 'post-scene' },
        el('h2', { class: 'section-title' }, `SCENE ${sceneCode(s)}`, el('span', { class: 'scene-heading' }, s.heading)));
      for (const { shot, code } of shots) {
        const mine = d.takes.filter((t) => t.shotId === shot.id && (dayFilter === 'all' || t.dayId === dayFilter || !t.dayId));
        const circled = mine.filter((t) => t.status === 'circle').length;
        section.append(el('div', { class: 'take-shot', 'data-shot': shot.id },
          el('div', { class: 'take-shot-head' },
            el('span', { class: 'shot-code' }, code),
            el('span', { class: 'type-chip' }, shot.type),
            el('span', { class: 'take-desc' }, (shot.desc || '').replace(/\*/g, '') || 'No description'),
            el('span', { class: 'muted small' }, mine.length ? `${mine.length} take${mine.length === 1 ? '' : 's'}${circled ? ` · ${circled} circled` : ''}` : ''),
            ro() ? null : el('button', { class: 'ghost-btn', type: 'button', onclick: () => {
              const t = { id: PF.uid(), dayId: dayFilter === 'all' ? shot.dayId || null : dayFilter, sceneId: s.id, shotId: shot.id, take: PF.nextTake(d, shot.id), roll: lastRoll(), clip: '', tc: '', status: '', notes: '' };
              d.takes.push(t);
              save(); render({ keepScroll: true });
              const n = document.querySelector(`[data-item="${t.id}"] .take-clip`);
              if (n) n.focus();
            } }, '+ Take')),
          mine.length ? el('div', { class: 'take-rows' },
            el('div', { class: 'take-row take-cols' }, ...['Take', 'Roll / card', 'Clip', 'Timecode', '', 'Notes', ''].map((h) => el('span', {}, h))),
            ...mine.map((t) => el('div', { class: 'take-row' + (t.status ? ' st-' + t.status : ''), 'data-item': t.id },
              input(t, 'take', { class: 'field take-num' }),
              input(t, 'roll', { placeholder: 'A001' }),
              input(t, 'clip', { class: 'field take-clip', placeholder: 'A001C003' }),
              input(t, 'tc', { placeholder: '00:00:00:00' }),
              el('span', { class: 'take-status' }, ...PF.TAKE_STATUS.filter(([k]) => k).map(([k, label]) => el('button', {
                type: 'button', class: 'take-st' + (t.status === k ? ' on' : '') + ' st-' + k, title: label, disabled: ro(),
                onclick: () => { t.status = t.status === k ? '' : k; save(); render({ keepScroll: true }); },
              }, label.split(' ')[0]))),
              input(t, 'notes', { placeholder: 'Notes: boom in, missed line…' }),
              ro() ? el('span') : el('button', { class: 'icon-btn del', type: 'button', title: 'Delete take', onclick: () => {
                d.takes = d.takes.filter((x) => x !== t);
                d.media.forEach((m) => { if (m.takeId === t.id) m.takeId = null; });
                save(); render({ keepScroll: true });
              } }, '✕')))) : null));
      }
      wrap.append(section);
    }
    return wrap;
  }

  // ---------- Media catalogue ----------
  const fmtSize = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : n + ' B');
  // "D:\Footage\A001" → "D:"; "/Volumes/SHOOT_01/…" → "SHOOT_01"
  const driveOf = (p) => { const w = /^([A-Za-z]:)[\\/]/.exec(p); if (w) return w[1].toUpperCase(); const v = /^\/Volumes\/([^/]+)/.exec(p); return v ? v[1] : ''; };

  async function addMedia(d, folder) {
    if (blocked()) return;
    const { files, truncated } = await api.pickMedia({ folder });
    if (!files.length) return;
    const have = new Set(d.media.map((m) => m.path));
    let added = 0;
    for (const f of files) {
      if (have.has(f.path)) continue;
      d.media.push({ id: PF.uid(), name: f.name, path: f.path, kind: PF.kindOf(f.name), size: f.size || 0, modified: f.modified || 0, drive: driveOf(f.path), sceneId: null, shotId: null, takeId: null, notes: '', tags: '' });
      added++;
    }
    const linked = PF.matchMedia(d);
    save(); render({ keepScroll: true });
    toast(`Added ${added} file${added === 1 ? '' : 's'}${linked ? ` · ${linked} linked to logged takes` : ''}${truncated ? ' (stopped at 5,000 — add sub-folders separately)' : ''}`);
  }

  function renderMedia(d) {
    const wrap = el('div', { class: 'post-media' });
    const q = mediaSearch.toLowerCase();
    const shots = shotIndex();
    const list = d.media.filter((m) => (!mediaKind || m.kind === mediaKind)
      && (!q || `${m.name} ${m.path} ${m.notes} ${m.tags} ${(shots.get(m.shotId) || {}).code || ''}`.toLowerCase().includes(q)));
    const total = d.media.reduce((n, m) => n + m.size, 0);
    const search = el('input', { class: 'field media-search', type: 'search', placeholder: 'Search names, folders, notes, shots…', value: mediaSearch,
      oninput: (e) => { mediaSearch = e.target.value; render({ keepScroll: true }); const n = document.querySelector('.media-search'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } } });
    add(wrap, el('div', { class: 'post-bar' },
      ro() ? null : el('button', { class: 'primary-btn', type: 'button', onclick: () => addMedia(d, false) }, '+ Add files'),
      ro() ? null : el('button', { class: 'ghost-btn', type: 'button', onclick: () => addMedia(d, true) }, '+ Add folder'),
      ro() ? null : el('button', { class: 'ghost-btn', type: 'button', title: 'Link files to logged takes whose clip name matches the file name', onclick: () => {
        const n = PF.matchMedia(d); if (n) { save(); render({ keepScroll: true }); } toast(n ? `${n} file${n === 1 ? '' : 's'} linked to takes` : 'No new matches with the take log');
      } }, 'Match to takes'),
      search,
      select([['', 'All kinds'], ...Object.entries(PF.KIND_LABEL)], mediaKind, (v) => { mediaKind = v; render({ keepScroll: true }); }, 'field media-kind'),
      el('span', { class: 'muted small' }, `${d.media.length} file${d.media.length === 1 ? '' : 's'} · ${fmtSize(total)}`)));
    wrap.append(el('p', { class: 'muted small' }, 'A catalogue of footage and production files: where each file is (drive and folder), what it is, and which scene, shot or take it belongs to. Files stay where they are; nothing is uploaded.'));
    if (!d.media.length) { wrap.append(el('div', { class: 'empty' }, 'No files yet. Add files, or a whole card / drive folder.')); return wrap; }
    const sceneOptions = [['', '—'], ...prod.scenes.flatMap((s) => [[`scene:${s.id}`, `SC ${sceneCode(s)}`], ...s.shots.map((shot, i) => [`shot:${shot.id}`, `   ${sceneCode(s)}${SF.shotLetter(i)} ${shot.type}`])])];
    const LIMIT = 400;
    wrap.append(el('div', { class: 'media-table' },
      el('div', { class: 'media-row media-cols' }, ...['Name', 'Kind', 'Size', 'Date', 'Drive', 'Scene / shot', 'Notes', ''].map((h) => el('span', {}, h))),
      ...list.slice(0, LIMIT).map((m) => {
        const take = m.takeId && d.takes.find((t) => t.id === m.takeId);
        return el('div', { class: 'media-row', 'data-item': m.id },
          el('span', { class: 'media-name', title: m.path }, m.name, take ? el('span', { class: 'media-take' }, ` · take ${take.take}${take.status === 'circle' ? ' ◯' : ''}`) : null),
          el('span', { class: 'muted small' }, PF.KIND_LABEL[m.kind]),
          el('span', { class: 'muted small' }, fmtSize(m.size)),
          el('span', { class: 'muted small' }, m.modified ? new Date(m.modified).toLocaleDateString() : ''),
          input(m, 'drive', { placeholder: 'Drive' }),
          select(sceneOptions, m.shotId ? `shot:${m.shotId}` : m.sceneId ? `scene:${m.sceneId}` : '', (v) => {
            const [k, id] = v.split(':');
            const x = k === 'shot' ? shots.get(id) : null;
            m.shotId = x ? id : null;
            m.sceneId = k === 'scene' ? id : x ? x.scene.id : null;
            m.takeId = null;
            save(); render({ keepScroll: true });
          }),
          input(m, 'notes', { placeholder: 'Notes / tags' }),
          el('span', { class: 'media-actions' },
            el('button', { class: 'icon-btn', type: 'button', title: 'Show in folder', onclick: async () => { if (!(await api.revealMedia(m.path))) toast('Not found here. Is the drive connected?'); } }, '📂'),
            ro() ? null : el('button', { class: 'icon-btn del', type: 'button', title: 'Remove from the catalogue (the file isn’t touched)', onclick: () => {
              d.media = d.media.filter((x) => x !== m); save(); render({ keepScroll: true });
            } }, '✕')));
      }),
      list.length > LIMIT ? el('div', { class: 'muted small media-more' }, `Showing ${LIMIT} of ${list.length}. Search or filter to narrow it down.`) : null));
    return wrap;
  }

  // ---------- Post tracker ----------
  async function loadScripts() {
    const data = (await api.loadStore('scripts')) || {};
    let list = (data.scripts || []).filter((x) => x.productionId === prod.id);
    if (cloudProd) {
      const kids = await window.Cloud.projects('script', prod.id).catch(() => []);
      const docs = await Promise.all(kids.map((k) => window.Cloud.doc(k.id).then((x) => ({ ...x, id: k.id })).catch(() => null)));
      list = list.concat(docs.filter(Boolean));
    }
    return list;
  }
  // Visual effects and sound items from the breakdown become tasks (once each).
  async function fromBreakdown(d) {
    if (blocked()) return;
    const BV = window.BreakdownViews;
    const cat = BV.catalogue(prod, BV.tagIndex(await loadScripts()));
    const areaFor = { vfx: 'vfx', sound: 'sound' };
    const have = new Set(d.tasks.map((t) => t.source).filter(Boolean));
    let n = 0;
    for (const it of cat.values()) {
      const area = areaFor[it.category];
      if (!area || have.has(it.key) || !it.scenes.size) continue;
      d.tasks.push({ id: PF.uid(), area, title: it.name, status: 'todo', assignee: '', due: '', notes: '', sceneIds: [...it.scenes], source: it.key });
      n++;
    }
    if (n) { save(); render({ keepScroll: true }); }
    toast(n ? `Added ${n} task${n === 1 ? '' : 's'} from the breakdown` : 'Nothing new in the breakdown (visual effects and sound items become tasks)');
  }

  function renderTracker(d) {
    const wrap = el('div', { class: 'post-tracker' });
    const open = d.tasks.filter((t) => t.status !== 'done').length;
    add(wrap, el('div', { class: 'post-bar' },
      ro() ? null : el('button', { class: 'ghost-btn', type: 'button', onclick: () => fromBreakdown(d) }, 'Add from breakdown'),
      el('div', { class: 'seg' },
        ...[['open', 'Open'], ['all', 'All']].map(([k, label]) => el('button', { class: taskFilter === k ? 'active' : '', type: 'button', onclick: () => { taskFilter = k; render({ keepScroll: true }); } }, label))),
      el('span', { class: 'muted small' }, `${open} open · ${d.tasks.length - open} done`)));
    for (const area of PF.AREAS) {
      const all = d.tasks.filter((t) => t.area === area.id);
      const list = all.filter((t) => taskFilter === 'all' || t.status !== 'done');
      const done = all.filter((t) => t.status === 'done').length;
      wrap.append(el('section', { class: 'task-area', style: `--area:${area.color}` },
        el('div', { class: 'task-area-head' },
          el('h2', { class: 'section-title' }, area.label.toUpperCase()),
          all.length ? el('span', { class: 'muted small' }, `${done}/${all.length} done`) : null,
          ro() ? null : el('button', { class: 'link-btn', type: 'button', onclick: () => {
            const t = { id: PF.uid(), area: area.id, title: '', status: 'todo', assignee: '', due: '', notes: '', sceneIds: [], source: '' };
            d.tasks.push(t); taskFilter = taskFilter === 'open' ? 'open' : 'all';
            save(); render({ keepScroll: true });
            const n = document.querySelector(`[data-item="${t.id}"] .task-title`); if (n) n.focus();
          } }, '+ Task')),
        ...list.map((t) => el('div', { class: 'task-row st-' + t.status + (t.due && t.due < todayStr() && t.status !== 'done' ? ' late' : ''), 'data-item': t.id },
          select(PF.STATUSES, t.status, (v) => { t.status = v; save(); render({ keepScroll: true }); }, 'field task-status'),
          input(t, 'title', { class: 'field task-title', placeholder: area.id === 'sound' ? 'e.g. ADR: Maya line 12' : area.id === 'music' ? 'e.g. Cue 1M3 — diner jukebox' : 'Task' }),
          el('span', { class: 'muted small task-scenes' }, t.sceneIds.length ? 'SC ' + helpers().scenesOf(t.sceneIds) : ''),
          input(t, 'assignee', { placeholder: 'Who' }),
          el('input', { class: 'field', type: 'date', value: t.due, disabled: ro(), title: 'Due', onchange: (e) => { t.due = e.target.value; save(); render({ keepScroll: true }); } }),
          input(t, 'notes', { placeholder: 'Notes' }),
          ro() ? el('span') : el('button', { class: 'icon-btn del', type: 'button', title: 'Delete task', onclick: () => { d.tasks = d.tasks.filter((x) => x !== t); save(); render({ keepScroll: true }); } }, '✕'))),
        list.length ? null : el('div', { class: 'muted small task-empty' }, all.length ? 'All done.' : 'Nothing yet.')));
    }
    return wrap;
  }

  // ---------- Cuts & review notes ----------
  function renderCuts(d) {
    const wrap = el('div', { class: 'post-cuts' });
    const order = PF.STAGES.map(([k]) => k);
    add(wrap, el('div', { class: 'post-bar' },
      ro() ? null : el('button', { class: 'primary-btn', type: 'button', onclick: () => {
        const last = d.versions[d.versions.length - 1];
        const stage = last ? order[Math.min(order.indexOf(last.stage) + (last.stage === 'other' ? 0 : 1), order.length - 2)] : 'assembly';
        const label = PF.STAGES.find(([k]) => k === stage)[1];
        const same = d.versions.filter((v) => v.stage === stage).length;
        d.versions.push({ id: PF.uid(), name: label + (same ? ` v${same + 1}` : ''), stage, date: todayStr(), link: '', notes: [] });
        save(); render({ keepScroll: true });
      } }, '+ New cut'),
      el('label', { class: 'muted small' }, el('input', { type: 'checkbox', checked: showResolved, onchange: (e) => { showResolved = e.target.checked; render({ keepScroll: true }); } }), ' Show resolved notes')));
    if (!d.versions.length) { wrap.append(el('div', { class: 'empty' }, 'No cuts yet. Add the assembly when it’s ready, then each cut after it; review notes go on each cut.')); return wrap; }
    const me = (window.Cloud.signedIn && window.Cloud.user && window.Cloud.user.name) || 'You';
    for (const v of [...d.versions].reverse()) {
      const openNotes = v.notes.filter((n) => !n.resolved).length;
      const notes = v.notes.filter((n) => showResolved || !n.resolved);
      const isLink = /^https?:\/\//i.test(v.link.trim());
      wrap.append(el('section', { class: 'cut-card stage-' + v.stage, 'data-item': v.id },
        el('div', { class: 'cut-head' },
          el('input', { class: 'cut-name', value: v.name, disabled: ro(), oninput: (e) => { v.name = e.target.value; save(); } }),
          select(PF.STAGES, v.stage, (x) => { v.stage = x; save(); render({ keepScroll: true }); }, 'field cut-stage'),
          el('input', { class: 'field cut-date', type: 'date', value: v.date, disabled: ro(), onchange: (e) => { v.date = e.target.value; save(); } }),
          el('span', { class: 'muted small' }, `${openNotes} open note${openNotes === 1 ? '' : 's'}`),
          ro() ? null : el('button', { class: 'icon-btn del', type: 'button', title: 'Delete this cut and its notes', onclick: () => {
            if (v.notes.length && !confirm(`Delete "${v.name}" and its ${v.notes.length} notes?`)) return;
            d.versions = d.versions.filter((x) => x !== v); save(); render({ keepScroll: true });
          } }, '✕')),
        el('div', { class: 'cut-link' },
          input(v, 'link', { placeholder: 'Where to watch it: review link (https://…) or file path' }),
          v.link.trim() ? el('button', { class: 'ghost-btn', type: 'button', onclick: async () => {
            if (isLink) window.open(v.link.trim(), '_blank');
            else if (!(await api.revealMedia(v.link.trim()))) toast('Not found here. Is the drive connected?');
          } }, isLink ? 'Open ↗' : 'Show in folder') : null),
        el('div', { class: 'cut-notes' },
          ...notes.map((n) => el('div', { class: 'cut-note' + (n.resolved ? ' resolved' : ''), 'data-item': n.id },
            el('input', { type: 'checkbox', checked: n.resolved, disabled: ro(), title: 'Resolved', onchange: (e) => { n.resolved = e.target.checked; save(); render({ keepScroll: true }); } }),
            input(n, 'tc', { class: 'field note-tc', placeholder: '00:00:00:00' }),
            input(n, 'text', { class: 'field note-text', placeholder: 'Note' }),
            el('span', { class: 'muted small' }, n.author),
            ro() ? null : el('button', { class: 'icon-btn del', type: 'button', title: 'Delete note', onclick: () => { v.notes = v.notes.filter((x) => x !== n); save(); render({ keepScroll: true }); } }, '✕'))),
          ro() ? null : el('button', { class: 'link-btn', type: 'button', onclick: () => {
            const n = { id: PF.uid(), tc: '', text: '', author: me, at: Date.now(), resolved: false };
            v.notes.push(n); save(); render({ keepScroll: true });
            const t = document.querySelector(`[data-item="${n.id}"] .note-tc`); if (t) t.focus();
          } }, '+ Note'))));
    }
    return wrap;
  }

  // ---------- Render ----------
  let historyFor = null;
  function render({ keepScroll = false, remote = false } = {}) {
    const sheet = $('sheet');
    const top = sheet.scrollTop;
    const d = active();
    if ((d && d.id) !== historyFor) { historyFor = d && d.id; history.reset(); }
    else if (remote) history.rebase();
    undoUi.update();
    collab.updateToolbar();
    $('app').classList.toggle('read-only', ro());
    document.querySelectorAll('#viewToggle button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    if (prod) { $('title').textContent = prod.title; document.title = `${prod.title} — Post`; }
    const sections = $('sections');
    if (message) { sections.replaceChildren(el('div', { class: 'empty' }, message)); return; }
    if (!d || !prod) { sections.replaceChildren(el('div', { class: 'empty' }, 'Opening…')); return; }
    sections.replaceChildren({ takes: renderTakes, media: renderMedia, tracker: renderTracker, cuts: renderCuts }[view](d));
    if (keepScroll) sheet.scrollTop = top;
  }

  function setView(v) {
    view = v;
    const url = new URL(location.href);
    url.searchParams.set('view', v);
    window.history.replaceState(null, '', url);
    render();
    $('sheet').scrollTop = 0;
  }

  async function exportAs(kind) {
    const d = active();
    if (!d) return;
    const name = window.Common.safeFileName(prod.title, 'post');
    let saved = null;
    if (kind === 'pdf') {
      const label = { takes: 'Take log', media: 'Media', tracker: 'Post tracker', cuts: 'Cuts and notes' }[view];
      saved = await api.exportPdf({ defaultName: `${name} - ${label}.pdf` });
    } else {
      const h = helpers();
      const map = {
        takes: ['Take log', () => PF.takesCSV(d, h)], media: ['Media', () => PF.mediaCSV(d, h)],
        tracker: ['Post tracker', () => PF.tasksCSV(d, h)], cuts: ['Review notes', () => PF.notesCSV(d)],
      }[view];
      saved = await api.exportFile({ defaultName: `${name} - ${map[0]}.csv`, ext: 'csv', label: 'CSV', content: map[1]() });
    }
    if (saved) toast('Exported → ' + saved.split(/[\\/]/).pop());
  }

  // ---------- Loading ----------
  async function loadProduction() {
    const pid = P.id();
    const local = (await P.list()).find((x) => x.id === pid);
    if (local) { prod = local; cloudProd = false; return; }
    prod = SF.upgradeProject({ ...(await window.Cloud.doc(pid)), id: pid });
    cloudProd = true;
  }

  // The production's post document: on this computer, or (shared production) online inside
  // it, made the first time someone who can edit opens this page.
  async function openPostDoc() {
    if (!cloudProd) {
      let d = state.docs.find((x) => x.productionId === prod.id && !x._cloud);
      if (!d) { d = PF.newPost(prod.id); state.docs.push(d); store.save(); }
      state.activeId = d.id;
      return;
    }
    await collab.refreshList();
    if (collab.shared.length) { collab.open(collab.shared[0].id); return; }
    try {
      const project = await window.Cloud.createProject('post', PF.newPost(prod.id), { parent: prod.id });
      await collab.refreshList();
      collab.open(project.id);
    } catch (err) {
      message = err.status === 403 || err.status === 404
        ? 'Post production hasn’t been started for this production yet. Someone who can edit it needs to open this page once.'
        : err.message;
    }
  }

  function wire() {
    $('homeBtn').addEventListener('click', () => P.goHome(store));
    document.querySelectorAll('#viewToggle button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    window.Common.wireDropdowns();
    document.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => exportAs(b.dataset.export)));
    // Coming back to the app: the production may have changed (new shots, days, breakdown).
    window.addEventListener('focus', async () => { try { await loadProduction(); render({ keepScroll: true }); } catch { /* offline */ } });
    // Split screen: the production changed beside this page.
    window.Common.onStoreChanged('shotsheets', async () => { if (!cloudProd) { await loadProduction(); render({ keepScroll: true }); } });
    api.onMenu((channel, arg) => {
      ({
        home: () => P.goHome(store),
        export: () => exportAs(arg === 'pdf' ? 'pdf' : 'csv'),
        undo: () => active() && undoUi.run(false, true),
        redo: () => active() && undoUi.run(true, true),
      }[channel] || (() => {}))();
    });
  }

  async function init() {
    await P.migrate();
    if (!P.id()) { P.goPicker(); return; }
    const q = new URLSearchParams(location.search);
    if (['takes', 'media', 'tracker', 'cuts'].includes(q.get('view'))) view = q.get('view');
    try { await loadProduction(); } catch { P.goPicker(); return; }
    const stored = await api.loadStore('post');
    state = { ...(stored || {}), docs: (stored && Array.isArray(stored.docs) ? stored.docs : []).map(PF.normalizePost) };
    wire();
    collab.mountToolbar(document.querySelector('.toolbar'), document.querySelector('.menu-wrap'));
    collab.init();
    await openPostDoc();
    render();
    window.Common.initUpdates();
  }

  init();
})();
