// Run: node tests/shotsheet-formats.test.js
// Cast & crew data: upgrading older projects, file round trips, and gear implied by shots.
const assert = require('assert');
globalThis.window = globalThis;
let n = 0;
window.Common = { uid: () => 'id' + ++n, parseCSV: () => [], csvField: (v) => String(v) };
require('../src/shotsheet-formats.js');
const F = window.ShotFormats;

// Older projects listed scene cast by name; upgrading turns them into one shared character list.
const old = { title: 'Old', scenes: [{ id: 's1', cast: ['Maya', 'Lou'], shots: [] }, { id: 's2', cast: ['MAYA'], shots: [] }], days: [] };
F.upgradeProject(old);
assert.deepStrictEqual(old.characters.map((c) => c.name), ['Maya', 'Lou']);
assert.strictEqual(old.scenes[1].castIds[0], old.scenes[0].castIds[0], 'same character matched case-insensitively');
assert.ok(!('cast' in old.scenes[0]));
assert.deepStrictEqual([old.crew, old.scenes[0].crewIds, old.scenes[0].props], [[], [], '']);
console.log('  ✓ older projects upgrade to the character list');

// Malformed shared data is cleaned up instead of breaking the page.
const bad = {
  title: 42,
  characters: [{ id: 'c', name: { evil: true } }, 'junk', null],
  crew: [{ id: 'k', role: 7, allDays: 'yes' }],
  days: [{ id: 'd', date: 'not a date' }, { id: 'd2', date: '2026-11-02', notes: ['x'] }],
  scenes: [{ id: 's', number: 3, shots: [{ id: 'x', desc: { a: 1 }, done: 'true', dayId: 5 }, 'junk'], castIds: ['c', 9, null], eighths: 'lots' }],
};
F.upgradeProject(bad);
assert.strictEqual(bad.title, '42');
assert.deepStrictEqual(bad.characters.map((c) => typeof c.name), ['string']);
assert.deepStrictEqual([bad.crew[0].role, bad.crew[0].allDays], ['7', true]);
assert.deepStrictEqual(bad.days.map((d) => d.id), ['d2'], 'days without a valid date are dropped');
assert.strictEqual(typeof bad.days[0].notes, 'string');
const shot = bad.scenes[0].shots[0];
assert.deepStrictEqual([typeof shot.desc, shot.done, shot.dayId, bad.scenes[0].shots.length], ['string', true, null, 1]);
assert.deepStrictEqual([bad.scenes[0].number, bad.scenes[0].castIds, bad.scenes[0].eighths], ['3', ['c'], 0]);
console.log('  ✓ malformed shared data is cleaned up');

// Round trip through the .shotsheet file keeps people and their scene assignments.
const p = F.normalizeProject({
  title: 'Film',
  characters: [{ id: 'a', name: 'Maya', actor: 'Jane', contact: 'jane@x.test' }],
  crew: [{ id: 'k', role: 'Gaffer', name: 'Sam', contact: '', allDays: true }],
  days: [{ id: 'd', date: '2026-11-02', equipment: 'Generator' }],
  scenes: [{ number: '1', castIds: ['a', 'missing'], crewIds: ['k'], props: 'mug, keys', equipment: 'haze', shots: [{ dayId: 'd' }] }],
});
const back = F.normalizeProject(JSON.parse(F.toShotsheet(p)));
assert.deepStrictEqual(back.characters.map((c) => [c.name, c.actor, c.contact]), [['Maya', 'Jane', 'jane@x.test']]);
assert.strictEqual(back.crew[0].allDays, true);
assert.deepStrictEqual(back.scenes[0].castIds, [back.characters[0].id], 'unknown ids are dropped, known ids remapped');
assert.deepStrictEqual(back.scenes[0].crewIds, [back.crew[0].id]);
assert.deepStrictEqual([back.scenes[0].props, back.scenes[0].equipment, back.days[0].equipment], ['mug, keys', 'haze', 'Generator']);
assert.match(F.toICS(back), /Cast: Maya \(Jane\)/);
console.log('  ✓ cast, crew, props and equipment survive export/import (and reach the calendar)');

