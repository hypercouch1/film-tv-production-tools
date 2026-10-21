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

  const PING_MS = 25000;          // keep-alive interval; the server answers each with 'pong'
  const PONG_GRACE_MS = 10000;    // silence beyond a ping interval plus this = dead connection
  const CONNECT_TIMEOUT_MS = 15000;

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
      this.heardAt = 0; // last message from the server (pongs included)
      // Coming back (network returns, window shown or focused, computer wakes): check the
      // connection now rather than waiting for the next ping or retry.
      this.wake = () => this.checkAlive();
      window.addEventListener('online', this.wake);
      window.addEventListener('focus', this.wake);
      document.addEventListener('visibilitychange', this.wake);
      // Start after the caller has stored the session, since handlers may refer to it.
      queueMicrotask(() => this.connect());
    }

    // After sleep or a network change, a connection can be dead without the browser
    // noticing for a long time: it still looks open, so nothing reconnects and edits sit
    // unsent. Every ping gets a pong, so silence means the connection is gone.
    checkAlive() {
      if (this.closed || document.visibilityState === 'hidden') return;
      const ws = this.ws;
      if (!ws || ws.readyState > 1) {
        // Closed and waiting to retry: try now, from the start of the backoff.
        if (this.state !== 'gone') { clearTimeout(this.timer); this.failures = Math.min(this.failures, 1); this.connect(); }
        return;
      }
      if (ws.readyState !== 1) return; // still connecting
      // Looks open; make sure with a quick ping.
      const asked = Date.now();
      try { ws.send('ping'); } catch { return this.reconnectNow(); }
      clearTimeout(this.probe);
      this.probe = setTimeout(() => { if (this.ws === ws && this.heardAt < asked) this.reconnectNow(); }, PONG_GRACE_MS);
    }

    // Drop the current connection without waiting for it to close, and start a new one.
    reconnectNow() {
      if (this.closed) return;
      const old = this.ws;
      this.ws = null;
      clearInterval(this.pinger);
      clearTimeout(this.probe);
      clearTimeout(this.timer);
      if (old) {
        old.onclose = old.onmessage = old.onerror = null;
        try { old.close(4000, 'No answer'); } catch { /* already closed */ }
      }
      this.status('offline');
      this.failures = Math.max(this.failures, 1);
      this.connect();
    }

    status(s) {
      this.state = s;
      this.h.onStatus && this.h.onStatus(s);
    }

    connect() {
      if (this.closed) return;
      this.status(this.failures ? 'offline' : 'connecting');
      // The token goes in a subprotocol rather than the URL, so it doesn't end up in logs.
      const url = serverUrl().replace(/^http/, 'ws') + `/api/projects/${encodeURIComponent(this.id)}/live`;
      let ws;
      try { ws = new WebSocket(url, ['production-tools', 'auth.' + (token || '')]); } catch { return this.retry(); }
      this.ws = ws;
      clearInterval(this.pinger);
      clearTimeout(this.connectTimer);
      // A connection attempt that hangs (e.g. on a network that's half up) counts as failed.
      this.connectTimer = setTimeout(() => { if (this.ws === ws && ws.readyState === 0) this.dropAndRetry(ws); }, CONNECT_TIMEOUT_MS);
      ws.onopen = () => { this.failures = 0; this.heardAt = Date.now(); clearTimeout(this.connectTimer); };
      ws.onmessage = (e) => { this.heardAt = Date.now(); this.receive(e.data); };
      ws.onclose = (e) => {
        clearTimeout(this.connectTimer);
        if (this.ws !== ws || this.closed) return;
        clearInterval(this.pinger);
        if (e.code === 4001 || e.code === 4003 || e.code === 4004) return; // 'gone' message already handled
        this.status('offline');
        this.retry();
      };
      // Keep-alive, and a check that the server still answers. Timers in a hidden window
      // can run late, so a long gap since the last tick isn't counted against the server.
      let lastTick = Date.now();
      this.pinger = setInterval(() => {
        const now = Date.now();
        const late = now - lastTick > PING_MS * 2;
        lastTick = now;
        if (ws.readyState !== 1) return;
        if (late) {
          if (document.visibilityState !== 'hidden') return this.checkAlive(); // probably just woke up
        } else if (now - this.heardAt > PING_MS + PONG_GRACE_MS) {
          return this.reconnectNow(); // the last ping got no answer
        }
        try { ws.send('ping'); } catch { this.reconnectNow(); }
      }, PING_MS);
    }

    dropAndRetry(ws) {
      ws.onclose = ws.onmessage = ws.onerror = null;
      try { ws.close(); } catch { /* not open */ }
      if (this.ws === ws) this.ws = null;
      this.status('offline');
      this.retry();
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
      this.stopWatching();
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
      this.stopWatching();
      try { this.ws && this.ws.close(1000); } catch { /* already closed */ }
    }

    stopWatching() {
      clearInterval(this.pinger);
      clearTimeout(this.timer);
      clearTimeout(this.probe);
      clearTimeout(this.connectTimer);
      window.removeEventListener('online', this.wake);
      window.removeEventListener('focus', this.wake);
      document.removeEventListener('visibilitychange', this.wake);
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

    // Productions (and documents shared on their own) you're a member of, or with parent,
    // the documents inside a production.
    projects: (kind, parent) => request('GET', '/api/projects?' + new URLSearchParams({ ...(kind ? { kind } : {}), ...(parent ? { parent } : {}) }))
      .then((r) => r.projects),
    // opts.id keeps the document's id (so links to it survive); opts.parent puts it inside a production.
    createProject: (kind, doc, opts = {}) => request('POST', '/api/projects', { kind, doc, ...(opts.id ? { id: opts.id } : {}), ...(opts.parent ? { parent: opts.parent } : {}) })
      .then((r) => r.project),
    // A document as it is now, without opening it live.
    doc: (id) => request('GET', `/api/projects/${encodeURIComponent(id)}/doc`).then((r) => r.doc),
    moveInto: (id, parent) => request('PATCH', `/api/projects/${encodeURIComponent(id)}`, { parent }).then((r) => r.project),

    // Personal availability links for a shared production's cast and crew.
    availabilityLinks: (id) => request('GET', `/api/projects/${encodeURIComponent(id)}/availability/links`).then((r) => r.links),
    createAvailabilityLinks: (id, body) => request('POST', `/api/projects/${encodeURIComponent(id)}/availability/links`, body).then((r) => r.links),
    revokeAvailabilityLink: (id, personId) => request('DELETE', `/api/projects/${encodeURIComponent(id)}/availability/links/${encodeURIComponent(personId)}`),
    // Anyone in a shared production (view-only too): say which cast/crew entry is you
    // (personId null lets go), then mark your own days.
    claimPerson: (id, personId) => request('POST', `/api/projects/${encodeURIComponent(id)}/me/claim`, { personId }),
    setMyAvailability: (id, personId, entry) => request('POST', `/api/projects/${encodeURIComponent(id)}/me/availability`, { personId, ...entry }),
    // The address cast and crew open: /a/<code> on the availability site (or this server).
    availabilityLink: (code) => {
      const site = ((window.APP_CONFIG && window.APP_CONFIG.availabilityUrl) || '').replace(/\/+$/, '');
      const configured = ((window.APP_CONFIG && window.APP_CONFIG.serverUrl) || '').replace(/\/+$/, '');
      // Someone using their own server gets links on that server.
      return `${site && serverUrl() === configured ? site : serverUrl()}/a/${code}`;
    },
    deleteProject: (id) => request('DELETE', `/api/projects/${encodeURIComponent(id)}`),
    members: (id) => request('GET', `/api/projects/${encodeURIComponent(id)}/members`).then((r) => r.members),
    addMember: (id, email, role) => request('POST', `/api/projects/${encodeURIComponent(id)}/members`, { email, role }).then((r) => r.members),
    setRole: (id, uid, role) => request('PATCH', `/api/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(uid)}`, { role }).then((r) => r.members),
    removeMember: (id, uid) => request('DELETE', `/api/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(uid)}`).then((r) => r.members),

    connect: (projectId, handlers) => new LiveSession(projectId, handlers),
  };
})();
