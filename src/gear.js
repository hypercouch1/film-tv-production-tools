// A production's equipment and rentals: what's needed, where it comes from and what it costs,
// which shoot days it's needed on, and who has it (check out / check in, with a log). Rentals
// with a rate become budget lines (Budget → Build from production). Its data is a separate
// gear document (gear-formats.js).
(function () {
  const { api, $, el, toast, modal } = window.Common;
  const P = window.Production;
  const GF = window.GearFormats;
  const SF = window.ShotFormats;

  let state = { docs: [], activeId: null };
  let prod = null;
  let cloudProd = false;
  let view = 'list';          // 'list' | 'days' | 'log'
  let catFilter = '';
  let search = '';
  let message = null;
  const open = new Set();     // items showing serial and notes

  const store = window.Common.createStore('gear', () => ({ ...state, docs: collab.localOnly(state.docs) }),
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
    kind: 'gear', listKey: 'docs', noun: 'equipment list', nounPlural: 'equipment lists',
    getState: () => state,
    render: (opts = {}) => render(opts),
    renderSidebar: () => {},
    save: () => store.save(),
    normalize: (doc) => GF.normalizeGear(doc),
    selectLocal: () => P.goHome(store),
    onRoleChange: () => render(),
    production: true,
    parent: () => (cloudProd ? prod.id : null),
    productionTitle: () => (cloudProd ? prod.title : null),
    share: async () => { await store.flush(); if (await P.share(prod.id)) location.reload(); },
  });
  const ro = () => collab.readOnly();

  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = () => { const t = new Date(); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };
  const fmtDate = (s, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => new Date(s + 'T00:00').toLocaleDateString(undefined, opts);
  const sortedDays = () => [...prod.days].sort((a, b) => a.date.localeCompare(b.date));
  const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const statusLabel = (k) => (GF.STATUSES.find(([x]) => x === k) || [k, k])[1];
  const select = (options, value, onchange, attrs = {}) => {
    const s = el('select', { class: 'field', disabled: ro(), onchange: (e) => onchange(e.target.value), ...attrs }, ...options.map(([v, label]) => el('option', { value: v }, label)));
    s.value = value;
    return s;
  };

  // ---------- Check out / in ----------
  function checkOut(d, item) {
    const who = prompt(`Who is taking "${item.name || 'this'}"?`, item.holder || '');
    if (who == null) return;
    item.status = 'out'; item.holder = who.trim();
    d.log.push({ id: GF.uid(), itemId: item.id, action: 'out', who: item.holder, at: Date.now(), note: '' });
    save(); render({ keepScroll: true });
  }
  function checkIn(d, item) {
    d.log.push({ id: GF.uid(), itemId: item.id, action: 'in', who: item.holder, at: Date.now(), note: '' });
    item.status = 'returned'; item.holder = '';
    save(); render({ keepScroll: true });
  }

  // The shoot days an item is needed on (none ticked: every day).
  function daysDialog(d, item) {
    const days = sortedDays();
    const boxes = days.map((day, i) => ({ day, box: el('input', { type: 'checkbox', checked: item.dayIds.includes(day.id), disabled: ro() }), n: i + 1 }));
    const body = el('div', {},
      el('p', { class: 'muted small' }, 'Tick the shoot days it’s needed. With none ticked, it’s needed every shoot day (between its pickup and return dates, if set).'),
      el('div', { class: 'av-people' }, ...(days.length ? boxes.map(({ day, box, n }) => el('label', { class: 'av-pick' }, box, el('span', {}, el('strong', {}, `Day ${n}`), el('span', { class: 'muted small' }, ` ${fmtDate(day.date)}${day.location ? ' · ' + day.location.split('\n')[0] : ''}`)))) : [el('p', { class: 'muted' }, 'No shoot days scheduled yet.')])),
      el('div', { class: 'modal-foot' }, ro() ? null : el('button', { class: 'primary-btn', type: 'button', onclick: () => {
        item.dayIds = boxes.filter((b) => b.box.checked).map((b) => b.day.id);
        save(); render({ keepScroll: true }); m.close();
      } }, 'Done')));
    const m = modal(`Days for ${item.name || 'this item'}`, body);
  }

  // ---------- List ----------
  function renderList(d) {
    const wrap = el('div', { class: 'gear-list' });
    const today = todayStr();
    const shootDays = prod.days.length;
    const rentals = d.items.reduce((n, i) => n + (i.rate ? GF.rentalCost(i, shootDays) : 0), 0);
    const out = d.items.filter((i) => i.status === 'out').length;
    const late = d.items.filter((i) => GF.overdue(i, today));
    const add = () => {
      const item = GF.newItem({ cat: catFilter || 'camera' });
      d.items.push(item); save(); render({ keepScroll: true });
      const n = document.querySelector(`[data-item="${item.id}"] .gr-name`); if (n) { n.focus(); n.scrollIntoView({ block: 'center' }); }
    };
    wrap.append(el('div', { class: 'post-bar' },
      ro() ? null : el('button', { class: 'primary-btn', type: 'button', onclick: add }, '+ Add item'),
      select([['', 'Every department'], ...GF.CATEGORIES.map((c) => [c.id, c.label])], catFilter, (v) => { catFilter = v; render({ keepScroll: true }); }, { disabled: false }),
      el('input', { class: 'field', type: 'search', placeholder: 'Search', value: search, oninput: (e) => { search = e.target.value; render({ keepScroll: true }); const s = document.querySelector('.gear-list input[type=search]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } } }),
      el('span', { class: 'muted small' }, `${d.items.length} item${d.items.length === 1 ? '' : 's'} · rentals ${money(rentals)} · ${out} out`),
      late.length ? el('span', { class: 'gr-late' }, `${late.length} overdue`) : null));
    if (!d.items.length) {
      wrap.append(el('div', { class: 'empty' }, 'No equipment yet. Add what the shoot needs: cameras, lenses, lights, grip, sound, vehicles… For rentals, add the vendor, rate and pickup and return dates: Budget → Build from production turns them into budget lines.'));
      return wrap;
    }
    const q = search.trim().toLowerCase();
    const match = (i) => (!catFilter || i.cat === catFilter) && (!q || [i.name, i.vendor, i.holder, i.serial, i.notes].some((x) => x.toLowerCase().includes(q)));
    for (const c of GF.CATEGORIES) {
      const list = d.items.filter((i) => i.cat === c.id && match(i));
      if (!list.length) continue;
      const cost = list.reduce((n, i) => n + (i.rate ? GF.rentalCost(i, shootDays) : 0), 0);
      wrap.append(el('section', { class: 'bl-cat' },
        el('div', { class: 'bl-cat-head' }, el('strong', {}, c.label), el('span', { class: 'muted small' }, `${list.length}`),
          el('span', { class: 'bl-cat-total' }, cost ? `rentals ${money(cost)}` : ''),
          ro() ? null : el('button', { class: 'link-btn', type: 'button', onclick: () => { const item = GF.newItem({ cat: c.id }); d.items.push(item); save(); render({ keepScroll: true }); const n = document.querySelector(`[data-item="${item.id}"] .gr-name`); if (n) n.focus(); } }, '+ Item')),
        el('div', { class: 'gr-row gr-cols' }, ...['Item', 'Qty', 'Source', 'Vendor', 'Rate', '', 'Pickup', 'Due back', 'Status', 'With', 'Days', ''].map((h) => el('span', {}, h))),
        ...list.flatMap((i) => itemRows(d, i, today))));
    }
    return wrap;
  }

  function itemRows(d, i, today) {
    const text = (key, ph, cls = '') => el('input', { class: 'field ' + cls, value: i[key], placeholder: ph, disabled: ro(), oninput: (e) => { i[key] = e.target.value; save(); } });
    const number = (key, attrs = {}) => el('input', { class: 'field num', type: 'number', min: 0, step: 'any', value: i[key], disabled: ro(), ...attrs,
      oninput: (e) => { i[key] = Math.max(0, Number(e.target.value) || 0); save(); }, onchange: () => render({ keepScroll: true }) });
    const date = (key) => el('input', { class: 'field', type: 'date', value: i[key], disabled: ro(), onchange: (e) => { i[key] = e.target.value; save(); render({ keepScroll: true }); } });
    const late = GF.overdue(i, today);
    const row = el('div', { class: 'gr-row' + (late ? ' late' : '') + (i.status === 'missing' ? ' missing' : ''), 'data-item': i.id },
      text('name', 'Item', 'gr-name'),
      number('qty', { min: 1, step: 1 }),
      select(GF.SOURCES, i.source, (v) => { i.source = v; save(); render({ keepScroll: true }); }),
      text('vendor', i.source === 'owned' ? 'Whose' : 'Vendor'),
      number('rate', { title: 'Rental rate' }),
      select(GF.PER, i.per, (v) => { i.per = v; save(); render({ keepScroll: true }); }),
      date('pickup'), date('due'),
      select(GF.STATUSES, i.status, (v) => {
        if (v === 'out') { checkOut(d, i); return; }
        if (i.status === 'out' && v === 'returned') { checkIn(d, i); return; }
        if (v === 'missing') d.log.push({ id: GF.uid(), itemId: i.id, action: 'missing', who: i.holder, at: Date.now(), note: '' });
        i.status = v; save(); render({ keepScroll: true });
      }),
      text('holder', 'Who has it'),
      el('button', { class: 'ghost-btn gr-days', type: 'button', title: 'Which shoot days it’s needed', onclick: () => daysDialog(d, i) }, i.dayIds.length ? `${i.dayIds.length} day${i.dayIds.length === 1 ? '' : 's'}` : 'Every day'),
      el('span', { class: 'gr-actions' },
        ro() ? null : i.status === 'out'
          ? el('button', { class: 'ghost-btn', type: 'button', onclick: () => checkIn(d, i) }, 'Check in')
          : el('button', { class: 'ghost-btn', type: 'button', onclick: () => checkOut(d, i) }, 'Check out'),
        el('button', { class: 'icon-btn', type: 'button', title: 'Serial number and notes', onclick: () => { open.has(i.id) ? open.delete(i.id) : open.add(i.id); render({ keepScroll: true }); } }, open.has(i.id) ? '▴' : '⋯'),
        ro() ? null : el('button', { class: 'icon-btn del', type: 'button', title: 'Delete item', onclick: () => {
          if ((i.name || i.vendor) && !confirm(`Delete "${i.name || 'this item'}"?`)) return;
          d.items = d.items.filter((x) => x !== i); d.log = d.log.filter((e) => e.itemId !== i.id); save(); render({ keepScroll: true });
        } }, '✕')));
    const rows = [row];
    const cost = i.rate ? GF.rentalCost(i, prod.days.length) : 0;
    if (open.has(i.id) || i.notes || cost) {
      rows.push(el('div', { class: 'gr-more' },
        cost ? el('span', { class: 'muted small' }, `Rental: ${i.qty} × ${money(i.rate)} × ${GF.rentalUnits(i, prod.days.length)} ${i.per === 'week' ? 'week' : i.per === 'flat' ? '' : 'day'}${GF.rentalUnits(i, prod.days.length) === 1 || i.per === 'flat' ? '' : 's'} = ${money(cost)}`) : el('span'),
        open.has(i.id) ? text('serial', 'Serial / asset numbers') : null,
        open.has(i.id) || i.notes ? text('notes', 'Notes', 'gr-notes') : null,
        late ? el('span', { class: 'gr-late' }, `Due back ${fmtDate(i.due)}`) : null));
    }
    return rows;
  }

  // ---------- By day ----------
  function renderDays(d) {
    const wrap = el('div', { class: 'gear-days' });
    const today = todayStr();
    const days = sortedDays();
    const late = d.items.filter((i) => GF.overdue(i, today));
    if (late.length) {
      wrap.append(el('div', { class: 'gr-banner' }, el('strong', {}, 'Overdue: '),
        late.map((i) => `${i.name || 'Item'}${i.holder ? ` (with ${i.holder})` : ''}, due ${fmtDate(i.due)}`).join(' · ')));
    }
    // Every shoot day, plus pickup and return dates that aren't shoot days.
    const dates = [...new Set([...days.map((x) => x.date), ...d.items.flatMap((i) => [i.pickup, i.due]).filter(Boolean)])].sort();
    if (!dates.length) { wrap.append(el('div', { class: 'empty' }, 'No shoot days or rental dates yet.')); return wrap; }
    for (const date of dates) {
      const day = days.find((x) => x.date === date);
      const pickups = d.items.filter((i) => i.pickup === date);
      const returns = d.items.filter((i) => i.due === date);
      const needed = day ? d.items.filter((i) => GF.neededOn(i, day)) : [];
      const pill = (i) => el('span', { class: 'gr-status s-' + i.status }, statusLabel(i.status));
      const line = (i) => el('li', {}, el('strong', {}, i.name || 'Item'), i.qty > 1 ? ` ×${i.qty}` : '', i.vendor ? el('span', { class: 'muted' }, ` · ${i.vendor}`) : '', ' ', pill(i));
      wrap.append(el('section', { class: 'bl-cat gd-day' + (date === today ? ' today' : '') },
        el('div', { class: 'bl-cat-head' },
          el('strong', {}, day ? `Day ${days.indexOf(day) + 1}` : 'Not a shoot day'),
          el('span', {}, fmtDate(date, { weekday: 'long', month: 'long', day: 'numeric' })),
          day && day.location ? el('span', { class: 'muted small' }, day.location.split('\n')[0]) : null),
        pickups.length ? el('div', { class: 'gd-group' }, el('div', { class: 'gd-label' }, 'Pick up'), el('ul', {}, ...pickups.map(line))) : null,
        returns.length ? el('div', { class: 'gd-group' }, el('div', { class: 'gd-label' }, 'Return'), el('ul', {}, ...returns.map(line))) : null,
        day ? el('div', { class: 'gd-group' }, el('div', { class: 'gd-label' }, `Needed (${needed.length})`),
          needed.length ? el('div', { class: 'gd-cats' }, ...GF.CATEGORIES.filter((c) => needed.some((i) => i.cat === c.id)).map((c) =>
            el('div', {}, el('div', { class: 'muted small' }, c.label), el('ul', {}, ...needed.filter((i) => i.cat === c.id).map(line)))))
            : el('p', { class: 'muted small' }, 'Nothing listed for this day.')) : null));
    }
    return wrap;
  }

  // ---------- Log ----------
  function renderLog(d) {
    const wrap = el('div', { class: 'gear-log' });
    const byId = new Map(d.items.map((i) => [i.id, i]));
    const entries = [...d.log].sort((a, b) => b.at - a.at);
    if (!entries.length) { wrap.append(el('div', { class: 'empty' }, 'Nothing checked out yet. "Check out" on an item records who took it and when; "Check in" records its return.')); return wrap; }
    const words = { out: 'Checked out', in: 'Returned', missing: 'Marked missing' };
    wrap.append(el('table', { class: 'budget-table' },
      el('thead', {}, el('tr', {}, ...['When', 'Item', 'What', 'Who'].map((h) => el('th', {}, h)))),
      el('tbody', {}, ...entries.map((e) => el('tr', {},
        el('td', { class: 'muted' }, new Date(e.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })),
        el('td', {}, (byId.get(e.itemId) || {}).name || 'Item'),
        el('td', {}, words[e.action]), el('td', {}, e.who || '—'))))));
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
    if (prod) { $('title').textContent = prod.title; document.title = `${prod.title} — Equipment`; }
    const sections = $('sections');
    if (message) { sections.replaceChildren(el('div', { class: 'empty' }, message)); return; }
    if (!d || !prod) { sections.replaceChildren(el('div', { class: 'empty' }, 'Opening…')); return; }
    sections.replaceChildren(({ days: renderDays, log: renderLog }[view] || renderList)(d));
    if (keepScroll) sheet.scrollTop = top;
  }

  async function exportAs(kind) {
    const d = active();
    if (!d) return;
    const name = window.Common.safeFileName(prod.title, 'equipment');
    const saved = kind === 'pdf'
      ? await api.exportPdf({ defaultName: `${name} - Equipment ${view === 'days' ? 'by day' : view === 'log' ? 'log' : 'list'}.pdf` })
      : await api.exportFile({ defaultName: `${name} - Equipment.csv`, ext: 'csv', label: 'CSV', content: GF.gearCSV(d, prod.days.length) });
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
  async function openGear() {
    if (!cloudProd) {
      let d = state.docs.find((x) => x.productionId === prod.id && !x._cloud);
      if (!d) { d = GF.newGear(prod.id); state.docs.push(d); store.save(); }
      state.activeId = d.id;
      return;
    }
    await collab.refreshList();
    if (collab.shared.length) { collab.open(collab.shared[0].id); return; }
    try {
      const project = await window.Cloud.createProject('gear', GF.newGear(prod.id), { parent: prod.id });
      await collab.refreshList();
      collab.open(project.id);
    } catch (err) {
      // View-only people can't create it.
      message = err.status === 403 ? 'There’s no equipment list yet. It appears here once someone who can edit the production opens Equipment.' : err.message;
    }
  }

  function wire() {
    $('homeBtn').addEventListener('click', () => P.goHome(store));
    document.querySelectorAll('#viewToggle button').forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; render(); $('sheet').scrollTop = 0; }));
    window.Common.wireDropdowns();
    document.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => exportAs(b.dataset.export)));
    window.addEventListener('focus', async () => { try { await loadProduction(); } catch { /* offline */ } });
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
    const asked = new URLSearchParams(location.search).get('view');
    if (['days', 'log'].includes(asked)) view = asked;
    try { await loadProduction(); } catch { P.goPicker(); return; }
    const stored = await api.loadStore('gear');
    state = { ...(stored || {}), docs: (stored && Array.isArray(stored.docs) ? stored.docs : []).map(GF.normalizeGear) };
    wire();
    collab.mountToolbar(document.querySelector('.toolbar'), document.querySelector('.menu-wrap'));
    collab.init();
    await openGear();
    render();
    window.Common.initUpdates();
  }

  init();
})();
