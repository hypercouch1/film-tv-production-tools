// A production's budget: one budget document per production (store 'budget', or a shared
// 'budget' document inside a shared production, visible to its owner and editors only).
//   { id, productionId, title, currency, fringe (% on labour), contingency (%),
//     lines: [{ id, cat, desc, qty, unit, rate, labour, actual, notes, link, auto }] }
// link: what a line was built from ('cast:<id>', 'crew:<id>', 'location:<id>', 'element:<key>',
// 'catering'). auto: its quantity follows the schedule until someone changes it by hand.
(function (root) {
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  const GROUPS = [
    { id: 'atl', label: 'Above the line' },
    { id: 'prod', label: 'Production' },
    { id: 'post', label: 'Post production' },
    { id: 'other', label: 'Other' },
  ];
  const CATEGORIES = [
    { id: 'story', code: '1100', label: 'Story & rights', group: 'atl' },
    { id: 'producers', code: '1200', label: 'Producers', group: 'atl' },
    { id: 'director', code: '1300', label: 'Director', group: 'atl' },
    { id: 'cast', code: '1400', label: 'Cast', group: 'atl' },
    { id: 'staff', code: '2000', label: 'Production staff', group: 'prod' },
    { id: 'camera', code: '2100', label: 'Camera', group: 'prod' },
    { id: 'grip', code: '2200', label: 'Grip & electric', group: 'prod' },
    { id: 'sound', code: '2300', label: 'Sound', group: 'prod' },
    { id: 'art', code: '2400', label: 'Art & set dressing', group: 'prod' },
    { id: 'props', code: '2500', label: 'Props', group: 'prod' },
    { id: 'wardrobe', code: '2600', label: 'Wardrobe', group: 'prod' },
    { id: 'makeup', code: '2700', label: 'Makeup & hair', group: 'prod' },
    { id: 'locations', code: '2800', label: 'Locations', group: 'prod' },
    { id: 'transport', code: '2900', label: 'Transport', group: 'prod' },
    { id: 'catering', code: '3000', label: 'Catering & craft services', group: 'prod' },
    { id: 'equipment', code: '3100', label: 'Equipment rentals', group: 'prod' },
    { id: 'extras', code: '3200', label: 'Extras', group: 'prod' },
    { id: 'stunts', code: '3300', label: 'Stunts & special effects', group: 'prod' },
    { id: 'vehicles', code: '3400', label: 'Picture vehicles & animals', group: 'prod' },
    { id: 'editing', code: '4100', label: 'Editing', group: 'post' },
    { id: 'vfx', code: '4200', label: 'Visual effects', group: 'post' },
    { id: 'soundpost', code: '4300', label: 'Sound post', group: 'post' },
    { id: 'music', code: '4400', label: 'Music', group: 'post' },
    { id: 'finishing', code: '4500', label: 'Colour & finishing', group: 'post' },
    { id: 'insurance', code: '5100', label: 'Insurance', group: 'other' },
    { id: 'legal', code: '5200', label: 'Legal & accounting', group: 'other' },
    { id: 'office', code: '5300', label: 'Office & admin', group: 'other' },
    { id: 'marketing', code: '5400', label: 'Marketing & festivals', group: 'other' },
  ];
  const UNITS = ['day', 'week', 'flat', 'each', 'hour'];
  const category = (id) => CATEGORIES.find((c) => c.id === id) || null;

  // Which account a crew role belongs to.
  function roleCategory(role) {
    const r = String(role || '').toLowerCase();
    if (/\bdirector of photography|\bdp\b|camera|\b1st ac|\b2nd ac|\bac\b|\bdit\b|steadicam|focus/.test(r)) return 'camera';
    if (/director/.test(r) && !/assistant|art|casting|location|photography/.test(r)) return 'director';
    if (/producer/.test(r)) return 'producers';
    if (/writer|story/.test(r)) return 'story';
    if (/gaffer|grip|electric|best boy|rigg/.test(r)) return 'grip';
    if (/sound|boom|audio/.test(r)) return 'sound';
    if (/designer|art|set dress|construction|scenic/.test(r) && !/costume/.test(r)) return 'art';
    if (/prop/.test(r)) return 'props';
    if (/costume|wardrobe/.test(r)) return 'wardrobe';
    if (/hair|make ?up/.test(r)) return 'makeup';
    if (/location/.test(r)) return 'locations';
    if (/driver|transport/.test(r)) return 'transport';
    if (/cater|craft/.test(r)) return 'catering';
    if (/stunt|special effects|sfx|pyro/.test(r)) return 'stunts';
    if (/editor|edit/.test(r)) return 'editing';
    if (/vfx|visual effects/.test(r)) return 'vfx';
    if (/composer|music/.test(r)) return 'music';
    if (/colou?rist/.test(r)) return 'finishing';
    return 'staff'; // ADs, script supervisor, coordinators, PAs…
  }
  // Breakdown category → budget account.
  const ELEMENT_CATEGORY = {
    props: 'props', wardrobe: 'wardrobe', makeup: 'makeup', extras: 'extras', stunts: 'stunts', vehicles: 'vehicles',
    animals: 'vehicles', sfx: 'stunts', vfx: 'vfx', sound: 'soundpost', setdressing: 'art', equipment: 'equipment',
  };

  // "$1,500 / day" → 1500; "" → 0
  function parseMoney(text) {
    const m = String(text == null ? '' : text).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : 0;
  }
  const num = (v) => { const n = typeof v === 'number' ? v : parseMoney(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };

  const isItem = (x) => x && typeof x === 'object' && !Array.isArray(x) && typeof x.id === 'string';
  function normalizeBudget(d) {
    d = d || {};
    d.title = String(d.title || 'Budget').slice(0, 200);
    if (typeof d.productionId !== 'string') delete d.productionId;
    d.currency = String(d.currency == null ? '$' : d.currency).slice(0, 6);
    d.fringe = Math.min(100, Math.max(0, num(d.fringe == null ? 0 : d.fringe)));
    d.contingency = Math.min(100, Math.max(0, num(d.contingency == null ? 10 : d.contingency)));
    d.lines = (Array.isArray(d.lines) ? d.lines : []).filter(isItem).map((l) => ({
      id: l.id, cat: category(l.cat) ? l.cat : 'office', desc: String(l.desc || '').slice(0, 300),
      qty: num(l.qty), unit: UNITS.includes(l.unit) ? l.unit : 'flat', rate: num(l.rate), labour: !!l.labour,
      actual: num(l.actual), notes: String(l.notes || '').slice(0, 1000),
      link: typeof l.link === 'string' ? l.link.slice(0, 200) : null, auto: !!l.auto,
    }));
    d.comments = Array.isArray(d.comments) ? d.comments : [];
    return d;
  }
  const newBudget = (productionId) => normalizeBudget({ id: uid(), productionId, title: 'Budget', currency: '$', fringe: 0, contingency: 10, lines: [] });

  // Totals: per account, per group and overall (estimate = qty × rate; fringes on labour lines).
  function totals(b) {
    const byCat = new Map(CATEGORIES.map((c) => [c.id, { est: 0, actual: 0, fringe: 0, lines: 0 }]));
    for (const l of b.lines) {
      const t = byCat.get(l.cat);
      const est = l.qty * l.rate;
      t.est += est; t.actual += l.actual; t.lines++;
      if (l.labour) t.fringe += est * (b.fringe / 100);
    }
    const groups = GROUPS.map((g) => {
      const cats = CATEGORIES.filter((c) => c.group === g.id);
      return { ...g, est: cats.reduce((n, c) => n + byCat.get(c.id).est, 0), actual: cats.reduce((n, c) => n + byCat.get(c.id).actual, 0) };
    });
    const subtotal = groups.reduce((n, g) => n + g.est, 0);
    const fringes = [...byCat.values()].reduce((n, t) => n + t.fringe, 0);
    const contingency = (subtotal + fringes) * (b.contingency / 100);
    const actual = groups.reduce((n, g) => n + g.actual, 0);
    return { byCat, groups, subtotal, fringes, contingency, total: subtotal + fringes + contingency, actual };
  }

  // Adds and updates lines built from the production. items: [{ link, cat, desc, qty, unit, labour, rate }].
  // A line made before keeps its rate, actual and notes; its quantity follows the production
  // unless it was changed by hand. Lines whose source is gone are reported, not deleted.
  function sync(b, items) {
    const byLink = new Map(b.lines.filter((l) => l.link).map((l) => [l.link, l]));
    let added = 0, updated = 0;
    for (const it of items) {
      const l = byLink.get(it.link);
      if (!l) {
        b.lines.push({ id: uid(), cat: it.cat, desc: it.desc, qty: num(it.qty), unit: it.unit || 'day', rate: num(it.rate || 0), labour: !!it.labour, actual: 0, notes: '', link: it.link, auto: true });
        added++;
      } else if (l.auto && (l.qty !== num(it.qty) || l.desc !== it.desc)) {
        l.qty = num(it.qty); l.desc = it.desc; updated++;
      }
    }
    const links = new Set(items.map((i) => i.link));
    const gone = b.lines.filter((l) => l.link && !links.has(l.link) && l.link !== 'manual');
    return { added, updated, gone };
  }

  const field = (v) => {
    let x = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(x)) x = "'" + x;
    return /[",\n\r]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x;
  };
  function budgetCSV(b) {
    const t = totals(b);
    const rows = [['Account', 'Category', 'Description', 'Qty', 'Unit', 'Rate', 'Estimate', 'Fringe', 'Actual', 'Notes']];
    for (const c of CATEGORIES) {
      for (const l of b.lines.filter((x) => x.cat === c.id)) {
        rows.push([c.code, c.label, l.desc, l.qty, l.unit, l.rate, (l.qty * l.rate).toFixed(2), l.labour ? 'yes' : '', l.actual.toFixed(2), l.notes]);
      }
    }
    rows.push([], ['', 'Subtotal', '', '', '', '', t.subtotal.toFixed(2), '', t.actual.toFixed(2)],
      ['', `Fringes (${b.fringe}%)`, '', '', '', '', t.fringes.toFixed(2)],
      ['', `Contingency (${b.contingency}%)`, '', '', '', '', t.contingency.toFixed(2)],
      ['', 'Total', '', '', '', '', t.total.toFixed(2), '', t.actual.toFixed(2)]);
    return rows.map((r) => r.map(field).join(',')).join('\n') + '\n';
  }

  root.BudgetFormats = { uid, GROUPS, CATEGORIES, UNITS, category, roleCategory, ELEMENT_CATEGORY, parseMoney, normalizeBudget, newBudget, totals, sync, budgetCSV };
})(typeof window !== 'undefined' ? window : globalThis);
