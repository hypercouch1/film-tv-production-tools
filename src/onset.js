// On set: the daily production report (times, scenes shot, setups and takes, cast in and
// out, delays and incidents, progress against the schedule) and continuity notes with photos.
// Its data is a separate "on set" document (onset-formats.js); photos are JPEGs kept on this
// computer, or on the server for a shared production.
(function () {
  const { api, $, el, toast } = window.Common;
  const P = window.Production;
  const OF = window.OnsetFormats;
  const SF = window.ShotFormats;

  let state = { docs: [], activeId: null };
  let prod = null;
  let cloudProd = false;
  let post = null;            // the take log, for setups and takes
  let view = 'report';        // 'report' | 'continuity'
  let dayId = null;           // the report being shown
  let sceneFilter = '';
  let catFilter = '';
  let search = '';
  let message = null;

  const store = window.Common.createStore('onset', () => ({ ...state, docs: collab.localOnly(state.docs) }),
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
  const history = window.History.createHistory({ getDoc: () => active(), onApply: () => { save(); render({ keepScroll: true }); } });
  const undoUi = window.Common.wireUndo(history);

  const collab = window.Collab.attach({
    kind: 'onset', listKey: 'docs', noun: 'on-set document', nounPlural: 'on-set documents',
    getState: () => state,
    render: (opts = {}) => render(opts),
    renderSidebar: () => {},
    save: () => store.save(),
    normalize: (doc) => OF.normalizeOnset(doc),
    selectLocal: () => P.goHome(store),
    onRoleChange: () => render(),
    production: true,
    parent: () => (cloudProd ? prod.id : null),
    productionTitle: () => (cloudProd ? prod.title : null),
    share: async () => { await store.flush(); if (await P.share(prod.id)) location.reload(); },
  });
  const ro = () => collab.readOnly();

  // ---------- Production helpers ----------
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = () => { const t = new Date(); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };
  const fmtDate = (s, opts = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) => new Date(s + 'T00:00').toLocaleDateString(undefined, opts);
  const sortedDays = () => [...prod.days].sort((a, b) => a.date.localeCompare(b.date));
  const isTv = () => prod.type === 'tv';
  const sceneCode = (sc) => { const e = isTv() && prod.episodes.find((x) => x.id === sc.episodeId); return e ? `${e.number}-${sc.number}` : sc.number; };
  const sceneById = (id) => prod.scenes.find((sc) => sc.id === id);
  const pages = (n) => (n ? window.ScriptParse.formatEighths(n) : '0');
  const time = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
  const me = () => (window.Cloud && window.Cloud.user ? window.Cloud.user.name : '');

  // ---------- Daily production report ----------
  const reportFor = (d, id) => d.reports.find((r) => r.dayId === id);
  // The report for the day, made the first time something is typed into it.
  function ensure(d, id) {
    let r = reportFor(d, id);
    if (!r) { r = OF.newReport(id); r.by = me(); d.reports.push(r); }
    return r;
  }
  function pickDay() {
    const days = sortedDays();
    if (dayId && days.some((x) => x.id === dayId)) return days.find((x) => x.id === dayId);
    const today = todayStr();
    const day = days.find((x) => x.date === today) || [...days].reverse().find((x) => x.date < today) || days[0] || null;
    dayId = day ? day.id : null;
    return day;
  }

  function renderReport(d) {
    const wrap = el('div', { class: 'onset-report' });
    const days = sortedDays();
    const day = pickDay();
    if (!day) { wrap.append(el('div', { class: 'empty' }, 'No shoot days yet. Schedule shoot days (Schedule page) and a report for each appears here.')); return wrap; }
    const r = reportFor(d, day.id) || OF.newReport(day.id); // a blank one until something is typed
    const edit = (fn) => { const real = ensure(d, day.id); fn(real); save(); };
    const i = days.indexOf(day);
    const daySelect = el('select', { class: 'field', onchange: (e) => { dayId = e.target.value; render(); } },
      ...days.map((x, n) => el('option', { value: x.id }, `Day ${n + 1} · ${fmtDate(x.date, { weekday: 'short', month: 'short', day: 'numeric' })}${reportFor(d, x.id) ? ' ✓' : ''}`)));
    daySelect.value = day.id;
    wrap.append(el('div', { class: 'post-bar' },
      el('button', { class: 'icon-btn', type: 'button', title: 'Previous day', disabled: i === 0, onclick: () => { dayId = days[i - 1].id; render(); } }, '‹'),
      daySelect,
      el('button', { class: 'icon-btn', type: 'button', title: 'Next day', disabled: i === days.length - 1, onclick: () => { dayId = days[i + 1].id; render(); } }, '›'),
      el('span', { class: 'muted small' }, reportFor(d, day.id) ? (r.by ? `Report by ${r.by}` : 'Report started') : ro() ? 'No report for this day yet' : 'Nothing filled in yet')));

    const prog = OF.progress(prod, d.reports, day);
    const field = (value, oninput, attrs = {}) => el('input', { class: 'field', value, disabled: ro(), ...attrs, oninput: (e) => oninput(e.target.value) });
    const area = (key, label, ph) => el('label', { class: 'pr-note' }, el('span', {}, label),
      el('textarea', { class: 'field', rows: 3, placeholder: ro() ? '' : ph, disabled: ro(), oninput: (e) => edit((x) => { x[key] = e.target.value; }) }, r[key]));
    const box = (title, ...kids) => el('section', { class: 'pr-box' }, el('h3', {}, title), ...kids);

    // Header and progress.
    const ahead = prog.aheadBy;
    wrap.append(el('div', { class: 'pr-head' },
      el('div', {},
        el('div', { class: 'pr-day' }, `Day ${prog.dayNumber} of ${prog.days}`),
        el('div', { class: 'pr-date' }, fmtDate(day.date)),
        day.location ? el('div', { class: 'muted' }, day.location.split('\n')[0]) : null,
        el('label', { class: 'pr-by' }, el('span', { class: 'muted small' }, 'Filled in by'), field(r.by, (v) => edit((x) => { x.by = v; }), { placeholder: '2nd AD' }))),
      el('div', { class: 'pr-progress' },
        el('div', {}, el('span', { class: 'muted small' }, 'Today'), el('strong', {}, `${prog.today.done} of ${prog.today.planned} scenes · ${pages(prog.today.donePages)} of ${pages(prog.today.plannedPages)} pages`)),
        el('div', {}, el('span', { class: 'muted small' }, 'To date'), el('strong', {}, `${prog.scenesFinished} of ${prog.scenesTotal} scenes · ${pages(prog.pagesFinished)} of ${pages(prog.pagesTotal)} pages`)),
        el('div', { class: ahead < 0 ? 'pr-behind' : 'pr-ahead' }, prog.toDate.plannedPages || prog.toDate.donePages
          ? (ahead === 0 ? 'On schedule' : `${pages(Math.abs(ahead))} page${Math.abs(ahead) === 8 ? '' : 's'} ${ahead < 0 ? 'behind' : 'ahead of'} schedule`)
          : 'No pages scheduled yet'))));

    // Times.
    wrap.append(box('Times', el('div', { class: 'pr-times' }, ...OF.TIMES.map(([k, label]) => el('label', {}, el('span', { class: 'muted small' }, label),
      el('input', { class: 'field', type: 'time', value: r.times[k] || '', disabled: ro(),
        title: k === 'crewCall' && day.crewCall ? `Scheduled: ${time(day.crewCall)}` : '',
        onchange: (e) => edit((x) => { x.times[k] = e.target.value; }) }),
      k === 'crewCall' && (day.crewCall || day.call) ? el('span', { class: 'muted small' }, `called ${time(day.crewCall || day.call)}`) : null)))));

    // Scenes.
    const planned = prod.scenes.filter((sc) => OF.onDay(sc, day.id));
    const extra = r.extraSceneIds.map(sceneById).filter(Boolean).filter((sc) => !planned.includes(sc));
    const sceneRow = (sc, added) => {
      const v = r.scenes[sc.id] || { status: '', note: '' };
      const status = el('select', { class: 'field', disabled: ro(), onchange: (e) => edit((x) => { x.scenes[sc.id] = { ...(x.scenes[sc.id] || { note: '' }), status: e.target.value }; render({ keepScroll: true }); }) },
        ...OF.SCENE_STATUS.map(([k, label]) => el('option', { value: k }, label)));
      status.value = v.status;
      return el('tr', { class: 'pr-scene s-' + (v.status || 'none') },
        el('td', {}, el('strong', {}, sceneCode(sc)), added ? el('span', { class: 'pr-added', title: 'Not on the schedule for this day' }, ' added') : null),
        el('td', {}, sc.heading || 'Untitled scene'),
        el('td', { class: 'num' }, sc.eighths ? pages(sc.eighths) : '—'),
        el('td', {}, status),
        el('td', {}, field(v.note, (val) => edit((x) => { x.scenes[sc.id] = { ...(x.scenes[sc.id] || { status: '' }), note: val }; }), { placeholder: 'e.g. lost the light, pick up tomorrow' })),
        el('td', {}, added && !ro() ? el('button', { class: 'icon-btn del', type: 'button', title: 'Remove', onclick: () => edit((x) => { x.extraSceneIds = x.extraSceneIds.filter((id) => id !== sc.id); delete x.scenes[sc.id]; render({ keepScroll: true }); }) }, '✕') : null));
    };
    const addScene = el('select', { class: 'field', disabled: ro(), onchange: (e) => {
      if (!e.target.value) return;
      edit((x) => { if (!x.extraSceneIds.includes(e.target.value)) x.extraSceneIds.push(e.target.value); });
      render({ keepScroll: true });
    } }, el('option', { value: '' }, '+ A scene shot that wasn’t planned…'),
    ...prod.scenes.filter((sc) => !planned.includes(sc) && !extra.includes(sc)).map((sc) => el('option', { value: sc.id }, `${sceneCode(sc)} ${sc.heading || ''}`)));
    wrap.append(box('Scenes',
      planned.length || extra.length ? el('table', { class: 'budget-table pr-table' },
        el('thead', {}, el('tr', {}, ...['SC', 'Set', 'Pages', 'Status', 'Notes', ''].map((h) => el('th', {}, h)))),
        el('tbody', {}, ...planned.map((sc) => sceneRow(sc, false)), ...extra.map((sc) => sceneRow(sc, true))))
        : el('p', { class: 'muted' }, 'No scenes scheduled on this day.'),
      ro() ? null : addScene));

    // Setups and takes (from the take log unless typed).
    const counts = OF.takeCounts(post, day.id);
    const countInput = (key, fromLog) => el('input', { class: 'field num', type: 'number', min: 0, step: 1, value: r[key] == null ? '' : r[key], placeholder: String(fromLog), disabled: ro(),
      onchange: (e) => edit((x) => { x[key] = e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value)) || 0); render({ keepScroll: true }); }) });
    wrap.append(box('Shots',
      el('div', { class: 'pr-times' },
        el('label', {}, el('span', { class: 'muted small' }, 'Setups'), countInput('setups', counts.setups)),
        el('label', {}, el('span', { class: 'muted small' }, 'Takes'), countInput('takes', counts.takes)),
        el('label', { class: 'pr-wide' }, el('span', { class: 'muted small' }, 'Cards / rolls / media used'), field(r.media, (v) => edit((x) => { x.media = v; }), { placeholder: 'e.g. A001–A004, 512 GB; sound rolls 1–2' }))),
      el('p', { class: 'muted small' }, post ? `From the take log (Post page): ${counts.setups} setup${counts.setups === 1 ? '' : 's'}, ${counts.takes} take${counts.takes === 1 ? '' : 's'}, ${counts.circled} circled. Type a number to use your own.` : 'Log takes on the Post page and setups and takes are counted here.')));

    // Cast in and out.
    const cast = prod.characters.filter((c) => planned.concat(extra).some((sc) => sc.castIds.includes(c.id)));
    wrap.append(box('Cast',
      cast.length ? el('table', { class: 'budget-table pr-table' },
        el('thead', {}, el('tr', {}, ...['#', 'Character', 'Actor', 'Called', 'Arrived', 'Wrapped', 'Notes'].map((h) => el('th', {}, h)))),
        el('tbody', {}, ...cast.map((c) => {
          const v = r.cast[c.id] || { arrive: '', wrap: '', note: '' };
          const set = (k) => (val) => edit((x) => { x.cast[c.id] = { ...(x.cast[c.id] || { arrive: '', wrap: '', note: '' }), [k]: val }; });
          return el('tr', {},
            el('td', {}, String(prod.characters.indexOf(c) + 1)), el('td', {}, c.name || 'Unnamed'), el('td', {}, c.actor || '—'),
            el('td', { class: 'muted' }, time((day.calls || {})[c.id] || day.call) || '—'),
            el('td', {}, el('input', { class: 'field', type: 'time', value: v.arrive, disabled: ro(), onchange: (e) => set('arrive')(e.target.value) })),
            el('td', {}, el('input', { class: 'field', type: 'time', value: v.wrap, disabled: ro(), onchange: (e) => set('wrap')(e.target.value) })),
            el('td', {}, field(v.note, set('note'), { placeholder: 'Meal penalty, late arrival…' })));
        })))
        : el('p', { class: 'muted' }, 'No cast in today’s scenes.')));

    wrap.append(box('Notes', el('div', { class: 'pr-notes' },
      area('delays', 'Delays', 'What held things up, and for how long'),
      area('incidents', 'Accidents & incidents', 'Anything that happened, who was involved, what was done'),
      area('equipment', 'Equipment problems', 'Breakdowns, missing or damaged gear'),
      area('notes', 'General notes', 'Anything else for the producers'))));
    return wrap;
  }

  // ---------- Continuity ----------
  // Photos: object URLs by photo id, loaded once.
  const photoUrls = new Map();
  const cloudDocId = () => { const d = active(); return d && d._cloud ? d._cloud.id : null; };
  function photoUrl(id) {
    if (!photoUrls.has(id)) {
      photoUrls.set(id, (async () => {
        const blob = cloudDocId()
          ? await window.Cloud.photo(cloudDocId(), id)
          : await api.loadPhoto(id).then((bytes) => (bytes ? new Blob([bytes], { type: 'image/jpeg' }) : null));
        return blob ? URL.createObjectURL(blob) : null;
      })().catch(() => null));
    }
    return photoUrls.get(id);
  }
  // Pictures are made at most 1600 px on the long side and saved as JPEG.
  async function shrink(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t read that picture.'))), 'image/jpeg', 0.82));
  }
  async function addPhotos(note, files) {
    const images = [...files].filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    toast(`Adding ${images.length} photo${images.length === 1 ? '' : 's'}…`);
    for (const file of images) {
      try {
        const blob = await shrink(file);
        let id;
        if (cloudDocId()) id = await window.Cloud.uploadPhoto(cloudDocId(), blob);
        else { id = OF.uid(); await api.savePhoto(id, new Uint8Array(await blob.arrayBuffer())); }
        photoUrls.set(id, Promise.resolve(URL.createObjectURL(blob)));
        note.photos.push(id);
        save();
      } catch (err) { alert(err.message); break; }
    }
    render({ keepScroll: true });
  }
  async function removePhoto(note, id) {
    if (!confirm('Delete this photo?')) return;
    note.photos = note.photos.filter((x) => x !== id);
    save(); render({ keepScroll: true });
    try { if (cloudDocId()) await window.Cloud.deletePhoto(cloudDocId(), id); else await api.deletePhoto(id); } catch { /* already gone */ }
  }
  function lightbox(id) {
    const img = el('img', { class: 'lb-img', alt: '' });
    photoUrl(id).then((u) => { if (u) img.src = u; });
    const o = el('div', { class: 'lightbox', onclick: () => o.remove() }, img);
    document.body.append(o);
  }

  function renderContinuity(d) {
    const wrap = el('div', { class: 'onset-continuity' });
    const sceneOptions = () => prod.scenes.map((sc) => el('option', { value: sc.id }, `${sceneCode(sc)} ${sc.heading || ''}`));
    const filter = el('select', { class: 'field', onchange: (e) => { sceneFilter = e.target.value; render({ keepScroll: true }); } }, el('option', { value: '' }, 'Every scene'), ...sceneOptions());
    filter.value = sceneFilter;
    const cats = el('select', { class: 'field', onchange: (e) => { catFilter = e.target.value; render({ keepScroll: true }); } }, el('option', { value: '' }, 'Everything'), ...OF.NOTE_CATS.map((c) => el('option', { value: c.id }, c.label)));
    cats.value = catFilter;
    const add = () => {
      const day = pickDay();
      const sceneId = sceneFilter || (day && (prod.scenes.find((sc) => OF.onDay(sc, day.id)) || {}).id) || (prod.scenes[0] || {}).id || '';
      const n = OF.newNote({ sceneId, cat: catFilter || 'wardrobe', by: me() });
      d.notes.push(n); save(); render({ keepScroll: true });
      const t = document.querySelector(`[data-note="${n.id}"] textarea`); if (t) { t.focus(); t.scrollIntoView({ block: 'center' }); }
    };
    wrap.append(el('div', { class: 'post-bar' },
      ro() ? null : el('button', { class: 'primary-btn', type: 'button', onclick: add }, '+ Note'),
      filter, cats,
      el('input', { class: 'field', type: 'search', placeholder: 'Search notes', value: search, oninput: (e) => { search = e.target.value; render({ keepScroll: true }); const s = document.querySelector('.onset-continuity input[type=search]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } } }),
      (() => { const photos = d.notes.reduce((n, x) => n + x.photos.length, 0); return el('span', { class: 'muted small' }, `${d.notes.length} note${d.notes.length === 1 ? '' : 's'} · ${photos} photo${photos === 1 ? '' : 's'}`); })()));
    const q = search.trim().toLowerCase();
    const shown = d.notes.filter((n) => (!sceneFilter || n.sceneId === sceneFilter) && (!catFilter || n.cat === catFilter) && (!q || n.text.toLowerCase().includes(q) || n.take.toLowerCase().includes(q)));
    if (!shown.length) {
      wrap.append(el('div', { class: 'empty' }, d.notes.length ? 'No notes match.' : 'No continuity notes yet. Add a note for what has to match between takes and scenes (wardrobe, props, hair, blocking…) with photos from set. Paste a picture into a note, or use 📷.'));
      return wrap;
    }
    // Grouped by scene, in script order.
    const order = new Map(prod.scenes.map((sc, i) => [sc.id, i]));
    const groups = [...new Set(shown.map((n) => n.sceneId))].sort((a, b) => (order.has(a) ? order.get(a) : 1e9) - (order.has(b) ? order.get(b) : 1e9));
    for (const sid of groups) {
      const sc = sceneById(sid);
      wrap.append(el('h2', { class: 'section-title' }, sc ? `${sceneCode(sc)} · ${sc.heading || 'Untitled scene'}` : 'No scene'),
        el('div', { class: 'cn-grid' }, ...shown.filter((n) => n.sceneId === sid).sort((a, b) => b.at - a.at).map((n) => noteCard(d, n, sceneOptions))));
    }
    return wrap;
  }

  function noteCard(d, n, sceneOptions) {
    const c = OF.noteCat(n.cat);
    const sc = sceneById(n.sceneId);
    const scene = el('select', { class: 'field', disabled: ro(), onchange: (e) => { n.sceneId = e.target.value; n.shotId = ''; save(); render({ keepScroll: true }); } }, el('option', { value: '' }, 'No scene'), ...sceneOptions());
    scene.value = n.sceneId;
    const shot = el('select', { class: 'field', disabled: ro(), onchange: (e) => { n.shotId = e.target.value; save(); } },
      el('option', { value: '' }, 'Any shot'), ...(sc ? sc.shots.map((s, i) => el('option', { value: s.id }, `${sceneCode(sc)}${SF.shotLetter(i)} ${s.type || ''}`)) : []));
    shot.value = n.shotId;
    const cat = el('select', { class: 'field cn-cat', style: `border-color:${c.color};color:${c.color}`, disabled: ro(), onchange: (e) => { n.cat = e.target.value; save(); render({ keepScroll: true }); } },
      ...OF.NOTE_CATS.map((x) => el('option', { value: x.id }, x.label)));
    cat.value = n.cat;
    const file = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: (e) => addPhotos(n, e.target.files) });
    const thumbs = el('div', { class: 'cn-photos' }, ...n.photos.map((id) => {
      const img = el('img', { class: 'cn-thumb', alt: 'Continuity photo', title: 'Click to enlarge', onclick: () => lightbox(id) });
      photoUrl(id).then((u) => { if (u) img.src = u; else img.classList.add('missing'); });
      return el('span', { class: 'cn-photo' }, img, ro() ? null : el('button', { class: 'cn-del', type: 'button', title: 'Delete photo', onclick: () => removePhoto(n, id) }, '✕'));
    }), ro() ? null : el('button', { class: 'cn-add', type: 'button', title: 'Add photos', onclick: () => file.click() }, '📷'), file);
    return el('article', { class: 'cn-card', 'data-note': n.id, style: `border-left-color:${c.color}` },
      el('div', { class: 'cn-top' }, cat, scene, shot,
        el('input', { class: 'field cn-take', value: n.take, placeholder: 'Take', disabled: ro(), oninput: (e) => { n.take = e.target.value; save(); } })),
      el('textarea', { class: 'field', rows: 3, placeholder: 'What has to match: e.g. jacket open, coffee half full, left hand', disabled: ro(),
        oninput: (e) => { n.text = e.target.value; save(); },
        onpaste: (e) => { const files = [...(e.clipboardData || {}).files || []]; if (files.length && !ro()) { e.preventDefault(); addPhotos(n, files); } } }, n.text),
      thumbs,
      el('div', { class: 'cn-foot muted small' }, [n.by, n.at ? new Date(n.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''].filter(Boolean).join(' · '),
        ro() ? null : el('button', { class: 'icon-btn del', type: 'button', title: 'Delete note', onclick: async () => {
          if (!confirm('Delete this note' + (n.photos.length ? ' and its photos' : '') + '?')) return;
          d.notes = d.notes.filter((x) => x !== n); save(); render({ keepScroll: true });
          for (const id of n.photos) { try { if (cloudDocId()) await window.Cloud.deletePhoto(cloudDocId(), id); else await api.deletePhoto(id); } catch { /* already gone */ } }
        } }, '✕')));
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
    if (prod) { $('title').textContent = prod.title; document.title = `${prod.title} — On Set`; }
    const sections = $('sections');
    if (message) { sections.replaceChildren(el('div', { class: 'empty' }, message)); return; }
    if (!d || !prod) { sections.replaceChildren(el('div', { class: 'empty' }, 'Opening…')); return; }
    // Typing in a field isn't interrupted by someone else's edit.
    const a = document.activeElement;
    if (remote && a && sections.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName)) return;
    sections.replaceChildren(view === 'continuity' ? renderContinuity(d) : renderReport(d));
    if (keepScroll) sheet.scrollTop = top;
  }

  async function exportPdf() {
    const name = window.Common.safeFileName(prod.title, 'on set');
    const day = pickDay();
    const saved = await api.exportPdf({ defaultName: view === 'continuity' ? `${name} - Continuity.pdf` : `${name} - Production report${day ? ' Day ' + (sortedDays().indexOf(day) + 1) : ''}.pdf` });
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
  async function loadPost() {
    const data = (await api.loadStore('post')) || {};
    const local = (data.docs || []).find((x) => x.productionId === prod.id);
    if (local) { post = local; return; }
    if (!cloudProd) { post = null; return; }
    const kids = await window.Cloud.projects('post', prod.id).catch(() => []);
    post = kids.length ? await window.Cloud.doc(kids[0].id).catch(() => null) : null;
  }
  async function openOnset() {
    if (!cloudProd) {
      let d = state.docs.find((x) => x.productionId === prod.id && !x._cloud);
      if (!d) { d = OF.newOnset(prod.id); state.docs.push(d); store.save(); }
      state.activeId = d.id;
      return;
    }
    await collab.refreshList();
    if (collab.shared.length) { collab.open(collab.shared[0].id); return; }
    try {
      const project = await window.Cloud.createProject('onset', OF.newOnset(prod.id), { parent: prod.id });
      await collab.refreshList();
      collab.open(project.id);
    } catch (err) {
      message = err.status === 403 ? 'No reports or notes yet. They appear here once someone who can edit the production opens On Set.' : err.message;
    }
  }

  function wire() {
    $('homeBtn').addEventListener('click', () => P.goHome(store));
    document.querySelectorAll('#viewToggle button').forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; render(); $('sheet').scrollTop = 0; }));
    $('exportPdf').addEventListener('click', exportPdf);
    window.addEventListener('focus', async () => { try { await loadProduction(); await loadPost(); } catch { /* offline */ } });
    // Split screen: the production or the take log changed beside this page.
    window.Common.onStoreChanged('shotsheets', async () => { if (!cloudProd) { await loadProduction(); render({ keepScroll: true, remote: true }); } });
    window.Common.onStoreChanged('post', async () => { await loadPost(); render({ keepScroll: true, remote: true }); });
    api.onMenu((channel) => {
      ({
        home: () => P.goHome(store),
        export: exportPdf,
        undo: () => active() && undoUi.run(false, true),
        redo: () => active() && undoUi.run(true, true),
      }[channel] || (() => {}))();
    });
  }

  async function init() {
    await P.migrate();
    if (!P.id()) { P.goPicker(); return; }
    const params = new URLSearchParams(location.search);
    if (params.get('view') === 'continuity') view = 'continuity';
    if (params.get('day')) dayId = params.get('day');
    try { await loadProduction(); } catch { P.goPicker(); return; }
    const stored = await api.loadStore('onset');
    state = { ...(stored || {}), docs: (stored && Array.isArray(stored.docs) ? stored.docs : []).map(OF.normalizeOnset) };
    wire();
    collab.mountToolbar(document.querySelector('.toolbar'), document.querySelector('.menu-wrap'));
    collab.init();
    await loadPost().catch(() => {});
    await openOnset();
    render();
    window.Common.initUpdates();
  }

  init();
})();
