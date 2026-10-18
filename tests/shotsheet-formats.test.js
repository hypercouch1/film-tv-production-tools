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
