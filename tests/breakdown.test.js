// Run: node tests/breakdown.test.js
const assert = require('assert');
globalThis.window = globalThis;
globalThis.Common = { uid: () => Math.random().toString(36).slice(2, 10) };
require('../src/script-parse.js');
require('../src/screenplay.js');
require('../src/shotsheet-formats.js');
require('../src/breakdown-views.js');
const S = globalThis.Screenplay;
const B = globalThis.BreakdownViews;

// Tags live in the script, on lines; they belong to the scene above them.
const script = S.normalizeDoc({
  id: 'scr', title: 'Night Diner',
  elements: [
    { id: 'h1', type: 'heading', text: 'INT. DINER - NIGHT' },
    { id: 'a1', type: 'action', text: 'Lou pours from a dented coffee pot. A police cruiser idles outside.' },
    { id: 'h2', type: 'heading', text: 'EXT. LOT - NIGHT' },
    { id: 'a2', type: 'action', text: 'Maya in a yellow raincoat runs past the cruiser.' },
  ],
  tags: [
    { id: 't1', lineId: 'a1', text: 'dented coffee pot', category: 'props' },
    { id: 't2', lineId: 'a1', text: 'police cruiser', category: 'vehicles' },
    { id: 't3', lineId: 'a2', text: 'yellow raincoat', category: 'wardrobe' },
    { id: 't4', lineId: 'a2', text: 'Police Cruiser', category: 'vehicles' },
    { id: 't5', lineId: 'gone', text: 'orphan', category: 'props' },
  ],
});
assert.strictEqual(script.tags.length, 4, 'tags on deleted lines are dropped');
const byScene = S.tagsByScene(script);
assert.deepStrictEqual([...byScene.keys()], ['h1', 'h2']);
assert.deepStrictEqual(byScene.get('h2').map((t) => t.text), ['yellow raincoat', 'Police Cruiser']);
console.log('  ✓ script tags belong to their scene');

// A production whose scenes are linked to those script scenes.
const p = {
  scenes: [
    { id: 's1', number: '1', scriptScene: { id: 'h1' }, castIds: [], shots: [] },
    { id: 's2', number: '2', scriptScene: { id: 'h2' }, castIds: [], shots: [] },
    { id: 's3', number: '3', scriptScene: null, castIds: [], shots: [] },
  ],
  elements: [],
};
const tags = B.tagIndex([script]);
let cat = B.catalogue(p, tags);
const cruiser = cat.get('vehicles:police cruiser');
assert.deepStrictEqual([...cruiser.scenes], ['s1', 's2'], 'the same item in two scenes is one element (case-insensitive)');
assert.ok(cruiser.fromScript.has('s1'));

// Adding by hand: a new item, and an existing one in another scene.
B.addItem(p, p.scenes[2], 'vehicles', 'police cruiser');
B.addItem(p, p.scenes[2], 'extras', '20 diners');
cat = B.catalogue(p, tags);
assert.deepStrictEqual([...cat.get('vehicles:police cruiser').scenes].sort(), ['s1', 's2', 's3']);
assert.deepStrictEqual([...cat.get('extras:20 diners').scenes], ['s3']);
B.removeItem(p, p.scenes[2], 'extras:20 diners');
assert.strictEqual(B.catalogue(p, tags).get('extras:20 diners').scenes.size, 0, 'removed from the scene (the entry keeps its notes)');
console.log('  ✓ script tags and items added by hand merge into one breakdown');

// What a shoot day's scenes need, by category in breakdown order.
const day = B.forScenes(p, [p.scenes[0], p.scenes[2]], tags);
assert.deepStrictEqual(day.map((g) => g.category.id), ['props', 'vehicles']);
assert.deepStrictEqual(day.find((g) => g.category.id === 'vehicles').items[0].sceneIds.sort(), ['s1', 's3']);
console.log('  ✓ breakdown for a day’s scenes, grouped by category');

// Formats: elements survive export/import with their scenes.
const F = globalThis.ShotFormats;
const prod = F.normalizeProject({ scenes: [{ id: 'x1', number: '1', heading: 'A', shots: [] }], elements: [{ category: 'props', name: 'Mug', notes: 'chipped', sceneIds: ['x1'] }, { category: 'nope', name: 'x' }] });
assert.strictEqual(prod.elements.length, 1, 'unknown categories dropped');
const back = F.normalizeProject(JSON.parse(F.toShotsheet(prod)));
assert.deepStrictEqual(back.elements.map((e) => [e.category, e.name, e.notes, e.sceneIds[0] === back.scenes[0].id]), [['props', 'Mug', 'chipped', true]]);
console.log('  ✓ breakdown items survive export/import');
console.log('breakdown: all checks passed');
