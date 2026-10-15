// Run: node tests/script-parse.test.js
// Parses the same short script as PDF, Final Draft and Fountain and checks the breakdown.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
require('../src/script-parse.js');
const { extractPdfLines } = require('../pdf-text.js');
const { parseScript, buildProject, parseHeading, formatEighths } = globalThis.ScriptParse;

const fx = (f) => path.join(__dirname, 'fixtures', f);

function checkBreakdown(parsed, label) {
  assert.strictEqual(parsed.title, 'Night Diner', `${label}: title`);
  assert.deepStrictEqual(parsed.scenes.map((s) => s.number), ['1', '2', '3', '4'], `${label}: numbers`);
  assert.deepStrictEqual(parsed.scenes.map((s) => s.heading), [
    "EXT. ROSIE'S DINER - NIGHT", "INT. ROSIE'S DINER - NIGHT", "INT. ROSIE'S DINER - BOOTH - LATER", 'EXT. PARKING LOT - CONTINUOUS',
  ], `${label}: headings`);
  const [s1, s2, s3, s4] = parsed.scenes;
  assert.deepStrictEqual([s1.intExt, s1.location, s1.time], ['EXT', "ROSIE'S DINER", 'NIGHT'], `${label}: heading parts`);
  assert.deepStrictEqual([s3.location, s3.time], ["ROSIE'S DINER - BOOTH", 'LATER'], `${label}: sub-location`);
  assert.deepStrictEqual(s1.speakers, [], `${label}: scene 1 speakers`);
  assert.deepStrictEqual(s1.cast, ['Maya'], `${label}: scene 1 cast from action`);
  assert.deepStrictEqual(s2.speakers, ['Maya', 'Lou'], `${label}: scene 2 speakers`);
  assert.deepStrictEqual(s3.speakers, ['Reyes', 'Maya', 'Lou'], `${label}: scene 3 speakers (CONT'D stripped)`);
  assert.deepStrictEqual(s4.cast, ['Maya'], `${label}: scene 4 cast`);
  assert.ok(s2.synopsis.startsWith('LOU (60s) wipes the counter'), `${label}: synopsis`);
  assert.deepStrictEqual(parsed.characters.slice().sort(), ['Lou', 'Maya', 'Reyes'], `${label}: characters`);
  for (const s of parsed.scenes) assert.ok(s.eighths >= 1 && s.eighths <= 8, `${label}: scene ${s.number} length ${s.eighths}/8`);

  const project = buildProject(parsed, { establishing: true, master: true, coverage: true });
  const types = project.scenes.map((s) => s.shots.map((x) => x.type).join(' '));
  assert.deepStrictEqual(types, [
    'EST WS MS',              // new location, action only
    'WS 2S OTS OTS',          // same location, two speakers
    'WS MS MCU MCU MCU',      // same place (booth), three speakers
    'EST WS MS',              // new location, action only
  ], `${label}: starter shots`);
  assert.strictEqual(project.scenes[1].shots[2].desc, 'Over *Lou* onto *Maya*');
  assert.strictEqual(project.scenes[0].shots[0].audio, 'MOS');
  assert.strictEqual(project.scenes[1].shots[0].audio, 'Sync');

  const bare = buildProject(parsed, { include: new Set([0, 2]) });
  assert.deepStrictEqual(bare.scenes.map((s) => [s.number, s.shots.length]), [['1', 0], ['3', 0]], `${label}: scenes only`);
}

(async () => {
  // Heading edge cases
  assert.deepStrictEqual(parseHeading('12A INT./EXT. CAR (MOVING) - DAY 12A'),
    { heading: 'INT./EXT. CAR (MOVING) - DAY', number: '12A', intExt: 'INT./EXT', location: 'CAR (MOVING)', time: 'DAY' });
  assert.deepStrictEqual(parseHeading('.FLASHBACK — THE LAKE #7#').number, '7');
  assert.strictEqual(formatEighths(11), '1 3/8');
  assert.strictEqual(formatEighths(8), '1');
  assert.strictEqual(formatEighths(3), '3/8');

  const pdf = parseScript({ kind: 'pdf', lines: await extractPdfLines(fx('night-diner.pdf')), name: 'night-diner.pdf' });
  checkBreakdown(pdf, 'PDF');
  console.log('  ✓ PDF', pdf.scenes.map((s) => `${s.number}:${formatEighths(s.eighths)}`).join(' '));

  const fdx = parseScript({ kind: 'fdx', xml: fs.readFileSync(fx('night-diner.fdx'), 'utf8') });
  checkBreakdown(fdx, 'FDX');
  console.log('  ✓ Final Draft');

  const fountain = parseScript({ kind: 'text', text: fs.readFileSync(fx('night-diner.fountain'), 'utf8') });
  checkBreakdown(fountain, 'Fountain');
  console.log('  ✓ Fountain');

  assert.throws(() => parseScript({ kind: 'text', text: 'Just some notes.\nNo scenes here.' }), /No scene headings/);
  assert.throws(() => parseScript({ kind: 'pdf', lines: [] }), /no selectable text/);
  console.log('  ✓ helpful errors for scripts without scenes / scanned PDFs');
  console.log('script-parse: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
