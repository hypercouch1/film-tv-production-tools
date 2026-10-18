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
  console.log('screenplay: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
