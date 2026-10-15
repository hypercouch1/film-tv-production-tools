// Talks to the Production Tools server: accounts, shared projects and live sessions.
(function () {
  const { diff, applyAll, clone } = window.SyncCore;

  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };

  let token = store.get('hub.token');
  let user = (() => { try { return JSON.parse(store.get('hub.user')); } catch { return null; } })();
  const authListeners = new Set();

  function serverUrl() {
    const configured = (window.APP_CONFIG && window.APP_CONFIG.serverUrl) || '';
    return (store.get('hub.server') || configured).trim().replace(/\/+$/, '');
  }
  function setServerUrl(url) {
    store.set('hub.server', url && url.trim() ? url.trim() : null);
  }

  function setSession(t, u) {
    token = t;
    user = u;
    store.set('hub.token', t);
    store.set('hub.user', u ? JSON.stringify(u) : null);
    authListeners.forEach((f) => f(user));
  }

  async function request(method, path, body) {
    const base = serverUrl();
    if (!base) throw new Error('No server address set. Add it under Account → Server.');
    let res;
    try {
      res = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error("Can't reach the server. Check your internet connection.");
    }
    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }
    if (res.status === 401 && token && path !== '/api/login') setSession(null, null);
    if (!res.ok) {
      const err = new Error(data.error || `Server error (${res.status}).`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ---------- Live session for one shared project ----------
  // Keeps the server's confirmed copy (base) plus local batches it hasn't confirmed
  // yet (pending). Remote edits are applied to base and pending is replayed on top,
  // so every person ends up with exactly the server's order of changes.
  class LiveSession {
    constructor(projectId, handlers) {
      this.id = projectId;
      this.h = handlers;
      this.pending = [];
      this.batchNo = 0;
      this.base = null;
      this.synced = null; // the doc as last handed to / read from the page
      this.role = null;
      this.clientId = null;
      this.closed = false;
      this.failures = 0;
      // Start after the caller has stored the session, since handlers may refer to it.
      queueMicrotask(() => this.connect());
    }

    status(s) {
      this.state = s;
      this.h.onStatus && this.h.onStatus(s);
    }

    connect() {
      if (this.closed) return;
      this.status(this.failures ? 'offline' : 'connecting');
      const url = serverUrl().replace(/^http/, 'ws') + `/api/projects/${encodeURIComponent(this.id)}/live?token=${encodeURIComponent(token || '')}`;
      let ws;
      try { ws = new WebSocket(url); } catch { return this.retry(); }
      this.ws = ws;
      ws.onopen = () => { this.failures = 0; };
      ws.onmessage = (e) => this.receive(e.data);
      ws.onclose = (e) => {
        clearInterval(this.pinger);
        if (this.ws !== ws || this.closed) return;
        if (e.code === 4003 || e.code === 4004) return; // 'gone' message already handled
        this.status('offline');
        this.retry();
      };
      this.pinger = setInterval(() => { if (ws.readyState === 1) ws.send('ping'); }, 25000);
    }

    async retry() {
      if (this.closed) return;
      this.failures++;
      // After repeated failures, check whether we still have access at all.
      if (this.failures >= 3) {
        try {
          await request('GET', `/api/projects/${encodeURIComponent(this.id)}/members`);
        } catch (err) {
          if (err.status === 401 || err.status === 404) return this.gone(err.status === 401 ? 'Please sign in again.' : 'You no longer have access to this project.');
        }
      }
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.connect(), Math.min(10000, 500 * 2 ** Math.min(this.failures, 5)));
    }

    gone(message) {
      this.closed = true;
      this.status('gone');
      this.h.onGone && this.h.onGone(message);
    }

    send(batch) {
      if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: 'ops', batch: batch.batch, ops: batch.ops }));
    }

    receive(raw) {
      if (raw === 'pong') return;
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      switch (msg.type) {
        case 'snapshot':
          this.clientId = msg.clientId;
          this.setRole(msg.role);
          if (msg.reset) this.pending = [];
          else this.captureLocal(false); // queued; sent with the rest just below
          this.base = msg.doc;
          this.rebuild();
          this.pending.forEach((b) => this.send(b)); // resend anything unconfirmed after a reconnect
          this.status('live');
          break;
        case 'ops':
          if (!this.base) return;
          applyAll(this.base, msg.ops);
          if (msg.from === this.clientId) {
            this.pending = this.pending.filter((b) => b.batch !== msg.batch);
          } else if (msg.ops.length) {
            this.captureLocal();
            this.rebuild();
          }
          break;
        case 'presence':
          this.h.onPresence && this.h.onPresence(msg.users, this.clientId);
          break;
        case 'role':
          this.setRole(msg.role);
          break;
        case 'error':
          this.h.onError && this.h.onError(msg.message);
          break;
        case 'gone':
          this.gone(msg.message);
          break;
      }
    }

    setRole(role) {
      if (role === this.role) return;
      this.role = role;
      this.h.onRole && this.h.onRole(role);
    }

    rebuild() {
      const doc = clone(this.base);
      for (const b of this.pending) applyAll(doc, b.ops);
      this.synced = clone(doc);
      this.h.onDoc(doc);
    }

    // Turn whatever the page changed since last time into a batch of operations.
    captureLocal(sendNow = true) {
      if (!this.synced) return;
      const current = this.h.getLocal();
      if (!current) return;
      const ops = diff(this.synced, current);
      if (!ops.length) return;
      if (this.role === 'viewer') {
        this.h.onError && this.h.onError('You have view-only access to this project.');
        this.rebuild();
        return;
      }
      const batch = { batch: ++this.batchNo, ops };
      this.pending.push(batch);
      this.synced = clone(current);
      if (sendNow) this.send(batch);
    }

    commit() {
      this.captureLocal();
    }

    get unsent() {
      return this.pending.length;
    }

    close() {
      if (this.closed) return;
      this.captureLocal();
      this.closed = true;
      clearInterval(this.pinger);
      clearTimeout(this.timer);
      try { this.ws && this.ws.close(1000); } catch { /* already closed */ }
    }
  }

  window.Cloud = {
    serverUrl,
    setServerUrl,
    get user() { return user; },
    get signedIn() { return !!token && !!user; },
    onAuth(fn) { authListeners.add(fn); return () => authListeners.delete(fn); },

    async signup(name, email, password) {
      const r = await request('POST', '/api/signup', { name, email, password });
      setSession(r.token, r.user);
      return r.user;
    },
    async login(email, password) {
      const r = await request('POST', '/api/login', { email, password });
      setSession(r.token, r.user);
      return r.user;
    },
    async logout() {
      try { await request('POST', '/api/logout'); } catch { /* signing out locally anyway */ }
      setSession(null, null);
    },
    async refreshMe() {
      if (!token) return null;
      try {
        const r = await request('GET', '/api/me');
        setSession(token, r.user);
      } catch { /* offline: keep the cached user */ }
      return user;
    },
    async updateMe(changes) {
      const r = await request('PATCH', '/api/me', changes);
      setSession(token, r.user);
      return r.user;
    },

    projects: (kind) => request('GET', '/api/projects?kind=' + encodeURIComponent(kind)).then((r) => r.projects),
    createProject: (kind, doc) => request('POST', '/api/projects', { kind, doc }).then((r) => r.project),
    deleteProject: (id) => request('DELETE', `/api/projects/${encodeURIComponent(id)}`),
    members: (id) => request('GET', `/api/projects/${encodeURIComponent(id)}/members`).then((r) => r.members),
    addMember: (id, email, role) => request('POST', `/api/projects/${encodeURIComponent(id)}/members`, { email, role }).then((r) => r.members),
    setRole: (id, uid, role) => request('PATCH', `/api/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(uid)}`, { role }).then((r) => r.members),
    removeMember: (id, uid) => request('DELETE', `/api/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(uid)}`).then((r) => r.members),

    connect: (projectId, handlers) => new LiveSession(projectId, handlers),
  };
})();
