// Run: node tests/sync-core.test.js
// Simulates several clients editing the same document at once through a server
// that applies batches in arrival order, then checks that everyone converges.
require('../src/sync-core.js');
const { diff, applyAll, clone } = globalThis.SyncCore;
const assert = require('assert');

let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (a) => a[Math.floor(rand() * a.length)];
let idn = 0;
const newId = () => 'n' + ++idn;

// ---- Unit checks ----
{
  const a = { title: 'A', sections: [{ id: 's1', title: 'One', items: [{ id: 'i1', text: 'x', done: false }] }] };
  const b = clone(a);
  b.title = 'B';
  b.sections[0].items.push({ id: 'i2', text: 'y', done: false });
  b.sections.unshift({ id: 's0', title: 'Zero', items: [] });
  b.updatedAt = 5; // local-only key, must not sync
  b._cloud = { id: 'p' };
  const ops = diff(a, b);
  const c = clone(a);
  applyAll(c, ops);
  assert.deepStrictEqual(c, { title: 'B', sections: b.sections });
  assert.ok(!ops.some((o) => o.p.includes('updatedAt') || o.p.includes('_cloud')));

  // Prototype pollution attempts are ignored.
  const d = {};
  applyAll(d, [{ t: 'set', p: ['__proto__', 'polluted'], v: 1 }, { t: 'set', p: ['constructor'], v: 1 }]);
  assert.strictEqual({}.polluted, undefined);
  assert.strictEqual(Object.keys(d).length, 0);
}

// ---- Randomized convergence ----
function randomEdit(doc) {
  const secs = doc.sections;
  const r = rand();
  if (r < 0.1 || !secs.length) secs.splice(Math.floor(rand() * (secs.length + 1)), 0, { id: newId(), title: 'S' + idn, items: [] });
  else if (r < 0.15) secs.splice(Math.floor(rand() * secs.length), 1);
  else if (r < 0.22 && secs.length > 1) { const [s] = secs.splice(Math.floor(rand() * secs.length), 1); secs.splice(Math.floor(rand() * (secs.length + 1)), 0, s); }
  else if (r < 0.3) pick(secs).title = 'T' + Math.floor(rand() * 100);
  else if (r < 0.32) doc.title = 'Doc ' + Math.floor(rand() * 100);
  else {
    const s = pick(secs);
    const items = s.items;
    const q = rand();
    if (q < 0.35 || !items.length) items.splice(Math.floor(rand() * (items.length + 1)), 0, { id: newId(), text: 'i' + idn, done: false });
    else if (q < 0.5) items.splice(Math.floor(rand() * items.length), 1);
    else if (q < 0.65) { const [it] = items.splice(Math.floor(rand() * items.length), 1); items.splice(Math.floor(rand() * (items.length + 1)), 0, it); }
    else if (q < 0.75) { const [it] = items.splice(Math.floor(rand() * items.length), 1); pick(secs).items.push(it); }
    else if (q < 0.88) pick(items).done = !pick(items).done;
    else pick(items).text = 'edit' + Math.floor(rand() * 1000);
  }
}

for (let round = 0; round < 300; round++) {
  const start = { id: 'doc', title: 'Doc', sections: [{ id: 's1', title: 'S1', items: [{ id: 'i1', text: 'a', done: false }] }] };
  const server = { doc: clone(start), log: [] };
  // Each client: confirmed server doc + unacknowledged batches + its live local doc.
  const clients = [0, 1, 2].map((n) => ({ n, base: clone(start), seen: 0, pending: [], local: clone(start), synced: clone(start) }));

  const rebuild = (c) => {
    const d = clone(c.base);
    for (const b of c.pending) applyAll(d, b.ops);
    c.local = d;
    c.synced = clone(d);
  };
  const deliver = (c) => {
    while (c.seen < server.log.length) {
      const msg = server.log[c.seen++];
      applyAll(c.base, msg.ops);
      if (msg.from === c.n) c.pending = c.pending.filter((b) => b.batch !== msg.batch);
      else rebuild(c);
    }
  };

  for (let step = 0; step < 40; step++) {
    const c = pick(clients);
    const r = rand();
    if (r < 0.6) {
      randomEdit(c.local);
      const ops = diff(c.synced, c.local);
      if (ops.length) {
        const batch = { batch: step, ops };
        c.pending.push(batch);
        c.synced = clone(c.local);
        c.outbox = (c.outbox || []).concat([batch]);
      }
    } else if (r < 0.85 && c.outbox && c.outbox.length) {
      const b = c.outbox.shift();
      server.log.push({ from: c.n, batch: b.batch, ops: applyAll(server.doc, b.ops) });
    } else deliver(c);
  }
  // Flush everything.
  for (const c of clients) for (const b of c.outbox || []) server.log.push({ from: c.n, batch: b.batch, ops: applyAll(server.doc, b.ops) });
  for (const c of clients) { c.outbox = []; deliver(c); }
  for (const c of clients) {
    assert.deepStrictEqual(c.local, server.doc, `round ${round}: client ${c.n} diverged`);
    assert.strictEqual(c.pending.length, 0);
  }
}

console.log('sync-core: all checks passed');
