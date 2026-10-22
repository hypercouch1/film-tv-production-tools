// Run: node tests/onset.test.js
const assert = require('assert');
require('../src/onset-formats.js');
const O = globalThis.OnsetFormats;

const d = O.normalizeOnset({ reports: [
  { id: 'r1', dayId: 'd1', times: { crewCall: '07:00', wrap: '7pm', bogus: '01:00' }, scenes: { s1: { status: 'done', note: 'ok' }, s2: { status: 'maybe' } },
    cast: { c1: { arrive: '07:15', wrap: 'late' } }, setups: '12', takes: '', extraSceneIds: ['s3', 4] },
], notes: [{ id: 'n1', sceneId: 's1', cat: 'nope', text: 'Jacket open', photos: ['abcdefgh12', '../../etc'] }] });
const r = d.reports[0];
assert.deepStrictEqual([r.times.crewCall, r.times.wrap, r.times.bogus], ['07:00', '', undefined], 'times cleaned');
assert.deepStrictEqual([r.scenes.s1.status, r.scenes.s2.status, r.cast.c1.arrive, r.cast.c1.wrap], ['done', '', '07:15', '']);
assert.deepStrictEqual([r.setups, r.takes, r.extraSceneIds], [12, null, ['s3']], 'blank counts come from the take log');
assert.deepStrictEqual([d.notes[0].cat, d.notes[0].photos], ['other', ['abcdefgh12']], 'only photo ids, no paths');
console.log('  ✓ cleaned');

// Progress: three days of 8 pages each; day 1 shot all, day 2 shot half, plus a scene from day 3.
const scene = (id, dayId, eighths) => ({ id, dayId, eighths, shots: [], castIds: [] });
const prod = {
  days: [{ id: 'd2', date: '2026-11-04' }, { id: 'd1', date: '2026-11-03' }, { id: 'd3', date: '2026-11-05' }],
  scenes: [scene('s1', 'd1', 8), scene('s2', 'd2', 4), scene('s3', 'd2', 4), scene('s4', 'd3', 8)],
};
const reports = [
  O.normalizeReport({ id: 'a', dayId: 'd1', scenes: { s1: { status: 'done' } } }),
  O.normalizeReport({ id: 'b', dayId: 'd2', scenes: { s2: { status: 'done' }, s3: { status: 'part' }, s4: { status: 'done' } }, extraSceneIds: ['s4'] }),
];
const p = O.progress(prod, reports, prod.days[0]);
assert.deepStrictEqual([p.dayNumber, p.days], [2, 3], 'days in date order');
assert.deepStrictEqual(p.today, { planned: 2, plannedPages: 8, done: 2, donePages: 12, reported: true }, 'a scene picked up from another day counts');
assert.deepStrictEqual([p.toDate.plannedPages, p.toDate.donePages, p.aheadBy], [16, 20, 4], 'ahead by half a page');
assert.deepStrictEqual([p.scenesFinished, p.scenesTotal, p.pagesFinished, p.pagesTotal], [3, 4, 20, 24]);
const first = O.progress(prod, [], prod.days[1]);
assert.deepStrictEqual([first.today.reported, first.aheadBy], [false, -8], 'nothing reported: a day behind');
console.log('  ✓ progress against the schedule');

const post = { takes: [
  { dayId: 'd1', shotId: 'x', status: 'circle' }, { dayId: 'd1', shotId: 'x', status: '' }, { dayId: 'd1', shotId: 'y', status: 'circle' }, { dayId: 'd2', shotId: 'z' },
] };
assert.deepStrictEqual(O.takeCounts(post, 'd1'), { setups: 2, takes: 3, circled: 2 });
assert.deepStrictEqual(O.takeCounts(null, 'd1'), { setups: 0, takes: 0, circled: 0 });
console.log('  ✓ setups and takes from the take log');
console.log('onset: all checks passed');
