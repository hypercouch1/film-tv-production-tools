// A production's home: every tool for this film or TV show, plus its episodes and
// upcoming shoot days. Each tool opens scoped to this production.
(function () {
  const { api, $, el, toast, uid } = window.Common;
  const P = window.Production;

  const LOGOS = {
    writer: `
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M14 6h26l12 12v40H14z" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/>
        <path d="M40 6v12h12" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/>
        <line x1="21" y1="26" x2="45" y2="26" stroke="#e6cf2e" stroke-width="3" stroke-linecap="round"/>
        <line x1="29" y1="34" x2="41" y2="34" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
        <line x1="25" y1="41" x2="45" y2="41" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
        <line x1="21" y1="49" x2="38" y2="49" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
      </svg>`,
    shotsheet: `
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <rect x="8" y="26" width="48" height="30" rx="4" fill="none" stroke="currentColor" stroke-width="3.5"/>
        <g transform="rotate(-14 8 22)">
          <rect x="8" y="14" width="48" height="10" rx="2" fill="currentColor"/>
          <path d="M16 14l-6 10M27 14l-6 10M38 14l-6 10M49 14l-6 10" stroke="#16130f" stroke-width="4"/>
        </g>
        <path d="M8 26h48" stroke="currentColor" stroke-width="3.5"/>
        <path d="M14 33h36" stroke="#e6cf2e" stroke-width="3" stroke-linecap="round"/>
        <line x1="14" y1="41" x2="38" y2="41" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
        <line x1="14" y1="48" x2="32" y2="48" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
      </svg>`,
    schedule: `
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <rect x="8" y="12" width="48" height="44" rx="5" fill="none" stroke="currentColor" stroke-width="3.5"/>
        <path d="M8 24h48" stroke="currentColor" stroke-width="3.5"/>
        <path d="M20 6v12M44 6v12" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
        <rect x="15" y="31" width="9" height="7" rx="1.5" fill="#e6cf2e"/>
        <rect x="28" y="31" width="9" height="7" rx="1.5" fill="currentColor" opacity=".5"/>
        <rect x="41" y="31" width="9" height="7" rx="1.5" fill="currentColor" opacity=".5"/>
        <rect x="15" y="42" width="9" height="7" rx="1.5" fill="currentColor" opacity=".5"/>
        <rect x="28" y="42" width="9" height="7" rx="1.5" fill="#e6cf2e"/>
      </svg>`,
    people: `
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="24" cy="22" r="8" fill="none" stroke="currentColor" stroke-width="3.5"/>
        <path d="M10 50c1-9 7-14 14-14s13 5 14 14" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
        <circle cx="44" cy="24" r="6.5" fill="none" stroke="#e6cf2e" stroke-width="3"/>
        <path d="M40 37c7-1 13 4 14 12" fill="none" stroke="#e6cf2e" stroke-width="3" stroke-linecap="round"/>
      </svg>`,
    breakdown: `
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M14 6h26l12 12v40H14z" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/>
        <rect x="20" y="22" width="14" height="6" rx="2" fill="#e6cf2e"/>
        <rect x="20" y="33" width="24" height="6" rx="2" fill="#3aa7c9"/>
        <rect x="20" y="44" width="10" height="6" rx="2" fill="#e2332b"/>
      </svg>`,
    locations: `
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M32 58s-17-17-17-30a17 17 0 0 1 34 0c0 13-17 30-17 30z" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/>
        <circle cx="32" cy="28" r="6.5" fill="#e6cf2e"/>
      </svg>`,
    post: `
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <rect x="8" y="8" width="48" height="30" rx="4" fill="none" stroke="currentColor" stroke-width="3.5"/>
        <path d="M28 16v14l11-7z" fill="#e6cf2e"/>
        <line x1="8" y1="46" x2="56" y2="46" stroke="currentColor" stroke-width="2" opacity=".5"/>
        <rect x="10" y="42" width="18" height="8" rx="2" fill="currentColor"/>
        <rect x="31" y="42" width="12" height="8" rx="2" fill="#e6cf2e"/>
        <rect x="46" y="42" width="8" height="8" rx="2" fill="currentColor" opacity=".55"/>
        <rect x="16" y="53" width="26" height="5" rx="2" fill="currentColor" opacity=".55"/>
        <line x1="36" y1="39" x2="36" y2="60" stroke="#e2332b" stroke-width="2.5" stroke-linecap="round"/>
      </svg>`,
    budget: `
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <rect x="10" y="6" width="44" height="52" rx="5" fill="none" stroke="currentColor" stroke-width="3.5"/>
        <rect x="17" y="13" width="30" height="10" rx="2" fill="#e6cf2e"/>
        <circle cx="21" cy="32" r="2.6" fill="currentColor"/><circle cx="32" cy="32" r="2.6" fill="currentColor"/><circle cx="43" cy="32" r="2.6" fill="currentColor"/>
        <circle cx="21" cy="41" r="2.6" fill="currentColor"/><circle cx="32" cy="41" r="2.6" fill="currentColor"/><circle cx="43" cy="41" r="2.6" fill="currentColor"/>
        <circle cx="21" cy="50" r="2.6" fill="currentColor"/><circle cx="32" cy="50" r="2.6" fill="currentColor"/>
        <rect x="40" y="47.5" width="6" height="5" rx="1.5" fill="#e2332b"/>
      </svg>`,
    onset: `
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <rect x="6" y="12" width="36" height="24" rx="4" fill="none" stroke="currentColor" stroke-width="3.5"/>
        <path d="M42 20l14-7v22l-14-7z" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/>
        <circle cx="14" cy="20" r="3.2" fill="#e2332b"/>
        <rect x="20" y="26" width="16" height="5" rx="1.5" fill="#e6cf2e"/>
        <path d="M24 36l-10 22M24 36l10 22M24 36v22" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
      </svg>`,
    gear: `
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <rect x="12" y="8" width="30" height="26" rx="5" fill="none" stroke="currentColor" stroke-width="3.5"/>
        <circle cx="27" cy="21" r="7.5" fill="#e6cf2e"/>
        <path d="M42 13l12-5v26l-12-5" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
        <path d="M27 34v14M27 48l-12 10M27 48l12 10M27 48v10" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
        <circle cx="50" cy="50" r="5" fill="#e2332b"/>
      </svg>`,
    callsheet: `
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <rect x="12" y="8" width="40" height="50" rx="5" fill="none" stroke="currentColor" stroke-width="3.5"/>
        <rect x="23" y="4" width="18" height="9" rx="2.5" fill="currentColor"/>
        <rect x="19" y="22" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="2.5"/>
        <path d="M20.5 25.5l1.8 1.8 3.4-3.6" fill="none" stroke="#e6cf2e" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="31" y1="25.5" x2="45" y2="25.5" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
        <rect x="19" y="35" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="2.5"/>
        <line x1="31" y1="38.5" x2="45" y2="38.5" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
        <circle cx="47" cy="50" r="5" fill="#e2332b"/>
      </svg>`,
  };

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

  let shots = null;     // the 'shotsheets' store (productions)
  let prod = null;      // this production
  let scripts = [];     // this production's scripts ({ id, title, episodeId })
  let sheets = [];      // this production's call sheets
  let post = null;      // this production's post document (on this computer)
  let budget = null;    // this production's budget (on this computer)
  let onset = null;     // this production's reports and continuity notes (on this computer)
  let gear = null;      // this production's equipment list (on this computer)
  let session = null;   // a shared production: its live connection
  let role = 'owner';   // your role in a shared production

  const readOnly = () => !!session && role === 'viewer';
  const saveProduction = async () => {
    prod.updatedAt = Date.now();
    if (session) session.commit();
    else await api.saveStore('shotsheets', shots);
  };

  // The tools, in tile order (number keys 1–7 open them).
  function systems() {
    const scenes = prod.scenes;
    const shotCount = scenes.reduce((n, s) => n + s.shots.length, 0);
    const days = [...prod.days].sort((a, b) => a.date.localeCompare(b.date));
    const next = days.find((d) => d.date >= todayStr());
    const tv = prod.type === 'tv';
    const withScripts = tv ? prod.episodes.filter((e) => scripts.some((s) => s.episodeId === e.id)).length : 0;
    return [
      { id: 'writer', name: 'Script', tag: tv ? 'One script per episode' : 'Write the screenplay, formatted automatically', page: 'writer.html', accent: '#e6cf2e',
        stats: tv ? `${withScripts} of ${plural(prod.episodes.length, 'episode')} written` : scripts.length ? scripts[0].title || 'Untitled script' : 'No script yet' },
      { id: 'shotsheet', name: 'Shot Sheet', tag: 'Scenes and shots, linked to the script', page: 'shotsheet.html', accent: '#3aa7c9',
        stats: scenes.length ? `${plural(scenes.length, 'scene')} · ${plural(shotCount, 'shot')}` : 'No scenes yet' },
      { id: 'schedule', name: 'Schedule', tag: 'Calendar, stripboard, day out of days and availability', page: 'schedule.html', accent: '#9b7be0',
        stats: days.length ? `${plural(days.length, 'shoot day')}${next ? ' · next ' + new Date(next.date + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}` : 'No shoot days yet' },
      { id: 'people', name: 'Cast & Crew', tag: 'Characters, actors, crew and contacts', page: 'shotsheet.html', params: { view: 'people' }, accent: '#5fbf8f',
        stats: `${plural(prod.characters.length, 'character')} · ${prod.crew.length} crew` },
      { id: 'callsheet', name: 'Call Sheets', tag: 'Cue checklists for the shoot or live show', page: 'callsheet.html', accent: '#e2332b',
        stats: sheets.length ? plural(sheets.length, 'call sheet') : 'No call sheets yet' },
      { id: 'breakdown', name: 'Breakdown', tag: 'Props, wardrobe, vehicles and more, per scene', page: 'breakdown.html', accent: '#a98be8',
        stats: (() => {
          const n = (prod.elements || []).filter((e) => e.sceneIds.length).length;
          return n ? `${plural(n, 'item')} added by hand · plus script tags` : 'Tag the script, or add items per scene';
        })() },
      { id: 'onset', name: 'On Set', tag: 'Daily production reports and continuity notes with photos', page: 'onset.html', accent: '#f08bb4',
        stats: onset ? [onset.reports.length && plural(onset.reports.length, 'report'), onset.notes.length && plural(onset.notes.length, 'continuity note')].filter(Boolean).join(' · ') || 'No reports yet'
          : session ? 'Reports and continuity' : 'No reports yet' },
      { id: 'post', name: 'Post', tag: 'Take log, media catalogue, post tracker, cuts & notes', page: 'post.html', accent: '#7fd0ea',
        stats: post ? [post.takes.length && plural(post.takes.length, 'take'), post.media.length && plural(post.media.length, 'file'),
          post.tasks.filter((t) => t.status !== 'done').length && plural(post.tasks.filter((t) => t.status !== 'done').length, 'open task')].filter(Boolean).join(' · ') || 'Nothing logged yet'
          : session ? 'Take log, media, tracker and cuts' : 'Nothing logged yet' },
      // The budget is for the owner and editors of a shared production only.
      ...(session && role === 'viewer' ? [] : [{ id: 'budget', name: 'Budget', tag: 'Top sheet, detail, costs and cost report', page: 'budget.html', accent: '#6fcf7a',
        stats: budget ? (budget.lines.length || budget.costs.length ? (() => {
          const t = window.BudgetFormats.totals(budget);
          const m = (n) => `${budget.currency}${Math.round(n).toLocaleString()}`;
          return `${m(t.total)} · ${t.actual ? m(t.actual) + ' spent' : plural(budget.lines.length, 'line')}`;
        })() : 'No lines yet')
          : session ? 'Owner and editors only' : 'Not started yet' }]),
      { id: 'gear', name: 'Equipment', tag: 'Gear lists, rentals and check-out', page: 'gear.html', accent: '#e6cf2e',
        stats: gear ? (gear.items.length ? (() => {
          const out = gear.items.filter((i) => i.status === 'out').length;
          const late = gear.items.filter((i) => window.GearFormats.overdue(i, todayStr())).length;
          return [plural(gear.items.length, 'item'), out && `${out} out`, late && `${late} overdue`].filter(Boolean).join(' · ');
        })() : 'Nothing listed yet')
          : session ? 'Gear, rentals and check-out' : 'Nothing listed yet' },
      { id: 'locations', name: 'Locations', tag: 'Addresses, contacts, permits and parking', page: 'locations.html', accent: '#f2994a',
        stats: (() => {
          const locs = prod.locations || [];
          const pending = locs.filter((l) => l.permit === 'needed' || l.permit === 'requested').length;
          return locs.length ? `${plural(locs.length, 'location')}${pending ? ` · ${pending} permit${pending === 1 ? '' : 's'} pending` : ''}` : 'No locations yet';
        })() },
    ];
  }

  function renderTiles() {
    const wrap = $('tiles');
    wrap.innerHTML = '';
    systems().forEach((sys, i) => {
      if (sys.soon) {
        wrap.append(el('div', { class: 'tile tile-soon', style: `--accent:${sys.accent || 'var(--muted)'}` },
          el('div', { class: 'tile-logo', html: LOGOS[sys.id] }),
          el('div', { class: 'tile-name' }, sys.name),
          el('div', { class: 'tile-tag' }, sys.tag),
          el('div', { class: 'tile-stats' }, 'Coming soon')));
        return;
      }
      wrap.append(el('a', {
        class: 'tile', href: P.link(sys.page, sys.params), style: `--accent:${sys.accent}`, title: `Open ${sys.name} (${i + 1})`,
      },
      el('div', { class: 'tile-logo', html: LOGOS[sys.id] }),
      el('div', { class: 'tile-name' }, sys.name),
      el('div', { class: 'tile-tag' }, sys.tag),
      el('div', { class: 'tile-stats' }, sys.stats)));
    });
  }

  // ---- TV: episodes ----
  function renderEpisodes() {
    $('episodes').hidden = prod.type !== 'tv';
    if (prod.type !== 'tv') return;
    const list = $('episodeList');
    list.innerHTML = '';
    for (const e of prod.episodes) {
      const script = scripts.find((s) => s.episodeId === e.id);
      const scenes = prod.scenes.filter((s) => s.episodeId === e.id);
      const shotCount = scenes.reduce((n, s) => n + s.shots.length, 0);
      const num = el('input', { class: 'field ep-num', value: e.number, title: 'Episode number', onchange: async (ev) => { e.number = ev.target.value.trim() || e.number; await saveProduction(); render(); } });
      const title = el('input', { class: 'field ep-title', value: e.title, placeholder: 'Episode title', onchange: async (ev) => { e.title = ev.target.value.trim(); await saveProduction(); } });
      list.append(el('div', { class: 'episode-row' },
        el('span', { class: 'ep-label' }, 'EP'), num, title,
        el('span', { class: 'muted small ep-stats' }, [script ? (script.title || 'Script') : 'No script yet', scenes.length ? `${plural(scenes.length, 'scene')} · ${plural(shotCount, 'shot')}` : null].filter(Boolean).join(' · ')),
        el('a', { class: 'ghost-btn', href: P.link('writer.html', { episode: e.id }) }, 'Script'),
        el('a', { class: 'ghost-btn', href: P.link('shotsheet.html', { episode: e.id }) }, 'Shot list'),
        el('button', { class: 'icon-btn del', type: 'button', title: 'Delete episode', onclick: () => deleteEpisode(e) }, '✕')));
    }
  }

  async function addEpisode() {
    const nums = prod.episodes.map((e) => parseInt(e.number, 10)).filter((n) => !isNaN(n));
    prod.episodes.push({ id: uid(), number: String(nums.length ? Math.max(...nums) + 1 : 1), title: '', scriptLink: null });
    await saveProduction();
    render();
    const inputs = document.querySelectorAll('.ep-title');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  async function deleteEpisode(e) {
    if (readOnly()) { toast('You have view-only access'); return; }
    if (prod.episodes.length === 1) { toast('A TV show needs at least one episode'); return; }
    const scenes = prod.scenes.filter((s) => s.episodeId === e.id);
    const script = scripts.find((s) => s.episodeId === e.id);
    const what = [scenes.length && plural(scenes.length, 'scene'), script && 'its script'].filter(Boolean).join(' and ');
    if (!confirm(`Delete episode ${e.number}${what ? ` with ${what}` : ''}? This can't be undone.`)) return;
    prod.episodes.splice(prod.episodes.indexOf(e), 1);
    prod.scenes = prod.scenes.filter((s) => s.episodeId !== e.id);
    await saveProduction();
    if (script && session) {
      try { await window.Cloud.deleteProject(script.id); } catch (err) { alert(err.message); }
      scripts = scripts.filter((s) => s !== script);
    } else if (script) {
      const data = (await api.loadStore('scripts')) || {};
      data.scripts = (data.scripts || []).filter((s) => s.id !== script.id);
      await api.saveStore('scripts', data);
      scripts = scripts.filter((s) => s !== script);
    }
    render();
  }

  // ---- Upcoming shoot days ----
  function renderUpcoming() {
    const today = todayStr();
    const days = [...prod.days].sort((a, b) => a.date.localeCompare(b.date));
    const rows = days.map((d, i) => ({ d, n: i + 1 })).filter((r) => r.d.date >= today).slice(0, 6);
    $('upcoming').hidden = !rows.length;
    const list = $('upcomingList');
    list.innerHTML = '';
    for (const { d, n } of rows) {
      const date = new Date(d.date + 'T00:00');
      const shotsThatDay = prod.scenes.reduce((m, s) => m + s.shots.filter((x) => x.dayId === d.id).length, 0);
      const time = d.call ? new Date(`2000-01-01T${d.call}`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
      list.append(el('li', {},
        el('a', { href: P.link('schedule.html', { date: d.date }) },
          el('div', { class: 'up-date' },
            el('span', { class: 'up-mon' }, date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()),
            el('span', { class: 'up-day' }, String(date.getDate()))),
          el('div', { class: 'up-body' },
            el('div', { class: 'up-title' }, `Day ${n}`),
            el('div', { class: 'up-meta' }, [date.toLocaleDateString(undefined, { weekday: 'long' }), time && `Call ${time}`, d.location, plural(shotsThatDay, 'shot')].filter(Boolean).join(' · '))))));
    }
  }

  function renderHeader() {
    document.title = `${prod.title} — Production Tools`;
    $('prodTitle').textContent = prod.title;
    $('prodType').textContent = P.typeLabel(prod);
    $('prodType').className = 'prod-type-pill' + (prod.type === 'tv' ? ' tv' : '');
    $('homeSub').textContent = prod.type === 'tv'
      ? 'Cast, crew, locations and the schedule are shared by every episode. Each episode has its own script and shot list.'
      : 'Everything for this film: script, shot list, schedule, cast & crew and call sheets.';
    $('shareBtn').textContent = session ? 'People' : 'Share';
    $('deleteProduction').textContent = session && role !== 'owner' ? 'Leave production' : session ? 'Delete for everyone' : 'Delete production';
    document.body.classList.toggle('read-only', readOnly());
  }

  function render() {
    renderHeader();
    renderTiles();
    renderEpisodes();
    renderUpcoming();
  }

  function wireTitle() {
    const h = $('prodTitle');
    const input = $('prodTitleInput');
    h.addEventListener('click', () => { input.value = prod.title; h.hidden = true; input.hidden = false; input.focus(); input.select(); });
    const done = async () => {
      if (input.hidden) return;
      const t = input.value.trim();
      input.hidden = true; h.hidden = false;
      if (t && t !== prod.title) { prod.title = t; await saveProduction(); render(); }
    };
    input.addEventListener('blur', done);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = prod.title; input.blur(); } });
  }

  async function deleteProduction() {
    const parts = [scripts.length && plural(scripts.length, 'script'), prod.scenes.length && plural(prod.scenes.length, 'scene'), sheets.length && plural(sheets.length, 'call sheet')].filter(Boolean);
    if (session && role !== 'owner') {
      if (!confirm(`Leave "${prod.title}"? You'll lose access until the owner adds you again.`)) return;
      session.close();
      try { await window.Cloud.deleteProject(prod.id); } catch (err) { alert(err.message); return; }
      P.goPicker();
      return;
    }
    if (!confirm(`Delete "${prod.title}"${session ? ' for everyone' : ''}${parts.length ? ` and everything in it (${parts.join(', ')})` : ''}? This can't be undone.`)) return;
    if (session) {
      session.close();
      try { await window.Cloud.deleteProject(prod.id); } catch (err) { alert(err.message); return; }
      P.goPicker();
      return;
    }
    shots.projects = shots.projects.filter((p) => p.id !== prod.id);
    await api.saveStore('shotsheets', shots);
    const sd = (await api.loadStore('scripts')) || {};
    sd.scripts = (sd.scripts || []).filter((s) => s.productionId !== prod.id);
    await api.saveStore('scripts', sd);
    const cd = (await api.loadStore('callsheets')) || {};
    cd.sheets = (cd.sheets || []).filter((s) => s.productionId !== prod.id);
    await api.saveStore('callsheets', cd);
    for (const key of ['post', 'budget', 'onset', 'gear']) {
      const data = (await api.loadStore(key)) || {};
      const gone = (data.docs || []).filter((s) => s.productionId === prod.id);
      data.docs = (data.docs || []).filter((s) => s.productionId !== prod.id);
      await api.saveStore(key, data);
      // Continuity photos kept on this computer go too.
      if (key === 'onset') for (const d of gone) for (const n of d.notes || []) for (const id of n.photos || []) await api.deletePhoto(id).catch(() => {});
    }
    P.goPicker();
  }

  // A shared production: connect live, so renames and episodes sync with everyone.
  function connect(pid) {
    return new Promise((resolve) => {
      let first = true;
      session = window.Cloud.connect(pid, {
        getLocal: () => prod,
        onDoc: (doc) => {
          prod = window.ShotFormats.upgradeProject({ ...doc, id: pid });
          if (first) { first = false; resolve(true); } else render();
        },
        onStatus: (s) => { const n = $('liveStatus'); n.hidden = false; n.className = 'live-status ' + s; n.textContent = { live: 'Live', connecting: 'Connecting…', offline: 'Offline · will sync', gone: 'Disconnected' }[s] || s; },
        onRole: (r) => { role = r; if (!first) render(); },
        onError: (msg) => toast(msg),
        onGone: (msg) => { alert(msg); P.goPicker(); },
      });
      // Not reachable (or no access): back to the list after a while.
      setTimeout(() => { if (first) resolve(false); }, 15000);
    });
  }

  async function share() {
    if (session) {
      P.openPeople(prod.id, { title: prod.title, role, onDelete: deleteProduction });
      return;
    }
    if (await P.share(prod.id)) location.reload();
  }

  // A production on this computer: what's in it, for the tiles.
  async function loadLocal(pid) {
    window.ShotFormats.upgradeProject(prod);
    const sd = (await api.loadStore('scripts')) || {};
    scripts = (sd.scripts || []).filter((s) => s.productionId === pid);
    const cd = (await api.loadStore('callsheets')) || {};
    sheets = (cd.sheets || []).filter((s) => s.productionId === pid);
    const pd = (await api.loadStore('post')) || {};
    const raw = (pd.docs || []).find((x) => x.productionId === pid);
    post = raw ? window.PostFormats.normalizePost(raw) : null;
    const bd = (await api.loadStore('budget')) || {};
    const rawBudget = (bd.docs || []).find((x) => x.productionId === pid);
    budget = rawBudget ? window.BudgetFormats.normalizeBudget(rawBudget) : null;
    const od = (await api.loadStore('onset')) || {};
    const rawOnset = (od.docs || []).find((x) => x.productionId === pid);
    onset = rawOnset ? window.OnsetFormats.normalizeOnset(rawOnset) : null;
    const gd = (await api.loadStore('gear')) || {};
    const rawGear = (gd.docs || []).find((x) => x.productionId === pid);
    gear = rawGear ? window.GearFormats.normalizeGear(rawGear) : null;
  }

  async function init() {
    const pid = P.id();
    await P.migrate();
    shots = (await api.loadStore('shotsheets')) || { projects: [] };
    shots.projects = Array.isArray(shots.projects) ? shots.projects : [];
    prod = shots.projects.find((p) => p.id === pid);
    $('account').append(window.Collab.accountButton());
    if (!prod) {
      if (!pid) { P.goPicker(); return; }
      if (!window.Cloud.signedIn) {
        $('homeSub').textContent = 'This production is shared online. Sign in to open it.';
        window.Cloud.onAuth(() => location.reload());
        return;
      }
      $('homeSub').textContent = 'Opening the shared production…';
      if (!(await connect(pid))) { alert("Couldn't open this production. Check your connection, or ask the owner to add you."); P.goPicker(); return; }
      try {
        scripts = await window.Cloud.projects('script', pid);
        sheets = await window.Cloud.projects('callsheet', pid);
      } catch { /* offline: counts fill in later */ }
    } else {
      await loadLocal(pid);
      // Split screen: keep the tiles current while the other side is edited.
      for (const key of ['shotsheets', 'scripts', 'callsheets', 'post', 'budget', 'onset', 'gear']) {
        window.Common.onStoreChanged(key, async () => {
          if (key === 'shotsheets') {
            shots = (await api.loadStore('shotsheets')) || { projects: [] };
            prod = (shots.projects || []).find((p) => p.id === pid) || prod;
          }
          await loadLocal(pid);
          render();
        });
      }
    }
    render();
    wireTitle();
    $('shareBtn').addEventListener('click', share);
    $('addEpisode').addEventListener('click', addEpisode);
    $('deleteProduction').addEventListener('click', deleteProduction);
    $('backLink').addEventListener('click', (e) => { e.preventDefault(); P.goPicker(); });
    window.addEventListener('pagehide', () => session && session.close());

    window.Cloud.refreshMe();
    window.Common.initUpdates();
    document.addEventListener('keydown', (e) => {
      if (/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName) || e.ctrlKey || e.metaKey) return;
      const sys = systems().filter((s) => !s.soon)[Number(e.key) - 1];
      if (sys) location.href = P.link(sys.page, sys.params);
    });
    api.onMenu((channel) => { if (channel === 'home') P.goPicker(); });
    window.Common.onFileDrop(() => toast('Open the Script or Shot Sheet first, then drop files onto it to import.'));
  }

  init();
})();
