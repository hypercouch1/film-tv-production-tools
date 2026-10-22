// Run: node tests/csv.test.js
// CSV exports hold text other people typed (shared projects): cells that a spreadsheet would
// run as formulas get a leading ', and the app's own CSV import gives back the original text.
const assert = require('assert');
globalThis.window = globalThis;
globalThis.document = { getElementById: () => null, addEventListener() {} };
globalThis.addEventListener = () => {};
require('../src/common.js');
const { csvField, parseCSV } = window.Common;

assert.strictEqual(csvField('=cmd|/C calc!A0'), "'=cmd|/C calc!A0");
assert.strictEqual(csvField('+1'), "'+1");
assert.strictEqual(csvField('@SUM(A1)'), "'@SUM(A1)");
assert.strictEqual(csvField('-2+3'), "'-2+3");
assert.strictEqual(csvField('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"', 'quoted as well when needed');
assert.strictEqual(csvField('Coffee pot, chipped'), '"Coffee pot, chipped"');
assert.strictEqual(csvField('Ordinary text - with a dash'), 'Ordinary text - with a dash');
console.log('  ✓ formulas are defused');

const row = ['=cmd|/C calc!A0', '-5 stops', 'plain', "'kept as typed"];
const parsed = parseCSV(row.map(csvField).join(',') + '\n')[0];
assert.deepStrictEqual(parsed, row, 'the app reads its own export back unchanged');
console.log('  ✓ round trip keeps the original text');
console.log('csv: all checks passed');
