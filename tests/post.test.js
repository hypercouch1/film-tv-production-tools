// Run: node tests/post.test.js
const assert = require('assert');
require('../src/post-formats.js');
const P = globalThis.PostFormats;

// Cleaning: unknown values become safe defaults; bad entries are dropped.
const d = P.normalizePost({
  productionId: 'p1',
  takes: [{ id: 't1', shotId: 's1', take: 1, status: 'circle', clip: 'A001C003' }, { id: 't2', shotId: 's1', take: '2', status: 'bogus' }, 'junk'],
  media: [{ id: 'm1', name: 'A001C003.MOV', size: 'big' }, { id: 'm2', name: 'notes.pdf' }, { id: 'm3', name: 'Cut v2.prproj' }, { id: 'm4', name: 'x.zzz' }],
  tasks: [{ id: 'k1', area: 'vfx', title: 'Sky replacement', status: 'nope', due: 'tomorrow' }],
  versions: [{ id: 'v1', name: 'Rough cut', stage: 'rough', notes: [{ id: 'n1', tc: '01:02:03:04', text: 'Trim the pause', resolved: 1 }, null] }],
});
assert.deepStrictEqual(d.takes.map((t) => [t.take, t.status]), [['1', 'circle'], ['2', '']]);
assert.deepStrictEqual(d.media.map((m) => m.kind), ['video', 'document', 'project', 'other']);
assert.strictEqual(d.media[0].size, 0);
assert.deepStrictEqual([d.tasks[0].status, d.tasks[0].due], ['todo', '']);
assert.deepStrictEqual(d.versions[0].notes.map((n) => [n.tc, n.resolved]), [['01:02:03:04', true]]);
console.log('  ✓ post documents are cleaned up');

// Take numbers and linking media to takes by clip name.
assert.strictEqual(P.nextTake(d, 's1'), '3');
assert.strictEqual(P.nextTake(d, 'other'), '1');
assert.strictEqual(P.matchMedia(d), 1);
assert.deepStrictEqual([d.media[0].takeId, d.media[0].shotId], ['t1', 's1'], 'A001C003.MOV matches clip A001C003');
console.log('  ✓ take numbers; catalogued clips link to logged takes');

// CSV exports.
const ctx = { codeOf: (id) => (id === 's1' ? '1A' : ''), sceneOf: () => '1', dayOf: () => 'Day 1', scenesOf: () => '1, 2' };
const takes = P.takesCSV(d, ctx).split('\n');
assert.strictEqual(takes[0], 'Day,Scene,Shot,Take,Roll / card,Clip,Timecode,Status,Notes');
assert.strictEqual(takes[1], 'Day 1,1,1A,1,,A001C003,,Circled,');
assert.match(P.tasksCSV(d, ctx), /Visual effects,Sky replacement,To do/);
assert.match(P.notesCSV(d), /Rough cut,Rough cut,,01:02:03:04,Trim the pause,,yes/);
assert.match(P.mediaCSV(d, ctx), /A001C003\.MOV,Video,0/);
const risky = P.normalizePost({ takes: [{ id: 'x', notes: '=HYPERLINK("http://evil","click")' }, { id: 'y', notes: '@SUM(A1)' }, { id: 'z', notes: 'fine - ok' }] });
const lines = P.takesCSV(risky, ctx).split('\n');
assert.match(lines[1], /,"'=HYPERLINK\(""http:\/\/evil"",""click""\)"$/, 'formulas are defused');
assert.match(lines[2], /,'@SUM\(A1\)$/);
assert.match(lines[3], /,fine - ok$/, 'ordinary text untouched');
console.log('  ✓ take log, media, tracker and notes export to CSV (formulas defused)');
console.log('post: all checks passed');
