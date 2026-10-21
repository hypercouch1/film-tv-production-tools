// Start screen: every production (film or TV show) on this computer and shared with you.
// Choosing one opens its dashboard, where the script, shot sheet, schedule and the rest live.
(function () {
  const { api, $, el, modal, toast, relTime } = window.Common;
  const P = window.Production;

  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const open = (id) => { location.href = `dashboard.html?production=${encodeURIComponent(id)}`; };

  function summary(p) {
    const scenes = p.scenes || [];
    const shots = scenes.reduce((n, s) => n + (s.shots || []).length, 0);
    const next = [...(p.days || [])].map((d) => d.date).sort().find((d) => d >= todayStr());
    return [
      p.type === 'tv' ? `${p.episodes.length} episode${p.episodes.length === 1 ? '' : 's'}` : null,
      scenes.length ? `${scenes.length} scene${scenes.length === 1 ? '' : 's'} · ${shots} shot${shots === 1 ? '' : 's'}` : 'No scenes yet',
      next ? 'Next shoot ' + new Date(next + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null,
    ].filter(Boolean).join(' · ');
  }

  const card = (p, { shared } = {}) => el('a', {
    class: 'prod-card' + (p.type === 'tv' ? ' tv' : ''), href: `dashboard.html?production=${encodeURIComponent(p.id)}`,
  },
  el('div', { class: 'prod-kind' }, P.typeLabel(p), shared ? el('span', { class: 'prod-shared-badge' }, '☁ ' + shared) : null),
  el('div', { class: 'prod-title' }, p.title || 'Untitled'),
  el('div', { class: 'prod-meta' }, shared ? `Shared · edited ${relTime(p.updatedAt || Date.now())}` : summary(p)),
  shared ? null : el('div', { class: 'prod-when' }, 'Edited ' + relTime(p.updatedAt || Date.now())));

  function newProduction() {
    const title = el('input', { class: 'field', placeholder: 'e.g. Night Diner', required: true });
    const kind = (value, label, sub, checked) => el('label', { class: 'kind-opt' },
      el('input', { type: 'radio', name: 'kind', value, checked }),
      el('span', {}, el('strong', {}, label), el('span', { class: 'muted small' }, sub)));
    const film = kind('film', 'Film', 'One script and one shot list', true);
    const tv = kind('tv', 'TV show', 'Episodes, each with its own script and shot list; cast, crew, locations and the schedule are shared', false);
    const create = el('button', { class: 'primary-btn', type: 'submit' }, 'Create production');
    const form = el('form', { class: 'new-prod' },
      el('label', { class: 'form-field' }, el('span', {}, 'Title'), title),
      el('div', { class: 'kind-opts' }, film, tv),
      el('div', { class: 'modal-foot' }, create));
    const m = modal('New production', form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const type = form.querySelector('input[name=kind]:checked').value;
      const p = P.upgrade(window.ShotFormats.upgradeProject(P.blank(title.value.trim() || 'Untitled Production', type)));
      const data = (await api.loadStore('shotsheets')) || {};
      data.projects = Array.isArray(data.projects) ? data.projects : [];
      data.projects.push(p);
      await api.saveStore('shotsheets', data);
      m.close();
      open(p.id);
    });
  }

  function renderUpcoming(productions) {
    const today = todayStr();
    const rows = [];
    for (const p of productions) {
      const days = [...p.days].sort((a, b) => a.date.localeCompare(b.date));
      days.forEach((d, i) => {
        if (d.date < today) return;
        const shots = p.scenes.reduce((n, s) => n + s.shots.filter((x) => x.dayId === d.id).length, 0);
        rows.push({ p, d, n: i + 1, shots });
      });
    }
    rows.sort((a, b) => a.d.date.localeCompare(b.d.date));
    $('upcoming').hidden = !rows.length;
    const list = $('upcomingList');
    list.innerHTML = '';
    for (const r of rows.slice(0, 8)) {
      const date = new Date(r.d.date + 'T00:00');
      const time = r.d.call ? new Date(`2000-01-01T${r.d.call}`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
      list.append(el('li', {},
        el('a', { href: `shotsheet.html?production=${encodeURIComponent(r.p.id)}&view=schedule&date=${r.d.date}` },
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

  async function renderShared() {
    const wrap = $('shared');
    if (!window.Cloud.signedIn || !window.Cloud.serverUrl()) { $('sharedSection').hidden = true; return; }
    try {
      const list = await window.Cloud.projects('shotsheet');
      $('sharedSection').hidden = !list.length;
      wrap.replaceChildren(...list.map((p) => card({ id: p.id, title: p.title, type: p.type || 'film', updatedAt: p.updatedAt },
        { shared: p.role === 'owner' ? 'Yours' : p.ownerName })));
    } catch (err) {
      $('sharedSection').hidden = false;
      wrap.replaceChildren(el('div', { class: 'list-note' }, err.message));
    }
  }

  async function init() {
    P.remember(null);
    const productions = await P.list();
    $('productions').replaceChildren(
      el('button', { class: 'prod-card prod-new', type: 'button', onclick: newProduction },
        el('div', { class: 'prod-plus' }, '+'),
        el('div', { class: 'prod-title' }, 'New production'),
        el('div', { class: 'prod-meta' }, 'A film, or a TV show with episodes')),
      ...productions.map((p) => card(p)));
    renderUpcoming(productions);

    $('account').append(window.Collab.accountButton());
    const greet = () => {
      $('homeSub').textContent = window.Cloud.signedIn
        ? `Signed in as ${window.Cloud.user.name}. Choose a production, or start a new one.`
        : 'Choose a production, or start a new one. Sign in to share productions and work on them together.';
      renderShared();
    };
    window.Cloud.onAuth(greet);
    greet();
    window.Cloud.refreshMe();
    window.Common.initUpdates();
    window.addEventListener('focus', renderShared);
    api.onMenu((channel) => { if (channel === 'new') newProduction(); });
    window.Common.onFileDrop(() => toast('Open a production first, then drop files onto the Script Writer or Shot Sheet.'));
  }

  init();
})();
