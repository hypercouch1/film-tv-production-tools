// Run: node tests/gear.test.js
const assert = require('assert');
require('../src/gear-formats.js');
const G = globalThis.GearFormats;

const g = G.normalizeGear({ items: [
  { id: 'a', name: 'Alexa Mini', cat: 'camera', qty: 1, source: 'rental', vendor: 'Panavision', rate: 400, per: 'day', pickup: '2026-11-02', due: '2026-11-04', status: 'out', holder: 'Sam' },
  { id: 'b', name: 'Lens kit', cat: 'lenses', qty: 2, source: 'rental', rate: 900, per: 'week', pickup: '2026-11-02', due: '2026-11-10' },
  { id: 'c', name: 'C-stands', cat: 'grip', qty: '6', source: 'owned', rate: 0 },
  { id: 'd', name: 'Van', cat: 'vehicles', qty: 0, source: 'nope', rate: 150, per: 'flat', status: 'lost', dayIds: ['d2', 5] },
], log: [{ id: 'l1', itemId: 'a', action: 'out', who: 'Sam', at: 5 }, { id: 'l2', itemId: 'gone', action: 'in' }] });
assert.deepStrictEqual(g.items.map((i) => [i.qty, i.source, i.status]), [[1, 'rental', 'out'], [2, 'rental', 'needed'], [6, 'owned', 'needed'], [1, 'owned', 'needed']], 'cleaned');
assert.deepStrictEqual(g.items[3].dayIds, ['d2']);
assert.strictEqual(g.log.length, 1, 'log entries for deleted items are dropped');
console.log('  ✓ cleaned');

assert.strictEqual(G.rentalDays(g.items[0]), 3, 'pickup and return day both count');
assert.strictEqual(G.rentalCost(g.items[0]), 1200);
assert.deepStrictEqual([G.rentalUnits(g.items[1]), G.rentalCost(g.items[1])], [2, 3600], '9 days is two weeks, two kits');
assert.strictEqual(G.rentalCost(g.items[3]), 150, 'flat');
assert.strictEqual(G.rentalDays(G.normalizeGear({ items: [{ id: 'x', dayIds: ['a', 'b'] }] }).items[0], 9), 2, 'no dates: the days it’s needed');
assert.strictEqual(G.rentalDays(G.normalizeGear({ items: [{ id: 'x' }] }).items[0], 9), 9, 'or every shoot day');
console.log('  ✓ rental days and costs');

const day = (id, date) => ({ id, date });
assert.deepStrictEqual([G.neededOn(g.items[0], day('d1', '2026-11-03')), G.neededOn(g.items[0], day('d9', '2026-11-05'))], [true, false], 'between pickup and return');
assert.deepStrictEqual([G.neededOn(g.items[2], day('d1', '2026-11-03')), G.neededOn(g.items[3], day('d1', '2026-11-03')), G.neededOn(g.items[3], day('d2', '2026-11-04'))], [true, false, true]);
assert.deepStrictEqual([G.overdue(g.items[0], '2026-11-04'), G.overdue(g.items[0], '2026-11-05'), G.overdue(g.items[1], '2026-12-01')], [false, true, false], 'only checked-out items can be late');
console.log('  ✓ needed on which days, overdue');

const lines = G.budgetItems(g, 5);
assert.deepStrictEqual(lines.map((l) => [l.link, l.cat, l.qty, l.unit, l.rate]), [
  ['gear:a', 'camera', 3, 'day', 400], ['gear:b', 'camera', 4, 'week', 900],
], 'rentals with a rate, by department (owned gear and flat-rate items owned aren’t budgeted)');
assert.ok(lines[0].desc.includes('Panavision') && lines[1].desc.includes('×2'));
const csv = G.gearCSV(g).split('\n');
assert.strictEqual(csv[0], 'Category,Item,Qty,Source,Vendor,Rate,Per,Pickup,Due back,Status,With,Serial,Rental cost,Notes');
assert.ok(csv[1].startsWith('Camera,Alexa Mini,1,rental,Panavision,400,day,2026-11-02,2026-11-04,Checked out,Sam,,1200.00'));
console.log('  ✓ budget lines and CSV');
console.log('gear: all checks passed');
