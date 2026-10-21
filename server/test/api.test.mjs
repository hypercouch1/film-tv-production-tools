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
// The token travels as a WebSocket subprotocol, like the app sends it; legacy: true uses
// the ?token= URL form that apps older than 1.2.2 use.
function live(projectId, token, { legacy = false } = {}) {
  const base = `${BASE.replace(/^http/, 'ws')}/api/projects/${projectId}/live`;
  const ws = legacy
    ? new WebSocket(`${base}?token=${encodeURIComponent(token)}`)
    : new WebSocket(base, ['production-tools', 'auth.' + token]);
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
const health = await api('GET', '/api/health');
assert.equal(health.ok, true);
assert.match(health.minClientVersion, /^\d+\.\d+\.\d+$/, 'health reports the oldest supported app version');
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

const script = await api('POST', '/api/projects', { kind: 'script', doc: { title: 'Draft', elements: [{ id: 'e1', type: 'heading', text: 'INT. ROOM - DAY' }] } }, A);
assert.equal(script.status, 200, script.error);
assert.equal((await api('GET', '/api/projects?kind=script', null, A)).projects[0].title, 'Draft');
assert.equal((await api('POST', '/api/projects', { kind: 'spreadsheet', doc: {} }, A)).status, 400);
assert.equal((await api('DELETE', `/api/projects/${script.project.id}`, null, A)).deleted, true);
step('Script Writer scripts can be shared; unknown project types are refused');

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

// Older apps (token in the URL) still connect.
const old = live(pid, A, { legacy: true });
assert.equal((await old.next((m) => m.type === 'snapshot')).role, 'owner');
old.close();
step('older apps that send the token in the URL still connect');

// Changing the password disconnects other devices' live connections, not this one.
const second = await api('POST', '/api/login', { email: `alice.${run}@example.com`, password: 'correct horse' });
const otherDevice = live(pid, second.token);
await otherDevice.next((m) => m.type === 'snapshot');
const changed = await api('PATCH', '/api/me', { currentPassword: 'correct horse', newPassword: 'correct horse 2' }, A);
assert.equal(changed.status, 200, changed.error);
assert.equal(changed.user.sessionHash, undefined, 'session details are not returned');
assert.match((await otherDevice.next((m) => m.type === 'gone')).message, /signed out/i);
await otherDevice.closed;
a.send({ type: 'ops', batch: 9, ops: [] });
await a.next((m) => m.type === 'ops' && m.batch === 9); // this device is still live
assert.equal((await api('GET', '/api/me', null, second.token)).status, 401);
step('password change signs out other devices, including their live connections');

// Signing out closes that session's live connection.
const third = await api('POST', '/api/login', { email: `alice.${run}@example.com`, password: 'correct horse 2' });
const laptop = live(pid, third.token);
await laptop.next((m) => m.type === 'snapshot');
await api('POST', '/api/logout', null, third.token);
await laptop.next((m) => m.type === 'gone');
await laptop.closed;
step('signing out disconnects that session live');

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

// ---- Productions: membership covers the scripts and call sheets inside ----
const prodId = 'prod' + run;
const prod = await api('POST', '/api/projects', { kind: 'shotsheet', id: prodId, doc: { title: 'Harbour Lights', type: 'tv', episodes: [{ id: 'e1', number: '1' }], scenes: [] } }, A);
assert.equal(prod.status, 200, prod.error);
assert.equal(prod.project.id, prodId, 'keeps the id the app chose');
assert.equal((await api('POST', '/api/projects', { kind: 'shotsheet', id: prodId, doc: { title: 'x' } }, A)).status, 409, 'an id already online is refused');
assert.equal((await api('POST', '/api/projects', { kind: 'shotsheet', id: 'bad id!', doc: { title: 'x' } }, A)).status, 400);
const listed = (await api('GET', '/api/projects?kind=shotsheet', null, A)).projects.find((p) => p.id === prodId);
assert.equal(listed.type, 'tv', 'lists show the production type');
const childId = 'scr' + run;
const child = await api('POST', '/api/projects', { kind: 'script', id: childId, parent: prodId, doc: { title: 'Ep 1', episodeId: 'e1', elements: [{ id: 'h', type: 'heading', text: 'INT. BOAT - NIGHT' }] } }, A);
assert.equal(child.status, 200, child.error);
assert.equal(child.project.parentId, prodId);
assert.equal((await api('POST', '/api/projects', { kind: 'shotsheet', parent: prodId, doc: { title: 'x' } }, A)).status, 400, 'no productions inside productions');
assert.equal((await api('GET', '/api/projects?kind=script', null, A)).projects.some((p) => p.id === childId), false, 'documents inside a production are not listed on their own');
step('a production keeps its id; scripts go inside it');

// Not a member: nothing inside is reachable.
assert.equal((await api('GET', `/api/projects?parent=${prodId}`, null, B)).status, 404);
assert.equal((await api('GET', `/api/projects/${childId}/doc`, null, B)).status, 404);
assert.equal((await api('POST', '/api/projects', { kind: 'callsheet', parent: prodId, doc: { title: 'x' } }, B)).status, 404);
const outsider = live(childId, B);
assert.notEqual((await outsider.closed).code, 1000);
step('people outside the production can’t list, read, add to or open what’s inside');

// Invite Bob to the production (editor) and Carol (viewer): both reach the script.
await api('POST', `/api/projects/${prodId}/members`, { email: `bob.${run}@example.com`, role: 'editor' }, A);
await api('POST', `/api/projects/${prodId}/members`, { email: `carol.${run}@example.com`, role: 'viewer' }, A);
const kids = (await api('GET', `/api/projects?parent=${prodId}`, null, B)).projects;
assert.deepEqual(kids.map((k) => [k.id, k.kind, k.episodeId, k.role]), [[childId, 'script', 'e1', 'editor']]);
assert.equal((await api('GET', `/api/projects/${childId}/doc`, null, C)).doc.title, 'Ep 1');
const bobScript = live(childId, B);
assert.equal((await bobScript.next((m) => m.type === 'snapshot')).role, 'editor');
const carolScript = live(childId, C);
assert.equal((await carolScript.next((m) => m.type === 'snapshot')).role, 'viewer');
assert.equal((await api('POST', '/api/projects', { kind: 'callsheet', parent: prodId, doc: { title: 'Day 1 cues' } }, C)).status, 403, 'viewers can’t add');
const sheet = await api('POST', '/api/projects', { kind: 'callsheet', parent: prodId, doc: { title: 'Day 1 cues' } }, B);
assert.equal(sheet.status, 200, sheet.error);
assert.equal(sheet.project.ownerName, 'Alice', 'the production owner owns what’s inside');
assert.deepEqual((await api('GET', `/api/projects/${childId}/members`, null, B)).members.map((x) => x.role), ['owner', 'editor', 'viewer'], 'people are the production’s');
step('production members reach everything inside, with their production role');

// Changing someone's role or removing them reaches every open document in the production.
const carolMember = (await api('GET', `/api/projects/${prodId}/members`, null, A)).members.find((x) => x.role === 'viewer');
await api('PATCH', `/api/projects/${prodId}/members/${carolMember.id}`, { role: 'editor' }, A);
assert.equal((await carolScript.next((m) => m.type === 'role')).role, 'editor');
const bobMember = (await api('GET', `/api/projects/${prodId}/members`, null, A)).members.find((x) => x.name === 'Bob');
await api('DELETE', `/api/projects/${prodId}/members/${bobMember.id}`, null, A);
await bobScript.next((m) => m.type === 'gone');
await bobScript.closed;
assert.equal((await api('GET', `/api/projects/${childId}/doc`, null, B)).status, 404);
step('role changes and removals reach the documents inside');

// A script shared on its own (from before productions) can be moved into the production.
const loose = await api('POST', '/api/projects', { kind: 'script', doc: { title: 'Old draft', elements: [] } }, A);
assert.equal((await api('PATCH', `/api/projects/${loose.project.id}`, { parent: prodId }, C)).status, 404, 'only its owner can move it');
assert.equal((await api('PATCH', `/api/projects/${loose.project.id}`, { parent: loose.project.id }, A)).status, 400, 'only into a production');
assert.equal((await api('PATCH', `/api/projects/${loose.project.id}`, { parent: 'nope' + run }, A)).status, 404, 'only into a production you can edit');
assert.equal((await api('PATCH', `/api/projects/${loose.project.id}`, { parent: prodId }, A)).project.parentId, prodId);
assert.equal((await api('GET', `/api/projects/${loose.project.id}/doc`, null, C)).doc.title, 'Old draft', 'production members can now open it');
assert.equal((await api('GET', `/api/projects?parent=${prodId}&kind=script`, null, A)).projects.length, 2);
step('a script shared on its own moves into a production');

// Editors can delete a document inside; deleting the production deletes everything.
assert.equal((await api('DELETE', `/api/projects/${sheet.project.id}`, null, C)).deleted, true);
assert.equal((await api('DELETE', `/api/projects/${prodId}`, null, A)).deleted, true);
await carolScript.next((m) => m.type === 'gone');
assert.equal((await api('GET', `/api/projects/${childId}/doc`, null, A)).status, 404);
step('deleting a production deletes everything in it');

// Brute-force protection.
for (let i = 0; i < 10; i++) await api('POST', '/api/login', { email: `bob.${run}@example.com`, password: 'nope nope' });
assert.equal((await api('POST', '/api/login', { email: `bob.${run}@example.com`, password: 'correct horse' })).status, 429);
step('sign-in locks for 15 minutes after 10 failures');

console.log('server API: all checks passed');
process.exit(0);
