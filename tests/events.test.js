// Run: node tests/events.test.js
// Events that aren't shoot days (table reads, meetings…): cleaning, files and the calendar export.
const assert = require('assert');
globalThis.window = globalThis;
let n = 0;
window.Common = { uid: () => 'id' + ++n, parseCSV: () => [], csvField: (v) => String(v) };
require('../src/shotsheet-formats.js');
const F = window.ShotFormats;

const p = F.upgradeProject({
  title: 'Night Diner', scenes: [], days: [],
  characters: [{ id: 'c1', name: 'Maya', actor: 'Ana' }], crew: [{ id: 'k1', role: 'Gaffer', name: 'Sam' }],
  events: [
    { id: 'e1', date: '2026-11-02', start: '18:00', end: '21:00', title: 'Full cast table read', kind: 'tableread', location: 'Studio B', peopleIds: ['c1', 'gone'] },
    { id: 'e2', date: '2026-11-01', start: '9am', title: '', kind: 'nonsense', everyone: 1 },
    { id: 'e3', date: 'someday', title: 'No date' },
  ],
});
assert.deepStrictEqual(p.events.map((e) => [e.id, e.start, e.kind, e.everyone, e.peopleIds]), [
  ['e1', '18:00', 'tableread', false, ['c1']],
  ['e2', '', 'other', true, []],
], 'cleaned: bad times, kinds and people dropped; events without a date left out');
assert.ok(F.invited(p.events[0], 'c1') && !F.invited(p.events[0], 'k1') && F.invited(p.events[1], 'k1'), 'invited: picked people, or everyone');
assert.strictEqual(F.eventKind('tableread').label, 'Table read');
console.log('  ✓ cleaned, who is invited');

// Files keep events, with people matched to their new ids.
const back = F.normalizeProject(JSON.parse(F.toShotsheet(p)));
const maya = back.characters.find((c) => c.name === 'Maya');
assert.deepStrictEqual(back.events.map((e) => [e.title, e.date, e.peopleIds]), [['Full cast table read', '2026-11-02', [maya.id]], ['', '2026-11-01', []]]);
console.log('  ✓ production files keep events');

const ics = F.toICS(p);
assert.ok(/SUMMARY:Night Diner — Full cast table read/.test(ics) && /DTSTART:20261102T180000/.test(ics) && /DTEND:20261102T210000/.test(ics) && /LOCATION:Studio B/.test(ics));
assert.ok(/DTSTART;VALUE=DATE:20261101/.test(ics), 'no start time: all day');
console.log('  ✓ calendar export includes events');
console.log('events: all checks passed');
