// Run: node tests/schedule.test.js
const assert = require('assert');
globalThis.window = globalThis;
require('../src/schedule-views.js');
const V = globalThis.ScheduleViews;

// Day Out of Days codes.
const days = ['d1', 'd2', 'd3', 'd4', 'd5'].map((id, i) => ({ id, date: `2026-11-0${i + 1}` }));
const works = (...ids) => (d) => ids.includes(d.id);
assert.deepStrictEqual(V.doodRow(days, works('d2', 'd4')).cells, ['', 'SW', 'H', 'WF', '']);
assert.deepStrictEqual(V.doodRow(days, works('d3')).cells, ['', '', 'SWF', '', '']);
assert.deepStrictEqual(V.doodRow(days, works('d1', 'd2', 'd5')).cells, ['SW', 'W', 'H', 'H', 'WF']);
const r = V.doodRow(days, works('d1', 'd2', 'd5'));
assert.deepStrictEqual([r.work, r.hold, r.first, r.last], [3, 2, 0, 4]);
assert.deepStrictEqual(V.doodRow(days, () => false).cells, ['', '', '', '', '']);
console.log('  ✓ day out of days: start, work, hold, finish');

// Moving scenes between days (whole scenes, split scenes, scenes without shots).
const p = {
  days: [{ id: 'd1', date: '2026-11-01', sceneOrder: [] }, { id: 'd2', date: '2026-11-02', sceneOrder: [] }],
  characters: [{ id: 'c1', name: 'Maya', actor: 'Ann' }], crew: [{ id: 'k1', role: 'Gaffer', name: 'Gus', allDays: true }],
  scenes: [
    { id: 's1', heading: 'INT. DINER - NIGHT', castIds: ['c1'], crewIds: [], shots: [{ dayId: 'd1' }, { dayId: 'd2' }] },
    { id: 's2', heading: 'EXT. LOT - DAY', castIds: [], crewIds: [], shots: [{ dayId: null }, { dayId: null }] },
    { id: 's3', heading: 'I/E. CAR - NIGHT', castIds: ['c1'], crewIds: [], shots: [] },
  ],
};
assert.deepStrictEqual(V.sceneDays(p, p.scenes[0]), ['d1', 'd2'], 'a split scene is on both days');
V.moveScene(p, p.scenes[1], null, 'd1');
assert.deepStrictEqual(p.scenes[1].shots.map((x) => x.dayId), ['d1', 'd1'], 'unscheduled shots move to the day');
V.moveScene(p, p.scenes[0], 'd2', 'd1', 's2');
assert.deepStrictEqual(p.scenes[0].shots.map((x) => x.dayId), ['d1', 'd1'], 'only the shots planned for that day move');
assert.deepStrictEqual(V.orderedScenes(p, p.days[0]).map((s) => s.id), ['s1', 's2'], 'dropped before s2');
V.moveScene(p, p.scenes[2], null, 'd2');
assert.strictEqual(p.scenes[2].dayId, 'd2', 'a scene without shots is scheduled by its own day');
assert.deepStrictEqual(V.scenesOn(p, 'd2').map((s) => s.id), ['s3']);
V.moveScene(p, p.scenes[2], 'd2', null);
assert.strictEqual(p.scenes[2].dayId, null);
console.log('  ✓ stripboard moves whole and split scenes, keeps the order');

// Strip colours from the heading.
assert.deepStrictEqual(V.sceneKind('INT. DINER - NIGHT'), { ie: 'INT', dn: 'N', cls: 'strip-int-n' });
assert.deepStrictEqual(V.sceneKind('EXT. LOT - DAY'), { ie: 'EXT', dn: 'D', cls: 'strip-ext-d' });
assert.strictEqual(V.sceneKind('I/E. CAR - NIGHT').ie, 'I/E');
assert.strictEqual(V.sceneKind('INT./EXT. HOUSE - DAY').ie, 'I/E');
console.log('  ✓ strip colours: INT/EXT, day/night');

// Clashes: needed on a day they can't work.
p.scenes[2].dayId = 'd2';
p.availability = { c1: { off: ['2026-11-02'] }, k1: { off: ['2026-11-01'] } };
assert.deepStrictEqual(V.conflictsOn(p, p.days[1]).map((x) => x.name), ['Ann'], 'actor needed on day 2 but off');
assert.deepStrictEqual(V.conflictsOn(p, p.days[0]).map((x) => x.name), ['Gus'], 'every-day crew off on day 1');
console.log('  ✓ clashes between availability and the schedule');
console.log('schedule: all checks passed');
