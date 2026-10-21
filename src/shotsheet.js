(function () {
  const { api, uid, $, mod, fmt, el, toast, relTime } = window.Common;
  const F = window.ShotFormats;
  const { OPTIONS, shotLetter } = F;
  const safeFileName = (s) => window.Common.safeFileName(s, 'shot-sheet');

  let state = { projects: [], activeId: null, sidebarHidden: false };
  let view = 'shots';          // 'shots' | 'schedule' | 'people' | 'summary'
  let summaryDayId = null;     // shoot day shown in the 'summary' view
  let editing = false;
  let dayFilter = 'all';       // 'all' | 'none' | <dayId>
  let calMonth = null;         // { y, m } shown in the schedule calendar
  let selectedDate = null;     // 'YYYY-MM-DD' selected in the schedule
  let history = [];
  let episodeFilter = null;    // TV: the episode whose shot list is shown (cast, crew and schedule cover all)

  // Shared (cloud) projects live on the server, so only local projects are saved here.
  const store = window.Common.createStore('shotsheets', () => ({ ...state, projects: collab.localOnly(state.projects) }));
  const active = () => state.projects.find((p) => p.id === state.activeId);
  function save() {
    const p = active();
    if (p) p.updatedAt = Date.now();
    store.save();
    collab.changed();
    undoHistory.record();
    undoUi.update();
  }

  // ---------- Undo / redo ----------
  const undoHistory = window.History.createHistory({
    getDoc: () => active(),
    onApply: () => { save(); render({ keepScroll: true }); },
  });
  const undoUi = window.Common.wireUndo(undoHistory);

  // ---------- Comments (on shots and scenes) ----------
  const comments = window.Comments.attach({
    getDoc: () => active(),
    save: () => save(),
    rerender: () => render({ keepScroll: true }),
    readOnly: () => collab.readOnly(),
    describe: (target) => {
      const p = active();
      if (!p) return null;
      for (const s of p.scenes) {
        if (s.id === target) return `Scene ${s.number}: ${s.heading}`;
        const i = s.shots.findIndex((x) => x.id === target);
        if (i >= 0) return `Shot ${s.number}${shotLetter(i)} ${s.shots[i].type}: ${s.shots[i].desc.replace(/\*/g, '') || 'no description'}`;
      }
      return null;
    },
    jump: (target) => {
      if (view !== 'shots') { view = 'shots'; dayFilter = 'all'; render(); }
      const node = document.querySelector(`[data-shot="${CSS.escape(target)}"]`) || document.getElementById('sec-' + target);
      if (node) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    },
  });
  const commentControl = (target) => comments.badge(target) || el('button', {
    class: 'cm-add', type: 'button', title: 'Add a comment',
    onclick: (e) => { e.stopPropagation(); comments.open(target); },
  }, '💬');

  // ---------- Collaboration ----------
  const collab = window.Collab.attach({
    kind: 'shotsheet',
    listKey: 'projects',
    noun: 'project',
    nounPlural: 'projects',
    getState: () => state,
    render: (opts = {}) => {
      if (opts.opened) { dayFilter = 'all'; history = []; editing = false; }
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
      return F.upgradeProject(doc);
    },
    selectLocal: () => selectFirstLocal(),
    onRoleChange: (role) => { if (role === 'viewer') editing = false; },
  });

  // Leaving a shared production (signed out, removed, deleted): back to the productions list.
  function selectFirstLocal() {
    editing = false;
    window.Production.goPicker(store);
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

  // TV shows: each episode has its own scenes (numbered within the episode). The shot list
  // shows one episode; production-wide views (schedule, call sheets) label scenes "2-5".
  const isTv = (p) => p && p.type === 'tv';
  const currentEpisode = (p) => (isTv(p) ? p.episodes.find((e) => e.id === episodeFilter) || p.episodes[0] : null);
  const epScenes = (p) => (isTv(p) ? p.scenes.filter((s) => s.episodeId === currentEpisode(p).id) : p.scenes);
  const epOf = (p, s) => (isTv(p) ? p.episodes.find((e) => e.id === s.episodeId) : null);
  const sceneCode = (p, s) => { const e = epOf(p, s); return e ? `${e.number}-${s.number}` : s.number; };

  // Every shot in the production (codes include the episode for TV).
  function allShots(p) {
    return p.scenes.flatMap((sc) => sc.shots.map((shot, i) => ({ shot, scene: sc, code: sceneCode(p, sc) + shotLetter(i) })));
  }
  // The shots in the shot list being shown.
  function epShots(p) {
    return epScenes(p).flatMap((sc) => sc.shots.map((shot, i) => ({ shot, scene: sc, code: sc.number + shotLetter(i) })));
  }
  function matchesFilter(shot) {
    if (dayFilter === 'all') return true;
    if (dayFilter === 'none') return !shot.dayId;
    return shot.dayId === dayFilter;
  }
  const visibleShots = (p) => epShots(p).filter((x) => matchesFilter(x.shot));
  const currentShot = (p) => { const x = visibleShots(p).find((v) => !v.shot.done); return x ? x.shot : null; };
  const typeName = (abbr) => (OPTIONS.type.find(([a]) => a === abbr) || [abbr, abbr])[1];

  // ---------- Sample ----------
  function sampleProject() {
    const base = new Date(); base.setDate(base.getDate() + 7);
    const d1 = ymd(base); base.setDate(base.getDate() + 1); const d2 = ymd(base);
    const S = (type, desc, extra = {}) => ({ type, desc, ...extra });
    return F.normalizeProject({
      title: 'Night Diner',
      characters: [
        { id: 'c1', name: 'Maya', actor: '', contact: '' },
        { id: 'c2', name: 'Lou', actor: '', contact: '' },
      ],
      crew: [
        { id: 'k1', role: 'Director', name: '', contact: '', allDays: true },
        { id: 'k2', role: 'Director of Photography', name: '', contact: '', allDays: true },
        { id: 'k3', role: 'Sound Mixer', name: '', contact: '', allDays: true },
        { id: 'k4', role: 'Gaffer', name: '', contact: '' },
        { id: 'k5', role: 'Prop Master', name: '', contact: '' },
      ],
      days: [
        { date: d1, call: '07:00', wrap: '19:00', location: 'Rosie’s Diner, 4th St', notes: 'Practical neons on by 6:30.' },
        { date: d2, call: '16:00', wrap: '02:00', location: 'Parking lot behind diner', notes: 'Night exterior — rain tower booked.' },
      ],
      scenes: [
        { number: '1', heading: 'EXT. DINER - NIGHT', castIds: ['c1'], crewIds: ['k4'], equipment: 'Rain tower', shots: [
          S('EST', 'Diner sign flickers, rain on the window', { move: 'Crane', lens: '24mm', day: d2, audio: 'MOS' }),
          S('WS', 'Maya crosses the lot toward the door', { move: 'Tracking', lens: '35mm', day: d2 }),
          S('CU', 'Her hand hesitates on the *door handle*', { lens: '85mm', day: d2, audio: 'MOS' }),
        ] },
        { number: '2', heading: 'INT. DINER - NIGHT', castIds: ['c1', 'c2'], crewIds: ['k4', 'k5'], props: 'Coffee pot, chipped mug, dish rag', shots: [
          S('WS', 'Master — Maya enters, Lou behind counter', { lens: '24mm', day: d1 }),
          S('MS', 'Lou pours coffee without looking up', { day: d1 }),
          S('OTS', 'Over Lou onto Maya', { lens: '50mm', day: d1 }),
          S('OTS', 'Over Maya onto Lou', { lens: '50mm', cam: 'B', day: d1 }),
          S('MCU', 'Maya: "You still make it too strong."', { move: 'Push In', lens: '50mm', day: d1 }),
          S('INS', 'Coffee mug slides across counter', { angle: 'High', lens: '100mm', fps: '48', audio: 'MOS', day: d1 }),
        ] },
        { number: '3', heading: 'INT. DINER - BOOTH - LATER', castIds: ['c1', 'c2'], props: 'Two coffee mugs', shots: [
          S('2S', 'Maya and Lou in the booth', { lens: '35mm' }),
          S('ECU', 'Lou’s eyes — the truth lands', { lens: '135mm', angle: 'Low' }),
          S('POV', 'Maya’s POV through rain-streaked glass', { move: 'Handheld' }),
        ] },
      ],
    }, 'Night Diner');
  }

  // ---------- Sidebar ----------
  // The production this page belongs to, and for TV its episodes (each has its own shot list).
  function renderSidebar() {
    const p = active();
    $('app').classList.toggle('sidebar-hidden', state.sidebarHidden);
    $('sidebarTitle').textContent = p ? p.title || 'Untitled' : 'Production';
    $('sidebarSub').textContent = p ? window.Production.typeLabel(p) + (collab.isCloud(p) ? ' · shared' : '') : '';
    const list = $('list');
    list.innerHTML = '';
    $('listHeading').hidden = !isTv(p);
    if (!isTv(p)) return;
    const cur = currentEpisode(p);
    for (const e of p.episodes) {
      const shots = p.scenes.filter((s) => s.episodeId === e.id).flatMap((s) => s.shots);
      list.append(el('li', {
        class: e === cur ? 'active' : '',
        onclick: () => selectEpisode(e.id),
      },
      el('div', { class: 'name' }, window.Production.episodeLabel(e)),
      el('div', { class: 'meta' }, `${shots.filter((x) => x.done).length}/${shots.length} shots`)));
    }
  }

  function selectEpisode(id) {
    episodeFilter = id;
    history = [];
    dayFilter = 'all';
    const url = new URL(location.href);
    url.searchParams.set('episode', id);
    window.history.replaceState(null, '', url);
    render();
    $('sheet').scrollTop = 0;
  }

  // ---------- Header ----------
  function renderHeader(p) {
    const vis = visibleShots(p);
    const done = vis.filter((x) => x.shot.done).length;
    document.title = `${p.title} — Shot Sheet`;
    $('title').textContent = p.title;
    $('title').hidden = editing;
    const ep = currentEpisode(p);
    $('episodeLabel').hidden = !ep || view === 'people' || view === 'schedule' || view === 'summary';
    if (ep) $('episodeLabel').textContent = window.Production.episodeLabel(ep);
    const ti = $('titleInput');
    ti.hidden = !editing;
    if (editing && document.activeElement !== ti) ti.value = p.title;
    const counter = $('counter');
    counter.textContent = `${done}/${vis.length}`;
    counter.classList.toggle('complete', vis.length > 0 && done === vis.length);
    counter.hidden = view !== 'shots' || editing;

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
    if (epShots(p).some((x) => !x.shot.dayId) && p.days.length) chip('none', 'UNSCHEDULED');

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
    epScenes(p).forEach((s) => {
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

  // ---------- Cast & crew helpers ----------
  const characterLabel = (c) => (c.actor ? `${c.name || 'Unnamed'} (${c.actor})` : c.name || 'Unnamed');
  const crewLabel = (k) => [k.role || 'Crew', k.name].filter(Boolean).join(' — ');
  const sceneCast = (p, s) => p.characters.filter((c) => s.castIds.includes(c.id));
  const sceneCrew = (p, s) => p.crew.filter((k) => s.crewIds.includes(k.id));
  // Scenes being shot on a day: any scene with at least one shot scheduled that day.
  const scenesOnDay = (p, dayId) => p.scenes.filter((s) => s.shots.some((x) => x.dayId === dayId));
  // The shoot days a scene is (partly) scheduled on, in date order.
  const daysForScene = (p, s) => sortedDays(p).filter((d) => s.shots.some((x) => x.dayId === d.id));
  function daysLabel(p, scenes) {
    const days = sortedDays(p).filter((d) => scenes.some((s) => s.shots.some((x) => x.dayId === d.id)));
    return days.map((d) => `Day ${dayNum(p, d.id)}`).join(', ');
  }

  // Synopsis, cast, crew, props and page length, shown under a scene's title.
  function sceneInfo(p, s) {
    const cast = sceneCast(p, s);
    const crew = sceneCrew(p, s);
    const props = F.listItems(s.props);
    const gear = F.listItems(s.equipment);
    const parts = [
      s.synopsis ? el('span', { class: 'scene-synopsis' }, s.synopsis) : null,
      cast.length ? el('span', { class: 'scene-cast', title: 'Cast' }, cast.map(characterLabel).join(', ')) : null,
      crew.length ? el('span', { class: 'scene-crew', title: 'Crew' }, crew.map((k) => k.role || k.name).join(', ')) : null,
      props.length ? el('span', { class: 'scene-tagged' }, el('b', {}, 'Props '), props.join(', ')) : null,
      gear.length ? el('span', { class: 'scene-tagged' }, el('b', {}, 'Gear '), gear.join(', ')) : null,
      s.eighths ? el('span', { class: 'scene-pages' }, pagesLabel(s.eighths)) : null,
    ].filter(Boolean);
    return parts.length ? el('div', { class: 'scene-info' }, ...parts) : null;
  }

  const pagesLabel = (eighths) => `${window.ScriptParse.formatEighths(eighths)} pg${eighths > 8 ? 's' : ''}`;

  // Script pages covered by a shoot day: every scene with at least one shot that day.
  function dayEighths(p, dayId) {
    return p.scenes.filter((s) => s.shots.some((x) => x.dayId === dayId)).reduce((n, s) => n + (s.eighths || 0), 0);
  }

  // ---------- Link to the Script Writer script this project came from ----------
  // Scenes remember their script scene (heading line id + fingerprint). Comparing with the
  // script as it is now shows which scenes changed, which are new and which were removed.
  const SP = () => window.ScriptParse;
  const SW = () => window.Screenplay;
  let scripts = []; // Script Writer scripts on this computer

  async function loadScripts() {
    try {
      const data = await api.loadStore('scripts');
      scripts = data && Array.isArray(data.scripts) ? data.scripts : [];
    } catch { scripts = []; }
  }

  // The script link for the shot list being shown: the film's, or the current episode's.
  const linkOf = (p) => (!p ? null : isTv(p) ? currentEpisode(p).scriptLink : p.scriptLink);
  const setLinkOf = (p, link) => { if (isTv(p)) currentEpisode(p).scriptLink = link; else p.scriptLink = link; };

  function linkStatus(p) {
    if (!p || !linkOf(p)) return null;
    const raw = scripts.find((d) => d.id === linkOf(p).scriptId);
    if (!raw) return { missing: true };
    const script = SW().normalizeDoc(raw);
    const links = SW().sceneLinks(script);
    const hashOf = new Map(links.map((l) => [l.id, l.hash]));
    const scenes = epScenes(p);
    const linked = new Set(scenes.filter((s) => s.scriptScene).map((s) => s.scriptScene.id));
    const changed = scenes.filter((s) => s.scriptScene && hashOf.has(s.scriptScene.id) && hashOf.get(s.scriptScene.id) !== s.scriptScene.hash);
    const removed = scenes.filter((s) => s.scriptScene && !hashOf.has(s.scriptScene.id));
    const ignored = new Set(linkOf(p).ignored || []);
    const unlinked = links.map((l, index) => ({ ...l, index })).filter((l) => !linked.has(l.id));
    const added = unlinked.filter((l) => !ignored.has(l.id));
    const leftOut = unlinked.filter((l) => ignored.has(l.id)); // unticked at import, or deleted here
    return { script, links, changed, removed, added, leftOut, total: changed.length + removed.length + added.length };
  }

  function scriptBadge(s) {
    const st = s.scriptScene && linkStatus(active());
    if (!st || st.missing) return null;
    if (st.changed.includes(s)) return el('button', { class: 'script-badge', type: 'button', title: 'This scene changed in the script', onclick: (e) => { e.stopPropagation(); openLinkReview(); } }, 'Script changed');
    if (st.removed.includes(s)) return el('button', { class: 'script-badge removed', type: 'button', title: 'This scene is no longer in the script', onclick: (e) => { e.stopPropagation(); openLinkReview(); } }, 'Removed from script');
    return null;
  }

  function linkBanner(p) {
    const st = linkStatus(p);
    if (!st) return null;
    if (st.missing) return el('div', { class: 'link-banner muted' }, `Linked to the script "${linkOf(p).title}", which isn't on this computer.`);
    if (!st.total) return el('div', { class: 'link-banner ok' }, el('span', {}, `✓ Up to date with the script "${st.script.title}".`), autoToggle(p));
    const parts = [
      st.changed.length && `${st.changed.length} scene${st.changed.length === 1 ? '' : 's'} changed`,
      st.added.length && `${st.added.length} new`,
      st.removed.length && `${st.removed.length} removed`,
    ].filter(Boolean).join(', ');
    return el('div', { class: 'link-banner' },
      el('span', {}, `The script "${st.script.title}" has changed: ${parts}.`),
      autoToggle(p),
      el('button', { class: 'primary-btn', type: 'button', onclick: openLinkReview }, 'Review changes'));
  }

  // What the script now says about scene `index` (heading, synopsis, cast, length).
  function scriptScene(st, index) {
    st.parsed = st.parsed || SP().parseScript(SW().toParseInput(st.script));
    return st.parsed.scenes[index];
  }

  function updateFromScript(p, s, st) {
    const index = st.links.findIndex((l) => l.id === s.scriptScene.id);
    const ps = scriptScene(st, index);
    if (ps) {
      Object.assign(s, { heading: ps.heading, synopsis: ps.synopsis, eighths: ps.eighths });
      s.castIds = [];
      s.cast = ps.cast;
      F.upgradeProject(p); // turns the cast names into characters
    }
    s.scriptScene.hash = st.links[index].hash;
  }

  function addFromScript(p, l, st, withShots) {
    const one = F.normalizeProject(SP().buildProject({ ...st.parsed, scenes: [scriptScene(st, l.index)] },
      { establishing: withShots, master: withShots, coverage: withShots })).scenes[0];
    one.scriptScene = { id: l.id, hash: l.hash, number: one.number };
    linkOf(p).ignored = (linkOf(p).ignored || []).filter((id) => id !== l.id);
    one.castIds = [];
    one.cast = scriptScene(st, l.index).cast;
    if (isTv(p)) one.episodeId = currentEpisode(p).id;
    // Place it after the scene that comes before it in the script (or before the
    // episode's first scene).
    const prevIds = new Set(st.links.slice(0, l.index).map((x) => x.id));
    const mine = epScenes(p);
    let at = mine.length ? p.scenes.indexOf(mine[0]) : p.scenes.length;
    p.scenes.forEach((s, i) => { if (mine.includes(s) && s.scriptScene && prevIds.has(s.scriptScene.id)) at = i + 1; });
    p.scenes.splice(at, 0, one);
    F.upgradeProject(p);
  }

  // Linked scenes follow the script's scene numbers, so a scene inserted in the script
  // renumbers the ones after it here too. Only a number the script itself changed is
  // applied; a number you typed here stays until the script's number changes again.
  // Returns how many numbers changed.
  function renumberFromScript(p, st) {
    const indexOf = new Map(st.links.map((l, i) => [l.id, i]));
    let n = 0;
    for (const s of epScenes(p)) {
      const ps = s.scriptScene && indexOf.has(s.scriptScene.id) && scriptScene(st, indexOf.get(s.scriptScene.id));
      if (!ps || !ps.number) continue;
      const last = s.scriptScene.number == null ? s.number : s.scriptScene.number;
      s.scriptScene.number = ps.number;
      if (ps.number !== last && s.number !== ps.number) { s.number = ps.number; n++; }
    }
    return n;
  }

  // Deleting a linked scene here means "not in this shot sheet": remember it, so updating
  // from the script doesn't bring it back.
  function forgetScriptScene(p, s) {
    if (linkOf(p) && s.scriptScene) linkOf(p).ignored = [...new Set([...(linkOf(p).ignored || []), s.scriptScene.id])];
  }

  // With "Update automatically" on, new and changed script scenes are applied as soon as
  // the shot sheet sees them (opening it, or coming back to the app). Shots are never
  // touched, and scenes removed from the script are only flagged: deleting them could
  // lose shots, so that stays a choice. Undo reverses the whole update, and it stays undone
  // until the script changes again (the script version last applied is kept per project).
  // project id → script fingerprint; kept for the session, so going to the Script Writer
  // and back doesn't redo an update you undid.
  const autoSeen = {
    key: (id) => 'scriptSeen:' + id,
    get(id) { try { return sessionStorage.getItem(this.key(id)); } catch { return null; } },
    set(id, v) { try { sessionStorage.setItem(this.key(id), v); } catch { /* ignore */ } },
    delete(id) { try { sessionStorage.removeItem(this.key(id)); } catch { /* ignore */ } },
  };
  function autoSync(p) {
    if (!p || !linkOf(p) || !linkOf(p).auto || collab.readOnly()) return;
    const st = linkStatus(p);
    if (!st || st.missing) return;
    const print = st.links.map((l) => l.id + ':' + l.hash).join(',');
    const seenKey = p.id + (isTv(p) ? ':' + currentEpisode(p).id : '');
    if (autoSeen.get(seenKey) === print) return;
    autoSeen.set(seenKey, print);
    const changed = st.changed.length, added = st.added.length;
    st.changed.forEach((s) => updateFromScript(p, s, st));
    st.added.forEach((l) => addFromScript(p, l, st, true));
    const renumbered = renumberFromScript(p, st);
    if (!changed && !added && !renumbered) return;
    save();
    const parts = [
      added && `${added} new scene${added === 1 ? '' : 's'} added`,
      changed && `${changed} scene${changed === 1 ? '' : 's'} updated`,
      !added && !changed && 'scene numbers updated',
    ].filter(Boolean).join(', ');
    toast(`From the script: ${parts}. Ctrl/⌘+Z to undo.`);
  }

  function autoToggle(p) {
    if (collab.readOnly()) return null;
    const box = el('input', { type: 'checkbox', checked: !!linkOf(p).auto, onchange: () => {
      linkOf(p).auto = box.checked;
      if (box.checked) autoSeen.delete(p.id + (isTv(p) ? ':' + currentEpisode(p).id : '')); // apply anything waiting right away
      save(); render({ keepScroll: true });
    } });
    return el('label', { class: 'link-auto', title: 'Add new script scenes and apply script changes automatically. Your shots are never changed.' }, box, ' Update automatically');
  }

  async function openLinkReview() {
    await loadScripts();
    const p = active();
    const st = linkStatus(p);
    if (!st || st.missing) { toast("The linked script isn't on this computer"); return; }
    const ro = collab.readOnly();
    const body = el('div', { class: 'link-review' });
    const m = window.Common.modal('Script changes', body, { wide: true });
    const withShots = el('input', { type: 'checkbox', checked: true });
    const done = (msg) => { save(); render({ keepScroll: true }); toast(msg); draw(); };
    const row = (label, sub, ...buttons) => el('div', { class: 'lr-row' },
      el('div', {}, el('div', { class: 'lr-title' }, label), sub ? el('div', { class: 'muted small' }, sub) : null),
      el('div', { class: 'lr-actions' }, ...(ro ? [] : buttons)));
    const btn = (text, onclick, primary) => el('button', { class: primary ? 'primary-btn' : 'ghost-btn', type: 'button', onclick }, text);
    function draw() {
      const now = linkStatus(active());
      body.innerHTML = '';
      const leftOut = now.leftOut.length ? [el('h3', { class: 'panel-title' }, 'Left out of this shot sheet'),
        el('p', { class: 'muted small' }, 'Scenes you unticked when importing or deleted here. Automatic updates skip them.'),
        ...now.leftOut.map((l) => {
          const ps = scriptScene(now, l.index);
          return row(ps ? `SC ${ps.number} — ${ps.heading}` : 'Scene', ps && ps.synopsis,
            btn('Add scene', () => { addFromScript(active(), l, now, withShots.checked); done('Scene added'); }));
        })] : [];
      if (!now.total) {
        body.append(el('p', {}, `Everything matches the script "${now.script.title}".`), ...leftOut,
          el('div', { class: 'modal-foot' }, btn('Done', () => m.close(), true)));
        return;
      }
      body.append(el('p', { class: 'muted small' }, `Changes in "${now.script.title}" since this shot sheet was made or last reviewed. Updating a scene refreshes its heading, synopsis, cast and length; your shots stay as they are.`));
      if (now.changed.length) {
        body.append(el('h3', { class: 'panel-title' }, 'Changed scenes'),
          ...now.changed.map((s) => row(`SC ${s.number} — ${s.heading}`, (scriptScene(now, now.links.findIndex((l) => l.id === s.scriptScene.id)) || {}).synopsis,
            btn('Update from script', () => { updateFromScript(active(), s, now); done(`Scene ${s.number} updated`); }, true),
            btn('Mark reviewed', () => { s.scriptScene.hash = now.links.find((l) => l.id === s.scriptScene.id).hash; done('Marked as reviewed'); }))));
      }
      if (now.added.length) {
        body.append(el('h3', { class: 'panel-title' }, 'New in the script'),
          el('label', { class: 'small muted lr-opt' }, withShots, ' Add starter shots to new scenes'),
          ...now.added.map((l) => {
            const ps = scriptScene(now, l.index);
            return row(ps ? ps.heading : 'New scene', ps && ps.synopsis,
              btn('Add scene', () => { addFromScript(active(), l, now, withShots.checked); done('Scene added'); }, true));
          }));
      }
      if (now.removed.length) {
        body.append(el('h3', { class: 'panel-title' }, 'Removed from the script'),
          ...now.removed.map((s) => row(`SC ${s.number} — ${s.heading}`, `${s.shots.length} shot${s.shots.length === 1 ? '' : 's'}`,
            btn('Delete scene', () => {
              if (s.shots.length && !confirm(`Delete scene ${s.number} and its ${s.shots.length} shots?`)) return;
              const scenes = active().scenes;
              scenes.splice(scenes.indexOf(s), 1);
              done('Scene deleted');
            }),
            btn('Keep (unlink)', () => { s.scriptScene = null; done('Scene kept'); }))));
      }
      body.append(...leftOut);
      body.append(el('div', { class: 'modal-foot spread' },
        ro ? el('span') : btn('Update all and add new scenes', () => {
          const pr = active();
          now.changed.forEach((s) => updateFromScript(pr, s, now));
          now.added.forEach((l) => addFromScript(pr, l, now, withShots.checked));
          done('Shot sheet updated from the script');
        }),
        btn('Done', () => m.close(), true)));
    }
    draw();
  }

  function renderRun(p) {
    const wrap = $('sections');
    wrap.innerHTML = '';
    const banner = linkBanner(p);
    if (banner) wrap.append(banner);
    const cur = currentShot(p);
    let any = false;
    for (const s of epScenes(p)) {
      const ul = el('ul', { class: 'items' });
      s.shots.forEach((shot, i) => {
        if (!matchesFilter(shot)) return;
        any = true;
        ul.append(el('li', {
          class: 'item shot' + (shot.done ? ' checked' : '') + (cur === shot ? ' current' : ''),
          'data-shot': shot.id,
          onclick: () => toggleShot(shot),
        },
        el('span', { class: 'box' }),
        el('span', { class: 'shot-code' }, s.number + shotLetter(i)),
        el('span', { class: 'type-chip', title: typeName(shot.type) }, shot.type),
        el('div', { class: 'shot-body' },
          el('div', { class: 'item-text' }, el('span', { html: shot.desc ? fmt(shot.desc) : '<span class="muted">No description</span>' }), commentControl(shot.id)),
          el('div', { class: 'shot-meta' }, shotMeta(p, shot)),
          shot.notes ? el('div', { class: 'shot-notes' }, shot.notes) : null)));
      });
      if (!ul.children.length) continue;
      wrap.append(el('section', { class: 'section', id: 'sec-' + s.id },
        el('h2', { class: 'section-title' }, `SCENE ${s.number}`, el('span', { class: 'scene-heading' }, s.heading),
          scriptBadge(s), commentControl(s.id)),
        sceneInfo(p, s),
        ul));
    }
    if (!any) {
      wrap.append(el('div', { class: 'empty' },
        dayFilter === 'all' ? 'No shots yet. Click Edit to add scenes and shots, or use "Import script" in the sidebar to build them from a screenplay.'
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

    epScenes(p).forEach((s) => {
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
          el('button', { class: 'icon-btn', title: 'Move up', onclick: () => moveScene(s, -1) }, '↑'),
          el('button', { class: 'icon-btn', title: 'Move down', onclick: () => moveScene(s, 1) }, '↓'),
          el('button', { class: 'icon-btn del', title: 'Delete scene', onclick: () => {
            if (s.shots.length && !confirm(`Delete scene ${s.number} and its ${s.shots.length} shots?`)) return;
            forgetScriptScene(p, s);
            p.scenes.splice(p.scenes.indexOf(s), 1); save(); render({ keepScroll: true });
          } }, '✕')),
        el('div', { class: 'edit-row scene-extra' },
          el('input', {
            class: 'edit-input synopsis-input', value: s.synopsis || '', placeholder: 'Scene synopsis (optional)',
            oninput: (e) => { s.synopsis = e.target.value; save(); },
          })),
        picker(p, s, 'cast'),
        picker(p, s, 'crew'),
        el('div', { class: 'edit-row scene-extra' },
          labeled('Props', el('input', {
            class: 'field', value: s.props, placeholder: 'e.g. coffee mug, car keys',
            oninput: (e) => { s.props = e.target.value; save(); },
          })),
          labeled('Equipment', el('input', {
            class: 'field', value: s.equipment, placeholder: 'e.g. rain tower, haze machine',
            oninput: (e) => { s.equipment = e.target.value; save(); },
          }))),
        shotsWrap,
        el('button', { class: 'add-btn', onclick: () => {
          const n = F.newShot(s.shots[s.shots.length - 1]);
          s.shots.push(n); save(); render({ keepScroll: true }); focusShot(n.id);
        } }, '+ Add shot')));
    });

    wrap.append(el('button', { class: 'add-section-btn', onclick: () => {
      const nums = epScenes(p).map((s) => parseInt(s.number, 10)).filter((n) => !isNaN(n));
      const s = { id: uid(), number: String(nums.length ? Math.max(...nums) + 1 : 1), heading: '', shots: [F.newShot()] };
      if (isTv(p)) s.episodeId = currentEpisode(p).id;
      F.upgradeProject({ ...p, scenes: [s] }); // fills in the scene's fields
      p.scenes.push(s); save(); render({ keepScroll: true });
      const inp = document.querySelector(`#sec-${s.id} .section-input:not(.scene-num)`);
      if (inp) { inp.scrollIntoView({ block: 'center' }); inp.focus(); }
    } }, '+ ADD SCENE'));
  }

  // Tap-to-select chips for the characters or crew a scene needs, plus a box to add a new one.
  function picker(p, s, kind) {
    const isCast = kind === 'cast';
    const list = isCast ? p.characters : p.crew;
    const key = isCast ? 'castIds' : 'crewIds';
    const wrap = el('div', { class: 'picker', 'data-picker': kind });
    const add = el('input', {
      class: 'pick-add',
      placeholder: isCast ? '+ New character' : '+ New crew role',
      title: 'Type a name and press Enter',
      onkeydown: (e) => {
        if (e.key !== 'Enter' || !e.target.value.trim()) return;
        e.preventDefault();
        const text = e.target.value.trim();
        const item = isCast
          ? { id: uid(), name: text, actor: '', contact: '' }
          : { id: uid(), role: text, name: '', contact: '', allDays: false };
        list.push(item);
        s[key].push(item.id);
        save();
        render({ keepScroll: true });
        const again = document.querySelector(`#sec-${s.id} [data-picker="${kind}"] .pick-add`);
        if (again) again.focus();
      },
    });
    const draw = () => wrap.replaceChildren(
      el('span', { class: 'picker-label' }, isCast ? 'Cast' : 'Crew'),
      ...list.map((item) => el('button', {
        type: 'button',
        class: 'pick-chip' + (s[key].includes(item.id) ? ' on' : ''),
        title: isCast ? (item.actor ? `Played by ${item.actor}` : 'No actor assigned yet') : (item.name || 'No name yet'),
        onclick: () => {
          const i = s[key].indexOf(item.id);
          if (i >= 0) s[key].splice(i, 1); else s[key].push(item.id);
          save();
          draw();
        },
      }, isCast ? item.name || 'Unnamed' : item.role || item.name || 'Crew')),
      add);
    draw();
    return wrap;
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

  // Swaps a scene with its neighbour in the shot list being shown (same episode for TV).
  function moveScene(s, dir) {
    const p = active();
    const list = epScenes(p);
    const other = list[list.indexOf(s) + dir];
    if (!other) return;
    const a = p.scenes.indexOf(s);
    const b = p.scenes.indexOf(other);
    [p.scenes[a], p.scenes[b]] = [p.scenes[b], p.scenes[a]];
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
        el('span', { class: 'day-row-count' }, `${done}/${shots.length}` + (dayEighths(p, d.id) ? ` · ${pagesLabel(dayEighths(p, d.id))}` : '')));
      }),
      unscheduled ? el('div', { class: 'muted small unsched-note' }, `${unscheduled} shot${unscheduled === 1 ? '' : 's'} not scheduled yet`) : null);
  }

  function addDay(date) {
    const p = active();
    if (dayOnDate(p, date) || blockedReadOnly()) return;
    p.days.push({
      id: uid(), date, call: '07:00', wrap: '', location: '', notes: '', equipment: '',
      crewCall: '06:30', parking: '', hospital: '', weather: '', sunrise: '', sunset: '', weatherPlace: '', calls: {},
    });
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
        el('div', { class: 'panel-actions' },
          el('button', { class: 'ghost-btn', title: 'The printable call sheet for this day: call times, weather, location, scenes, cast and crew', onclick: () => openSummary(day.id) }, 'Call sheet'),
          el('button', { class: 'primary-btn', title: 'Open this day as a checklist', onclick: () => {
            dayFilter = day.id; view = 'shots'; editing = false; history = []; render(); $('sheet').scrollTop = 0;
          } }, 'Run day ▶'))),
      el('div', { class: 'day-fields' },
        labeled('Date', el('input', { class: 'field', type: 'date', value: day.date, onchange: (e) => {
          const v = e.target.value;
          if (!v) return;
          if (dayOnDate(p, v) && v !== day.date) { toast('There is already a shoot day on that date'); e.target.value = day.date; return; }
          day.date = v; selectedDate = v; const dt = parseYmd(v); calMonth = { y: dt.getFullYear(), m: dt.getMonth() };
          save(); render({ keepScroll: true });
        } })),
        labeled('Crew call', el('input', { class: 'field', type: 'time', value: day.crewCall || '', oninput: upd('crewCall') })),
        labeled('Shooting call', el('input', { class: 'field', type: 'time', value: day.call, oninput: upd('call') })),
        labeled('Wrap', el('input', { class: 'field', type: 'time', value: day.wrap, oninput: upd('wrap') })),
        labeled('Location', el('input', { class: 'field', value: day.location, placeholder: 'Address or set', oninput: upd('location') })),
        labeled('Notes', el('textarea', { class: 'field', rows: 2, placeholder: 'Parking, weather backup, meals…', oninput: upd('notes') }, day.notes)),
        labeled('Extra equipment for the day', el('textarea', { class: 'field', rows: 2, placeholder: 'Generator, walkies, craft services tent…', oninput: upd('equipment') }, day.equipment || ''))),
      el('h3', { class: 'panel-title' }, `SHOTS THIS DAY (${mine.length})` + (dayEighths(p, day.id) ? ` · ${pagesLabel(dayEighths(p, day.id)).toUpperCase()}` : '')),
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

  // ---------- Cast & Crew ----------
  function renderPeople(p) {
    const wrap = $('sections');
    wrap.innerHTML = '';
    const ro = collab.readOnly();
    const sceneNums = (scenes) => (scenes.length ? 'SC ' + scenes.map((s) => sceneCode(p, s)).join(', ') : '—');

    function input(item, keyName, placeholder, extra = {}) {
      return el('input', {
        class: 'field', value: item[keyName] || '', placeholder, disabled: ro, ...extra,
        oninput: (e) => { item[keyName] = e.target.value; save(); },
      });
    }

    function removeItem(list, item, key, label) {
      if (blockedReadOnly()) return;
      const used = p.scenes.filter((s) => s[key].includes(item.id));
      if (used.length && !confirm(`Remove ${label}? They are in ${used.length} scene${used.length === 1 ? '' : 's'}.`)) return;
      list.splice(list.indexOf(item), 1);
      for (const s of used) s[key].splice(s[key].indexOf(item.id), 1);
      save();
      render({ keepScroll: true });
    }

    function addItem(list, item) {
      if (blockedReadOnly()) return;
      list.push(item);
      save();
      render({ keepScroll: true });
      const first = document.querySelector(`[data-item="${item.id}"] input`);
      if (first) first.focus();
    }

    const castRows = p.characters.map((c) => {
      const scenes = p.scenes.filter((s) => s.castIds.includes(c.id));
      return el('div', { class: 'people-row cast-row', 'data-item': c.id },
        input(c, 'name', 'Character'),
        input(c, 'actor', 'Actor'),
        input(c, 'contact', 'Phone or email'),
        el('span', { class: 'people-meta' }, sceneNums(scenes)),
        el('span', { class: 'people-meta days' }, daysLabel(p, scenes) || 'Not scheduled'),
        ro ? el('span') : el('button', { class: 'icon-btn del', title: 'Remove character', onclick: () => removeItem(p.characters, c, 'castIds', c.name || 'this character') }, '✕'));
    });

    // Roles as chips: type or pick one and press Enter (or a comma) to add it; × removes one.
    function roleEditor(k) {
      const roles = F.crewRoles(k);
      const refocus = () => {
        const again = document.querySelector(`.crew-row[data-item="${k.id}"] .role-add`);
        if (again) again.focus();
      };
      const set = (next, { focus = true } = {}) => { F.setCrewRoles(k, next); save(); render({ keepScroll: true }); if (focus) refocus(); };
      const add = el('input', {
        class: 'role-add', list: 'crewRoles', placeholder: roles.length ? '+ Role' : 'Role(s)',
        title: 'Type a role and press Enter. Add as many as this person does.',
        onkeydown: (e) => {
          if ((e.key === 'Enter' || e.key === ',') && add.value.trim()) { e.preventDefault(); commit(); }
          else if (e.key === 'Backspace' && !add.value && roles.length) { e.preventDefault(); set(roles.slice(0, -1)); }
        },
        // Picking a suggestion from the list adds it straight away.
        oninput: (e) => { if (e.inputType === 'insertReplacementText' || e.inputType == null) commit(); },
        // Leaving the box keeps what was typed, and the field clicked into keeps the focus.
        onblur: () => {
          if (!add.value.trim()) return;
          setTimeout(() => {
            const to = document.activeElement;
            const row = to && to.closest && to.closest('[data-item]');
            const at = row ? { id: row.dataset.item, i: [...row.querySelectorAll('input, textarea, select')].indexOf(to) } : null;
            commit({ focus: false });
            const again = at && document.querySelector(`[data-item="${CSS.escape(at.id)}"]`);
            const n = again && again.querySelectorAll('input, textarea, select')[at.i];
            if (n) n.focus();
          });
        },
      });
      function commit(opts) {
        const text = add.value.trim();
        if (!text) return;
        add.value = '';
        set([...roles, ...text.split(',')], opts);
      }
      return el('div', { class: 'role-chips' + (ro ? ' read-only' : ''), onclick: (e) => { if (e.target === e.currentTarget && !ro) add.focus(); } },
        ...roles.map((r, i) => el('span', { class: 'role-chip' }, r,
          ro ? null : el('button', { type: 'button', class: 'role-x', title: `Remove ${r}`, onclick: () => set(roles.filter((_, j) => j !== i)) }, '×'))),
        ro ? (roles.length ? null : el('span', { class: 'muted small' }, '—')) : add);
    }

    const crewRows = p.crew.map((k) => {
      const scenes = p.scenes.filter((s) => s.crewIds.includes(k.id));
      return el('div', { class: 'people-row crew-row', 'data-item': k.id },
        roleEditor(k),
        input(k, 'name', 'Name'),
        input(k, 'contact', 'Phone or email'),
        el('label', { class: 'people-check', title: 'Needed on every shoot day (director, DP, sound…)' },
          el('input', { type: 'checkbox', checked: k.allDays, disabled: ro, onchange: (e) => { k.allDays = e.target.checked; save(); render({ keepScroll: true }); } }),
          ' Every day'),
        el('span', { class: 'people-meta' }, k.allDays ? 'All scenes' : sceneNums(scenes)),
        el('span', { class: 'people-meta days' }, k.allDays ? (p.days.length ? 'Every shoot day' : 'Not scheduled') : daysLabel(p, scenes) || 'Not scheduled'),
        ro ? el('span') : el('button', { class: 'icon-btn del', title: 'Remove crew member', onclick: () => removeItem(p.crew, k, 'crewIds', k.name || k.role || 'this crew member') }, '✕'));
    });

    wrap.append(
      el('p', { class: 'edit-help' }, 'Build the cast and crew lists here, then choose who each scene needs in the Shot List (Edit mode). Scenes and shoot days update automatically from the schedule.'),
      el('section', { class: 'people-card' },
        el('div', { class: 'people-head' },
          el('h2', { class: 'section-title' }, `CAST (${p.characters.length})`),
          ro ? null : el('button', { class: 'ghost-btn', onclick: () => addItem(p.characters, { id: uid(), name: '', actor: '', contact: '' }) }, '+ Add character')),
        el('div', { class: 'people-row people-cols cast-row' }, ...['Character', 'Actor', 'Contact', 'Scenes', 'Shoot days', ''].map((h) => el('span', {}, h))),
        ...(castRows.length ? castRows : [el('div', { class: 'list-note' }, 'No characters yet. Add them here, or import a script to fill this in.')])),
      el('section', { class: 'people-card' },
        el('div', { class: 'people-head' },
          el('h2', { class: 'section-title' }, `CREW (${p.crew.length})`),
          ro ? null : el('button', { class: 'ghost-btn', onclick: () => addItem(p.crew, { id: uid(), role: '', name: '', contact: '', allDays: false }) }, '+ Add crew member')),
        el('div', { class: 'people-row people-cols crew-row' }, ...['Roles', 'Name', 'Contact', '', 'Scenes', 'Shoot days', ''].map((h) => el('span', {}, h))),
        ...(crewRows.length ? crewRows : [el('div', { class: 'list-note' }, 'No crew yet.')])));
  }

  // ---------- Day summary ----------
  function openSummary(dayId) {
    summaryDayId = dayId;
    view = 'summary';
    editing = false;
    render();
    $('sheet').scrollTop = 0;
  }

  function daySummaryData(p, day) {
    const scenes = scenesOnDay(p, day.id);
    const shots = allShots(p).filter((x) => x.shot.dayId === day.id);
    const scenesWith = (key, id) => scenes.filter((s) => s[key].includes(id));
    const cast = p.characters
      .filter((c) => scenes.some((s) => s.castIds.includes(c.id)))
      .map((c) => ({ c, scenes: scenesWith('castIds', c.id) }));
    const crew = p.crew
      .filter((k) => k.allDays || scenes.some((s) => s.crewIds.includes(k.id)))
      .map((k) => ({ k, scenes: scenesWith('crewIds', k.id) }));
    // Collect items with where they're needed, merging duplicates case-insensitively.
    const collect = (entries) => {
      const map = new Map();
      for (const [item, ref] of entries) {
        const key = item.toLowerCase();
        if (!map.has(key)) map.set(key, { item, refs: [] });
        if (ref && !map.get(key).refs.includes(ref)) map.get(key).refs.push(ref);
      }
      return [...map.values()];
    };
    const equipment = [
      ...collect([
        ...scenes.flatMap((s) => F.listItems(s.equipment).map((i) => [i, 'SC ' + s.number])),
        ...F.listItems(day.equipment).map((i) => [i, 'Day']),
      ]),
      ...F.shotEquipment(shots).map((g) => ({ item: g.item, refs: g.refs, fromShots: true })),
    ];
    const props = collect(scenes.flatMap((s) => F.listItems(s.props).map((i) => [i, 'SC ' + s.number])));
    const shotNotes = shots.filter((x) => x.shot.notes.trim());
    const eighths = scenes.reduce((n, s) => n + (s.eighths || 0), 0);
    return { scenes, shots, cast, crew, equipment, props, shotNotes, eighths };
  }

  // The industry-style call sheet for a shoot day. Logistics (call times, parking, hospital,
  // weather…) are edited right on the sheet and print as plain text.
  function renderSummary(p) {
    const wrap = $('sections');
    wrap.innerHTML = '';
    const day = dayById(p, summaryDayId);
    if (!day) { view = 'schedule'; render(); return; }
    day.calls = day.calls || {};
    const d = daySummaryData(p, day);
    const n = dayNum(p, day.id);
    const ro = collab.readOnly();
    const plural = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;

    // Inputs that write straight into the day (no re-render, so typing isn't interrupted).
    const field = (key, opts = {}) => {
      const tag = opts.multiline ? 'textarea' : 'input';
      const node = el(tag, {
        class: 'cs-input' + (opts.cls ? ' ' + opts.cls : ''),
        type: opts.multiline ? null : opts.type || 'text',
        rows: opts.multiline ? 2 : null,
        placeholder: ro ? '' : opts.placeholder || '',
        disabled: ro,
        oninput: (e) => { day[key] = e.target.value; e.target.classList.toggle('empty', !e.target.value); save(); },
      });
      node.value = day[key] || '';
      node.classList.toggle('empty', !node.value); // empty time fields print blank, not "--:--"
      return node;
    };
    const callInput = (id, fallback) => {
      const node = el('input', {
        class: 'cs-input cs-time', type: 'time', disabled: ro,
        title: 'Call time',
        oninput: (e) => {
          if (e.target.value) day.calls[id] = e.target.value; else delete day.calls[id];
          e.target.classList.toggle('empty', !e.target.value);
          save();
        },
      });
      node.value = day.calls[id] || fallback || '';
      node.classList.toggle('empty', !node.value);
      return node;
    };
    const box = (label, ...content) => el('div', { class: 'cs-box' }, el('div', { class: 'cs-label' }, label), ...content);
    const table = (head, rows, empty, cls = '') => (rows.length
      ? el('table', { class: 'sum-table ' + cls },
        el('thead', {}, el('tr', {}, ...head.map((h) => el('th', {}, h)))),
        el('tbody', {}, ...rows.map((r) => el('tr', {}, ...r.map((cell) => el('td', {}, cell))))))
      : el('p', { class: 'sum-empty' }, empty));
    const list = (items, empty) => (items.length
      ? el('ul', { class: 'sum-list' }, ...items.map((x) => el('li', {}, x.item, x.refs.length ? el('span', { class: 'sum-ref' }, ' — ' + x.refs.join(', ')) : null)))
      : el('p', { class: 'sum-empty' }, empty));
    const castNo = (c) => p.characters.indexOf(c) + 1;
    const dayNight = (heading) => {
      const t = window.ScriptParse.parseHeading(heading || '').time;
      return ({
        DAY: 'D', NIGHT: 'N', MORNING: 'M', EVENING: 'E', DUSK: 'Dusk', DAWN: 'Dawn',
        CONTINUOUS: 'Cont.', LATER: 'Later', 'MOMENTS LATER': 'Later', SAME: 'Same',
      })[t] || (t ? t.slice(0, 6) : '—');
    };

    // Weather: look up the forecast for the day from the place name.
    const forecastBtn = el('button', { class: 'ghost-btn cs-noprint', type: 'button', disabled: ro }, 'Get forecast');
    forecastBtn.addEventListener('click', async () => {
      const place = (day.weatherPlace || day.location || '').trim();
      forecastBtn.disabled = true;
      forecastBtn.textContent = 'Getting forecast…';
      try {
        const f = await window.Weather.forecast(place, day.date, window.Weather.defaultUnit());
        Object.assign(day, { weather: f.weather, sunrise: f.sunrise, sunset: f.sunset, weatherPlace: f.place });
        save();
        toast(`Forecast for ${f.place}`);
        render({ keepScroll: true });
      } catch (err) {
        alert(err.message);
        forecastBtn.disabled = false;
        forecastBtn.textContent = 'Get forecast';
      }
    });

    wrap.append(
      el('div', { class: 'summary-actions' },
        el('button', { class: 'ghost-btn', onclick: () => { view = 'schedule'; selectedDate = day.date; render(); } }, '← Back to schedule'),
        el('span', { class: 'muted small' }, ro ? 'View only' : 'Click any field on the sheet to edit it.'),
        el('button', { class: 'primary-btn', onclick: () => exportAs('pdf') }, 'Export PDF')),
      el('article', { class: 'summary-paper call-sheet' },
        el('header', { class: 'cs-top' },
          el('div', { class: 'cs-title' },
            el('div', { class: 'sum-project' }, p.title),
            el('h1', {}, 'Call Sheet'),
            el('div', { class: 'sum-date' }, fmtDate(day.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })),
            el('div', { class: 'cs-daynum' }, `Day ${n} of ${p.days.length}`)),
          el('div', { class: 'cs-calls' },
            el('div', { class: 'cs-label' }, 'General crew call'),
            field('crewCall', { type: 'time', cls: 'cs-big' }),
            el('div', { class: 'cs-subcalls' },
              el('label', {}, el('span', {}, 'Shooting call'), field('call', { type: 'time' })),
              el('label', {}, el('span', {}, 'Est. wrap'), field('wrap', { type: 'time' })))),
          el('div', { class: 'cs-weather' },
            el('div', { class: 'cs-label' }, 'Weather'),
            el('div', { class: 'cs-weather-place' }, field('weatherPlace', { placeholder: 'City for the forecast' }), forecastBtn),
            field('weather', { multiline: true, placeholder: 'e.g. Partly cloudy · High 72° / Low 58°F' }),
            el('div', { class: 'cs-sun' },
              el('label', {}, el('span', {}, 'Sunrise'), field('sunrise', { placeholder: '6:41 AM' })),
              el('label', {}, el('span', {}, 'Sunset'), field('sunset', { placeholder: '5:58 PM' }))))),

        el('div', { class: 'cs-grid' },
          box('Location', field('location', { multiline: true, placeholder: 'Address or set' })),
          box('Parking', field('parking', { multiline: true, placeholder: 'Where crew and cast park' })),
          box('Nearest hospital', field('hospital', { multiline: true, placeholder: 'Name, address, phone' }))),
        el('div', { class: 'cs-notes' }, box('Notes', field('notes', { multiline: true, placeholder: 'Safety, special instructions, meals…' }))),

        el('div', { class: 'sum-counts' }, [
          plural(d.scenes.length, 'scene'), d.eighths ? pagesLabel(d.eighths) : null, plural(d.shots.length, 'shot'),
          plural(d.cast.length, 'cast member'), plural(d.crew.length, 'crew member'),
        ].filter(Boolean).join(' · ')),

        el('h3', {}, 'Scenes'),
        table(['SC', 'Set & description', 'D/N', 'Cast', 'Pages', 'Shots'], d.scenes.map((s) => [
          sceneCode(p, s),
          el('div', {}, el('strong', {}, s.heading || 'Untitled scene'), s.synopsis ? el('div', { class: 'sum-sub' }, s.synopsis) : null),
          dayNight(s.heading),
          sceneCast(p, s).map(castNo).join(', ') || '—',
          s.eighths ? window.ScriptParse.formatEighths(s.eighths) : '—',
          String(s.shots.filter((x) => x.dayId === day.id).length),
        ]), 'No scenes scheduled yet. Assign shots to this day in the Schedule view.'),

        el('h3', {}, 'Cast'),
        table(['#', 'Character', 'Actor', 'Call', 'Scenes', 'Contact'], d.cast.map(({ c, scenes }) => [
          String(castNo(c)), c.name || 'Unnamed', c.actor || '—', callInput(c.id, day.call), scenes.map((s) => sceneCode(p, s)).join(', '), c.contact || '—',
        ]), 'No cast picked for these scenes. Choose cast per scene in the Shot List (Edit mode).'),

        el('h3', {}, 'Crew'),
        table(['Role', 'Name', 'Call', 'Contact'], d.crew.map(({ k }) => [
          k.role || '—', k.name || '—', callInput(k.id, day.crewCall), k.contact || '—',
        ]), 'No crew picked. Mark core crew as "Every day" in Cast & Crew, and choose crew per scene.'),

        el('div', { class: 'sum-columns' },
          el('div', {}, el('h3', {}, 'Equipment'), list(d.equipment, 'No equipment listed.')),
          el('div', {}, el('h3', {}, 'Props'), list(d.props, 'No props listed.'))),

        d.shotNotes.length ? el('h3', {}, 'Shot notes') : null,
        d.shotNotes.length ? el('ul', { class: 'sum-list' }, ...d.shotNotes.map((x) => el('li', {}, el('strong', {}, x.code + ' '), x.shot.notes))) : null,
        el('footer', { class: 'sum-foot' }, `${p.title} · Call sheet · Day ${n} · generated ${new Date().toLocaleDateString()}`)));
  }

  // ---------- Render ----------
  let historyFor = null; // the project the undo history belongs to
  function render({ keepScroll = false, remote = false } = {}) {
    const sheetEl = $('sheet');
    const top = sheetEl.scrollTop;
    renderSidebar();
    const p = active();
    // Opening another project starts a fresh undo history; a collaborator's edit becomes the
    // new starting point, so undo never reverses their work.
    if ((p && p.id) !== historyFor) { historyFor = p && p.id; undoHistory.reset(); }
    else if (remote) undoHistory.rebase();
    if (!remote) autoSync(p); // after the undo baseline, so the update can be undone
    undoUi.update();
    comments.refresh();
    const shownView = view === 'summary' ? 'schedule' : view;
    document.querySelectorAll('#viewToggle button').forEach((b) => b.classList.toggle('active', b.dataset.view === shownView));
    $('app').classList.toggle('summary-mode', view === 'summary');
    $('editBtn').textContent = editing ? 'Done' : 'Edit';
    $('editBtn').hidden = view !== 'shots' || collab.readOnly();
    $('resetBtn').hidden = editing || view !== 'shots' || collab.readOnly();
    $('app').classList.toggle('read-only', collab.readOnly());
    collab.updateToolbar();
    $('app').classList.toggle('editing', editing);
    $('app').classList.toggle('schedule-view', view === 'schedule');
    $('app').classList.toggle('is-empty', !p);
    if (!p) {
      // A shared production that's still loading.
      $('sections').replaceChildren(el('div', { class: 'empty' }, 'Opening the production…'));
      return;
    }
    if (view === 'shots' && !editing && !epScenes(p).length) {
      renderHeader(p);
      $('sections').replaceChildren(window.Common.emptyState({
        title: 'No scenes yet',
        text: isTv(p)
          ? `Build ${window.Production.episodeLabel(currentEpisode(p))}'s shot list from its script, or add scenes by hand.`
          : 'Build the shot list from the script, or add scenes by hand.',
        actions: [
          { label: 'Import script…', primary: true, onclick: importScript },
          { label: 'Add scenes', onclick: () => { if (!blockedReadOnly()) { editing = true; render(); } } },
          { label: 'Load example', onclick: loadExample },
        ],
      }));
      return;
    }
    if (dayFilter !== 'all' && dayFilter !== 'none' && !dayById(p, dayFilter)) dayFilter = 'all';
    renderHeader(p);
    if (view === 'schedule') renderSchedule(p);
    else if (view === 'people') renderPeople(p);
    else if (view === 'summary') renderSummary(p);
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
    if (v !== 'shots') editing = false;
    render();
    $('sheet').scrollTop = 0;
  }

  // ---------- Actions ----------
  // The example scenes, cast and crew, added to this (empty) production.
  function loadExample() {
    const p = active();
    if (!p || blockedReadOnly()) return;
    const sample = sampleProject();
    const toFile = JSON.parse(F.toShotsheet(sample));
    const ex = F.normalizeProject(toFile);
    p.characters.push(...ex.characters);
    p.crew.push(...ex.crew);
    p.days.push(...ex.days);
    ex.scenes.forEach((s) => { if (isTv(p)) s.episodeId = currentEpisode(p).id; });
    p.scenes.push(...ex.scenes);
    F.upgradeProject(p);
    save(); render();
    toast('Example scenes added');
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
    if (!active() || (!editing && blockedReadOnly())) return;
    if (view !== 'shots') { view = 'shots'; editing = true; }
    else editing = !editing;
    render({ keepScroll: true });
  }

  // ---------- Script import ----------
  const SCRIPT_EXTS = ['pdf', 'fdx', 'fountain', 'spmd', 'txt'];

  // Pick one of your Script Writer scripts, or a PDF / Final Draft / Fountain file.
  async function importScript() {
    const p = active();
    if (!p) return;
    // This production's scripts (for TV, the current episode's first).
    const ep = currentEpisode(p);
    const pick = await window.Common.pickScript((d) => d.productionId === p.id && (!ep || !d.episodeId || d.episodeId === ep.id));
    if (!pick) return;
    if (pick.doc) {
      const doc = window.Screenplay.normalizeDoc(pick.doc);
      if (!window.Screenplay.scenes(doc).length) { alert('This script has no scene headings yet.'); return; }
      const link = { scriptId: doc.id, title: doc.title, scenes: window.Screenplay.sceneLinks(doc) };
      if (await offerLinkedProject(link)) return;
      openScriptPreview(window.ScriptParse.parseScript(window.Screenplay.toParseInput(doc)), doc.title, link);
      return;
    }
    openScriptResult(pick.result);
  }

  // If this shot list already came from this script, review its changes instead of
  // importing it again. Returns true if that's what happened.
  async function offerLinkedProject(link) {
    const p = active();
    const current = linkOf(p);
    if (!current || current.scriptId !== link.scriptId) return false;
    await openLinkReview();
    return true;
  }

  // Puts a script's scenes into this production's shot list (the current episode's, for TV),
  // after the scenes already there or in their place. Characters are matched by name.
  function addScenesFromScript(raw, { replace, link, included, ignored }) {
    const p = active();
    const incoming = F.normalizeProject(raw);
    const nameOf = new Map(incoming.characters.map((c) => [c.id, c.name]));
    const scenes = incoming.scenes.map((s, k) => {
      s.cast = s.castIds.map((id) => nameOf.get(id)).filter(Boolean);
      s.castIds = [];
      if (isTv(p)) s.episodeId = currentEpisode(p).id;
      if (link) s.scriptScene = { ...link.scenes[included[k]], number: s.number };
      return s;
    });
    if (replace) {
      const mine = new Set(epScenes(p));
      p.scenes = p.scenes.filter((s) => !mine.has(s));
    }
    p.scenes.push(...scenes);
    if (link) setLinkOf(p, { scriptId: link.scriptId, title: link.title, auto: true, ignored });
    F.upgradeProject(p); // cast names → this production's characters
    return scenes;
  }

  function openScriptResult(result) {
    if (result.error) { alert(result.error); return; }
    let parsed;
    try {
      parsed = window.ScriptParse.parseScript(result.script);
    } catch (err) {
      alert(`${result.script.name}: ${err.message}`);
      return;
    }
    openScriptPreview(parsed, result.script.name);
  }

  // link (from the Script Writer): { scriptId, title, scenes: [{ id, hash }] } — one per script scene.
  function openScriptPreview(parsed, fileName, link) {
    const SP = window.ScriptParse;
    const p = active();
    const existing = epScenes(p).length;
    const check = (on) => el('input', { type: 'checkbox', checked: on });
    const opts = { establishing: check(true), master: check(true), coverage: check(true) };
    const sceneChecks = parsed.scenes.map(() => check(true));
    const create = el('button', { class: 'primary-btn' });
    const replaceBtn = existing ? el('button', { class: 'ghost-btn' }, 'Replace the shot list') : null;
    const summary = el('span', { class: 'muted small' });

    const currentOpts = () => ({
      include: new Set(sceneChecks.map((c, i) => (c.checked ? i : -1)).filter((i) => i >= 0)),
      establishing: opts.establishing.checked,
      master: opts.master.checked,
      coverage: opts.coverage.checked,
    });
    const update = () => {
      const raw = SP.buildProject(parsed, currentOpts());
      const shots = raw.scenes.reduce((n, s) => n + s.shots.length, 0);
      create.textContent = existing ? 'Add to the shot list' : 'Create shot list';
      create.disabled = !raw.scenes.length;
      if (replaceBtn) replaceBtn.disabled = !raw.scenes.length;
      summary.textContent = `${raw.scenes.length} scene${raw.scenes.length === 1 ? '' : 's'} · ${shots} starter shot${shots === 1 ? '' : 's'}`;
    };
    for (const c of [...Object.values(opts), ...sceneChecks]) c.addEventListener('change', update);
    const setAll = (on) => { sceneChecks.forEach((c) => (c.checked = on)); update(); };

    const body = el('div', { class: 'script-import' },
      el('p', { class: 'script-summary' },
        el('strong', {}, fileName),
        el('br'),
        `${parsed.scenes.length} scenes · ${parsed.characters.length} speaking characters · ${SP.formatEighths(parsed.totalEighths)} pages`),
      el('p', { class: 'muted small' }, (isTv(p) ? `Into ${window.Production.episodeLabel(currentEpisode(p))} of "${p.title}".` : `Into "${p.title}".`)
        + (existing ? ` Its shot list already has ${existing} scene${existing === 1 ? '' : 's'}: add these after them, or replace them.` : '')),
      el('div', { class: 'script-opts' },
        el('div', { class: 'field-label' }, 'Starter shots for each scene'),
        el('label', {}, opts.establishing, ' Establishing shot when the location changes'),
        el('label', {}, opts.master, ' Master wide shot'),
        el('label', {}, opts.coverage, ' Coverage of speaking characters (singles, two-shots, overs)')),
      el('div', { class: 'script-scenes-head' },
        el('span', { class: 'field-label' }, 'Scenes'),
        el('span', {},
          el('button', { class: 'link-btn', type: 'button', onclick: () => setAll(true) }, 'All'), ' · ',
          el('button', { class: 'link-btn', type: 'button', onclick: () => setAll(false) }, 'None'))),
      el('div', { class: 'script-scenes' }, ...parsed.scenes.map((s, i) => el('label', { class: 'script-scene' },
        sceneChecks[i],
        el('span', { class: 'shot-code small' }, s.number),
        el('span', { class: 'script-scene-main' },
          el('span', { class: 'script-scene-heading' }, s.heading),
          el('span', { class: 'muted small' }, [s.cast.join(', '), s.synopsis].filter(Boolean).join(' — '))),
        el('span', { class: 'muted small nowrap' }, pagesLabel(s.eighths))))),
      el('p', { class: 'muted small' }, 'Starter shots are a first pass. Adjust them in Edit mode.'),
      el('div', { class: 'modal-foot spread' }, summary, el('span', { class: 'foot-actions' }, replaceBtn, create)));
    const m = window.Common.modal('Import script', body, { wide: true });

    const go = (replace) => {
      if (blockedReadOnly()) return;
      if (replace && !confirm(`Replace the ${existing} scene${existing === 1 ? '' : 's'} in this shot list (and their shots)?`)) return;
      const o = currentOpts();
      // Remember where each scene came from, so later script changes can be flagged.
      // Unticked scenes are left out on purpose, so automatic updates don't add them.
      const linked = link && link.scenes.length === parsed.scenes.length;
      const scenes = addScenesFromScript(SP.buildProject(parsed, o), {
        replace,
        link: linked ? link : null,
        included: [...o.include].sort((a, b) => a - b),
        ignored: linked ? link.scenes.filter((_, i) => !o.include.has(i)).map((l) => l.id) : [],
      });
      m.close();
      editing = false; view = 'shots'; dayFilter = 'all';
      save(); render();
      const shots = scenes.reduce((n, s) => n + s.shots.length, 0);
      toast(`Added ${scenes.length} scenes and ${shots} shots from ${fileName}`);
    };
    create.addEventListener('click', () => go(false));
    if (replaceBtn) replaceBtn.addEventListener('click', () => go(true));
    update();
  }

  function ingest(files) {
    // Screenplays dropped on the window go through script import.
    const script = files.find((f) => SCRIPT_EXTS.includes(f.ext));
    if (script) {
      api.readDroppedScript(script.file).then(openScriptResult);
      files = files.filter((f) => f !== script);
      if (!files.length) return;
    }
    // A .shotsheet / backup file is a whole production: it's added as a new one.
    let added = 0, last = null;
    const errors = [];
    for (const f of files) {
      try {
        for (const p of F.importFile(f)) { state.projects.push(p); last = p; added++; }
      } catch (err) {
        errors.push(`${f.name}: ${err.message}`);
      }
    }
    if (errors.length) alert('Some files could not be imported:\n\n' + errors.join('\n'));
    if (last) {
      store.save();
      store.flush().then(() => {
        if (confirm(`Imported ${added} production${added > 1 ? 's' : ''}. Open "${last.title}" now?`)) {
          location.href = `dashboard.html?production=${encodeURIComponent(last.id)}`;
        }
      });
    }
  }

  async function importFiles() {
    ingest(await api.importFiles({ label: 'Shot Sheets', extensions: ['shotsheet', 'json', 'csv'] }));
  }

  async function exportAs(kind) {
    const p = active();
    if (!p && kind !== 'all') return;
    const name = p ? safeFileName(p.title) : 'shot-sheets';
    let saved = null;
    if (kind === 'pdf' && view === 'summary' && dayById(p, summaryDayId)) {
      saved = await api.exportPdf({ defaultName: `${name} - Day ${dayNum(p, summaryDayId)} call sheet.pdf` });
    } else if (kind === 'pdf') {
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
    $('homeBtn').addEventListener('click', () => window.Production.goHome(store));
    $('importBtn').addEventListener('click', importFiles);
    $('importScriptBtn').addEventListener('click', importScript);
    $('commentsBtn').addEventListener('click', () => active() && comments.open());
    // Coming back to the app: re-check linked scripts for changes.
    window.addEventListener('focus', async () => {
      const p = active();
      if (p && linkOf(p)) { await loadScripts(); render({ keepScroll: true }); }
    });
    $('resetBtn').addEventListener('click', resetChecks);
    $('editBtn').addEventListener('click', toggleEdit);
    $('sidebarToggle').addEventListener('click', toggleSidebar);
    $('titleInput').addEventListener('input', (e) => {
      const p = active();
      if (!p) return;
      p.title = e.target.value; save(); renderSidebar();
    });
    $('sheet').addEventListener('scroll', updateActiveTab, { passive: true });
    document.querySelectorAll('#viewToggle button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    window.Common.wireDropdowns();
    document.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => exportAs(b.dataset.export)));
    window.Common.onFileDrop(ingest);

    const lens = $('lensList');
    OPTIONS.lens.forEach((l) => lens.append(el('option', { value: l })));
    F.CREW_ROLES.forEach((r) => $('crewRoles').append(el('option', { value: r })));

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
        import: importFiles,
        importScript,
        export: () => exportAs(arg === 'native' ? 'shotsheet' : arg),
        home: () => window.Production.goHome(store),
        toggleEdit,
        reset: resetChecks,
        toggleSidebar,
        undo: () => active() && undoUi.run(false, true),
        redo: () => active() && undoUi.run(true, true),
        comments: () => active() && comments.open(),
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
    // This page shows one production: ?production=<id> (or the one last opened this session),
    // optionally &episode=<id>&view=schedule|people&date=YYYY-MM-DD.
    await window.Production.migrate();
    const q = new URLSearchParams(location.search);
    const pid = window.Production.id() || q.get('project');
    if (!pid) { window.Production.goPicker(); return; }
    const stored = await api.loadStore('shotsheets');
    state = { sidebarHidden: false, ...(stored || {}), projects: stored && Array.isArray(stored.projects) ? stored.projects : [] };
    state.projects.forEach(F.upgradeProject); // projects saved before cast & crew existed
    const local = state.projects.some((p) => p.id === pid);
    state.activeId = local ? pid : null;
    episodeFilter = q.get('episode');
    if (q.get('view') === 'schedule' || q.get('view') === 'people') view = q.get('view');
    if (q.get('date')) {
      selectedDate = q.get('date');
      const d = parseYmd(selectedDate);
      calMonth = { y: d.getFullYear(), m: d.getMonth() };
    }
    await loadScripts(); // to check projects linked to Script Writer scripts
    wire();
    collab.mountToolbar(document.querySelector('.toolbar'), $('resetBtn'));
    render();
    collab.init();
    // Not on this computer: a shared production, opened live from the server.
    if (!local) collab.open(pid);
    window.Common.initUpdates();
    // A script sent from the Script Writer ("Send to → Shot Sheet") opens the import preview.
    const handoff = window.Common.takeHandoff('shotsheet');
    if (handoff) {
      try {
        if (!(handoff.link && await offerLinkedProject(handoff.link))) {
          openScriptPreview(window.ScriptParse.parseScript(handoff.input), handoff.name, handoff.link);
        }
      } catch (err) {
        alert(err.message);
      }
    }
    const pending = await api.takePendingFile();
    if (pending) ingest([pending]);
  }

  init();
})();
