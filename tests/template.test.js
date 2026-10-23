// Run: node tests/template.test.js
const assert = require('assert');
require('../src/budget-formats.js');
require('../src/gear-formats.js');
require('../src/template.js');
const { copy } = globalThis.Template;

const src = {
  id: 'old', title: 'Night Diner', scenes: [{ id: 's1' }], days: [{ id: 'd1', date: '2026-11-03' }],
  characters: [{ id: 'c1', name: 'Maya', actor: 'Ana', contact: 'ana@x', extra: 'no' }],
  crew: [{ id: 'k1', role: 'Gaffer', name: 'Sam', allDays: true }],
  locations: [{ id: 'l1', name: "Rosie's", sets: ["Rosie's Diner"], cost: '$1,200', permit: 'approved' }],
};
const fresh = { id: 'new', title: 'Night Diner 2', type: 'film', scenes: [], days: [], characters: [], crew: [], locations: [] };
const srcGear = globalThis.GearFormats.normalizeGear({ items: [{ id: 'g1', name: 'Alexa', status: 'out', holder: 'Sam', pickup: '2026-11-01', due: '2026-11-04', dayIds: ['d1'], rate: 400, source: 'rental' }], log: [{ id: 'x', itemId: 'g1', at: 1 }] });
const srcBudget = globalThis.BudgetFormats.normalizeBudget({ currency: '£', fringe: 18, contingency: 7,
  lines: [{ id: 'b1', cat: 'cast', desc: 'Ana as Maya', qty: 5, rate: 500, link: 'cast:c1', auto: true, actual: 900 }, { id: 'b2', cat: 'insurance', desc: 'Policy', qty: 1, rate: 800, actual: 800 }],
  costs: [{ id: 'e1', amount: 50 }] });
const all = { cast: true, crew: true, locations: true, gear: true, budget: true };
const out = copy({ src, srcGear, srcBudget, fresh, parts: all, newGear: globalThis.GearFormats.newGear, newBudget: globalThis.BudgetFormats.newBudget });

assert.deepStrictEqual([out.prod.id, out.prod.title, out.prod.scenes, out.prod.days], ['new', 'Night Diner 2', [], []], 'no scenes or schedule');
assert.deepStrictEqual(out.prod.characters, [{ id: 'c1', name: 'Maya', actor: 'Ana', contact: 'ana@x' }], 'cast keep their ids');
assert.deepStrictEqual([out.prod.crew[0].id, out.prod.crew[0].allDays], ['k1', true]);
assert.deepStrictEqual([out.prod.locations[0].name, out.prod.locations[0].permit, out.prod.locations[0].sets], ["Rosie's", '', ["Rosie's Diner"]], 'permits cleared');
assert.strictEqual(src.locations[0].permit, 'approved', 'the original is untouched');
console.log('  ✓ cast, crew and locations');

assert.deepStrictEqual([out.gear.productionId, out.gear.items[0].status, out.gear.items[0].holder, out.gear.items[0].pickup, out.gear.items[0].dayIds, out.gear.items[0].rate, out.gear.log],
  ['new', 'needed', '', '', [], 400, []], 'gear: statuses, dates and log cleared');
assert.deepStrictEqual([out.budget.productionId, out.budget.currency, out.budget.fringe, out.budget.contingency, out.budget.costs], ['new', '£', 18, 7, []]);
assert.deepStrictEqual(out.budget.lines.map((l) => [l.desc, l.qty, l.rate, l.actual, l.link]), [['Ana as Maya', 0, 500, 0, 'cast:c1'], ['Policy', 1, 800, 0, null]],
  'budget: rates kept, schedule quantities restart, no actuals');
console.log('  ✓ equipment and budget');

const some = copy({ src, srcGear, srcBudget, fresh, parts: { crew: true }, newGear: globalThis.GearFormats.newGear, newBudget: globalThis.BudgetFormats.newBudget });
assert.deepStrictEqual([some.prod.characters, some.prod.crew.length, some.prod.locations, some.gear, some.budget], [[], 1, [], null, null], 'only what was picked');
console.log('  ✓ only the parts picked');
console.log('template: all checks passed');
