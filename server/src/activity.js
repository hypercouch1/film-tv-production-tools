// "Recent activity": edits described in a few words ("Scene 4", "Day of 2026-11-03",
// "Take log") from the operations people send, for the production home's list.

const MAX_ITEMS = 12;
const str = (v) => (v == null ? '' : String(v));

// The item an id-addressed path step points at, before or after the change.
function find(doc, path) {
  let cur = doc;
  const trail = [];
  for (const seg of path) {
    if (cur == null) break;
    if (seg.startsWith('#')) {
      cur = Array.isArray(cur) ? cur.find((x) => x && x.id === seg.slice(1)) : undefined;
      trail.push(cur);
    } else cur = cur[seg];
  }
  return trail;
}

const KIND_LABEL = { shotsheet: 'Production', script: 'Script', callsheet: 'Call sheet', post: 'Post', budget: 'Budget', onset: 'On set', gear: 'Equipment' };
const SECTION = {
  post: { takes: 'Take log', media: 'Media catalogue', tasks: 'Post tracker', versions: 'Cuts & notes' },
  budget: { lines: 'Budget lines', costs: 'Expenses' },
  onset: { reports: 'Production reports', notes: 'Continuity notes' },
  gear: { items: 'Equipment list', log: 'Equipment check-out' },
  script: { elements: 'Script', titlePage: 'Title page', revisions: 'Revisions', tags: 'Breakdown tags' },
  callsheet: { sections: 'Call sheet' },
};
// Bookkeeping that isn't anyone's edit.
const SKIP = new Set(['claims', 'crewLinks', 'availabilityLinks', 'scriptLink', 'comments']);

// One op → a label (or null to leave it out). before/after: the document either side.
export function describe(kind, op, before, after, title = '') {
  if (!op || !Array.isArray(op.p) || !op.p.length) return null;
  const [top] = op.p;
  if (SKIP.has(top)) return null;
  // The item, found in either version (a deleted one is only in "before").
  const path = op.t === 'ins' || op.t === 'del' || op.t === 'mov'
    ? [...op.p, '#' + str(op.t === 'ins' ? op.v && op.v.id : op.id)] : op.p;
  const item = find(after, path)[0] || find(before, path)[0] || (op.t === 'ins' && op.p.length === 1 ? op.v : null);
  if (top === 'title') return `${KIND_LABEL[kind] || 'Document'} title`;
  if (kind === 'shotsheet') {
    if (top === 'scenes') return item ? `Scene ${str(item.number) || '?'}` : 'Scenes';
    if (top === 'days') return item && item.date ? `Shoot day ${item.date}` : 'Shoot days';
    if (top === 'characters') return item ? `Cast: ${str(item.name) || str(item.actor) || 'someone'}` : 'Cast';
    if (top === 'crew') return item ? `Crew: ${str(item.name) || str(item.role) || 'someone'}` : 'Crew';
    if (top === 'locations') return item ? `Location: ${str(item.name) || 'unnamed'}` : 'Locations';
    if (top === 'elements') return 'Breakdown';
    if (top === 'availability') return 'Availability';
    if (top === 'episodes') return item ? `Episode ${str(item.number)}` : 'Episodes';
    return 'Production';
  }
  const section = (SECTION[kind] || {})[top];
  if (kind === 'script') return section === 'Script' ? `Script${title ? ': ' + title : ''}` : section || 'Script';
  return section || KIND_LABEL[kind] || 'Document';
}

// The labels for a batch of ops, without repeats.
export function describeAll(kind, ops, before, after, title) {
  const out = [];
  for (const op of ops) {
    const label = describe(kind, op, before, after, title);
    if (label && !out.includes(label)) out.push(label);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

export function mergeItems(a, b) {
  const out = [...a];
  for (const x of b) if (!out.includes(x) && out.length < MAX_ITEMS) out.push(x);
  return out;
}