// Call sheet details, the script link and comments survive a round trip, with call times
// following their people to the new ids.
const cs = F.normalizeProject({
  title: 'Linked',
  scriptLink: { scriptId: 'script-1', title: 'Night Diner' },
  characters: [{ id: 'a', name: 'Maya' }],
  crew: [{ id: 'k', role: 'Gaffer' }],
  days: [{ id: 'd', date: '2026-11-02', crewCall: '06:30', parking: 'Lot B', hospital: 'St. Mary’s, 555-0100', weather: 'Clear 72°', sunrise: '6:41 AM', sunset: '5:58 PM', calls: { a: '08:00', k: '06:00', ghost: '09:00' } }],
  scenes: [{ number: '1', heading: 'INT. DINER - NIGHT', scriptScene: { id: 'h1', hash: 'abc' }, shots: [] }],
  comments: [{ id: 'c1', target: 'x', text: 'Check the lens', author: 'A', at: 1 }],
});
const cs2 = F.normalizeProject(JSON.parse(F.toShotsheet(cs)));
const day2 = cs2.days[0];
assert.deepStrictEqual([day2.crewCall, day2.parking, day2.hospital, day2.weather, day2.sunrise, day2.sunset], ['06:30', 'Lot B', 'St. Mary’s, 555-0100', 'Clear 72°', '6:41 AM', '5:58 PM']);
assert.deepStrictEqual(day2.calls, { [cs2.characters[0].id]: '08:00', [cs2.crew[0].id]: '06:00' }, 'call times follow their people; unknown ids dropped');
assert.deepStrictEqual(cs2.scriptLink, { scriptId: 'script-1', title: 'Night Diner', auto: true, ignored: [] }, 'older links update automatically');
assert.deepStrictEqual(cs2.scenes[0].scriptScene, { id: 'h1', hash: 'abc' });
assert.strictEqual(cs2.comments[0].text, 'Check the lens');
const off = F.normalizeProject(JSON.parse(F.toShotsheet({ ...cs,
  scriptLink: { scriptId: 's', title: 'T', auto: false, ignored: ['h2', 7] },
  scenes: [{ ...cs.scenes[0], scriptScene: { id: 'h1', hash: 'abc', number: '4' } }] })));
assert.deepStrictEqual(off.scriptLink, { scriptId: 's', title: 'T', auto: false, ignored: ['h2'] });
assert.deepStrictEqual(off.scenes[0].scriptScene, { id: 'h1', hash: 'abc', number: '4' });
console.log('  ✓ call sheet details, script link and comments survive export/import');

// Schedule: strip order, scenes scheduled without shots, availability — survive export/import.
const sched = F.normalizeProject({
  characters: [{ id: 'c', name: 'Maya', actor: 'Ann' }],
  crew: [{ id: 'k', role: 'Gaffer' }],
  days: [{ id: 'd1', date: '2026-11-02', sceneOrder: ['s2', 's1'] }],
  scenes: [{ id: 's1', number: '1', heading: 'A', shots: [{ day: '2026-11-02' }] }, { id: 's2', number: '2', heading: 'B', dayId: 'd1', shots: [] }],
  availability: { c: { off: ['2026-11-02', 'bad', '2026-11-02'], note: 'mornings' }, ghost: { off: ['2026-11-03'] } },
});
const sched2 = F.normalizeProject(JSON.parse(F.toShotsheet(sched)));
const [sa, sb] = sched2.scenes;
assert.deepStrictEqual(sched2.days[0].sceneOrder, [sb.id, sa.id], 'strip order follows the scenes');
assert.strictEqual(sb.dayId, sched2.days[0].id, 'a scene without shots keeps its day');
assert.deepStrictEqual(sched2.availability[sched2.characters[0].id], { off: ['2026-11-02'], note: 'mornings' }, 'availability follows its person; bad dates dropped');
assert.strictEqual(Object.keys(sched2.availability).length, 1, 'unknown people dropped');
console.log('  ✓ schedule (strip order, availability) survives export/import');

