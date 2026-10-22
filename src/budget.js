// A production's budget: top sheet and detail, built from the production (cast and crew days
// from the schedule, locations, breakdown items) and edited by hand. Its data is a separate
// budget document (budget-formats.js); in a shared production only the owner and editors
// can see it.
(function () {
  const { api, $, el, toast } = window.Common;
  const P = window.Production;
  const BF = window.BudgetFormats;
  const SF = window.ShotFormats;

  let state = { docs: [], activeId: null };
  let prod = null;
  let cloudProd = false;
  let view = 'top';           // 'top' | 'detail'
  let showAll = false;        // detail: show accounts with no lines too
  let gone = new Set();       // lines whose source left the production (after Build)
  let message = null;

  const store = window.Common.createStore('budget', () => ({ ...state, docs: collab.localOnly(state.docs) }));
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
    kind: 'budget', listKey: 'docs', noun: 'budget', nounPlural: 'budgets',
    getState: () => state,
    render: (opts = {}) => render(opts),
    renderSidebar: () => {},
    save: () => store.save(),
    normalize: (doc) => BF.normalizeBudget(doc),
    selectLocal: () => P.goHome(store),
    onRoleChange: () => render(),
    production: true,
    parent: () => (cloudProd ? prod.id : null),
    productionTitle: () => (cloudProd ? prod.title : null),
    share: async () => { await store.flush(); if (await P.share(prod.id)) location.reload(); },
  });
  const ro = () => collab.readOnly();

  // ---------- Money ----------
  const money = (d, n) => `${d.currency}${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  // ---------- From the production ----------
  const sortedDays = () => [...prod.days].sort((a, b) => a.date.localeCompare(b.date));
  const sceneDays = (s) => (s.shots.length ? [...new Set(s.shots.map((x) => x.dayId).filter(Boolean))] : s.dayId ? [s.dayId] : []);
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
  // What the production says it needs, as budget lines.
  async function productionItems() {
    const days = sortedDays();
    const on = (d, pred) => prod.scenes.some((s) => sceneDays(s).includes(d.id) && pred(s));
    const doodDays = (working) => { const r = window.ScheduleViews.doodRow(days, working); return r.work + r.hold; };
    const items = [];
    for (const c of prod.characters) {
      items.push({ link: 'cast:' + c.id, cat: 'cast', desc: `${c.actor || 'TBC'} as ${c.name || 'Unnamed'}`, qty: doodDays((d) => on(d, (s) => s.castIds.includes(c.id))), unit: 'day', labour: true });
    }
    for (const k of prod.crew) {
      const roles = SF.crewRoles(k);
      const qty = k.allDays ? days.length : days.filter((d) => on(d, (s) => s.crewIds.includes(k.id))).length;
      items.push({ link: 'crew:' + k.id, cat: BF.roleCategory(roles[0] || k.role), desc: `${k.name || 'TBC'} — ${roles.join(', ') || 'Crew'}`, qty, unit: 'day', labour: true });
    }
    for (const l of prod.locations || []) {
      const qty = days.filter((d) => on(d, (s) => SF.locationOf(prod, s) === l)).length;
      items.push({ link: 'location:' + l.id, cat: 'locations', desc: l.name || 'Location', qty, unit: 'day', rate: BF.parseMoney(l.cost) });
    }
    const cat = window.BreakdownViews.catalogue(prod, window.BreakdownViews.tagIndex(await loadScripts()));
    for (const it of cat.values()) {
      const account = BF.ELEMENT_CATEGORY[it.category];
      if (!account || !it.scenes.size) continue;
      const perDay = it.category === 'extras' || it.category === 'animals';
      const qty = perDay ? days.filter((d) => on(d, (s) => it.scenes.has(s.id))).length || 1 : 1;
      items.push({ link: 'element:' + it.key, cat: account, desc: it.name, qty, unit: perDay ? 'day' : 'flat' });
    }
    if (days.length) items.push({ link: 'catering', cat: 'catering', desc: `Catering: ${days.length} shoot day${days.length === 1 ? '' : 's'}`, qty: days.length, unit: 'day' });
    return items;
  }
  async function build(d) {
    if (ro()) return;
    const result = BF.sync(d, await productionItems());
    gone = new Set(result.gone.map((l) => l.id));
    save(); render({ keepScroll: true });
    toast(`${result.added} line${result.added === 1 ? '' : 's'} added · ${result.updated} updated from the schedule`
      + (result.gone.length ? ` · ${result.gone.length} no longer in the production (marked)` : ''));
  }

  // ---------- Top sheet ----------
  function renderTop(d) {
    const t = BF.totals(d);
    const wrap = el('div', { class: 'budget-top' });
    const pct = (key, label) => el('label', { class: 'bt-setting' }, el('span', {}, label),
      el('input', { class: 'field', type: 'number', min: 0, max: 100, step: 0.5, value: d[key], disabled: ro(),
        onchange: (e) => { d[key] = Math.min(100, Math.max(0, Number(e.target.value) || 0)); save(); render({ keepScroll: true }); } }), el('span', {}, '%'));
    wrap.append(el('div', { class: 'post-bar' },
      ro() ? null : el('button', { class: 'primary-btn', type: 'button', onclick: () => build(d) }, 'Build from production'),
      el('label', { class: 'bt-setting' }, el('span', {}, 'Currency'), el('input', { class: 'field bt-cur', value: d.currency, disabled: ro(), maxlength: 6,
        onchange: (e) => { d.currency = e.target.value.trim().slice(0, 6); save(); render({ keepScroll: true }); } })),
      pct('fringe', 'Fringes on labour'),
      pct('contingency', 'Contingency')));
    if (!d.lines.length) {
      wrap.append(el('div', { class: 'empty' }, 'No budget lines yet. "Build from production" adds cast and crew (with their days from the schedule), locations, breakdown items and catering, ready for rates. Or add lines by hand in Detail.'));
      return wrap;
    }
    const rows = [];
    for (const g of t.groups) {
      const cats = BF.CATEGORIES.filter((c) => c.group === g.id && t.byCat.get(c.id).lines);
      if (!cats.length) continue;
      rows.push(el('tr', { class: 'bt-group' }, el('td', { colspan: 5 }, g.label.toUpperCase())));
      for (const c of cats) {
        const x = t.byCat.get(c.id);
        rows.push(el('tr', { class: 'bt-row', onclick: () => { view = 'detail'; render(); const n = document.getElementById('cat-' + c.id); if (n) n.scrollIntoView({ block: 'start' }); } },
          el('td', { class: 'muted' }, c.code), el('td', {}, c.label),
          el('td', { class: 'num' }, money(d, x.est)), el('td', { class: 'num' }, x.actual ? money(d, x.actual) : '—'),
          el('td', { class: 'num ' + (x.actual > x.est ? 'over' : '') }, x.actual ? money(d, x.est - x.actual) : '')));
      }
      rows.push(el('tr', { class: 'bt-sub' }, el('td', {}), el('td', {}, `Total ${g.label.toLowerCase()}`),
        el('td', { class: 'num' }, money(d, g.est)), el('td', { class: 'num' }, g.actual ? money(d, g.actual) : '—'), el('td')));
    }
    rows.push(
      el('tr', { class: 'bt-sub' }, el('td'), el('td', {}, 'Subtotal'), el('td', { class: 'num' }, money(d, t.subtotal)), el('td', { class: 'num' }, money(d, t.actual)), el('td', { class: 'num ' + (t.actual > t.subtotal ? 'over' : '') }, money(d, t.subtotal - t.actual))),
      el('tr', {}, el('td'), el('td', {}, `Fringes (${d.fringe}% of labour)`), el('td', { class: 'num' }, money(d, t.fringes)), el('td'), el('td')),
      el('tr', {}, el('td'), el('td', {}, `Contingency (${d.contingency}%)`), el('td', { class: 'num' }, money(d, t.contingency)), el('td'), el('td')),
      el('tr', { class: 'bt-total' }, el('td'), el('td', {}, 'TOTAL'), el('td', { class: 'num' }, money(d, t.total)), el('td', { class: 'num' }, money(d, t.actual)), el('td', { class: 'num ' + (t.actual > t.total ? 'over' : '') }, money(d, t.total - t.actual))));
    wrap.append(el('table', { class: 'budget-table' },
      el('thead', {}, el('tr', {}, ...['Acct', 'Category', 'Estimate', 'Actual', 'Remaining'].map((h, i) => el('th', { class: i > 1 ? 'num' : '' }, h)))),
      el('tbody', {}, ...rows)));
    return wrap;
  }

  // ---------- Detail ----------
  function renderDetail(d) {
    const wrap = el('div', { class: 'budget-detail' });
    const t = BF.totals(d);
    const addTo = el('select', { class: 'field', disabled: ro(), onchange: (e) => {
      if (!e.target.value) return;
      const l = { id: BF.uid(), cat: e.target.value, desc: '', qty: 1, unit: 'flat', rate: 0, labour: false, actual: 0, notes: '', link: null, auto: false };
      d.lines.push(l); save(); render({ keepScroll: true });
      const n = document.querySelector(`[data-item="${l.id}"] .bl-desc`); if (n) { n.focus(); n.scrollIntoView({ block: 'center' }); }
    } }, el('option', { value: '' }, '+ Add a line to…'), ...BF.CATEGORIES.map((c) => el('option', { value: c.id }, `${c.code} ${c.label}`)));
    wrap.append(el('div', { class: 'post-bar' },
      ro() ? null : el('button', { class: 'ghost-btn', type: 'button', onclick: () => build(d) }, 'Build from production'),
      ro() ? null : addTo,
      el('label', { class: 'muted small' }, el('input', { type: 'checkbox', checked: showAll, onchange: (e) => { showAll = e.target.checked; render({ keepScroll: true }); } }), ' Show every account'),
      el('span', { class: 'muted small' }, `${d.lines.length} line${d.lines.length === 1 ? '' : 's'} · total ${money(d, t.total)}`)));
    for (const g of BF.GROUPS) {
      const cats = BF.CATEGORIES.filter((c) => c.group === g.id && (showAll || d.lines.some((l) => l.cat === c.id)));
      if (!cats.length) continue;
      wrap.append(el('h2', { class: 'section-title' }, g.label.toUpperCase()));
      for (const c of cats) {
        const lines = d.lines.filter((l) => l.cat === c.id);
        const x = t.byCat.get(c.id);
        wrap.append(el('section', { class: 'bl-cat', id: 'cat-' + c.id },
          el('div', { class: 'bl-cat-head' }, el('span', { class: 'muted' }, c.code), el('strong', {}, c.label),
            el('span', { class: 'bl-cat-total' }, money(d, x.est) + (x.actual ? ` · actual ${money(d, x.actual)}` : '')),
            ro() ? null : el('button', { class: 'link-btn', type: 'button', onclick: () => {
              const l = { id: BF.uid(), cat: c.id, desc: '', qty: 1, unit: 'flat', rate: 0, labour: false, actual: 0, notes: '', link: null, auto: false };
              d.lines.push(l); save(); render({ keepScroll: true });
              const n = document.querySelector(`[data-item="${l.id}"] .bl-desc`); if (n) n.focus();
            } }, '+ Line')),
          lines.length ? el('div', { class: 'bl-row bl-cols' }, ...['Description', 'Qty', 'Unit', 'Rate', 'Estimate', 'Fringe', 'Actual', 'Notes', ''].map((h) => el('span', {}, h))) : null,
          ...lines.map((l) => lineRow(d, l))));
      }
    }
    if (!d.lines.length && !showAll) wrap.append(el('div', { class: 'empty' }, 'No lines yet. Build from production, or add a line to an account above.'));
    return wrap;
  }

  function lineRow(d, l) {
    const est = el('span', { class: 'num bl-est' }, money(d, l.qty * l.rate));
    const numInput = (key, attrs = {}) => el('input', { class: 'field num', type: 'number', step: 'any', min: 0, value: l[key], disabled: ro(), ...attrs,
      oninput: (e) => {
        l[key] = Number(e.target.value) || 0;
        if (key === 'qty') l.auto = false; // changed by hand: no longer follows the schedule
        est.textContent = money(d, l.qty * l.rate);
        save();
      },
      onchange: () => render({ keepScroll: true }) });
    const unit = el('select', { class: 'field', disabled: ro(), onchange: (e) => { l.unit = e.target.value; save(); } }, ...BF.UNITS.map((u) => el('option', { value: u }, u)));
    unit.value = l.unit;
    return el('div', { class: 'bl-row' + (gone.has(l.id) ? ' gone' : ''), 'data-item': l.id },
      el('span', { class: 'bl-desc-wrap' },
        el('input', { class: 'field bl-desc', value: l.desc, placeholder: 'Description', disabled: ro(), oninput: (e) => { l.desc = e.target.value; save(); } }),
        l.auto ? el('span', { class: 'bl-auto', title: 'The quantity follows the schedule (Build from production). Typing a quantity stops that.' }, '↻') : null,
        gone.has(l.id) ? el('span', { class: 'bl-gone', title: 'No longer in the production. Delete it if it’s not needed.' }, 'gone') : null),
      numInput('qty'),
      unit,
      numInput('rate'),
      est,
      el('input', { type: 'checkbox', checked: l.labour, disabled: ro(), title: 'Labour: fringes apply', onchange: (e) => { l.labour = e.target.checked; save(); render({ keepScroll: true }); } }),
      numInput('actual'),
      el('input', { class: 'field', value: l.notes, placeholder: 'Notes', disabled: ro(), oninput: (e) => { l.notes = e.target.value; save(); } }),
      ro() ? el('span') : el('button', { class: 'icon-btn del', type: 'button', title: 'Delete line', onclick: () => { d.lines = d.lines.filter((x) => x !== l); save(); render({ keepScroll: true }); } }, '✕'));
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
    if (prod) { $('title').textContent = prod.title; document.title = `${prod.title} — Budget`; }
    const sections = $('sections');
    if (message) { sections.replaceChildren(el('div', { class: 'empty' }, message)); return; }
    if (!d || !prod) { sections.replaceChildren(el('div', { class: 'empty' }, 'Opening…')); return; }
    sections.replaceChildren(view === 'detail' ? renderDetail(d) : renderTop(d));
    if (keepScroll) sheet.scrollTop = top;
  }

  async function exportAs(kind) {
    const d = active();
    if (!d) return;
    const name = window.Common.safeFileName(prod.title, 'budget');
    const saved = kind === 'pdf'
      ? await api.exportPdf({ defaultName: `${name} - Budget ${view === 'detail' ? 'detail' : 'top sheet'}.pdf` })
      : await api.exportFile({ defaultName: `${name} - Budget.csv`, ext: 'csv', label: 'CSV', content: BF.budgetCSV(d) });
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
  async function openBudget() {
    if (!cloudProd) {
      let d = state.docs.find((x) => x.productionId === prod.id && !x._cloud);
      if (!d) { d = BF.newBudget(prod.id); state.docs.push(d); store.save(); }
      state.activeId = d.id;
      return;
    }
    await collab.refreshList();
    if (collab.shared.length) { collab.open(collab.shared[0].id); return; }
    try {
      const project = await window.Cloud.createProject('budget', BF.newBudget(prod.id), { parent: prod.id });
      await collab.refreshList();
      collab.open(project.id);
    } catch (err) {
      message = err.status === 403 || err.status === 404
        ? 'The budget is only for the production’s owner and editors.'
        : err.message;
    }
  }

  function wire() {
    $('homeBtn').addEventListener('click', () => P.goHome(store));
    document.querySelectorAll('#viewToggle button').forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; render(); $('sheet').scrollTop = 0; }));
    window.Common.wireDropdowns();
    document.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => exportAs(b.dataset.export)));
    window.addEventListener('focus', async () => { try { await loadProduction(); } catch { /* offline */ } });
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
    if (new URLSearchParams(location.search).get('view') === 'detail') view = 'detail';
    try { await loadProduction(); } catch { P.goPicker(); return; }
    const stored = await api.loadStore('budget');
    state = { ...(stored || {}), docs: (stored && Array.isArray(stored.docs) ? stored.docs : []).map(BF.normalizeBudget) };
    wire();
    collab.mountToolbar(document.querySelector('.toolbar'), document.querySelector('.menu-wrap'));
    collab.init();
    await openBudget();
    render();
    window.Common.initUpdates();
  }

  init();
})();
