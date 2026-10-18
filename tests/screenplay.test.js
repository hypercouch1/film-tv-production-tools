// Run: node tests/screenplay.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
require('../src/script-parse.js');
require('../src/screenplay.js');
const { extractPdfLines } = require('../pdf-text.js');
const S = globalThis.Screenplay;
const SP = globalThis.ScriptParse;

const doc = S.normalizeDoc({
  title: 'Night Diner',
  titlePage: { author: 'Test Writer', contact: 'test@example.test\n555-0100', draftDate: 'Oct 2026' },
  elements: [
    { type: 'transition', text: 'fade in:' },
    { type: 'heading', text: "ext. rosie's diner - night" },
    { type: 'action', text: 'Rain hammers the neon sign. MAYA (30s) crosses the lot.' },
    { type: 'heading', text: "int. rosie's diner - night" },
    { type: 'action', text: 'Lou wipes the counter.' },
    { type: 'character', text: 'maya' },
    { type: 'dialogue', text: 'You still make it too strong.' },
    { type: 'character', text: 'lou' },
    { type: 'parenthetical', text: 'not looking up' },
    { type: 'dialogue', text: 'You still drink it.' },
    { type: 'transition', text: 'cut to:' },
    { type: 'heading', text: 'FLASHBACK - THE LAKE - DAY' },
    { type: 'shot', text: 'close on the water' },
    { type: 'character', text: 'MAYA (V.O.)' },
    { type: 'dialogue', text: 'I remember this place.' },
  ],
});
const shape = (d) => d.elements.map((e) => [e.type, S.displayText(e)]);

// Formatting rules
assert.strictEqual(S.autoType('INT. KITCHEN - DAY', 'action'), 'heading');
assert.strictEqual(S.autoType('ext. lot', 'action'), 'heading');
assert.strictEqual(S.autoType('SMASH CUT TO:', 'action'), 'transition');
assert.strictEqual(S.autoType('She walks in.', 'action'), 'action');
assert.strictEqual(S.autoType('INT. KITCHEN', 'dialogue'), 'dialogue', 'only Action lines are auto-detected');
assert.strictEqual(S.displayText({ type: 'parenthetical', text: 'quietly' }), '(quietly)');
assert.strictEqual(S.displayText({ type: 'character', text: 'maya' }), 'MAYA');
assert.strictEqual(S.NEXT_ON_ENTER.character, 'dialogue');
assert.strictEqual(S.NEXT_ON_TAB.dialogue, 'parenthetical');
console.log('  ✓ formatting rules');

// Suggestions
const heading = { type: 'heading', text: "INT. ROSIE'S DINER - N" };
assert.deepStrictEqual(S.suggestions(doc, heading).items, ['NIGHT']);
assert.deepStrictEqual(S.suggestions(doc, { type: 'heading', text: 'int. r' }).items, ["INT. ROSIE'S DINER"]);
assert.deepStrictEqual(S.suggestions(doc, { type: 'character', text: 'l' }).items, ['LOU']);
console.log('  ✓ suggestions for characters, locations and times');

// Fountain round trip
const fountain = S.toFountain(doc);
assert.match(fountain, /^Title: Night Diner/);
assert.match(fountain, /\n\.FLASHBACK - THE LAKE - DAY\n/, 'non-standard heading is forced with a dot');
assert.match(fountain, /\nLOU\n\(not looking up\)\nYou still drink it\./);
const fromFountain = S.fromImport({ kind: 'text', text: fountain, name: 'x.fountain' });
assert.strictEqual(fromFountain.title, 'Night Diner');
assert.deepStrictEqual(fromFountain.titlePage, { credit: 'Written by', author: 'Test Writer', contact: 'test@example.test\n555-0100', draftDate: 'Oct 2026' },
  'title page details survive the round trip');
