// Run: node tests/history.test.js
const assert = require('assert');
require('../src/sync-core.js');
require('../src/history.js');
const { createHistory } = globalThis.History;
const { clone } = globalThis.SyncCore;

let doc = { id: 'd', title: 'Show', sections: [{ id: 's1', title: 'Prep', items: [{ id: 'i1', text: 'Mics', done: false }] }] };
let applied = 0;
const h = createHistory({ getDoc: () => doc, onApply: () => applied++, mergeWithinMs: 0 });
h.reset();

// Separate edits are separate steps.
doc.title = 'Show 2'; h.record();
doc.sections[0].items.push({ id: 'i2', text: 'Cue host', done: false }); h.record();
doc.sections[0].items[0].done = true; h.record();
assert.ok(h.canUndo && !h.canRedo);
h.undo();
assert.strictEqual(doc.sections[0].items[0].done, false);
h.undo();
assert.deepStrictEqual(doc.sections[0].items.map((i) => i.id), ['i1']);
assert.ok(h.canRedo);
h.redo();
assert.deepStrictEqual(doc.sections[0].items.map((i) => i.text), ['Mics', 'Cue host']);
assert.strictEqual(applied, 3);
console.log('  ✓ undo and redo step back and forward');

// A new edit clears redo.
doc.sections[0].title = 'PREP'; h.record();
assert.ok(!h.canRedo);
console.log('  ✓ a new edit clears redo');

// Typing without a pause is one step.
const typing = createHistory({ getDoc: () => doc, mergeWithinMs: 10000 });
typing.reset();
for (const ch of ' and IFBs') { doc.sections[0].items[0].text += ch; typing.record(); }
typing.undo();
assert.strictEqual(doc.sections[0].items[0].text, 'Mics');
assert.ok(!typing.canUndo);
console.log('  ✓ continuous typing undoes as one step');

// In a shared project, undo reverses only my change, not a collaborator's.
doc = { id: 'p', title: 'Shared', sections: [{ id: 's1', title: 'A', items: [{ id: 'x', text: 'one', done: false }] }] };
const shared = createHistory({ getDoc: () => doc, mergeWithinMs: 0 });
shared.reset();
doc.sections[0].items[0].text = 'one (mine)'; shared.record();       // my edit
doc.sections[0].items.push({ id: 'y', text: 'theirs', done: false }); // arrives from a collaborator
doc.title = 'Renamed by them';
shared.rebase();
shared.undo();
assert.strictEqual(doc.sections[0].items[0].text, 'one', 'my edit is undone');
assert.deepStrictEqual(doc.sections[0].items.map((i) => i.id), ['x', 'y'], "collaborator's new item survives");
assert.strictEqual(doc.title, 'Renamed by them', "collaborator's rename survives");
console.log("  ✓ undo in a shared project leaves collaborators' changes alone");

// Switching documents starts a fresh history; local-only keys are ignored.
const other = { id: 'other', title: 'B', _cloud: { role: 'owner' } };
let current = clone(doc);
const sw = createHistory({ getDoc: () => current, mergeWithinMs: 0 });
sw.reset();
current = other; sw.record();
assert.ok(!sw.canUndo);
other._cloud.role = 'viewer'; other.updatedAt = 5; sw.record();
assert.ok(!sw.canUndo, 'updatedAt and _ keys are not undo steps');
console.log('  ✓ switching documents resets; local-only fields are ignored');
console.log('history: all checks passed');