// Locations: scenes match by their set; the longest matching set wins; a pick overrides.
assert.strictEqual(F.setOf("INT. ROSIE'S DINER - BOOTH - LATER"), "ROSIE'S DINER - BOOTH");
assert.strictEqual(F.setOf('EXT. PARKING LOT - NIGHT'), 'PARKING LOT');
assert.strictEqual(F.setOf('I/E. CAR - DAY'), 'CAR');
const lp = F.normalizeProject({
  locations: [{ id: 'l1', name: "Rosie's", sets: ["Rosie's Diner"], permit: 'approved' }, { id: 'l2', name: 'Booth set', sets: ["Rosie's Diner - Booth"], permit: 'bogus' }, { id: 'l3', name: 'Lot', sets: ['Parking lot'] }],
  scenes: [
    { id: 'a', heading: "INT. ROSIE'S DINER - NIGHT", shots: [] },
    { id: 'b', heading: "INT. ROSIE'S DINER - BOOTH - LATER", shots: [] },
    { id: 'c', heading: 'EXT. PARKING LOT - NIGHT', shots: [], locationId: 'l1' },
    { id: 'd', heading: 'EXT. BEACH - DAY', shots: [] },
  ],
});
assert.deepStrictEqual(lp.scenes.map((s) => (F.locationOf(lp, s) || {}).name || null), ["Rosie's", 'Booth set', "Rosie's", null]);
assert.strictEqual(lp.locations[1].permit, '', 'unknown permit status cleared');
const lp2 = F.normalizeProject(JSON.parse(F.toShotsheet(lp)));
assert.deepStrictEqual(lp2.scenes.map((s) => (F.locationOf(lp2, s) || {}).name || null), ["Rosie's", 'Booth set', "Rosie's", null], 'survives export/import');
console.log('  ✓ locations match scenes by set, and survive export/import');

// Several roles per crew member, kept in the one role field.
assert.deepStrictEqual(F.crewRoles({ role: 'Director, Producer ,, director' }), ['Director', 'Producer'], 'trimmed, no blanks or repeats');
assert.deepStrictEqual(F.crewRoles({ role: 'Gaffer' }), ['Gaffer'], 'single roles unchanged');
assert.deepStrictEqual(F.crewRoles({}), []);
const multi = F.setCrewRoles({ role: 'Director' }, ['Director', ' Editor', 'Writer, Producer', '']);
assert.strictEqual(multi.role, 'Director, Editor, Writer, Producer');
const rolesBack = F.normalizeProject(JSON.parse(F.toShotsheet(F.normalizeProject({ crew: [{ id: 'k', role: multi.role, name: 'Sam' }], scenes: [] }))));
assert.deepStrictEqual(F.crewRoles(rolesBack.crew[0]), ['Director', 'Editor', 'Writer', 'Producer'], 'roles survive export/import');
console.log('  ✓ crew members can have several roles');

assert.deepStrictEqual(F.listItems('mug, keys\nnewspaper; ,'), ['mug', 'keys', 'newspaper']);
const gear = F.shotEquipment([
  { code: '1A', shot: { move: 'Crane', cam: 'A', fps: '24', audio: 'MOS', lens: '24mm' } },
  { code: '1B', shot: { move: 'Gimbal', cam: 'B', fps: '120', audio: 'Sync', lens: '100mm' } },
  { code: '1C', shot: { move: 'Static', cam: 'B', fps: '24', audio: 'Sync', lens: '50mm' } },
]);
assert.deepStrictEqual(gear.map((g) => [g.item, g.refs.join(' ')]), [
  ['Lenses: 24mm, 50mm, 100mm', ''],
  ['Crane / jib', '1A'],
  ['Gimbal', '1B'],
  ['B camera', '1B 1C'],
  ['High-speed capture (120 fps)', '1B'],
  ['Sound kit (sync sound)', '1B 1C'],
]);
console.log('  ✓ equipment implied by shots');
console.log('shotsheet-formats: all checks passed');
