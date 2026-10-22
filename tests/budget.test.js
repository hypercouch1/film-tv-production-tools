// Run: node tests/budget.test.js
const assert = require('assert');
require('../src/budget-formats.js');
const B = globalThis.BudgetFormats;

assert.strictEqual(B.parseMoney('$1,500 / day'), 1500);
assert.strictEqual(B.parseMoney('€ 250.50'), 250.5);
assert.strictEqual(B.parseMoney('free'), 0);
assert.deepStrictEqual(['Director of Photography', '1st AC', 'Gaffer', 'Director', '1st AD', 'Boom Operator', 'Costume Designer', 'Production Designer', 'Hair & Makeup', 'Producer', 'Composer'].map(B.roleCategory),
  ['camera', 'camera', 'grip', 'director', 'staff', 'sound', 'wardrobe', 'art', 'makeup', 'producers', 'music']);
console.log('  ✓ money parsing and crew roles to accounts');

const b = B.normalizeBudget({ fringe: 20, contingency: 10, lines: [
  { id: 'a', cat: 'cast', desc: 'Ann as Maya', qty: 3, rate: 500, labour: true, actual: 1600 },
  { id: 'b', cat: 'locations', desc: 'Diner', qty: 2, rate: '1,000', actual: 2000 },
  { id: 'c', cat: 'bogus', desc: 'x', qty: 'two', rate: 5, unit: 'fortnight' },
] });
assert.deepStrictEqual([b.lines[2].cat, b.lines[2].qty, b.lines[2].unit], ['office', 0, 'flat'], 'cleaned');
const t = B.totals(b);
assert.strictEqual(t.subtotal, 3500);
assert.strictEqual(t.fringes, 300, '20% on the labour line only');
assert.strictEqual(t.contingency, 380, '10% of subtotal + fringes');
assert.strictEqual(t.total, 4180);
assert.strictEqual(t.actual, 3600);
assert.strictEqual(t.groups.find((g) => g.id === 'atl').est, 1500);
console.log('  ✓ totals: fringes on labour, contingency, groups, actuals');

// Building from the production: adds lines, then follows the schedule without touching rates.
const items = [{ link: 'cast:c1', cat: 'cast', desc: 'Ann as Maya', qty: 3, unit: 'day', labour: true }, { link: 'location:l1', cat: 'locations', desc: 'Diner', qty: 2, rate: 1000 }];
const s = B.normalizeBudget({});
assert.deepStrictEqual([B.sync(s, items).added, s.lines.length], [2, 2]);
s.lines[0].rate = 650;
s.lines[1].qty = 5; s.lines[1].auto = false; // changed by hand
const again = B.sync(s, [{ ...items[0], qty: 4 }, { ...items[1], qty: 3 }]);
assert.deepStrictEqual([again.added, again.updated, s.lines[0].qty, s.lines[0].rate, s.lines[1].qty], [0, 1, 4, 650, 5]);
assert.deepStrictEqual(B.sync(s, [items[0]]).gone.map((l) => l.link), ['location:l1'], 'lines whose source is gone are reported, not deleted');
assert.strictEqual(s.lines.length, 2);
console.log('  ✓ building from the production keeps rates and hand-made changes');

const csv = B.budgetCSV(b).split('\n');
assert.strictEqual(csv[0], 'Account,Category,Description,Qty,Unit,Rate,Estimate,Fringe,Actual,Notes');
assert.ok(csv.some((l) => l.startsWith(',Total,,,,,4180.00')));
console.log('  ✓ CSV export');

// Costs: receipts against an account or a line; they add to actuals.
const c = B.normalizeBudget({ lines: [{ id: 'l1', cat: 'locations', desc: 'Diner', qty: 1, rate: 1000, actual: 100 }], costs: [
  { id: 'x1', date: '2026-11-03', cat: 'cast', lineId: 'l1', vendor: 'Rosie', amount: '400' }, // the line's account wins
  { id: 'x2', date: 'soon', cat: 'catering', vendor: '=HYPERLINK("x")', amount: 250.555 },
  { id: 'x3', cat: 'props', lineId: 'nope', amount: -5 },
] });
assert.deepStrictEqual(c.costs.map((x) => [x.date, x.lineId, x.amount]), [['2026-11-03', 'l1', 400], ['', null, 250.56], ['', null, -5]], 'cleaned');
assert.deepStrictEqual([B.costCat(c, c.costs[0]), B.lineCosts(c, c.lines[0])], ['locations', 400]);
const ct = B.totals(c);
assert.deepStrictEqual([ct.byCat.get('locations').actual, ct.byCat.get('catering').actual, ct.byCat.get('catering').costs, ct.actual], [500, 250.56, 1, 745.56]);
const costRows = B.costsCSV(c).split('\n');
assert.strictEqual(costRows[0], 'Date,Account,Category,Line,Vendor,Description,Receipt / invoice,Paid by,Amount');
assert.ok(costRows.some((l) => l.includes(`"'=HYPERLINK(""x"")"`)), 'formulas defused');
assert.ok(B.budgetCSV(c).includes('3000,Catering & craft services,Other costs'), 'costs without a line show in the budget CSV');
console.log('  ✓ costs: against accounts and lines, in actuals, CSV');
console.log('budget: all checks passed');
