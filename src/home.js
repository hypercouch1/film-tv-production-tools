(function () {
  const { api, $, el } = window.Common;

  const LOGOS = {
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
  };

  // Add new systems here: they show up as tiles on the home screen.
  const SYSTEMS = [
    {
      id: 'callsheet',
      name: 'Call Sheet',
      tagline: 'Live show cue checklists',
      page: 'callsheet.html',
      store: 'callsheets',
      accent: '#e2332b',
      stats: (d) => {
        const n = d && d.sheets ? d.sheets.length : 0;
        return n ? `${n} call sheet${n === 1 ? '' : 's'}` : 'No call sheets yet';
      },
    },
    {
      id: 'shotsheet',
      name: 'Shot Sheet',
      tagline: 'Shot lists & shoot scheduling for film',
      page: 'shotsheet.html',
      store: 'shotsheets',
      accent: '#3aa7c9',
      stats: (d) => {
        const ps = d && d.projects ? d.projects : [];
        if (!ps.length) return 'No projects yet';
        const shots = ps.reduce((n, p) => n + p.scenes.reduce((m, s) => m + s.shots.length, 0), 0);
        return `${ps.length} project${ps.length === 1 ? '' : 's'} · ${shots} shots`;
      },
    },
  ];

  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  function renderTiles(data) {
    const wrap = $('tiles');
    SYSTEMS.forEach((sys, i) => {
      wrap.append(el('a', {
        class: 'tile',
        href: sys.page,
        style: `--accent:${sys.accent}`,
        title: `Open ${sys.name} (${i + 1})`,
      },
      el('div', { class: 'tile-logo', html: LOGOS[sys.id] }),
      el('div', { class: 'tile-name' }, sys.name),
      el('div', { class: 'tile-tag' }, sys.tagline),
      el('div', { class: 'tile-stats' }, sys.stats(data[sys.store]))));
    });
    wrap.append(el('div', { class: 'tile tile-soon' },
      el('div', { class: 'tile-logo', html: '<svg viewBox="0 0 64 64"><path d="M32 16v32M16 32h32" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>' }),
      el('div', { class: 'tile-name' }, 'More Coming'),
      el('div', { class: 'tile-tag' }, 'New systems will appear here')));
  }

  function renderUpcoming(shot) {
    const today = todayStr();
    const rows = [];
    for (const p of (shot && shot.projects) || []) {
      const days = [...p.days].sort((a, b) => a.date.localeCompare(b.date));
      days.forEach((d, i) => {
        if (d.date < today) return;
        const shots = p.scenes.reduce((n, s) => n + s.shots.filter((x) => x.dayId === d.id).length, 0);
        rows.push({ p, d, n: i + 1, shots });
      });
    }
    rows.sort((a, b) => a.d.date.localeCompare(b.d.date));
    if (!rows.length) return;
    $('upcoming').hidden = false;
    const list = $('upcomingList');
    for (const r of rows.slice(0, 8)) {
      const date = new Date(r.d.date + 'T00:00');
      const time = r.d.call
        ? new Date(`2000-01-01T${r.d.call}`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        : '';
      list.append(el('li', {},
        el('a', { href: `shotsheet.html?project=${encodeURIComponent(r.p.id)}&view=schedule&date=${r.d.date}` },
          el('div', { class: 'up-date' },
            el('span', { class: 'up-mon' }, date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()),
            el('span', { class: 'up-day' }, String(date.getDate()))),
          el('div', { class: 'up-body' },
            el('div', { class: 'up-title' }, `${r.p.title} — Day ${r.n}`),
            el('div', { class: 'up-meta' }, [
              date.toLocaleDateString(undefined, { weekday: 'long' }),
              time && `Call ${time}`,
              r.d.location,
              `${r.shots} shot${r.shots === 1 ? '' : 's'}`,
            ].filter(Boolean).join(' · '))))));
    }
  }

  async function init() {
    const data = {};
    await Promise.all(SYSTEMS.map(async (s) => { data[s.store] = await api.loadStore(s.store); }));
    renderTiles(data);
    renderUpcoming(data.shotsheets);

    $('account').append(window.Collab.accountButton());
    const greet = () => {
      $('homeSub').textContent = window.Cloud.signedIn
        ? `Signed in as ${window.Cloud.user.name}. Shared projects appear in each system's sidebar.`
        : 'Pick a system to get started. Sign in to share projects and work on them together.';
    };
    window.Cloud.onAuth(greet);
    greet();
    window.Cloud.refreshMe();

    document.addEventListener('keydown', (e) => {
      const sys = SYSTEMS[Number(e.key) - 1];
      if (sys && !e.ctrlKey && !e.metaKey) location.href = sys.page;
    });
    api.onMenu(() => {});
    window.Common.onFileDrop(() => alert('Open a system first, then drop files onto it to import.'));
  }

  init();
})();
