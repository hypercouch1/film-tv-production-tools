// Run: node tests/release-notes.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { sectionFor } = require('../scripts/release-notes.js');

const sample = `# Production Tools 1.3.0

## New
- Productions

---

# Production Tools 1.2.4

## Fixed
- Reconnecting
# Production Tools 1.2.3
- Updates
`;
assert.strictEqual(sectionFor(sample, '1.3.0'), '## New\n- Productions\n', 'stops at ---');
assert.strictEqual(sectionFor(sample, 'v1.2.4'), '## Fixed\n- Reconnecting\n', 'stops at the next version; a leading v is fine');
assert.strictEqual(sectionFor(sample, '1.2.3'), '- Updates\n');
assert.strictEqual(sectionFor(sample, '9.9.9'), null, 'no section');
assert.strictEqual(sectionFor(sample.replace(/\n/g, '\r\n'), '1.3.0'), '## New\n- Productions\n', 'Windows line endings');
console.log('  ✓ picks one version’s section');

// The real file has a section for the version in package.json (the release would fail otherwise).
const version = require('../package.json').version;
const real = sectionFor(fs.readFileSync(path.join(__dirname, '..', 'RELEASE_NOTES.md'), 'utf8'), version);
assert.ok(real, `RELEASE_NOTES.md needs a "# Production Tools ${version}" section`);
assert.ok(!/^# Production Tools/m.test(real), 'only that version');
console.log(`  ✓ RELEASE_NOTES.md has notes for ${version}`);
console.log('release-notes: all checks passed');
