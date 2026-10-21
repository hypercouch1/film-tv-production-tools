// Production Tools server: accounts, shared projects and live sync.
//   Worker         – REST API for accounts, projects and members (D1 database)
//   ProjectRoom DO – one per shared project: holds the document and relays edits
//                    to everyone connected over WebSockets.
import { DurableObject } from 'cloudflare:workers';
import '../../src/sync-core.js';

const { applyAll, clone } = globalThis.SyncCore;

const KINDS = ['callsheet', 'shotsheet', 'script'];
const ROLES = ['editor', 'viewer'];
const SESSION_DAYS = 30;
const MAX_DOC_BYTES = 1_500_000;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ---------- Crypto helpers ----------
const enc = new TextEncoder();
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (bytes) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const newId = () => randomToken(12);

async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

async function hashPassword(password, env) {
  const iterations = Math.min(100000, parseInt(env.PBKDF2_ITERATIONS, 10) || 100000);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${iterations}$${b64(salt)}$${b64(await pbkdf2(password, salt, iterations))}`;
}

async function verifyPassword(password, stored) {
  const [scheme, iter, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2') return false;
  const actual = new Uint8Array(await pbkdf2(password, unb64(salt), parseInt(iter, 10)));
  const expected = unb64(hash);
  return actual.length === expected.length && crypto.subtle.timingSafeEqual(actual, expected);
}

// ---------- Request helpers ----------
async function readJson(req, limit = MAX_DOC_BYTES + 10_000) {
  const text = await req.text();
  if (text.length > limit) throw new HttpError(413, 'Request is too large.');
  try { return JSON.parse(text || '{}'); } catch { throw new HttpError(400, 'Invalid JSON.'); }
}

const cleanEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;
const cleanName = (n) => String(n || '').trim().slice(0, 60);
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name });

async function createSession(env, userId) {
  const token = randomToken();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), userId, Date.now() + SESSION_DAYS * 86400000).run();
  return token;
}

// Live connections can't set an Authorization header, so the app sends the token as a
// WebSocket subprotocol ("auth.<token>"), which isn't logged like a URL is. The ?token=
// form is still accepted for apps older than 1.2.2.
const WS_PROTOCOL = 'production-tools';
function tokenFrom(req, url) {
  const header = req.headers.get('Authorization') || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  const proto = (req.headers.get('Sec-WebSocket-Protocol') || '').split(',').map((s) => s.trim()).find((s) => s.startsWith('auth.'));
  if (proto) return proto.slice(5);
  return url.searchParams.get('token');
}

async function authUser(req, env, url) {
  const token = tokenFrom(req, url);
  if (!token) throw new HttpError(401, 'Please sign in.');
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  const row = await env.DB.prepare(
    'SELECT u.id, u.email, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?'
  ).bind(tokenHash, now).first();
  if (!row) throw new HttpError(401, 'Your session has expired. Please sign in again.');
  // Sessions last SESSION_DAYS from last use, not from sign-in: renewed at most once a day.
  if (row.expires_at - now < (SESSION_DAYS - 1) * 86400000) {
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
      .bind(now + SESSION_DAYS * 86400000, tokenHash).run();
  }
  const { expires_at: _expires, ...u } = row;
  return { ...u, sessionHash: tokenHash };
}

// Disconnects a user's live connections in every project they belong to (and everything
// inside those productions). keep: session to leave connected; only: the one session to disconnect.
async function revokeLive(env, userId, { keep, only } = {}) {
  const { results } = await env.DB.prepare(
    'SELECT p.id FROM members m JOIN projects p ON p.id = m.project_id OR p.parent_id = m.project_id WHERE m.user_id = ?'
  ).bind(userId).all();
  await Promise.all(results.map((r) => roomCall(env, r.id, '/revoke', { userId, keep, only })));
}

// Stand-in hash so a sign-in for an unknown email takes as long as a wrong password,
// and timing doesn't reveal which emails have accounts.
let dummyHash = null;

// People are members of a production (or of a document shared on its own); a script or call
// sheet inside a production is reached through the production's membership.
async function rootOf(env, projectId) {
  const row = await env.DB.prepare('SELECT id, parent_id FROM projects WHERE id = ?').bind(projectId).first();
  return row ? row.parent_id || row.id : null;
}

async function roleOf(env, projectId, userId) {
  const row = await env.DB.prepare(
    'SELECT m.role FROM projects p JOIN members m ON m.project_id = COALESCE(p.parent_id, p.id) AND m.user_id = ? WHERE p.id = ?'
  ).bind(userId, projectId).first();
  return row ? row.role : null;
}

async function requireRole(env, projectId, userId, allowed) {
  const role = await roleOf(env, projectId, userId);
  if (!role) throw new HttpError(404, 'Project not found.');
  if (allowed && !allowed.includes(role)) throw new HttpError(403, allowed.includes('editor') ? "You don't have permission to change this." : 'Only the project owner can do that.');
  return role;
}

const room = (env, projectId) => env.ROOMS.get(env.ROOMS.idFromName(projectId));
const roomCall = (env, projectId, path, body) =>
  room(env, projectId).fetch('https://room' + path, { method: 'POST', body: JSON.stringify(body || {}) });
// A production and everything in it: role changes and removals reach every open document.
async function roomsOf(env, rootId) {
  const { results } = await env.DB.prepare('SELECT id FROM projects WHERE id = ? OR parent_id = ?').bind(rootId, rootId).all();
  return results.map((r) => r.id);
}
const roomCallAll = async (env, rootId, path, body) =>
  Promise.all((await roomsOf(env, rootId)).map((id) => roomCall(env, id, path, body)));

// Small facts about a document for lists: a production's type, a script's episode.
function infoOf(doc) {
  const info = {};
  if (doc && (doc.type === 'tv' || doc.type === 'film')) info.type = doc.type;
  if (doc && typeof doc.episodeId === 'string') info.episodeId = doc.episodeId.slice(0, 64);
  return JSON.stringify(info);
}
const withInfo = (row) => {
  let info = {};
  try { info = JSON.parse(row.info || '{}') || {}; } catch { /* old rows */ }
  const { info: _raw, ...rest } = row;
  return { ...rest, ...info };
};
// Ids the app chooses for documents it moves online (so links between them survive).
const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(id);

async function listMembers(env, projectId) {
  const { results } = await env.DB.prepare(
    'SELECT u.id, u.email, u.name, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.project_id = ? ' +
    "ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, u.name"
  ).bind(projectId).all();
  return results;
}

// ---------- Routes ----------
async function route(req, env, url) {
  const { pathname } = url;
  const method = req.method;
  let m;

  // minClientVersion: apps older than this show an "update required" notice (set in wrangler.toml).
  if (pathname === '/' || pathname === '/api/health') {
    return json({ ok: true, service: 'production-hub', minClientVersion: env.MIN_CLIENT_VERSION || '1.0.0' });
  }

  // Accounts
  if (pathname === '/api/signup' && method === 'POST') {
    const body = await readJson(req);
    const email = cleanEmail(body.email);
    const name = cleanName(body.name);
    const password = String(body.password || '');
    if (!validEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
    if (!name) throw new HttpError(400, 'Enter your name.');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
    if (password.length > 200) throw new HttpError(400, 'Password is too long.');
    if (await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) {
      throw new HttpError(409, 'An account with that email already exists. Sign in instead.');
    }
    const user = { id: newId(), email, name };
    await env.DB.prepare('INSERT INTO users (id, email, name, pw, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(user.id, email, name, await hashPassword(password, env), Date.now()).run();
    return json({ token: await createSession(env, user.id), user });
  }

  if (pathname === '/api/login' && method === 'POST') {
    const body = await readJson(req);
    const email = cleanEmail(body.email);
    const now = Date.now();
    const fail = await env.DB.prepare('SELECT count, window_start FROM auth_failures WHERE email = ?').bind(email).first();
    if (fail && fail.count >= MAX_FAILURES && now - fail.window_start < FAILURE_WINDOW_MS) {
      throw new HttpError(429, 'Too many failed sign-in attempts. Try again in 15 minutes.');
    }
    const user = await env.DB.prepare('SELECT id, email, name, pw FROM users WHERE email = ?').bind(email).first();
    if (!user) {
      dummyHash = dummyHash || (await hashPassword('not-a-real-password', env));
      await verifyPassword(String(body.password || ''), dummyHash);
    }
    if (!user || !(await verifyPassword(String(body.password || ''), user.pw))) {
      if (!fail || now - fail.window_start >= FAILURE_WINDOW_MS) {
        await env.DB.prepare('INSERT OR REPLACE INTO auth_failures (email, count, window_start) VALUES (?, 1, ?)').bind(email, now).run();
      } else {
        await env.DB.prepare('UPDATE auth_failures SET count = count + 1 WHERE email = ?').bind(email).run();
      }
      throw new HttpError(401, 'Wrong email or password.');
    }
    if (fail) await env.DB.prepare('DELETE FROM auth_failures WHERE email = ?').bind(email).run();
    return json({ token: await createSession(env, user.id), user: publicUser(user) });
  }

  if (pathname === '/api/logout' && method === 'POST') {
    const header = req.headers.get('Authorization') || '';
    if (header.startsWith('Bearer ')) {
      const hash = await sha256Hex(header.slice(7));
      const session = await env.DB.prepare('SELECT user_id FROM sessions WHERE token_hash = ?').bind(hash).first();
      await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run();
      if (session) await revokeLive(env, session.user_id, { only: hash });
    }
    return json({ ok: true });
  }

  const user = await authUser(req, env, url);

  if (pathname === '/api/me' && method === 'GET') return json({ user: publicUser(user) });

  if (pathname === '/api/me' && method === 'PATCH') {
    const body = await readJson(req);
    if (body.name !== undefined) {
      const name = cleanName(body.name);
      if (!name) throw new HttpError(400, 'Enter your name.');
      await env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, user.id).run();
      user.name = name;
    }
    if (body.newPassword !== undefined) {
      const row = await env.DB.prepare('SELECT pw FROM users WHERE id = ?').bind(user.id).first();
      if (!(await verifyPassword(String(body.currentPassword || ''), row.pw))) throw new HttpError(401, 'Current password is wrong.');
      const pw = String(body.newPassword);
      if (pw.length < 8 || pw.length > 200) throw new HttpError(400, 'Password must be at least 8 characters.');
      await env.DB.prepare('UPDATE users SET pw = ? WHERE id = ?').bind(await hashPassword(pw, env), user.id).run();
      // Sign out every other device, including their open live connections.
      await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(user.id, user.sessionHash).run();
      await revokeLive(env, user.id, { keep: user.sessionHash });
    }
    const { sessionHash, ...publicFields } = user;
    return json({ user: publicFields });
  }

  // Projects
  // ?kind=shotsheet: productions (and documents shared on their own) you're a member of.
  // ?parent=<production id>: the scripts / call sheets inside a production.
  if (pathname === '/api/projects' && method === 'GET') {
    const kind = url.searchParams.get('kind');
    const parent = url.searchParams.get('parent');
    const cols = 'p.id, p.kind, p.title, p.updated_at AS updatedAt, p.parent_id AS parentId, p.info, u.name AS ownerName, ';
    if (parent) {
      const role = await requireRole(env, parent, user.id);
      const { results } = await env.DB.prepare(
        `SELECT ${cols} (SELECT COUNT(*) FROM members x WHERE x.project_id = ?) AS memberCount ` +
        'FROM projects p JOIN users u ON u.id = p.owner_id WHERE p.parent_id = ? AND (? IS NULL OR p.kind = ?) ORDER BY p.updated_at DESC'
      ).bind(parent, parent, kind, kind).all();
      return json({ projects: results.map((r) => ({ ...withInfo(r), role })) });
    }
    const { results } = await env.DB.prepare(
      `SELECT ${cols} m.role, (SELECT COUNT(*) FROM members x WHERE x.project_id = p.id) AS memberCount ` +
      'FROM members m JOIN projects p ON p.id = m.project_id JOIN users u ON u.id = p.owner_id ' +
      'WHERE m.user_id = ? AND p.parent_id IS NULL AND (? IS NULL OR p.kind = ?) ORDER BY p.updated_at DESC'
    ).bind(user.id, kind, kind).all();
    return json({ projects: results.map(withInfo) });
  }

  // body: { kind, doc, id?, parent? }. With parent, the document goes inside that production
  // (owners and editors of the production can add to it).
  if (pathname === '/api/projects' && method === 'POST') {
    const body = await readJson(req);
    if (!KINDS.includes(body.kind)) throw new HttpError(400, 'Unknown project type.');
    const doc = body.doc;
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new HttpError(400, 'Missing document.');
    let parent = null;
    let role = 'owner';
    let ownerId = user.id;
    let ownerName = user.name;
    if (body.parent != null) {
      role = await requireRole(env, String(body.parent), user.id, ['owner', 'editor']);
      parent = await env.DB.prepare('SELECT p.id, p.kind, p.parent_id, p.owner_id, u.name FROM projects p JOIN users u ON u.id = p.owner_id WHERE p.id = ?')
        .bind(String(body.parent)).first();
      if (!parent || parent.kind !== 'shotsheet' || parent.parent_id) throw new HttpError(400, 'Documents can only go inside a production.');
      if (body.kind === 'shotsheet') throw new HttpError(400, 'A production can’t go inside another production.');
      ownerId = parent.owner_id; // the production's owner owns everything in it
      ownerName = parent.name;
    }
    let id = newId();
    if (body.id != null) {
      if (!validId(body.id)) throw new HttpError(400, 'Invalid id.');
      if (await env.DB.prepare('SELECT 1 FROM projects WHERE id = ?').bind(body.id).first()) throw new HttpError(409, 'That document is already online.');
      id = body.id;
    }
    doc.id = id;
    const title = String(doc.title || 'Untitled').slice(0, 200);
    const now = Date.now();
    const insert = env.DB.prepare('INSERT INTO projects (id, kind, title, owner_id, created_at, updated_at, parent_id, info) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, body.kind, title, ownerId, now, now, parent ? parent.id : null, infoOf(doc));
    await env.DB.batch(parent ? [insert] : [
      insert,
      env.DB.prepare("INSERT INTO members (project_id, user_id, role, added_at) VALUES (?, ?, 'owner', ?)").bind(id, user.id, now),
    ]);
    await roomCall(env, id, '/init', { projectId: id, doc });
    return json({ project: { id, kind: body.kind, title, updatedAt: now, role, ownerName, memberCount: 1, parentId: parent ? parent.id : null, ...JSON.parse(infoOf(doc)) } });
  }

  // Move a script or call sheet that was shared on its own into a production. Its owner must
  // be an owner or editor of the production; from then on the production's people have access,
  // and anyone who only had the document is disconnected.
  if ((m = pathname.match(/^\/api\/projects\/([\w-]+)$/)) && method === 'PATCH') {
    const id = m[1];
    const body = await readJson(req);
    const doc = await env.DB.prepare('SELECT id, kind, parent_id FROM projects WHERE id = ?').bind(id).first();
    if (!doc || (await roleOf(env, id, user.id)) !== 'owner') throw new HttpError(404, 'Project not found.');
    if (doc.parent_id || doc.kind === 'shotsheet') throw new HttpError(400, 'Only a script or call sheet shared on its own can be moved into a production.');
    const parentId = String(body.parent || '');
    await requireRole(env, parentId, user.id, ['owner', 'editor']);
    const parent = await env.DB.prepare('SELECT id, kind, parent_id, owner_id FROM projects WHERE id = ?').bind(parentId).first();
    if (!parent || parent.kind !== 'shotsheet' || parent.parent_id) throw new HttpError(400, 'That isn’t a production.');
    const { results: before } = await env.DB.prepare('SELECT user_id FROM members WHERE project_id = ?').bind(id).all();
    await env.DB.batch([
      env.DB.prepare('UPDATE projects SET parent_id = ?, owner_id = ? WHERE id = ?').bind(parentId, parent.owner_id, id),
      env.DB.prepare('DELETE FROM members WHERE project_id = ?').bind(id),
    ]);
    for (const { user_id: uid } of before) {
      if (!(await roleOf(env, id, uid))) await roomCall(env, id, '/kick', { userId: uid });
    }
    return json({ project: { id, kind: doc.kind, parentId } });
  }

  // The current document, read-only (e.g. the shot sheet reading a production's script).
  if ((m = pathname.match(/^\/api\/projects\/([\w-]+)\/doc$/)) && method === 'GET') {
    const id = m[1];
    await requireRole(env, id, user.id);
    const res = await room(env, id).fetch('https://room/doc', { method: 'POST', body: '{}' });
    if (!res.ok) throw new HttpError(404, 'Project not found.');
    return json({ doc: await res.json() });
  }

  // Delete: a production's owner deletes it with everything inside; a document inside a
  // production can be deleted by its owners and editors. Anyone else leaves the production.
  if ((m = pathname.match(/^\/api\/projects\/([\w-]+)$/)) && method === 'DELETE') {
    const id = m[1];
    const role = await requireRole(env, id, user.id);
    const row = await env.DB.prepare('SELECT parent_id FROM projects WHERE id = ?').bind(id).first();
    if (row && row.parent_id) {
      if (role === 'viewer') throw new HttpError(403, "You don't have permission to change this.");
      await env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
      await roomCall(env, id, '/destroy');
      return json({ ok: true, deleted: true });
    }
    if (role === 'owner') {
      const ids = await roomsOf(env, id);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM members WHERE project_id = ?').bind(id),
        env.DB.prepare('DELETE FROM projects WHERE id = ? OR parent_id = ?').bind(id, id),
      ]);
      await Promise.all(ids.map((x) => roomCall(env, x, '/destroy')));
      return json({ ok: true, deleted: true });
    }
    await env.DB.prepare('DELETE FROM members WHERE project_id = ? AND user_id = ?').bind(id, user.id).run();
    await roomCallAll(env, id, '/kick', { userId: user.id });
    return json({ ok: true, left: true });
  }

  // Members are kept on the production; asking about a document inside it means its production.
  if ((m = pathname.match(/^\/api\/projects\/([\w-]+)\/members$/))) {
    const id = (await rootOf(env, m[1])) || m[1];
    if (method === 'GET') {
      await requireRole(env, id, user.id);
      return json({ members: await listMembers(env, id) });
    }
    if (method === 'POST') {
      await requireRole(env, id, user.id, ['owner']);
      const body = await readJson(req);
      const role = ROLES.includes(body.role) ? body.role : 'editor';
      const target = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(cleanEmail(body.email)).first();
      if (!target) throw new HttpError(404, 'No account uses that email. Ask them to create an account first.');
      const existing = await roleOf(env, id, target.id);
      if (existing === 'owner') throw new HttpError(400, 'That person owns this project.');
      if (existing) {
        await env.DB.prepare('UPDATE members SET role = ? WHERE project_id = ? AND user_id = ?').bind(role, id, target.id).run();
        await roomCallAll(env, id, '/role', { userId: target.id, role });
      } else {
        await env.DB.prepare('INSERT INTO members (project_id, user_id, role, added_at) VALUES (?, ?, ?, ?)').bind(id, target.id, role, Date.now()).run();
      }
      return json({ members: await listMembers(env, id) });
    }
  }

  if ((m = pathname.match(/^\/api\/projects\/([\w-]+)\/members\/([\w-]+)$/))) {
    const id = (await rootOf(env, m[1])) || m[1];
    const targetId = m[2];
    const myRole = await requireRole(env, id, user.id);
    const targetRole = await roleOf(env, id, targetId);
    if (!targetRole) throw new HttpError(404, 'That person is not in this project.');
    if (targetRole === 'owner') throw new HttpError(400, "The owner's access can't be changed.");
    if (method === 'PATCH') {
      if (myRole !== 'owner') throw new HttpError(403, 'Only the project owner can do that.');
      const body = await readJson(req);
      if (!ROLES.includes(body.role)) throw new HttpError(400, 'Unknown role.');
      await env.DB.prepare('UPDATE members SET role = ? WHERE project_id = ? AND user_id = ?').bind(body.role, id, targetId).run();
      await roomCallAll(env, id, '/role', { userId: targetId, role: body.role });
      return json({ members: await listMembers(env, id) });
    }
    if (method === 'DELETE') {
      if (myRole !== 'owner' && targetId !== user.id) throw new HttpError(403, 'Only the project owner can do that.');
      await env.DB.prepare('DELETE FROM members WHERE project_id = ? AND user_id = ?').bind(id, targetId).run();
      await roomCallAll(env, id, '/kick', { userId: targetId });
      return json({ members: await listMembers(env, id) });
    }
  }

  // Live connection
  if ((m = pathname.match(/^\/api\/projects\/([\w-]+)\/live$/)) && method === 'GET') {
    if (req.headers.get('Upgrade') !== 'websocket') throw new HttpError(426, 'Expected a WebSocket.');
    const id = m[1];
    const role = await requireRole(env, id, user.id);
    const headers = new Headers(req.headers);
    headers.set('X-User-Id', user.id);
    headers.set('X-User-Name', encodeURIComponent(user.name));
    headers.set('X-Role', role);
    headers.set('X-Project-Id', id);
    headers.set('X-Session-Hash', user.sessionHash);
    return room(env, id).fetch(new Request(req.url, { headers }));
  }

  throw new HttpError(404, 'Not found.');
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    try {
      return await route(req, env, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'Server error. Please try again.' }, 500);
    }
  },
};

// ---------- Durable Object: one live room per project ----------
export class ProjectRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    // Answer keep-alive pings without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      this.doc = (await ctx.storage.get('doc')) ?? null;
      this.version = (await ctx.storage.get('version')) ?? 0;
      this.projectId = (await ctx.storage.get('pid')) ?? null;
      this.title = this.doc ? this.doc.title : null;
      this.info = this.doc ? infoOf(this.doc) : null;
      this.touchedAt = 0;
    });
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (req.headers.get('Upgrade') === 'websocket') return this.connect(req);
    const body = req.method === 'POST' ? await req.json() : {};

    if (url.pathname === '/init') {
      if (!this.doc) {
        this.doc = body.doc;
        this.version = 0;
        this.projectId = body.projectId;
        this.title = this.doc.title;
        await this.ctx.storage.put({ doc: this.doc, version: 0, pid: body.projectId });
      }
      return new Response('ok');
    }
    if (url.pathname === '/doc') {
      if (!this.doc) return new Response('Not found', { status: 404 });
      return new Response(JSON.stringify(this.doc), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/destroy') {
      for (const ws of this.ctx.getWebSockets()) {
        this.safeSend(ws, { type: 'gone', message: 'This project was deleted by its owner.' });
        try { ws.close(4004, 'Project deleted'); } catch { /* already closed */ }
      }
      await this.ctx.storage.deleteAll();
      this.doc = null;
      return new Response('ok');
    }
    if (url.pathname === '/kick') {
      for (const ws of this.ctx.getWebSockets()) {
        if (ws.deserializeAttachment().userId === body.userId) {
          this.safeSend(ws, { type: 'gone', message: 'You no longer have access to this project.' });
          try { ws.close(4003, 'Removed'); } catch { /* already closed */ }
        }
      }
      this.broadcastPresence();
      return new Response('ok');
    }
    if (url.pathname === '/role') {
      for (const ws of this.ctx.getWebSockets()) {
        const att = ws.deserializeAttachment();
        if (att.userId === body.userId) {
          att.role = body.role;
          ws.serializeAttachment(att);
          this.safeSend(ws, { type: 'role', role: body.role });
        }
      }
      this.broadcastPresence();
      return new Response('ok');
    }
    // Signed out (or password changed on another device): close that session's connections.
    if (url.pathname === '/revoke') {
      for (const ws of this.ctx.getWebSockets()) {
        const att = ws.deserializeAttachment();
        if (att.userId !== body.userId) continue;
        if (body.keep && att.sessionHash === body.keep) continue;
        if (body.only && att.sessionHash !== body.only) continue;
        this.safeSend(ws, { type: 'gone', message: 'You were signed out. Please sign in again.' });
        try { ws.close(4001, 'Signed out'); } catch { /* already closed */ }
      }
      this.broadcastPresence();
      return new Response('ok');
    }
    return new Response('Not found', { status: 404 });
  }

  connect(req) {
    if (!this.doc) return new Response('Project not found', { status: 404 });
    if (!this.projectId) {
      this.projectId = req.headers.get('X-Project-Id');
      this.ctx.storage.put('pid', this.projectId);
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const att = {
      clientId: crypto.randomUUID().slice(0, 8),
      userId: req.headers.get('X-User-Id'),
      name: decodeURIComponent(req.headers.get('X-User-Name') || 'Someone'),
      role: req.headers.get('X-Role'),
      sessionHash: req.headers.get('X-Session-Hash'),
    };
    server.serializeAttachment(att);
    this.safeSend(server, { type: 'snapshot', doc: this.doc, v: this.version, clientId: att.clientId, role: att.role });
    this.broadcastPresence();
    // A client that sent its token as a subprotocol must get one of its protocols back.
    const offered = (req.headers.get('Sec-WebSocket-Protocol') || '').split(',').map((s) => s.trim());
    const headers = offered.includes(WS_PROTOCOL) ? { 'Sec-WebSocket-Protocol': WS_PROTOCOL } : undefined;
    return new Response(null, { status: 101, webSocket: client, headers });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_DOC_BYTES + 10_000) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const att = ws.deserializeAttachment();
    if (msg.type !== 'ops' || !this.doc) return;

    const resync = (message) => {
      this.safeSend(ws, { type: 'error', message });
      this.safeSend(ws, { type: 'snapshot', doc: this.doc, v: this.version, clientId: att.clientId, role: att.role, reset: true });
    };
    if (att.role === 'viewer') return resync('You have view-only access to this project.');

    const next = clone(this.doc);
    const applied = applyAll(next, msg.ops);
    if (JSON.stringify(next).length > MAX_DOC_BYTES) return resync('This project is too large to save more changes.');
    if (applied.length) {
      this.doc = next;
      this.version++;
      await this.ctx.storage.put({ doc: this.doc, version: this.version });
    }
    // Everyone gets the batch, including the sender (as its acknowledgement).
    this.broadcast({ type: 'ops', ops: applied, v: this.version, from: att.clientId, batch: msg.batch });
    await this.updateListing();
  }

  // Keep the project list (title, last edited, type / episode) in D1 roughly current.
  async updateListing() {
    const now = Date.now();
    const info = infoOf(this.doc);
    const changed = this.doc.title !== this.title || info !== this.info;
    if (!changed && now - this.touchedAt < 60_000) return;
    this.title = this.doc.title;
    this.info = info;
    this.touchedAt = now;
    try {
      await this.env.DB.prepare('UPDATE projects SET title = ?, updated_at = ?, info = ? WHERE id = ?')
        .bind(String(this.title || 'Untitled').slice(0, 200), now, info, this.projectId).run();
    } catch (err) {
      console.error('listing update failed', err);
    }
  }

  webSocketClose(ws, code) {
    try { ws.close(code === 1005 ? 1000 : code, 'Closed'); } catch { /* already closed */ }
    this.broadcastPresence(ws);
  }

  webSocketError(ws) {
    this.broadcastPresence(ws);
  }

  broadcastPresence(exclude) {
    const users = this.ctx.getWebSockets()
      .filter((ws) => ws !== exclude)
      .map((ws) => {
        const { clientId, userId, name, role } = ws.deserializeAttachment();
        return { clientId, userId, name, role };
      });
    this.broadcast({ type: 'presence', users }, exclude);
  }

  broadcast(msg, exclude) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) if (ws !== exclude) this.safeSend(ws, data);
  }

  safeSend(ws, msg) {
    try { ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch { /* socket closing */ }
  }
}
