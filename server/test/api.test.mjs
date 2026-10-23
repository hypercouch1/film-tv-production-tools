// End-to-end test against a running server: `npm run dev` in one terminal, then `npm test`.
// Set SERVER=https://... to point it somewhere else.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import '../../src/sync-core.js';
import { codeAt, stepAt } from '../src/totp.js';

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

// Personal availability links: no account needed, the code is the key.
const watcher = live(prodId, A);
await watcher.next((m) => m.type === 'snapshot');
await api('POST', '/api/projects', { kind: 'shotsheet', id: 'x' + prodId, doc: { title: 'Other' } }, A); // not used: proves codes are per production
assert.equal((await api('POST', `/api/projects/${prodId}/availability/links`, { start: '2026-11-01', end: '2026-11-30', people: [{ personId: 'c1', name: 'Ann Lee', role: 'Maya' }] }, C)).status, 200, 'editors can ask');
const linkRes = await api('POST', `/api/projects/${prodId}/availability/links`, { start: '2026-11-01', end: '2026-11-30', people: [{ personId: 'c1', name: 'Ann Lee', role: 'Maya' }, { personId: 'k1', name: 'Gus', role: 'Gaffer' }] }, A);
assert.equal(linkRes.status, 200, linkRes.error);
const annCode = linkRes.links.find((l) => l.personId === 'c1').code;
assert.match(annCode, /^[A-HJ-NP-Z2-9]{10}$/);
assert.equal((await api('GET', '/api/availability/AAAAAAAAAA')).status, 404, 'unknown codes are refused');
const page = await api('GET', `/api/availability/${annCode.toLowerCase()}`);
assert.deepEqual([page.production, page.name, page.role, page.start, page.end, page.off], ['Harbour Lights', 'Ann Lee', 'Maya', '2026-11-01', '2026-11-30', []], 'codes work in any case');
const sent = await api('POST', `/api/availability/${annCode}`, { off: ['2026-11-03', '2026-11-03', '2026-12-25', 'nope'], note: 'Mornings only on the 4th' });
assert.deepEqual(sent.off, ['2026-11-03'], 'only dates in the range are kept');
const live1 = await watcher.next((m) => m.type === 'ops' && m.from === 'server');
assert.deepEqual(live1.ops[0].p.slice(0, 1), ['availability'], 'the answer reaches the production live');
assert.deepEqual((await api('GET', `/api/projects/${prodId}/doc`, null, A)).doc.availability.c1.off, ['2026-11-03']);
assert.equal((await api('GET', `/api/availability/${annCode}`)).note, 'Mornings only on the 4th');
const listed2 = (await api('GET', `/api/projects/${prodId}/availability/links`, null, C)).links;
assert.deepEqual(listed2.map((l) => [l.personId, !!l.respondedAt]), [['c1', true], ['k1', false]]);
assert.equal((await api('GET', `/api/projects/${prodId}/availability/links`, null, B)).status, 404, 'non-members see nothing');
// A new link replaces the old one; revoking stops it.
const again = await api('POST', `/api/projects/${prodId}/availability/links`, { start: '2026-11-01', end: '2026-11-30', people: [{ personId: 'c1', name: 'Ann Lee', role: 'Maya' }] }, A);
assert.equal((await api('GET', `/api/availability/${annCode}`)).status, 404, 'the old code stops working');
await api('DELETE', `/api/projects/${prodId}/availability/links/c1`, null, A);
assert.equal((await api('GET', `/api/availability/${again.links[0].code}`)).status, 404, 'revoked');
const html = await fetch(BASE + `/a/${annCode}`);
assert.match(html.headers.get('content-type'), /text\/html/);
assert.match(html.headers.get('content-security-policy'), /script-src 'nonce-/);
assert.match(await html.text(), /Availability/);
// View-only people mark their own availability: claim a person, then only that row.
const viewer = await api('POST', '/api/signup', { email: `dan.${run}@example.com`, name: 'Dan', password: 'correct horse' });
await api('POST', `/api/projects/${prodId}/members`, { email: `dan.${run}@example.com`, role: 'viewer' }, A);
const D = viewer.token;
// The production needs people for claims to point at.
const owner = live(prodId, A);
const snapO = await owner.next((m) => m.type === 'snapshot');
owner.send({ type: 'ops', batch: 1, ops: [{ t: 'set', p: ['characters'], v: [{ id: 'c1', name: 'Maya', actor: 'Ann' }, { id: 'c2', name: 'Lou', actor: 'Dan' }] }] });
await owner.next((m) => m.type === 'ops' && m.from === snapO.clientId);
assert.equal((await api('POST', `/api/projects/${prodId}/me/availability`, { personId: 'c2', off: ['2026-11-05'] }, D)).status, 403, 'claim first');
assert.equal((await api('POST', `/api/projects/${prodId}/me/claim`, { personId: 'nobody' }, D)).status, 404);
assert.equal((await api('POST', `/api/projects/${prodId}/me/claim`, { personId: 'c2' }, D)).status, 200);
assert.deepEqual((await owner.next((m) => m.type === 'ops' && m.from === 'server')).ops[0].p[0], 'claims', 'claims reach the production live');
assert.equal((await api('POST', `/api/projects/${prodId}/me/claim`, { personId: 'c2' }, C)).status, 409, 'someone else can’t take it');
assert.equal((await api('POST', `/api/projects/${prodId}/me/availability`, { personId: 'c2', off: ['2026-11-05', 'x'], note: 'Back from 6th' }, D)).status, 200);
assert.equal((await api('POST', `/api/projects/${prodId}/me/availability`, { personId: 'c1', off: ['2026-11-05'] }, D)).status, 403, 'only your own row');
const docNow = (await api('GET', `/api/projects/${prodId}/doc`, null, A)).doc;
assert.deepEqual([docNow.availability.c2.off, docNow.availability.c2.source, docNow.claims.c2], [['2026-11-05'], 'member', viewer.user.id]);
assert.equal((await api('POST', `/api/projects/${prodId}/me/claim`, { personId: null }, D)).status, 200);
assert.equal((await api('GET', `/api/projects/${prodId}/doc`, null, A)).doc.claims.c2, undefined, 'letting go');
assert.equal((await api('POST', `/api/projects/${prodId}/me/claim`, { personId: 'c2' }, B)).status, 404, 'non-members can’t');

// Personal crew pages: each person's shoot days, the call sheet once it's sent, "Got it", calendar.
owner.send({ type: 'ops', batch: 2, ops: [
  { t: 'set', p: ['days'], v: [{ id: 'd1', date: '2026-11-03', call: '08:00', crewCall: '07:00', wrap: '18:00', location: 'Pier 9', parking: 'Lot C', calls: {} }] },
  { t: 'set', p: ['scenes'], v: [{ id: 's1', number: '1', heading: 'EXT. PIER - DAY', castIds: ['c1'], crewIds: [], shots: [], dayId: 'd1' }] },
] });
await owner.next((m) => m.type === 'ops' && m.from === snapO.clientId);
assert.equal((await api('POST', `/api/projects/${prodId}/crew/links`, { people: [{ personId: 'c1', name: 'Ann', role: 'Maya' }] }, D)).status, 403, 'view-only people can’t make links');
const crewRes = await api('POST', `/api/projects/${prodId}/crew/links`, { people: [{ personId: 'c1', name: 'Ann', role: 'Maya' }, { personId: 'c2', name: 'Dan', role: 'Lou' }] }, A);
assert.equal(crewRes.status, 200, crewRes.error);
const annCrew = crewRes.links.find((l) => l.personId === 'c1').code;
const danCrew = crewRes.links.find((l) => l.personId === 'c2').code;
let crewPage = await api('GET', `/api/crew/${annCrew.toLowerCase()}`);
assert.deepEqual([crewPage.production, crewPage.name, crewPage.role, crewPage.days.length, crewPage.days[0].call, crewPage.days[0].sentAt],
  ['Harbour Lights', 'Ann', 'Maya', 1, '08:00', null], 'their days and call, from the production');
assert.equal(crewPage.days[0].sheet, undefined, 'no call sheet until it’s sent');
assert.equal((await api('GET', `/api/crew/${danCrew}`)).days.length, 0, 'Lou isn’t in a scene yet');
assert.equal((await api('POST', `/api/crew/${annCrew}/confirm`, { dayId: 'd1' })).status, 400, 'nothing to confirm yet');
assert.equal((await api('POST', `/api/projects/${prodId}/callsheets/d1/send`, null, D)).status, 403, 'view-only people can’t send');
const firstSend = await api('POST', `/api/projects/${prodId}/callsheets/d1/send`, null, C);
assert.equal(firstSend.status, 200, firstSend.error);
crewPage = await api('GET', `/api/crew/${annCrew}`);
assert.deepEqual([crewPage.days[0].sheet.parking, crewPage.days[0].sheet.cast[0].actor], ['Lot C', 'Ann'], 'the call sheet once sent');
const gotIt = await api('POST', `/api/crew/${annCrew}/confirm`, { dayId: 'd1' });
assert.equal(gotIt.status, 200, gotIt.error);
assert.deepEqual((await api('GET', `/api/projects/${prodId}/callsheets/d1`, null, D)).confirms.map((x) => x.personId), ['c1'], 'everyone in the production sees who has it');
await new Promise((r) => setTimeout(r, 5));
await api('POST', `/api/projects/${prodId}/callsheets/d1/send`, null, A);
assert.deepEqual((await api('GET', `/api/projects/${prodId}/callsheets/d1`, null, A)).confirms, [], 'sent again after changes: confirm again');
assert.equal((await api('GET', `/api/crew/${annCrew}`)).days[0].confirmedAt, null);
const ics = await fetch(BASE + `/c/${annCrew}/calendar.ics`);
assert.match(ics.headers.get('content-type'), /text\/calendar/);
assert.match(await ics.text(), /DTSTART:20261103T080000\r\nDTEND:20261103T180000/);
const crewHtml = await fetch(BASE + `/c/${annCrew}`);
assert.match(crewHtml.headers.get('content-security-policy'), /script-src 'nonce-/);
assert.match(await crewHtml.text(), /Call sheet/);
assert.deepEqual((await api('GET', `/api/projects/${prodId}/crew/links`, null, D)).links.map((l) => [l.personId, !!l.openedAt]), [['c1', true], ['c2', true]]);
assert.equal((await api('GET', `/api/projects/${prodId}/crew/links`, null, B)).status, 404, 'non-members see nothing');
await api('DELETE', `/api/projects/${prodId}/crew/links/c2`, null, A);
assert.equal((await api('GET', `/api/crew/${danCrew}`)).status, 404, 'revoked');
step('crew pages: days and calls, call sheet once sent, "Got it" per version, calendar feed, revoke');

// Recent activity: who changed what (the test server writes it after ACTIVITY_FLUSH_MS).
await new Promise((r) => setTimeout(r, 2500));
const activity = (await api('GET', `/api/projects/${prodId}/activity`, null, D)).activity;
assert.ok(activity.some((a) => a.userName === 'Alice' && a.items.includes('Cast') && a.items.includes('Scenes') && a.items.includes('Shoot days')), JSON.stringify(activity));
assert.ok(activity.some((a) => /availability link/.test(a.userName) && a.items.includes('Availability')), 'answers through links count');
assert.equal((await api('GET', `/api/projects/${prodId}/activity`, null, B)).status, 404, 'non-members see nothing');
step('recent activity: edits described and combined per person, answers through links');

// Continuity photos: editors add and delete, anyone in the production sees them.
const onset = await api('POST', '/api/projects', { kind: 'onset', parent: prodId, doc: { title: 'On set' } }, A);
assert.equal(onset.status, 200, onset.error);
assert.equal((await api('POST', '/api/projects', { kind: 'gear', doc: { title: 'Gear' } }, A)).status, 400, 'equipment lists live in a production');
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 0xff, 0xd9]);
const upload = (bytes, token) => fetch(`${BASE}/api/projects/${onset.project.id}/photos`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', Authorization: 'Bearer ' + token }, body: bytes });
assert.equal((await upload(jpeg, D)).status, 403, 'view-only people can’t add photos');
assert.equal((await upload(new Uint8Array([1, 2, 3, 4]), A)).status, 400, 'JPEG only');
const photo = await (await upload(jpeg, C)).json();
assert.ok(photo.id);
const keepId = 'board' + run;
const kept = await (await fetch(`${BASE}/api/projects/${prodId}/photos?id=${keepId}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', Authorization: 'Bearer ' + A }, body: jpeg })).json();
assert.equal(kept.id, keepId, 'a shared production keeps its pictures’ ids');
assert.equal((await fetch(`${BASE}/api/projects/${prodId}/photos?id=${keepId}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', Authorization: 'Bearer ' + A }, body: jpeg })).status, 409, 'ids are unique');
assert.equal((await fetch(`${BASE}/api/projects/${onset.project.id}/photos/${keepId}`, { headers: { Authorization: 'Bearer ' + D } })).status, 200, 'any document in the production reaches them');
const got = await fetch(`${BASE}/api/projects/${onset.project.id}/photos/${photo.id}`, { headers: { Authorization: 'Bearer ' + D } });
assert.equal(got.headers.get('content-type'), 'image/jpeg');
assert.deepEqual([...new Uint8Array(await got.arrayBuffer())], [...jpeg], 'view-only people see them');
assert.equal((await fetch(`${BASE}/api/projects/${onset.project.id}/photos/${photo.id}`, { headers: { Authorization: 'Bearer ' + B } })).status, 404, 'non-members don’t');
assert.equal((await api('DELETE', `/api/projects/${onset.project.id}/photos/${photo.id}`, null, C)).status, 200);
assert.equal((await fetch(`${BASE}/api/projects/${onset.project.id}/photos/${photo.id}`, { headers: { Authorization: 'Bearer ' + A } })).status, 404);
step('continuity photos: JPEG only, editors add and delete, members see them');
owner.close();
assert.equal((await api('POST', '/api/projects', { kind: 'post', doc: { title: 'Post' } }, A)).status, 400, 'post documents only live inside a production');
assert.equal((await api('POST', '/api/projects', { kind: 'post', parent: prodId, doc: { title: 'Post' } }, A)).status, 200);
step('view-only people claim themselves and mark their own availability; post documents live in a production');

watcher.close();
await api('DELETE', `/api/projects/x${prodId}`, null, A);
step('availability links: answer without an account, reaches the production live, replace and revoke');

// A production's budget is for its owner and editors only.
const budget = await api('POST', '/api/projects', { kind: 'budget', parent: prodId, doc: { title: 'Budget', lines: [] } }, A);
assert.equal(budget.status, 200, budget.error);
assert.equal((await api('POST', '/api/projects', { kind: 'budget', doc: { title: 'x' } }, A)).status, 400, 'budgets only live in a production');
assert.equal((await api('GET', `/api/projects?parent=${prodId}&kind=budget`, null, D)).projects.length, 0, 'view-only members don’t see it listed');
assert.equal((await api('GET', `/api/projects/${budget.project.id}/doc`, null, D)).status, 404, 'or readable');
assert.notEqual((await live(budget.project.id, D).closed).code, 1000, 'or openable');
const carolBudget = live(budget.project.id, C);
assert.equal((await carolBudget.next((m) => m.type === 'snapshot')).role, 'editor', 'editors can');
const carolId2 = (await api('GET', `/api/projects/${prodId}/members`, null, A)).members.find((x) => x.name === 'Carol').id;
await api('PATCH', `/api/projects/${prodId}/members/${carolId2}`, { role: 'viewer' }, A);
await carolBudget.next((m) => m.type === 'gone');
assert.equal((await api('GET', `/api/projects/${budget.project.id}/doc`, null, C)).status, 404, 'made view-only: the budget goes away');
await api('PATCH', `/api/projects/${prodId}/members/${carolId2}`, { role: 'editor' }, A);
step('budgets: owner and editors only, even when someone is made view-only while it’s open');

// Editors can delete a document inside; deleting the production deletes everything.
assert.equal((await api('DELETE', `/api/projects/${sheet.project.id}`, null, C)).deleted, true);
assert.equal((await api('DELETE', `/api/projects/${prodId}`, null, A)).deleted, true);
await carolScript.next((m) => m.type === 'gone');
assert.equal((await api('GET', `/api/projects/${childId}/doc`, null, A)).status, 404);
step('deleting a production deletes everything in it');

// ---- Admin (the test server runs with ADMIN_EMAILS=admin@example.test) ----
let admin = await api('POST', '/api/login', { email: 'admin@example.test', password: 'correct horse admin' });
if (admin.status !== 200) admin = await api('POST', '/api/signup', { email: 'admin@example.test', name: 'Admin', password: 'correct horse admin' });
assert.equal(admin.status, 200, admin.error);
const ADM = admin.token;
assert.equal((await api('GET', '/api/admin/stats', null, C)).status, 403, 'only the admin');
assert.equal((await api('GET', '/api/admin/users', null)).status, 401);

// Two-step sign-in: the admin's authenticator app (set up on first use; the test keeps the
// key in test/.admin-totp so later runs against the same database can sign in).
const twoStepNow = await api('GET', '/api/admin/2fa', null, ADM);
assert.equal(twoStepNow.verified, false);
const refused = await api('GET', '/api/admin/stats', null, ADM);
assert.deepEqual([refused.status, refused.twoStep], [403, true], 'the password alone isn’t enough');
const SECRET_FILE = new URL('./.admin-totp', import.meta.url);
let secret;
const nowStep = stepAt(Date.now());
if (!twoStepNow.enabled) {
  assert.equal((await api('POST', '/api/admin/2fa/verify', { code: '123456' }, ADM)).status, 401, 'set it up first');
  const setup = await api('POST', '/api/admin/2fa/setup', null, ADM);
  assert.match(setup.uri, /^otpauth:\/\/totp\/.+secret=/);
  assert.equal((await api('POST', '/api/admin/2fa/enable', { code: '000000' }, ADM)).status, 401, 'wrong code');
  const on = await api('POST', '/api/admin/2fa/enable', { code: await codeAt(setup.secret, nowStep) }, ADM);
  assert.equal(on.status, 200, on.error);
  secret = setup.secret;
  writeFileSync(SECRET_FILE, secret);
  assert.equal((await api('POST', '/api/admin/2fa/setup', null, ADM)).status, 409, 'can’t be set up again with just the password');
} else {
  if (!existsSync(SECRET_FILE)) throw new Error('The test admin already has two-step sign-in but test/.admin-totp is missing. Reset it with: npx wrangler d1 execute production-hub --local --command "UPDATE users SET totp_secret = NULL WHERE email = \'admin@example.test\'"');
  secret = readFileSync(SECRET_FILE, 'utf8').trim();
  const ok = await api('POST', '/api/admin/2fa/verify', { code: await codeAt(secret, nowStep) }, ADM);
  assert.equal(ok.status, 200, ok.error);
}
// Another device: needs its own code, and each code works once.
const admin2 = await api('POST', '/api/login', { email: 'admin@example.test', password: 'correct horse admin' });
assert.equal((await api('GET', '/api/admin/users', null, admin2.token)).status, 403);
const nextCode = await codeAt(secret, nowStep + 1);
assert.equal((await api('POST', '/api/admin/2fa/verify', { code: nextCode }, admin2.token)).status, 200);
assert.equal((await api('GET', '/api/admin/users', null, admin2.token)).status, 200);
const admin3 = await api('POST', '/api/login', { email: 'admin@example.test', password: 'correct horse admin' });
assert.equal((await api('POST', '/api/admin/2fa/verify', { code: nextCode }, admin3.token)).status, 401, 'a code can’t be used twice');
assert.equal((await api('POST', '/api/admin/2fa/setup', null, C)).status, 403, 'not for anyone else');
step('admin: two-step sign-in with an authenticator app, set up once, a code works once');
await fetch(BASE + '/api/me', { headers: { Authorization: 'Bearer ' + C, 'X-App-Version': '1.4.0' } });
const stats = await api('GET', '/api/admin/stats', null, ADM);
assert.ok(stats.users.total >= 4 && stats.users.active1 >= 1, 'counts accounts and who was active');
assert.ok(stats.versions.some((v) => v.version === '1.4.0'), 'app versions in use');
assert.equal(stats.signupsByWeek.length, 12);
const found = (await api('GET', `/api/admin/users?q=${encodeURIComponent('carol.' + run)}`, null, ADM)).users;
assert.deepEqual(found.map((x) => [x.name, x.appVersion]), [['Carol', '1.4.0']]);
step('admin: stats (accounts, activity, versions) and account search, for the admin only');

// One-time code for a forgotten password.
const carolUser = found[0];
const codeRes = await api('POST', `/api/admin/users/${carolUser.id}/reset-code`, null, ADM);
assert.match(codeRes.code, /^[A-HJ-NP-Z2-9]{10}$/);
assert.equal((await api('POST', `/api/admin/users/${carolUser.id}/reset-code`, null, C)).status, 403);
assert.equal((await api('POST', '/api/reset', { email: `carol.${run}@example.com`, code: 'WRONGCODE1', password: 'new password 1' })).status, 401);
assert.equal((await api('POST', '/api/reset', { email: `bob.${run}@example.com`, code: codeRes.code, password: 'new password 1' })).status, 401, 'a code is for one account');
const reset = await api('POST', '/api/reset', { email: `carol.${run}@example.com`, code: codeRes.code.slice(0, 5) + '-' + codeRes.code.slice(5).toLowerCase(), password: 'new password 1' });
assert.equal(reset.status, 200, reset.error);
assert.equal((await api('GET', '/api/me', null, C)).status, 401, 'old sessions end');
assert.equal((await api('POST', '/api/login', { email: `carol.${run}@example.com`, password: 'new password 1' })).status, 200, 'new password works');
assert.equal((await api('POST', '/api/reset', { email: `carol.${run}@example.com`, code: codeRes.code, password: 'another one 2' })).status, 401, 'a code works once');
step('one-time codes reset a forgotten password once, for one account');

// Switching an account off, editing, deleting.
const C2 = reset.token;
assert.equal((await api('POST', `/api/admin/users/${carolUser.id}/disable`, { disabled: true }, ADM)).status, 200);
assert.equal((await api('GET', '/api/me', null, C2)).status, 401, 'switched off: signed out');
assert.equal((await api('POST', '/api/login', { email: `carol.${run}@example.com`, password: 'new password 1' })).status, 403);
await api('POST', `/api/admin/users/${carolUser.id}/disable`, { disabled: false }, ADM);
assert.equal((await api('POST', '/api/login', { email: `carol.${run}@example.com`, password: 'new password 1' })).status, 200, 'switched on again');
assert.equal((await api('PATCH', `/api/admin/users/${carolUser.id}`, { name: 'Carol B' }, ADM)).status, 200);
assert.equal((await api('POST', `/api/admin/users/${admin.user.id}/disable`, { disabled: true }, ADM)).status, 400, 'not your own');
const aliceId = (await api('GET', `/api/admin/users?q=${encodeURIComponent('alice.' + run)}`, null, ADM)).users[0].id;
const keep = await api('POST', '/api/projects', { kind: 'callsheet', doc: { title: 'Mine' } }, A);
assert.equal((await api('DELETE', `/api/admin/users/${aliceId}`, null, ADM)).status, 409, 'owners of shared projects can’t be deleted');
await api('DELETE', `/api/projects/${keep.project.id}`, null, A);
assert.equal((await api('DELETE', `/api/admin/users/${viewer.user.id}`, null, ADM)).status, 200);
assert.equal((await api('POST', '/api/login', { email: `dan.${run}@example.com`, password: 'correct horse' })).status, 401, 'deleted');
step('admin: switch accounts off and on, edit, delete (not owners of shared projects)');

const C3 = (await api('POST', '/api/login', { email: `carol.${run}@example.com`, password: 'new password 1' })).token;
const log = (await api('GET', '/api/admin/log', null, ADM)).log;
for (const what of ['Made a one-time password code', 'Switched an account off', 'Edited an account', 'Deleted an account']) {
  assert.ok(log.some((x) => x.action === what && x.admin === 'admin@example.test'), what + ' is logged');
}
assert.ok(log.some((x) => x.action === 'Edited an account' && /Carol B/.test(x.detail)), 'with what changed');
assert.equal((await api('GET', '/api/admin/log', null, C3)).status, 403);
step('admin log: what admins did, and to whom');

// Backups: deleted documents keep their final copy and can be brought back, with their people.
let backups = (await api('GET', '/api/admin/backups', null, ADM)).backups;
const prodCopy = backups.find((b) => b.projectId === prodId);
assert.ok(prodCopy && prodCopy.deleted, 'the deleted production has a final copy');
assert.ok(backups.some((b) => b.projectId === childId), 'and so does what was inside');
assert.equal((await api('POST', `/api/admin/backups/${backups.find((b) => b.projectId === childId).id}/restore`, null, ADM)).status, 409, 'a document inside needs its production back first');
const back = await api('POST', `/api/admin/backups/${prodCopy.id}/restore`, null, ADM);
assert.deepEqual([back.status, back.restored], [200, 'recreated'], back.error);
const restoredDoc = (await api('GET', `/api/projects/${prodId}/doc`, null, A)).doc;
assert.deepEqual([restoredDoc.title, restoredDoc.days[0].id], ['Harbour Lights', 'd1'], 'the production is back as it was');
assert.equal((await api('GET', `/api/projects/${prodId}/doc`, null, C3)).status, 200, 'with its people');
const childBack = await api('POST', `/api/admin/backups/${backups.find((b) => b.projectId === childId).id}/restore`, null, ADM);
assert.equal(childBack.status, 200, childBack.error);
assert.equal((await api('GET', `/api/projects/${childId}/doc`, null, A)).doc.title, 'Ep 1');
// Restoring over a document in use puts it back for everyone connected, keeping a copy first.
const now1 = await api('POST', '/api/admin/backups/now', null, ADM);
assert.ok(now1.count >= 2, 'back up everything now');
const watching = live(prodId, A);
const snapW = await watching.next((m) => m.type === 'snapshot');
watching.send({ type: 'ops', batch: 1, ops: [{ t: 'set', p: ['title'], v: 'Renamed by mistake' }] });
await watching.next((m) => m.type === 'ops' && m.from === snapW.clientId);
backups = (await api('GET', '/api/admin/backups', null, ADM)).backups;
const before = backups.filter((b) => b.projectId === prodId)[0];
assert.equal((await api('POST', `/api/admin/backups/${before.id}/restore`, null, ADM)).restored, 'replaced');
assert.equal((await watching.next((m) => m.type === 'snapshot' && m.reset)).doc.title, 'Harbour Lights', 'open copies get the restored one');
watching.close();
const dl = await fetch(`${BASE}/api/admin/backups/${before.id}`, { headers: { Authorization: 'Bearer ' + ADM } });
assert.equal(JSON.parse(await dl.text()).title, 'Harbour Lights');
const everything = await (await fetch(`${BASE}/api/admin/export`, { headers: { Authorization: 'Bearer ' + ADM } })).json();
assert.equal(everything.docs[prodId].title, 'Harbour Lights');
assert.ok(everything.accounts.every((x) => !('pw' in x) && !('totp_secret' in x)), 'no passwords or keys in the download');
assert.equal((await api('GET', '/api/admin/backups', null, C3)).status, 403);
assert.ok((await api('GET', '/api/admin/log', null, ADM)).log.some((x) => x.action === 'Restored a backup'));
await api('DELETE', `/api/projects/${prodId}`, null, A);
step('backups: daily copies, deleted documents brought back with their people, restore for open copies, download');

// Brute-force protection.
for (let i = 0; i < 10; i++) await api('POST', '/api/login', { email: `bob.${run}@example.com`, password: 'nope nope' });
assert.equal((await api('POST', '/api/login', { email: `bob.${run}@example.com`, password: 'correct horse' })).status, 429);
step('sign-in locks for 15 minutes after 10 failures');

console.log('server API: all checks passed');
process.exit(0);
