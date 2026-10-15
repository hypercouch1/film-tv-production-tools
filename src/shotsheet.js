(function () {
  const { api, uid, $, mod, fmt, el, toast, relTime } = window.Common;
  const F = window.ShotFormats;
  const { OPTIONS, shotLetter } = F;
  const safeFileName = (s) => window.Common.safeFileName(s, 'shot-sheet');

  let state = { projects: [], activeId: null, sidebarHidden: false };
  let view = 'shots';          // 'shots' | 'schedule'
  let editing = false;
  let dayFilter = 'all';       // 'all' | 'none' | <dayId>
  let calMonth = null;         // { y, m } shown in the schedule calendar
  let selectedDate = null;     // 'YYYY-MM-DD' selected in the schedule
  let history = [];
  let search = '';

  // Shared (cloud) projects live on the server, so only local projects are saved here.
  const store = window.Common.createStore('shotsheets', () => ({ ...state, projects: collab.localOnly(state.projects) }));
  const active = () => state.projects.find((p) => p.id === state.activeId);
  function save() {
    const p = active();
    if (p) p.updatedAt = Date.now();
    store.save();
    collab.changed();
  }

  // ---------- Collaboration ----------
  const collab = window.Collab.attach({
    kind: 'shotsheet',
    listKey: 'projects',
    noun: 'project',
    nounPlural: 'projects',
    getState: () => state,
    render: (opts = {}) => {
      if (opts.opened) { dayFilter = 'all'; history = []; selectedDate = null; calMonth = null; editing = false; }
      render(opts);
      if (opts.opened) $('sheet').scrollTop = 0;
    },
    renderSidebar: () => renderSidebar(),
    save: () => store.save(),
    normalize: (doc) => {
      doc.title = String(doc.title || 'Untitled');
      doc.scenes = Array.isArray(doc.scenes) ? doc.scenes : [];
      doc.scenes.forEach((s) => { s.shots = Array.isArray(s.shots) ? s.shots : []; });
      doc.days = Array.isArray(doc.days) ? doc.days : [];
      return doc;
    },
    selectLocal: () => selectFirstLocal(),
    onRoleChange: (role) => { if (role === 'viewer') editing = false; },
  });

  function selectFirstLocal() {
    if (!collab.localOnly(state.projects).length) state.projects.push(blankProject());
    editing = false;
    selectProject(collab.localOnly(state.projects).sort((a, b) => b.updatedAt - a.updatedAt)[0].id);
  }

  // Viewers can watch a shared project but not change it.
  function blockedReadOnly() {
    if (!collab.readOnly()) return false;
    toast('You have view-only access to this project');
    return true;
  }

  // ---------- Dates ----------
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = (s) => new Date(s + 'T00:00');
  const todayStr = () => ymd(new Date());
  const fmtDate = (s, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => parseYmd(s).toLocaleDateString(undefined, opts);
  const fmtTime = (t) => (t ? new Date(`2000-01-01T${t}`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');

  // ---------- Model helpers ----------
  const sortedDays = (p) => [...p.days].sort((a, b) => a.date.localeCompare(b.date));
  const dayById = (p, id) => p.days.find((d) => d.id === id);
  const dayOnDate = (p, date) => p.days.find((d) => d.date === date);
  const dayNum = (p, id) => sortedDays(p).findIndex((d) => d.id === id) + 1;

  function allShots(p) {
    return p.scenes.flatMap((sc) => sc.shots.map((shot, i) => ({ shot, scene: sc, code: sc.number + shotLetter(i) })));
  }
  function matchesFilter(shot) {
    if (dayFilter === 'all') return true;
    if (dayFilter === 'none') return !shot.dayId;
    return shot.dayId === dayFilter;
  }
  const visibleShots = (p) => allShots(p).filter((x) => matchesFilter(x.shot));
  const currentShot = (p) => { const x = visibleShots(p).find((v) => !v.shot.done); return x ? x.shot : null; };
  const typeName = (abbr) => (OPTIONS.type.find(([a]) => a === abbr) || [abbr, abbr])[1];

  // ---------- Sample ----------
  function sampleProject() {
    const base = new Date(); base.setDate(base.getDate() + 7);
    const d1 = ymd(base); base.setDate(base.getDate() + 1); const d2 = ymd(base);
    const S = (type, desc, extra = {}) => ({ type, desc, ...extra });
    return F.normalizeProject({
      title: 'Night Diner',
      days: [
        { date: d1, call: '07:00', wrap: '19:00', location: 'Rosie’s Diner, 4th St', notes: 'Practical neons on by 6:30.' },
        { date: d2, call: '16:00', wrap: '02:00', location: 'Parking lot behind diner', notes: 'Night exterior — rain tower booked.' },
      ],
      scenes: [
        { number: '1', heading: 'EXT. DINER - NIGHT', shots: [
          S('EST', 'Diner sign flickers, rain on the window', { move: 'Crane', lens: '24mm', day: d2, audio: 'MOS' }),
          S('WS', 'Maya crosses the lot toward the door', { move: 'Tracking', lens: '35mm', day: d2 }),
          S('CU', 'Her hand hesitates on the *door handle*', { lens: '85mm', day: d2, audio: 'MOS' }),
        ] },
        { number: '2', heading: 'INT. DINER - NIGHT', shots: [
          S('WS', 'Master — Maya enters, Lou behind counter', { lens: '24mm', day: d1 }),
          S('MS', 'Lou pours coffee without looking up', { day: d1 }),
          S('OTS', 'Over Lou onto Maya', { lens: '50mm', day: d1 }),
          S('OTS', 'Over Maya onto Lou', { lens: '50mm', cam: 'B', day: d1 }),
          S('MCU', 'Maya: "You still make it too strong."', { move: 'Push In', lens: '50mm', day: d1 }),
          S('INS', 'Coffee mug slides across counter', { angle: 'High', lens: '100mm', fps: '48', audio: 'MOS', day: d1 }),
        ] },
        { number: '3', heading: 'INT. DINER - BOOTH - LATER', shots: [
          S('2S', 'Maya and Lou in the booth', { lens: '35mm' }),
          S('ECU', 'Lou’s eyes — the truth lands', { lens: '135mm', angle: 'Low' }),
          S('POV', 'Maya’s POV through rain-streaked glass', { move: 'Handheld' }),
        ] },
      ],
    }, 'Night Diner');
  }

  function blankProject() {
    return F.normalizeProject({ title: 'New Project', scenes: [{ number: '1', heading: 'INT. LOCATION - DAY', shots: [{}] }] });
  }

  // ---------- Sidebar ----------
  function renderSidebar() {
    $('app').classList.toggle('sidebar-hidden', state.sidebarHidden);
    const list = $('list');
    list.innerHTML = '';
    const q = search.toLowerCase();
    collab.localOnly(state.projects)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((p) => !q || p.title.toLowerCase().includes(q))
      .forEach((p) => {
        const shots = allShots(p);
        const next = sortedDays(p).find((d) => d.date >= todayStr());
        list.append(el('li', {
          class: p.id === state.activeId ? 'active' : '',
          onclick: () => selectProject(p.id),
        },
        el('div', { class: 'name' }, p.title || 'Untitled'),
        el('div', { class: 'meta' },
          `${shots.filter((x) => x.shot.done).length}/${shots.length} shots · ` +
          (next ? 'next ' + fmtDate(next.date, { month: 'short', day: 'numeric' }) : relTime(p.updatedAt)))));
      });
    collab.renderShared($('sharedList'));
  }

  // Selects a project on this computer (shared ones are opened through collab.open).
  function selectProject(id) {
    collab.leave();
    state.activeId = id;
    dayFilter = 'all';
    history = [];
    selectedDate = null;
    calMonth = null;
    save();
    render();
    $('sheet').scrollTop = 0;
  }

  // ---------- Header ----------
  function renderHeader(p) {
    const vis = visibleShots(p);
    const done = vis.filter((x) => x.shot.done).length;
    $('title').textContent = p.title;
    $('title').hidden = editing;
    const ti = $('titleInput');
    ti.hidden = !editing;
    if (editing && document.activeElement !== ti) ti.value = p.title;
    const counter = $('counter');
    counter.textContent = `${done}/${vis.length}`;
    counter.classList.toggle('complete', vis.length > 0 && done === vis.length);
    counter.hidden = view === 'schedule' || editing;

    // Shoot day filter chips
    const bar = $('daybar');
    bar.innerHTML = '';
    bar.hidden = view !== 'shots' || editing;
    const chip = (key, label, sub) => bar.append(el('button', {
      class: 'day-chip' + (dayFilter === key ? ' active' : ''),
      onclick: () => { dayFilter = key; history = []; render(); $('sheet').scrollTop = 0; },
    }, label, sub ? el('span', { class: 'chip-sub' }, sub) : null));
    chip('all', 'ALL SHOTS');
    sortedDays(p).forEach((d, i) => chip(d.id, `DAY ${i + 1}`, fmtDate(d.date)));
    if (allShots(p).some((x) => !x.shot.dayId) && p.days.length) chip('none', 'UNSCHEDULED');

    // Info line for the filtered day (also shows on PDFs)
    const info = $('dayInfo');
    const day = view === 'shots' && !editing && dayById(p, dayFilter);
    info.hidden = !day;
    if (day) {
      info.innerHTML = '';
      info.append(...[
        el('strong', {}, `DAY ${dayNum(p, day.id)}`),
        fmtDate(day.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
        day.call && `Call ${fmtTime(day.call)}`,
        day.wrap && `Wrap ${fmtTime(day.wrap)}`,
        day.location,
      ].filter(Boolean).flatMap((x, i) => (i ? [el('span', { class: 'sep' }, '·'), x] : [x])));
    }

    // Scene tabs
    const tabs = $('tabs');
    tabs.innerHTML = '';
    tabs.hidden = view !== 'shots';
    p.scenes.forEach((s) => {
      const shots = s.shots.filter(matchesFilter);
      if (!editing && !shots.length) return;
      tabs.append(el('button', {
        class: 'tab' + (shots.length && shots.every((x) => x.done) ? ' done' : ''),
        'data-sec': s.id,
        title: s.heading,
        onclick: () => scrollToSection(s.id),
      }, `SC ${s.number}`));
    });
    updateActiveTab();
  }

  // ---------- Shot list: run mode ----------
  function shotMeta(p, shot) {
    const parts = [shot.angle, shot.move, shot.lens, `Cam ${shot.cam}`];
    if (shot.fps && shot.fps !== '24') parts.push(shot.fps + ' fps');
    if (shot.audio && shot.audio !== 'Sync') parts.push(shot.audio);
    if (dayFilter === 'all' && p.days.length) {
      const d = dayById(p, shot.dayId);
      parts.push(d ? `Day ${dayNum(p, d.id)} · ${fmtDate(d.date, { month: 'short', day: 'numeric' })}` : 'Unscheduled');
    }
    return parts.filter(Boolean).join('  ·  ');
  }

  function renderRun(p) {
    const wrap = $('sections');
    wrap.innerHTML = '';
    const cur = currentShot(p);
    let any = false;
    for (const s of p.scenes) {
      const ul = el('ul', { class: 'items' });
      s.shots.forEach((shot, i) => {
        if (!matchesFilter(shot)) return;
        any = true;
        ul.append(el('li', {
          class: 'item shot' + (shot.done ? ' checked' : '') + (cur === shot ? ' current' : ''),
          onclick: () => toggleShot(shot),
        },
        el('span', { class: 'box' }),
        el('span', { class: 'shot-code' }, s.number + shotLetter(i)),
        el('span', { class: 'type-chip', title: typeName(shot.type) }, shot.type),
        el('div', { class: 'shot-body' },
          el('div', { class: 'item-text', html: shot.desc ? fmt(shot.desc) : '<span class="muted">No description</span>' }),
          el('div', { class: 'shot-meta' }, shotMeta(p, shot)),
          shot.notes ? el('div', { class: 'shot-notes' }, shot.notes) : null)));
      });
      if (!ul.children.length) continue;
      wrap.append(el('section', { class: 'section', id: 'sec-' + s.id },
        el('h2', { class: 'section-title' }, `SCENE ${s.number}`, el('span', { class: 'scene-heading' }, s.heading)),
        ul));
    }
    if (!any) {
      wrap.append(el('div', { class: 'empty' },
        dayFilter === 'all' ? 'No shots yet. Click Edit to add scenes and shots.'
          : 'No shots on this day yet. Assign shots from the Schedule view or in Edit mode.'));
    }
  }

  function toggleShot(shot) {
    if (blockedReadOnly()) return;
    shot.done = !shot.done;
    if (shot.done) history.push(shot.id);
    else history = history.filter((id) => id !== shot.id);
    save();
    render({ keepScroll: true });
  }

  function checkNext() {
    const p = active();
    const s = p && currentShot(p);
    if (!s) return;
    toggleShot(s);
    scrollToCurrent();
  }

  function undoLast() {
    const p = active();
    if (!p || blockedReadOnly()) return;
    const shots = visibleShots(p).map((x) => x.shot);
    let s = null;
    while (history.length && !s) {
      const id = history.pop();
      s = shots.find((x) => x.id === id && x.done) || null;
    }
    if (!s) s = [...shots].reverse().find((x) => x.done) || null;
    if (!s) return;
    s.done = false;
    save();
    render({ keepScroll: true });
    scrollToCurrent();
  }

  function scrollToCurrent() {
    const n = document.querySelector('.item.current');
    if (n) n.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function scrollToSection(id) {
    const n = document.getElementById('sec-' + id);
    if (n) n.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function updateActiveTab() {
    const sheetEl = $('sheet');
    const secs = [...document.querySelectorAll('.section, .edit-section')];
    if (!secs.length) return;
    const headerBottom = document.querySelector('.sheet-header').getBoundingClientRect().bottom;
    let id = secs[0].id.replace(/^sec-/, '');
    for (const s of secs) if (s.getBoundingClientRect().top <= headerBottom + 40) id = s.id.replace(/^sec-/, '');
    if (sheetEl.scrollTop + sheetEl.clientHeight >= sheetEl.scrollHeight - 4) id = secs[secs.length - 1].id.replace(/^sec-/, '');
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.sec === id));
  }

  // ---------- Shot list: edit mode ----------
  let dragData = null;

  function select(options, value, onchange, cls = '') {
    const s = el('select', { class: 'field ' + cls, onchange: (e) => onchange(e.target.value) });
    for (const o of options) {
      const [v, label] = Array.isArray(o) ? o : [o, o];
      s.append(el('option', { value: v }, label));
    }
    // Keep unknown imported values selectable.
    if (value && ![...s.options].some((o) => o.value === value)) s.append(el('option', { value }, value));
    s.value = value || '';
    return s;
  }

  function labeled(label, input) {
    return el('label', { class: 'field-wrap' }, el('span', { class: 'field-label' }, label), input);
  }

  function renderEdit(p) {
    const wrap = $('sections');
    wrap.innerHTML = '';
    wrap.append(el('div', { class: 'edit-help', html:
      'Shots are numbered automatically (scene + letter). Wrap words in asterisks to highlight them — <code>*door handle*</code> shows as <mark>door handle</mark>. ' +
      'Enter in a description adds the next shot with the same settings. Drag ⠿ to reorder.' }));

    const dayOptions = [['', 'Unscheduled'], ...sortedDays(p).map((d, i) => [d.id, `Day ${i + 1} · ${fmtDate(d.date)}`])];

    p.scenes.forEach((s, sIdx) => {
      const shotsWrap = el('div', { class: 'edit-items' });
      s.shots.forEach((shot, i) => shotsWrap.append(editShotRow(p, s, shot, i, dayOptions)));
      shotsWrap.addEventListener('dragover', (e) => { if (dragData) e.preventDefault(); });
      shotsWrap.addEventListener('drop', (e) => {
        if (!dragData || e.target !== shotsWrap) return;
        e.preventDefault();
        moveShot(dragData, s, s.shots.length);
      });

      wrap.append(el('div', { class: 'edit-section', id: 'sec-' + s.id },
        el('div', { class: 'edit-row' },
          el('span', { class: 'scene-label' }, 'SC'),
          el('input', {
            class: 'edit-input section-input scene-num', value: s.number, title: 'Scene number',
            oninput: (e) => { s.number = e.target.value.trim(); save(); renderHeader(p); refreshCodes(s); },
          }),
          el('input', {
            class: 'edit-input section-input', value: s.heading, placeholder: 'INT. LOCATION - DAY',
            oninput: (e) => { s.heading = e.target.value; save(); },
          }),
          el('button', { class: 'icon-btn', title: 'Move up', onclick: () => moveScene(sIdx, -1) }, '↑'),
          el('button', { class: 'icon-btn', title: 'Move down', onclick: () => moveScene(sIdx, 1) }, '↓'),
          el('button', { class: 'icon-btn del', title: 'Delete scene', onclick: () => {
            if (s.shots.length && !confirm(`Delete scene ${s.number} and its ${s.shots.length} shots?`)) return;
            p.scenes.splice(sIdx, 1); save(); render({ keepScroll: true });
          } }, '✕')),
        shotsWrap,
        el('button', { class: 'add-btn', onclick: () => {
          const n = F.newShot(s.shots[s.shots.length - 1]);
          s.shots.push(n); save(); render({ keepScroll: true }); focusShot(n.id);
        } }, '+ Add shot')));
    });

    wrap.append(el('button', { class: 'add-section-btn', onclick: () => {
      const nums = p.scenes.map((s) => parseInt(s.number, 10)).filter((n) => !isNaN(n));
      const s = { id: uid(), number: String(nums.length ? Math.max(...nums) + 1 : 1), heading: '', shots: [F.newShot()] };
      p.scenes.push(s); save(); render({ keepScroll: true });
      const inp = document.querySelector(`#sec-${s.id} .section-input:not(.scene-num)`);
      if (inp) { inp.scrollIntoView({ block: 'center' }); inp.focus(); }
    } }, '+ ADD SCENE'));
  }

  // Update the auto shot codes in place after a scene number edit (keeps input focus).
  function refreshCodes(s) {
    document.querySelectorAll(`#sec-${s.id} .shot-edit .shot-code`).forEach((n, i) => (n.textContent = s.number + shotLetter(i)));
  }

  function editShotRow(p, s, shot, i, dayOptions) {
    const set = (k) => (v) => { shot[k] = v; save(); };
    const row = el('div', { class: 'shot-edit edit-row', 'data-shot': shot.id },
      el('div', { class: 'shot-edit-main' },
        el('span', { class: 'drag', title: 'Drag to reorder shot' }, '⠿'),
        el('span', { class: 'shot-code' }, s.number + shotLetter(i)),
        select(OPTIONS.type.map(([a, n]) => [a, `${a} — ${n}`]), shot.type, set('type'), 'type-select'),
        el('input', {
          class: 'edit-input desc-input', value: shot.desc, placeholder: 'What happens in the shot',
          oninput: (e) => { shot.desc = e.target.value; save(); },
          onkeydown: (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const n = F.newShot(shot);
              s.shots.splice(i + 1, 0, n); save(); render({ keepScroll: true }); focusShot(n.id);
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              const inputs = [...document.querySelectorAll('.desc-input')];
              const next = inputs[inputs.indexOf(e.target) + (e.key === 'ArrowUp' ? -1 : 1)];
              if (next) { e.preventDefault(); next.focus(); }
            }
          },
        }),
        el('button', { class: 'icon-btn', title: 'Duplicate shot', onclick: () => {
          const n = { ...shot, id: uid(), done: false };
          s.shots.splice(i + 1, 0, n); save(); render({ keepScroll: true });
        } }, '⧉'),
        el('button', { class: 'icon-btn del', title: 'Delete shot', onclick: () => {
          s.shots.splice(i, 1); save(); render({ keepScroll: true });
        } }, '✕')),
      el('div', { class: 'shot-fields' },
        labeled('Angle', select(OPTIONS.angle, shot.angle, set('angle'))),
        labeled('Movement', select(OPTIONS.move, shot.move, set('move'))),
        labeled('Lens', el('input', { class: 'field', list: 'lensList', value: shot.lens, placeholder: '35mm', oninput: (e) => set('lens')(e.target.value) })),
        labeled('Cam', select(OPTIONS.cam, shot.cam, set('cam'))),
        labeled('FPS', select(OPTIONS.fps, shot.fps, set('fps'))),
        labeled('Audio', select(OPTIONS.audio, shot.audio, set('audio'))),
        labeled('Shoot day', select(dayOptions, shot.dayId || '', (v) => { shot.dayId = v || null; save(); })),
        labeled('Notes', el('input', { class: 'field notes-field', value: shot.notes, placeholder: 'Props, VFX, talent…', oninput: (e) => set('notes')(e.target.value) }))));

    const handle = row.querySelector('.drag');
    handle.addEventListener('mousedown', () => (row.draggable = true));
    row.addEventListener('mouseup', () => (row.draggable = false));
    row.addEventListener('dragstart', (e) => { dragData = { sec: s, idx: i }; e.dataTransfer.effectAllowed = 'move'; });
    row.addEventListener('dragend', () => { row.draggable = false; dragData = null; });
    row.addEventListener('dragover', (e) => { if (dragData) { e.preventDefault(); row.classList.add('drag-over'); } });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (e) => {
      row.classList.remove('drag-over');
      if (!dragData) return;
      e.preventDefault(); e.stopPropagation();
      moveShot(dragData, s, i);
    });
    return row;
  }

  function moveShot(from, toSec, toIdx) {
    const [moved] = from.sec.shots.splice(from.idx, 1);
    if (from.sec === toSec && from.idx < toIdx) toIdx--;
    toSec.shots.splice(toIdx, 0, moved);
    save(); render({ keepScroll: true });
  }

  function moveScene(idx, dir) {
    const p = active();
    const to = idx + dir;
    if (to < 0 || to >= p.scenes.length) return;
    const [s] = p.scenes.splice(idx, 1);
    p.scenes.splice(to, 0, s);
    save(); render({ keepScroll: true });
  }

  function focusShot(id) {
    const inp = document.querySelector(`.shot-edit[data-shot="${id}"] .desc-input`);
    if (inp) { inp.focus(); inp.scrollIntoView({ block: 'nearest' }); }
  }

  // ---------- Schedule ----------
  function renderSchedule(p) {
    const wrap = $('sections');
    wrap.innerHTML = '';
    if (!calMonth) {
      const next = sortedDays(p).find((d) => d.date >= todayStr()) || sortedDays(p)[0];
      const d = next ? parseYmd(next.date) : new Date();
      calMonth = { y: d.getFullYear(), m: d.getMonth() };
      if (!selectedDate) selectedDate = next ? next.date : todayStr();
    }
    wrap.append(el('div', { class: 'schedule' },
      el('div', { class: 'cal-col' }, renderCalendar(p), renderDayList(p)),
      renderDayPanel(p)));
  }

  function renderCalendar(p) {
    const { y, m } = calMonth;
    const first = new Date(y, m, 1);
    const start = new Date(y, m, 1 - first.getDay());
    const shift = (n) => { const d = new Date(y, m + n, 1); calMonth = { y: d.getFullYear(), m: d.getMonth() }; render({ keepScroll: true }); };
    const grid = el('div', { class: 'cal-grid' });
    for (let i = 0; i < 7; i++) {
      grid.append(el('div', { class: 'cal-dow' }, new Date(2026, 1, i + 1).toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()));
    }
    const days = sortedDays(p);
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const date = ymd(d);
      const shoot = days.find((x) => x.date === date);
      const shotCount = shoot ? allShots(p).filter((x) => x.shot.dayId === shoot.id).length : 0;
      grid.append(el('button', {
        class: 'cal-cell' + (d.getMonth() !== m ? ' other' : '') + (date === todayStr() ? ' today' : '') +
          (date === selectedDate ? ' selected' : '') + (shoot ? ' shoot' : ''),
        onclick: () => { selectedDate = date; if (d.getMonth() !== m) calMonth = { y: d.getFullYear(), m: d.getMonth() }; render({ keepScroll: true }); },
        ondblclick: () => { if (!shoot) addDay(date); },
      },
      el('span', { class: 'cal-num' }, String(d.getDate())),
      shoot ? el('span', { class: 'cal-badge' }, `DAY ${days.indexOf(shoot) + 1}`) : null,
      shoot ? el('span', { class: 'cal-sub' }, `${shotCount} shot${shotCount === 1 ? '' : 's'}${shoot.call ? ' · ' + fmtTime(shoot.call) : ''}`) : null));
    }
    return el('div', { class: 'calendar' },
      el('div', { class: 'cal-head' },
        el('button', { class: 'icon-btn', title: 'Previous month', onclick: () => shift(-1) }, '‹'),
        el('div', { class: 'cal-title' }, first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }).toUpperCase()),
        el('button', { class: 'icon-btn', title: 'Next month', onclick: () => shift(1) }, '›'),
        el('button', { class: 'ghost-btn', onclick: () => {
          const t = new Date(); calMonth = { y: t.getFullYear(), m: t.getMonth() }; selectedDate = todayStr(); render({ keepScroll: true });
        } }, 'Today')),
      grid,
      el('div', { class: 'cal-tip' }, 'Click a date to select it · double-click an empty date to schedule a shoot day'));
  }

  function renderDayList(p) {
    const days = sortedDays(p);
    const all = allShots(p);
    const unscheduled = all.filter((x) => !x.shot.dayId).length;
    return el('div', { class: 'day-list' },
      el('h3', { class: 'panel-title' }, `SHOOT DAYS (${days.length})`),
      days.length ? null : el('div', { class: 'muted small' }, 'No shoot days yet.'),
      ...days.map((d, i) => {
        const shots = all.filter((x) => x.shot.dayId === d.id);
        const done = shots.filter((x) => x.shot.done).length;
        return el('button', {
          class: 'day-row' + (d.date === selectedDate ? ' active' : '') + (d.date < todayStr() ? ' past' : ''),
          onclick: () => { selectedDate = d.date; const dt = parseYmd(d.date); calMonth = { y: dt.getFullYear(), m: dt.getMonth() }; render({ keepScroll: true }); },
        },
        el('span', { class: 'day-row-num' }, `DAY ${i + 1}`),
        el('span', { class: 'day-row-date' }, fmtDate(d.date)),
        el('span', { class: 'day-row-loc' }, d.location || ''),
        el('span', { class: 'day-row-count' }, `${done}/${shots.length}`));
      }),
      unscheduled ? el('div', { class: 'muted small unsched-note' }, `${unscheduled} shot${unscheduled === 1 ? '' : 's'} not scheduled yet`) : null);
  }

  function addDay(date) {
    const p = active();
    if (dayOnDate(p, date) || blockedReadOnly()) return;
    p.days.push({ id: uid(), date, call: '07:00', wrap: '', location: '', notes: '' });
    selectedDate = date;
    save(); render({ keepScroll: true });
    toast(`Shoot day added for ${fmtDate(date)}`);
  }

  function renderDayPanel(p) {
    const date = selectedDate;
    const day = dayOnDate(p, date);
    const panel = el('div', { class: 'day-panel' });
    if (!day) {
      panel.append(
        el('div', { class: 'panel-date' }, fmtDate(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })),
        el('p', { class: 'muted' }, 'No shoot scheduled on this date.'),
        el('button', { class: 'primary-btn wide', onclick: () => addDay(date) }, '+ Schedule shoot day'));
      return panel;
    }
    const n = dayNum(p, day.id);
    const all = allShots(p);
    const mine = all.filter((x) => x.shot.dayId === day.id);
    const free = all.filter((x) => !x.shot.dayId);
    const upd = (k) => (e) => { day[k] = e.target.value; save(); renderSidebar(); refreshCalendarOnly(p); };

    panel.append(...[
      el('div', { class: 'panel-head' },
        el('div', {},
          el('div', { class: 'panel-day' }, `DAY ${n}`),
          el('div', { class: 'panel-date' }, fmtDate(day.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))),
        el('button', { class: 'primary-btn', title: 'Open this day as a checklist', onclick: () => {
          dayFilter = day.id; view = 'shots'; editing = false; history = []; render(); $('sheet').scrollTop = 0;
        } }, 'Run day ▶')),
      el('div', { class: 'day-fields' },
        labeled('Date', el('input', { class: 'field', type: 'date', value: day.date, onchange: (e) => {
          const v = e.target.value;
          if (!v) return;
          if (dayOnDate(p, v) && v !== day.date) { toast('There is already a shoot day on that date'); e.target.value = day.date; return; }
          day.date = v; selectedDate = v; const dt = parseYmd(v); calMonth = { y: dt.getFullYear(), m: dt.getMonth() };
          save(); render({ keepScroll: true });
        } })),
        labeled('Call', el('input', { class: 'field', type: 'time', value: day.call, oninput: upd('call') })),
        labeled('Wrap', el('input', { class: 'field', type: 'time', value: day.wrap, oninput: upd('wrap') })),
        labeled('Location', el('input', { class: 'field', value: day.location, placeholder: 'Address or set', oninput: upd('location') })),
        labeled('Notes', el('textarea', { class: 'field', rows: 2, placeholder: 'Parking, weather backup, meals…', oninput: upd('notes') }, day.notes))),
      el('h3', { class: 'panel-title' }, `SHOTS THIS DAY (${mine.length})`),
      mine.length ? null : el('div', { class: 'muted small' }, 'Add shots from the list below.'),
      el('ul', { class: 'mini-list' }, ...mine.map((x) => miniShot(x, '✕', 'Remove from this day', () => { x.shot.dayId = null; save(); render({ keepScroll: true }); }))),
      el('h3', { class: 'panel-title' }, `UNSCHEDULED (${free.length})`),
      free.length ? null : el('div', { class: 'muted small' }, 'Every shot is scheduled.'),
      ...groupByScene(free).map(([scene, items]) => el('div', { class: 'mini-group' },
        el('div', { class: 'mini-group-head' },
          el('span', {}, `SC ${scene.number}`, el('span', { class: 'muted' }, ' ' + scene.heading)),
          el('button', { class: 'link-btn', onclick: () => { items.forEach((x) => (x.shot.dayId = day.id)); save(); render({ keepScroll: true }); } }, '+ all')),
        el('ul', { class: 'mini-list' }, ...items.map((x) => miniShot(x, '+', 'Add to this day', () => { x.shot.dayId = day.id; save(); render({ keepScroll: true }); }))))),
      el('button', { class: 'ghost-btn danger wide del-day', onclick: () => {
        if (!confirm(`Delete Day ${n} (${fmtDate(day.date)})? Its shots become unscheduled.`)) return;
        p.days = p.days.filter((d) => d.id !== day.id);
        all.forEach((x) => { if (x.shot.dayId === day.id) x.shot.dayId = null; });
        if (dayFilter === day.id) dayFilter = 'all';
        save(); render({ keepScroll: true });
      } }, 'Delete shoot day')].filter(Boolean));
    return panel;
  }

  // Re-draw the calendar + day list without touching the panel being typed in.
  function refreshCalendarOnly(p) {
    const col = document.querySelector('.cal-col');
    if (!col) return;
    col.replaceChildren(renderCalendar(p), renderDayList(p));
  }

  function groupByScene(items) {
    const map = new Map();
    for (const x of items) {
      if (!map.has(x.scene)) map.set(x.scene, []);
      map.get(x.scene).push(x);
    }
    return [...map.entries()];
  }

  function miniShot(x, btn, title, onclick) {
    return el('li', { class: 'mini-shot' + (x.shot.done ? ' done' : '') },
      el('span', { class: 'shot-code small' }, x.code),
      el('span', { class: 'type-chip small', title: typeName(x.shot.type) }, x.shot.type),
      el('span', { class: 'mini-desc', html: x.shot.desc ? fmt(x.shot.desc) : '<span class="muted">No description</span>' }),
      el('button', { class: 'icon-btn mini-btn', title, onclick }, btn));
  }

  // ---------- Render ----------
  function render({ keepScroll = false } = {}) {
    const sheetEl = $('sheet');
    const top = sheetEl.scrollTop;
    renderSidebar();
    const p = active();
    document.querySelectorAll('#viewToggle button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    $('editBtn').textContent = editing ? 'Done' : 'Edit';
    $('editBtn').hidden = view !== 'shots' || collab.readOnly();
    $('resetBtn').hidden = editing || view !== 'shots' || collab.readOnly();
    $('app').classList.toggle('read-only', collab.readOnly());
    $('deleteLabel').textContent = collab.isCloud(p) ? (p._cloud.role === 'owner' ? 'Delete for everyone' : 'Leave shared project') : 'Delete project';
    collab.updateToolbar();
    $('app').classList.toggle('editing', editing);
    $('app').classList.toggle('schedule-view', view === 'schedule');
    if (!p) { $('sections').innerHTML = ''; return; }
    if (dayFilter !== 'all' && dayFilter !== 'none' && !dayById(p, dayFilter)) dayFilter = 'all';
    renderHeader(p);
    if (view === 'schedule') renderSchedule(p);
    else if (editing) renderEdit(p);
    else renderRun(p);
    $('hint').hidden = view !== 'shots';
    $('hint').innerHTML = editing
      ? `<kbd>${mod}+E</kbd> done editing`
      : '<kbd>Space</kbd> check next &nbsp; <kbd>⌫</kbd> undo &nbsp; <kbd>1–9</kbd> jump to scene';
    if (keepScroll) sheetEl.scrollTop = top;
    updateActiveTab();
  }

  function setView(v) {
    view = v;
    if (v === 'schedule') editing = false;
    render();
    $('sheet').scrollTop = 0;
  }

  // ---------- Actions ----------
  function addProject(p, { edit = false } = {}) {
    state.projects.push(p);
    selectProject(p.id);
    editing = edit;
    view = 'shots';
    render();
  }

  function newProject() {
    addProject(blankProject(), { edit: true });
    const t = $('titleInput'); t.focus(); t.select();
  }

  function duplicateProject() {
    const p = active();
    if (!p) return;
    const copy = F.normalizeProject(JSON.parse(F.toShotsheet(p)), p.title);
    copy.title = p.title + ' (copy)';
    allShots(copy).forEach((x) => (x.shot.done = false));
    addProject(copy);
    toast('Duplicated');
  }

  function deleteProject() {
    const p = active();
    if (!p) return;
    if (collab.isCloud(p)) return collab.deleteOrLeave(p);
    if (!confirm(`Delete "${p.title}"? This cannot be undone.`)) return;
    state.projects = state.projects.filter((x) => x.id !== p.id);
    selectFirstLocal();
  }

  function resetChecks() {
    const p = active();
    if (!p || blockedReadOnly()) return;
    visibleShots(p).forEach((x) => (x.shot.done = false));
    history = [];
    save(); render();
    $('sheet').scrollTop = 0;
    toast(dayFilter === 'all' ? 'All shots reset' : 'Shots in this view reset');
  }

  function toggleEdit() {
    if (!editing && blockedReadOnly()) return;
    if (view !== 'shots') { view = 'shots'; editing = true; }
    else editing = !editing;
    render({ keepScroll: true });
  }

  function ingest(files) {
    let added = 0, last = null;
    const errors = [];
    for (const f of files) {
      try {
        for (const p of F.importFile(f)) { state.projects.push(p); last = p; added++; }
      } catch (err) {
        errors.push(`${f.name}: ${err.message}`);
      }
    }
    if (last) { editing = false; view = 'shots'; selectProject(last.id); }
    if (errors.length) alert('Some files could not be imported:\n\n' + errors.join('\n'));
    else if (added) toast(`Imported ${added} project${added > 1 ? 's' : ''}`);
  }

  async function importFiles() {
    ingest(await api.importFiles({ label: 'Shot Sheets', extensions: ['shotsheet', 'json', 'csv'] }));
  }

  async function exportAs(kind) {
    const p = active();
    if (!p && kind !== 'all') return;
    const name = p ? safeFileName(p.title) : 'shot-sheets';
    let saved = null;
    if (kind === 'pdf') {
      const prev = { view, editing };
      view = 'shots'; editing = false; render();
      const suffix = dayById(p, dayFilter) ? ` - Day ${dayNum(p, dayFilter)}` : '';
      saved = await api.exportPdf({ defaultName: name + suffix + '.pdf' });
      view = prev.view; editing = prev.editing; render({ keepScroll: true });
    } else {
      const map = {
        shotsheet: { ext: 'shotsheet', label: 'Shot Sheet', content: () => F.toShotsheet(p) },
        csv: { ext: 'csv', label: 'CSV', content: () => F.toCSV(p) },
        ics: { ext: 'ics', label: 'Calendar', content: () => F.toICS(p) },
        all: { ext: 'json', label: 'JSON Backup', content: () => F.toBackup(state.projects), name: 'shot-sheets-backup' },
      }[kind];
      if (kind === 'ics' && !p.days.length) { toast('Add shoot days in the Schedule view first'); return; }
      saved = await api.exportFile({ defaultName: (map.name || name) + '.' + map.ext, ext: map.ext, label: map.label, content: map.content() });
    }
    if (saved) toast('Exported → ' + saved.split(/[\\/]/).pop());
  }

  // ---------- Events ----------
  function wire() {
    $('homeBtn').addEventListener('click', () => window.Common.goHome(store));
    $('newBtn').addEventListener('click', newProject);
    $('importBtn').addEventListener('click', importFiles);
    $('resetBtn').addEventListener('click', resetChecks);
    $('editBtn').addEventListener('click', toggleEdit);
    $('sidebarToggle').addEventListener('click', toggleSidebar);
    $('search').addEventListener('input', (e) => { search = e.target.value; renderSidebar(); });
    $('titleInput').addEventListener('input', (e) => { active().title = e.target.value; save(); renderSidebar(); });
    $('sheet').addEventListener('scroll', updateActiveTab, { passive: true });
    document.querySelectorAll('#viewToggle button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    window.Common.wireDropdowns();
    document.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => exportAs(b.dataset.export)));
    document.querySelector('[data-more="duplicate"]').addEventListener('click', duplicateProject);
    document.querySelector('[data-more="delete"]').addEventListener('click', deleteProject);
    window.Common.onFileDrop(ingest);

    const lens = $('lensList');
    OPTIONS.lens.forEach((l) => lens.append(el('option', { value: l })));

    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (typing && e.key === 'Escape') { document.activeElement.blur(); return; }
      if (typing || e.ctrlKey || e.metaKey || editing || view !== 'shots') return;
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); checkNext(); }
      else if (e.key === 'Backspace' || e.key === 'ArrowUp') { e.preventDefault(); undoLast(); }
      else if (/^[1-9]$/.test(e.key)) {
        const ids = [...document.querySelectorAll('.tab')].map((t) => t.dataset.sec);
        const id = ids[Number(e.key) - 1];
        if (id) scrollToSection(id);
      }
    });

    api.onMenu((channel, arg) => {
      ({
        new: newProject,
        duplicate: duplicateProject,
        import: importFiles,
        export: () => exportAs(arg === 'native' ? 'shotsheet' : arg),
        home: () => window.Common.goHome(store),
        toggleEdit,
        reset: resetChecks,
        toggleSidebar,
      }[channel] || (() => {}))();
    });
    api.onFileOpened((file) => ingest([file]));
  }

  function toggleSidebar() {
    state.sidebarHidden = !state.sidebarHidden;
    save();
    renderSidebar();
  }

  async function init() {
    const stored = await api.loadStore('shotsheets');
    if (stored && Array.isArray(stored.projects) && stored.projects.length) {
      state = { sidebarHidden: false, ...stored };
      if (!active()) state.activeId = state.projects[0].id;
    } else {
      const p = sampleProject();
      state = { projects: [p], activeId: p.id, sidebarHidden: false };
      save();
    }
    // Deep link from the home screen: ?project=<id>&view=schedule&date=YYYY-MM-DD
    const q = new URLSearchParams(location.search);
    if (q.get('project') && state.projects.some((p) => p.id === q.get('project'))) state.activeId = q.get('project');
    if (q.get('view') === 'schedule') view = 'schedule';
    if (q.get('date')) {
      selectedDate = q.get('date');
      const d = parseYmd(selectedDate);
      calMonth = { y: d.getFullYear(), m: d.getMonth() };
    }
    wire();
    collab.mountToolbar(document.querySelector('.toolbar'), $('resetBtn'));
    render();
    collab.init();
    const pending = await api.takePendingFile();
    if (pending) ingest([pending]);
  }

  init();
})();