assert.deepStrictEqual(shape(fromFountain), shape(doc).map(([t, x]) => [t === 'shot' ? 'action' : t, x]),
  'Fountain export re-imports to the same script (Fountain has no shot element, so shots come back as action)');
console.log('  ✓ Fountain export → import round trip');

// Final Draft round trip
const fdx = S.toFdx(doc);
assert.match(fdx, /<Paragraph Number="2" Type="Scene Heading"><Text>INT\. ROSIE'S DINER - NIGHT<\/Text>/);
const fromFdx = S.fromImport({ kind: 'fdx', xml: fdx });
assert.strictEqual(fromFdx.title, 'Night Diner');
assert.deepStrictEqual(shape(fromFdx).filter(([t]) => t !== 'shot'), shape(doc).filter(([t]) => t !== 'shot'));
console.log('  ✓ Final Draft export → import round trip');

// Importing existing scripts
(async () => {
  const pdfDoc = S.fromImport({ kind: 'pdf', lines: await extractPdfLines(path.join(__dirname, 'fixtures', 'night-diner.pdf')), name: 'night-diner.pdf' });
  const types = pdfDoc.elements.map((e) => e.type);
  assert.strictEqual(pdfDoc.title, 'Night Diner');
  assert.strictEqual(types.filter((t) => t === 'heading').length, 4);
  assert.deepStrictEqual(pdfDoc.elements.filter((e) => e.type === 'heading').map((e) => e.text)[0], "EXT. ROSIE'S DINER - NIGHT", 'scene numbers stripped');
  assert.ok(types.includes('parenthetical') && types.includes('dialogue') && types.includes('character'));
  const fdxDoc = S.fromImport({ kind: 'fdx', xml: fs.readFileSync(path.join(__dirname, 'fixtures', 'night-diner.fdx'), 'utf8') });
  assert.deepStrictEqual(S.scenes(fdxDoc).map((s) => s.heading), S.scenes(pdfDoc).map((s) => s.heading));
  console.log('  ✓ imports existing PDF and Final Draft scripts');

  // Pagination
  assert.strictEqual(S.paginate(doc.elements).pages, 1);
  const long = S.normalizeDoc({ elements: Array.from({ length: 120 }, (_, i) => ({ type: i % 2 ? 'action' : 'heading', text: 'INT. ROOM ' + i })) });
  const { pageOf, pages } = S.paginate(long.elements);
  assert.ok(pages >= 4 && pages <= 6, `120 elements → ${pages} pages`);
  assert.ok(pageOf.every((p, i) => i === 0 || p >= pageOf[i - 1]), 'pages only increase');
  assert.deepStrictEqual(S.stats(doc), { words: 59, scenes: 3, pages: 1, characters: 2 });
  console.log('  ✓ pagination and stats');

  // To Shot Sheet and Call Sheet
  const parsed = SP.parseScript(S.toParseInput(doc));
  assert.deepStrictEqual(parsed.scenes.map((s) => [s.number, s.speakers.join('/')]), [['1', ''], ['2', 'Maya/Lou'], ['3', 'Maya']]);
  assert.strictEqual(parsed.title, 'Night Diner');
  const cs = S.toCallsheet(doc);
  assert.deepStrictEqual(cs.sections.map((s) => s.title), ["SC 1 — EXT. ROSIE'S DINER - NIGHT", "SC 2 — INT. ROSIE'S DINER - NIGHT", 'SC 3 — FLASHBACK - THE LAKE - DAY']);
  assert.deepStrictEqual(cs.sections[1].items, ['Places: *Maya*, *Lou*', 'Cue *Maya*', 'Cue *Lou*', 'Take *CUT TO:*', 'Clear scene 2']);
  assert.deepStrictEqual(cs.sections[2].items, ['Places: *Maya*', 'Shot: CLOSE ON THE WATER', 'Cue *Maya*', 'Clear scene 3']);
  assert.throws(() => S.toCallsheet(S.normalizeDoc({ elements: [{ type: 'action', text: 'x' }] })), /no scene headings/);
  console.log('  ✓ sends to Shot Sheet and Call Sheet');

  // Splitting long speeches: break after a sentence, at least two lines each side.
  const speech = 'I waited. I waited all night for you to call and you never did. Not once. Do you know what that feels like? Sitting by the phone like a fool.';
  const lines = S.wrapLines(speech, 35);
  assert.ok(lines.every((l) => l.length <= 35));
  assert.strictEqual(lines.join(' '), speech, 'wrapping keeps every word');
  assert.strictEqual(lines.length, 5);
  const split = S.splitSpeech(speech, 35, 4);
  assert.ok(split, 'a 5-line speech with 4 lines of room is split');
  assert.ok(split.firstLines >= 2 && split.firstLines <= 4, `kept ${split.firstLines} lines`);
  assert.match(split.first, /[.?!]$/, 'breaks after a sentence');
  assert.strictEqual(`${split.first} ${split.rest}`, speech, 'nothing is lost');
  assert.strictEqual(split.first, 'I waited. I waited all night for you to call and you never did. Not once. Do you know what that feels like?');
  assert.strictEqual(S.splitSpeech(speech, 35, 1), null, 'never leaves a single line behind');
  assert.strictEqual(S.splitSpeech('No full stop here and it keeps going and going without any end at all in sight', 35, 2), null,
    'no sentence break: move the whole speech');
  assert.strictEqual(S.speakerOf(doc.elements, 9), 'LOU', 'dialogue after a parenthetical belongs to the character above');
  assert.strictEqual(S.speakerOf(doc.elements, 14), 'MAYA', '(V.O.) is dropped for the CONT\'D name');
  console.log('  ✓ long speeches split with (MORE) / (CONT\'D) at a sentence break');

  // Revisions: what changed since a saved draft.
  const draft = S.normalizeDoc(JSON.parse(JSON.stringify(doc)));
  draft.revisions.push(S.makeRevision(draft, { color: S.nextRevisionColor(draft), author: 'Writer' }));
  assert.strictEqual(draft.revisions[0].name, 'White Revision');
  assert.strictEqual(S.nextRevisionColor(draft), 'Blue');
  draft.elements[4].text = 'Lou wipes the counter slowly.';
  draft.elements.splice(6, 0, { id: 'new1', type: 'action', text: 'A beat.' });
  const removedLine = draft.elements.splice(10, 1)[0];
  const ch = S.revisionChanges(draft, draft.revisions[0]);
  assert.deepStrictEqual([...ch.changed], [draft.elements[4].id]);
  assert.deepStrictEqual([...ch.added], ['new1']);
  assert.deepStrictEqual(ch.removed.map((e) => e.text), [removedLine.text]);
  const reloaded = S.normalizeDoc(JSON.parse(JSON.stringify(draft)));
  assert.strictEqual(reloaded.revisions[0].elements.length, doc.elements.length, 'revisions survive save/load');
  console.log('  ✓ revisions record drafts and show what changed since');

  // Scene fingerprints change only when that scene changes.
  const before = S.sceneLinks(doc);
  const edited = S.normalizeDoc(JSON.parse(JSON.stringify(doc)));
  edited.elements[6].text = 'You still make it far too strong.'; // scene 2 dialogue
  const after = S.sceneLinks(edited);
  assert.deepStrictEqual(after.map((s) => s.id), before.map((s) => s.id), 'scenes are identified by their heading line');
  assert.deepStrictEqual(after.map((s, i) => s.hash === before[i].hash), [true, false, true]);
  edited.elements.push({ id: 'blank', type: 'action', text: '' });
  assert.strictEqual(S.sceneLinks(edited)[2].hash, before[2].hash, 'an added blank line is not a change');
  console.log('  ✓ scene fingerprints detect which scenes changed');
  console.log('screenplay: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
