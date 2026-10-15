// End-to-end test against a running server: `npm run dev` in one terminal, then `npm test`.
// Set SERVER=https://... to point it somewhere else.
import assert from 'node:assert/strict';
import '../../src/sync-core.js';

const BASE = process.env.SERVER || 'http://127.0.0.1:8787';
const { diff, applyAll, clone } = globalThis.SyncCore;
const run = Date.now().toString(36);

async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, ...data };
}

// A minimal live client that queues every message so tests can wait for them.
function live(projectId, token) {
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/api/projects/${projectId}/live?token=${encodeURIComponent(token)}`);
  const queue = [];
  const waiters = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    queue.push(msg);
    for (const w of [...waiters]) if (w.pred(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
  };
  // A refused handshake surfaces as an error event rather than a close.
  const closed = new Promise((r) => { ws.onclose = (e) => r(e); ws.onerror = () => r({ code: 1006 }); });
  return {
    ws,
    closed,
    next(pred, ms = 4000) {
      const found = queue.find(pred);
      if (found) { queue.splice(queue.indexOf(found), 1); return Promise.resolve(found); }
      return new Promise((resolve, reject) => {
        const w = { pred, resolve: (m) => { queue.splice(queue.indexOf(m), 1); clearTimeout(t); resolve(m); } };
        const t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error('timed out waiting for message')); }, ms);
        waiters.push(w);
      });
    },
    send: (m) => ws.send(JSON.stringify(m)),
    close: () => ws.close(),
  };
}

const step = (name) => console.log('  ✓ ' + name);

// ---- Accounts ----
assert.equal((await api('GET', '/api/health')).ok, true);
const users = {};
for (const n of ['alice', 'bob', 'carol']) {
  const r = await api('POST', '/api/signup', { email: `${n}.${run}@example.com`, name: n[0].toUpperCase() + n.slice(1), password: 'correct horse' });
  assert.equal(r.status, 200, r.error);
  users[n] = r;
}
assert.equal((await api('POST', '/api/signup', { email: `alice.${run}@example.com`, name: 'A', password: 'correct horse' })).status, 409);
assert.equal((await api('POST', '/api/signup', { email: `x.${run}@example.com`, name: 'X', password: 'short' })).status, 400);
step('sign up, duplicate email and weak password rejected');

assert.equal((await api('POST', '/api/login', { email: `alice.${run}@example.com`, password: 'wrong password' })).status, 401);
const login = await api('POST', '/api/login', { email: `ALICE.${run}@example.com`, password: 'correct horse' });
assert.equal(login.status, 200);
assert.equal((await api('GET', '/api/me', null, login.token)).user.name, 'Alice');
assert.equal((await api('GET', '/api/me')).status, 401);
step('sign in (email case-insensitive), wrong password rejected, /me needs a session');

// ---- Projects & members ----
const A = users.alice.token, B = users.bob.token, C = users.carol.token;
const doc = { title: 'RTN Tonight', sections: [{ id: 's1', title: 'Prep', items: [{ id: 'i1', text: 'Mics', done: false }] }] };
const created = await api('POST', '/api/projects', { kind: 'callsheet', doc }, A);
assert.equal(created.status, 200, created.error);
const pid = created.project.id;
assert.equal((await api('GET', '/api/projects?kind=callsheet', null, A)).projects.length, 1);
assert.equal((await api('GET', '/api/projects', null, B)).projects.length, 0);
assert.equal((await api('GET', `/api/projects/${pid}/members`, null, B)).status, 404);
step('create project; only members can see it');

assert.equal((await api('POST', `/api/projects/${pid}/members`, { email: `nobody.${run}@example.com` }, A)).status, 404);
assert.equal((await api('POST', `/api/projects/${pid}/members`, { email: `bob.${run}@example.com`, role: 'editor' }, A)).status, 200);
const mem = await api('POST', `/api/projects/${pid}/members`, { email: `carol.${run}@example.com`, role: 'viewer' }, A);
assert.deepEqual(mem.members.map((m) => m.role), ['owner', 'editor', 'viewer']);
assert.equal((await api('POST', `/api/projects/${pid}/members`, { email: `carol.${run}@example.com`, role: 'editor' }, B)).status, 403);
step('owner adds editor + viewer; unknown email and non-owner invites rejected');

// ---- Live sync ----
const a = live(pid, A);
const b = live(pid, B);
const snapA = await a.next((m) => m.type === 'snapshot');
const snapB = await b.next((m) => m.type === 'snapshot');
assert.equal(snapA.doc.title, 'RTN Tonight');
assert.equal(snapA.role, 'owner');
assert.equal(snapB.role, 'editor');
await a.next((m) => m.type === 'presence' && m.users.length === 2);
step('two people connect, get the document and see each other');

// Bob renames, Alice adds a cue, at the same time.
const bobDoc = clone(snapB.doc); bobDoc.title = 'RTN Tonight LIVE';
const aliceDoc = clone(snapA.doc); aliceDoc.sections[0].items.push({ id: 'i2', text: 'Ready *cam 3*', done: false });
b.send({ type: 'ops', batch: 1, ops: diff(snapB.doc, bobDoc) });
a.send({ type: 'ops', batch: 1, ops: diff(snapA.doc, aliceDoc) });
const fromBob = await a.next((m) => m.type === 'ops' && m.from === snapB.clientId);
assert.deepEqual(fromBob.ops[0].p, ['title']);
const ackB = await b.next((m) => m.type === 'ops' && m.from === snapB.clientId);
assert.equal(ackB.batch, 1);
await b.next((m) => m.type === 'ops' && m.from === snapA.clientId);
step('edits reach the other person live, sender gets an acknowledgement');

// A fresh connection sees both edits merged.
const check = live(pid, B);
const merged = (await check.next((m) => m.type === 'snapshot')).doc;
assert.equal(merged.title, 'RTN Tonight LIVE');
assert.deepEqual(merged.sections[0].items.map((i) => i.id), ['i1', 'i2']);
check.close();
step('concurrent edits are merged and saved');

// Viewer can watch but not edit.
const c = live(pid, C);
const snapC = await c.next((m) => m.type === 'snapshot');
assert.equal(snapC.role, 'viewer');
c.send({ type: 'ops', batch: 1, ops: [{ t: 'set', p: ['title'], v: 'hacked' }] });
await c.next((m) => m.type === 'error');
assert.equal((await c.next((m) => m.type === 'snapshot' && m.reset)).doc.title, 'RTN Tonight LIVE');
step('viewer edits are refused and their copy is reset');

// Malicious ops are ignored.
a.send({ type: 'ops', batch: 2, ops: [{ t: 'set', p: ['__proto__', 'x'], v: 1 }, { t: 'del', p: ['nope'], id: 'z' }] });
const junk = await a.next((m) => m.type === 'ops' && m.batch === 2);
assert.equal(junk.ops.length, 0);
step('invalid operations are ignored');

// Project list picks up the new title.
await new Promise((r) => setTimeout(r, 300));
assert.equal((await api('GET', '/api/projects', null, B)).projects[0].title, 'RTN Tonight LIVE');
step('project list shows the live title');

// Removing someone disconnects them.
const carolId = mem.members.find((m) => m.role === 'viewer').id;
assert.equal((await api('DELETE', `/api/projects/${pid}/members/${carolId}`, null, A)).status, 200);
await c.next((m) => m.type === 'gone');
await c.closed;
assert.equal((await api('GET', '/api/projects', null, C)).projects.length, 0);
step('removed member is disconnected and loses access');

// Bad tokens can't connect.
const bad = live(pid, 'not-a-token');
const ev = await bad.closed;
assert.notEqual(ev.code, 1000);
step('connection without a valid session is refused');

// Bob leaves; Alice deletes.
assert.equal((await api('DELETE', `/api/projects/${pid}`, null, B)).left, true);
await b.closed;
assert.equal((await api('DELETE', `/api/projects/${pid}`, null, A)).deleted, true);
await a.next((m) => m.type === 'gone');
assert.equal((await api('GET', '/api/projects', null, A)).projects.length, 0);
step('member leaves; owner deletes the project for everyone');

// Brute-force protection.
for (let i = 0; i < 10; i++) await api('POST', '/api/login', { email: `bob.${run}@example.com`, password: 'nope nope' });
assert.equal((await api('POST', '/api/login', { email: `bob.${run}@example.com`, password: 'correct horse' })).status, 429);
step('sign-in locks for 15 minutes after 10 failures');

console.log('server API: all checks passed');
process.exit(0);
