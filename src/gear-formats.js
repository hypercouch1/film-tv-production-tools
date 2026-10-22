// A production's equipment list: one gear document per production (store 'gear', or a shared
// 'gear' document inside a shared production).
//   { id, productionId, title,
//     items: [{ id, name, cat, qty, source, vendor, rate, per, pickup, due, status, holder,
//               serial, notes, dayIds }],
//     log: [{ id, itemId, action, who, at, note }] }
// dayIds: the shoot days it's needed (none: every shoot day). pickup / due: when a rental
// is collected and due back. Rentals with a rate become budget lines (Equipment / by department).
(function (root) {
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  const CATEGORIES = [
    { id: 'camera', label: 'Camera', budget: 'camera' },
    { id: 'lenses', label: 'Lenses & filters', budget: 'camera' },
    { id: 'grip', label: 'Grip', budget: 'grip' },
    { id: 'electric', label: 'Lighting & electric', budget: 'grip' },
    { id: 'sound', label: 'Sound', budget: 'sound' },
    { id: 'art', label: 'Art & set dressing', budget: 'art' },
    { id: 'wardrobe', label: 'Wardrobe & makeup', budget: 'wardrobe' },
    { id: 'vehicles', label: 'Vehicles', budget: 'transport' },
    { id: 'production', label: 'Production (walkies, tents, tables)', budget: 'equipment' },
    { id: 'other', label: 'Other', budget: 'equipment' },
  ];
  const SOURCES = [['owned', 'Owned'], ['rental', 'Rental'], ['borrowed', 'Borrowed']];
  const STATUSES = [['needed', 'Needed'], ['booked', 'Booked'], ['out', 'Checked out'], ['returned', 'Returned'], ['missing', 'Missing']];
  const PER = [['day', 'per day'], ['week', 'per week'], ['flat', 'flat']];
  const category = (id) => CATEGORIES.find((c) => c.id === id) || null;

  const isItem = (x) => x && typeof x === 'object' && !Array.isArray(x) && typeof x.id === 'string';
  const items = (list) => (Array.isArray(list) ? list.filter(isItem) : []);
  const s = (v, max = 300) => String(v == null ? '' : v).slice(0, max);
  const oneOf = (v, list, d) => (list.some(([k]) => k === v) ? v : d);
  const date = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : d; };

  function normalizeGear(d) {
    d = d || {};
    d.title = s(d.title || 'Equipment', 200);
    if (typeof d.productionId !== 'string') delete d.productionId;
    d.items = items(d.items).map((i) => ({
      id: i.id, name: s(i.name, 200), cat: category(i.cat) ? i.cat : 'other', qty: Math.max(1, Math.round(num(i.qty, 1)) || 1),
      source: oneOf(i.source, SOURCES, 'owned'), vendor: s(i.vendor, 200), rate: num(i.rate), per: oneOf(i.per, PER, 'day'),
      pickup: date(i.pickup), due: date(i.due), status: oneOf(i.status, STATUSES, 'needed'), holder: s(i.holder, 100),
      serial: s(i.serial, 100), notes: s(i.notes, 1000),
      dayIds: Array.isArray(i.dayIds) ? i.dayIds.filter((x) => typeof x === 'string') : [],
    }));
    const ids = new Set(d.items.map((i) => i.id));
    d.log = items(d.log).filter((e) => ids.has(e.itemId)).map((e) => ({
      id: e.id, itemId: e.itemId, action: oneOf(e.action, [['out'], ['in'], ['missing']], 'out'),
      who: s(e.who, 100), at: Number.isFinite(e.at) ? e.at : 0, note: s(e.note, 300),
    }));
    d.comments = Array.isArray(d.comments) ? d.comments : [];
    return d;
  }
  const newGear = (productionId) => normalizeGear({ id: uid(), productionId, title: 'Equipment', items: [], log: [] });
  const newItem = (fields = {}) => ({ id: uid(), name: '', cat: 'camera', qty: 1, source: 'owned', vendor: '', rate: 0, per: 'day', pickup: '', due: '', status: 'needed', holder: '', serial: '', notes: '', dayIds: [], ...fields });

  // Days between pickup and return, counting both (a rental picked up and returned the same
  // day is one day). Without dates: the shoot days it's needed, or every shoot day.
  function rentalDays(item, shootDays = 0) {
    if (item.pickup && item.due && item.due >= item.pickup) {
      return Math.round((Date.parse(item.due + 'T00:00:00Z') - Date.parse(item.pickup + 'T00:00:00Z')) / 86400000) + 1;
    }
    return item.dayIds.length || shootDays || 1;
  }
  function rentalUnits(item, shootDays = 0) {
    if (item.per === 'flat') return 1;
    const days = rentalDays(item, shootDays);
    return item.per === 'week' ? Math.ceil(days / 7) : days;
  }
  const rentalCost = (item, shootDays = 0) => item.qty * item.rate * rentalUnits(item, shootDays);

  // Whether an item is needed on a shoot day.
  const neededOn = (item, day) => (item.dayIds.length ? item.dayIds.includes(day.id) : (!item.pickup || day.date >= item.pickup) && (!item.due || day.date <= item.due));

  // Rentals with a rate, as budget lines (BudgetFormats.sync items).
  function budgetItems(gear, shootDays = 0) {
    return gear.items.filter((i) => i.rate > 0 && i.source !== 'owned').map((i) => ({
      link: 'gear:' + i.id, cat: category(i.cat).budget,
      desc: `${i.name || 'Equipment'}${i.qty > 1 ? ` ×${i.qty}` : ''}${i.vendor ? ` (${i.vendor})` : ''}`,
      qty: i.qty * rentalUnits(i, shootDays), unit: i.per === 'week' ? 'week' : i.per === 'flat' ? 'flat' : 'day', rate: i.rate,
    }));
  }

  // Out past its due date.
  const overdue = (item, today) => item.status === 'out' && !!item.due && item.due < today;

  const field = (v) => {
    let x = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(x)) x = "'" + x;
    return /[",\n\r]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x;
  };
  function gearCSV(gear, shootDays = 0) {
    const rows = [['Category', 'Item', 'Qty', 'Source', 'Vendor', 'Rate', 'Per', 'Pickup', 'Due back', 'Status', 'With', 'Serial', 'Rental cost', 'Notes']];
    for (const c of CATEGORIES) {
      for (const i of gear.items.filter((x) => x.cat === c.id)) {
        rows.push([c.label, i.name, i.qty, i.source, i.vendor, i.rate, i.per, i.pickup, i.due, (STATUSES.find(([k]) => k === i.status) || [])[1], i.holder, i.serial,
          i.rate ? rentalCost(i, shootDays).toFixed(2) : '', i.notes]);
      }
    }
    return rows.map((r) => r.map(field).join(',')).join('\n') + '\n';
  }

  root.GearFormats = { uid, CATEGORIES, SOURCES, STATUSES, PER, category, normalizeGear, newGear, newItem, rentalDays, rentalUnits, rentalCost, neededOn, budgetItems, overdue, gearCSV };
})(typeof window !== 'undefined' ? window : globalThis);
