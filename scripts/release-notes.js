// Prints only one version's section of RELEASE_NOTES.md (for the GitHub release), so a
// release lists what's new and changed in that update, not every earlier version.
//   node scripts/release-notes.js 1.3.0 [RELEASE_NOTES.md]
// A section starts at "# Production Tools <version>" and ends at the next "---" line or the
// next version heading. Exits with an error if there's no section for the version.
const fs = require('fs');
const path = require('path');

function sectionFor(text, version) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const heading = (l) => /^#\s+Production Tools\s+v?(\S+)\s*$/.exec(l);
  const start = lines.findIndex((l) => { const m = heading(l); return m && m[1] === version.replace(/^v/, ''); });
  if (start < 0) return null;
  const out = [];
  for (const l of lines.slice(start + 1)) {
    if (/^---\s*$/.test(l) || heading(l)) break;
    out.push(l);
  }
  const body = out.join('\n').trim();
  return body ? body + '\n' : null;
}

if (require.main === module) {
  const version = process.argv[2];
  const file = process.argv[3] || path.join(__dirname, '..', 'RELEASE_NOTES.md');
  if (!version) { console.error('Usage: node scripts/release-notes.js <version> [file]'); process.exit(2); }
  const notes = sectionFor(fs.readFileSync(file, 'utf8'), version);
  if (!notes) {
    console.error(`RELEASE_NOTES.md has no "# Production Tools ${version.replace(/^v/, '')}" section. Add one at the top before tagging.`);
    process.exit(1);
  }
  process.stdout.write(notes);
}

module.exports = { sectionFor };
