// The admin page (/admin): usage stats, account management, backups and the admin log, for
// the accounts listed in ADMIN_EMAILS. It signs in with the admin's own account (email +
// password), then a code from their authenticator app (set up on first use), and calls
// /api/admin/*, which checks both on every request. Self-contained (inline style and script
// under a per-response nonce); every value is set with textContent.
export const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Production Tools · Admin</title>
<style nonce="__NONCE__">
  :root { --bg: #0f0d0b; --panel: #16130f; --panel2: #1e1a15; --line: #2a251f; --text: #ece9e4; --muted: #8f99a3; --yellow: #e6cf2e; --red: #e2332b; --green: #6fcf7a; --blue: #7fd0ea; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
  main { max-width: 1200px; margin: 0 auto; padding: 24px 20px 60px; }
  header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .brand { font-size: 12px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: var(--muted); display: flex; align-items: center; gap: 8px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--red); box-shadow: 0 0 10px var(--red); }
  h1 { font-size: 30px; margin: 6px 0 0; letter-spacing: .5px; text-transform: uppercase; flex-basis: 100%; }
  h2 { font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--muted); margin: 28px 0 10px; }
  .spacer { flex: 1; }
  .muted { color: var(--muted); }
  .small { font-size: 12px; }
  button, .btn { background: transparent; color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 6px 12px; font: inherit; cursor: pointer; }
  button:hover { border-color: var(--muted); }
  button.primary { background: var(--yellow); color: #2a2405; border-color: var(--yellow); font-weight: 700; }
  button.danger { color: #ffb3ad; }
  button:disabled { opacity: .45; cursor: default; }
  input { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; font: inherit; }
  input:focus { outline: none; border-color: var(--yellow); }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 12px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px; }
  .card .big { font-size: 30px; font-weight: 700; line-height: 1.1; }
  .card .label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .8px; }
  .card .rows { margin-top: 8px; display: grid; gap: 2px; font-size: 13px; }
  .card .rows div { display: flex; justify-content: space-between; gap: 8px; }
  .chart { display: flex; align-items: flex-end; gap: 4px; height: 90px; margin-top: 10px; }
  .bar { flex: 1; background: var(--blue); border-radius: 3px 3px 0 0; min-height: 2px; position: relative; }
  .bar span { position: absolute; top: -16px; left: 0; right: 0; text-align: center; font-size: 10px; color: var(--muted); }
  .two { display: grid; grid-template-columns: 2fr 1fr; gap: 12px; margin-top: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .8px; color: var(--muted); font-weight: 600; }
  td.actions { white-space: nowrap; text-align: right; }
  td.actions button { padding: 4px 8px; font-size: 12px; margin-left: 4px; }
  tr.off td:not(.actions) { opacity: .5; }
  .pill { font-size: 11px; border-radius: 999px; padding: 1px 8px; border: 1px solid var(--line); color: var(--muted); }
  .pill.admin { color: var(--yellow); border-color: var(--yellow); }
  .pill.off { color: #ffb3ad; border-color: var(--red); }
  .pill.ok { color: var(--green); border-color: var(--green); }
  .tools { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .login { max-width: 420px; margin: 60px auto; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 22px; display: grid; gap: 10px; }
  .login p { margin: 0; }
  .key { font: 700 18px/1.5 ui-monospace, Menlo, Consolas, monospace; letter-spacing: 2px; color: var(--yellow); background: var(--panel2); border: 1px solid var(--line); border-radius: 8px; padding: 10px; word-break: break-all; user-select: all; }
  .totp { font: 700 22px/1 ui-monospace, Menlo, Consolas, monospace; letter-spacing: 6px; text-align: center; }
  ol { margin: 0; padding-left: 20px; display: grid; gap: 6px; }
  .error { color: #ffb3ad; min-height: 1em; }
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: grid; place-items: center; padding: 16px; }
  .dialog { background: var(--panel2); border: 1px solid var(--line); border-radius: 12px; padding: 20px; max-width: 560px; width: 100%; max-height: 85vh; overflow: auto; }
  .code { font: 700 30px/1.2 ui-monospace, Menlo, Consolas, monospace; letter-spacing: 4px; color: var(--yellow); margin: 10px 0; user-select: all; }
  .log td { font-size: 13px; }
  .hidden { display: none !important; }
  @media (max-width: 800px) { .two { grid-template-columns: 1fr; } #accounts td:nth-child(4), #accounts th:nth-child(4), #accounts td:nth-child(5), #accounts th:nth-child(5) { display: none; } }
</style>
</head>
<body>
<main>
  <header>
    <div class="brand"><span class="dot"></span><span>Production Tools · Admin</span></div>
    <span class="spacer"></span>
    <span class="muted small" id="who"></span>
    <button id="refresh" class="hidden" type="button">Refresh</button>
    <button id="signout" class="hidden" type="button">Sign out</button>
    <h1>Admin</h1>
  </header>

  <form class="login hidden" id="login">
    <strong>Sign in with your admin account</strong>
    <input id="email" type="email" autocomplete="username" placeholder="Email" required>
    <input id="password" type="password" autocomplete="current-password" placeholder="Password" required>
    <button class="primary" type="submit">Sign in</button>
    <div class="error" id="loginError"></div>
  </form>

  <form class="login hidden" id="setup">
    <strong>Set up two-step sign-in</strong>
    <p class="muted">The admin page needs a code from an authenticator app on your phone as well as your password, so nobody can get in with your password alone.</p>
    <ol>
      <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…).</li>
      <li>Add an account → <strong>Enter a setup key</strong>, name it "Production Tools", and type this key (time-based):</li>
    </ol>
    <div class="key" id="setupKey"></div>
    <a class="small muted" id="setupLink" href="#">On this phone? Open it in your authenticator app</a>
    <p>3. Enter the 6-digit code it shows:</p>
    <input class="totp" id="setupCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" required>
    <button class="primary" type="submit">Turn on two-step sign-in</button>
    <div class="error" id="setupError"></div>
  </form>

  <form class="login hidden" id="verify">
    <strong>Enter your code</strong>
    <p class="muted">The 6-digit code for Production Tools in your authenticator app.</p>
    <input class="totp" id="verifyCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" required>
    <button class="primary" type="submit">Continue</button>
    <div class="error" id="verifyError"></div>
  </form>

  <section id="dash" class="hidden">
    <h2>Usage</h2>
    <p class="muted small">Counts accounts and shared productions on the server. Work people keep only on their own computers isn't visible here.</p>
    <div class="cards" id="cards"></div>
    <div class="two">
      <div class="card"><div class="label">New accounts per week (last 12 weeks)</div><div class="chart" id="chart"></div></div>
      <div class="card"><div class="label">App versions in use (active in 30 days)</div><div class="rows" id="versions"></div></div>
    </div>

    <h2>Accounts</h2>
    <div class="tools">
      <input id="search" type="search" placeholder="Search name or email" autocomplete="off">
      <span class="muted small" id="count"></span>
    </div>
    <table id="accounts">
      <thead><tr><th>Name</th><th>Email</th><th>Joined</th><th>Last active</th><th>Version</th><th>Productions</th><th></th></tr></thead>
      <tbody id="users"></tbody>
    </table>

    <h2>Backups</h2>
    <p class="muted small">Every shared document is copied before its first change of the day; the last 14 copies are kept. A deleted document's copies are kept for 30 days, so it can be brought back. Restoring keeps a copy of what was there.</p>
    <div class="tools">
      <button id="backupNow" type="button">Back up everything now</button>
      <button id="exportAll" type="button">Download everything (.json)</button>
      <input id="backupSearch" type="search" placeholder="Search documents" autocomplete="off">
      <span class="muted small" id="backupCount"></span>
    </div>
    <table>
      <thead><tr><th>Document</th><th>Type</th><th>Status</th><th>Copies</th><th>Latest copy</th><th></th></tr></thead>
      <tbody id="backups"></tbody>
    </table>

    <h2>Admin log</h2>
    <table class="log">
      <thead><tr><th>When</th><th>Admin</th><th>What</th><th>Account / document</th><th>Details</th></tr></thead>
      <tbody id="log"></tbody>
    </table>
  </section>
  <p class="error" id="fatal"></p>
</main>
<script nonce="__NONCE__">
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'adminToken';
  var token = null;
  var backupRows = [];
  var KINDS = { shotsheet: 'Production', script: 'Script', callsheet: 'Call sheet', post: 'Post', budget: 'Budget', onset: 'On set', gear: 'Equipment' };
  try { token = sessionStorage.getItem(KEY); } catch (e) {}
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function when(t) {
    if (!t) return 'never';
    var d = (Date.now() - t) / 1000;
    if (d < 3600) return Math.max(1, Math.round(d / 60)) + ' min ago';
    if (d < 86400) return Math.round(d / 3600) + ' h ago';
    if (d < 86400 * 30) return Math.round(d / 86400) + ' days ago';
    return new Date(t).toLocaleDateString();
  }
  function stamp(t) { return new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function size(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
  function request(method, path, body) {
    return fetch(path, { method: method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: body ? JSON.stringify(body) : undefined });
  }
  function api(method, path, body) {
    return request(method, path, body)
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || ('Error ' + r.status)); e.status = r.status; e.twoStep = !!j.twoStep; throw e; } return j; }); });
  }
  // A file from the server (sent with the sign-in token), saved by the browser.
  function download(path, fallbackName) {
    return request('GET', path).then(function (r) {
      if (!r.ok) return r.json().then(function (j) { throw new Error(j.error || 'Download failed'); });
      var name = ((r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1] || fallbackName;
      return r.blob().then(function (b) {
        var a = el('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      });
    });
  }
  function setToken(t) { token = t; try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch (e) {} }
  function show(id) {
    ['login', 'setup', 'verify', 'dash'].forEach(function (x) { $(x).classList.toggle('hidden', x !== id); });
    var inside = id === 'dash';
    $('refresh').classList.toggle('hidden', !inside);
    $('signout').classList.toggle('hidden', id === 'login');
  }
  function showLogin(msg) { show('login'); $('loginError').textContent = msg || ''; $('who').textContent = ''; }

  // After the password: set up the authenticator app, or enter its code.
  function twoStep() {
    return api('GET', '/api/admin/2fa').then(function (s) {
      $('who').textContent = s.email;
      if (s.verified) return load();
      if (s.enabled) { show('verify'); $('verifyCode').value = ''; $('verifyCode').focus(); return; }
      return api('POST', '/api/admin/2fa/setup').then(function (r) {
        $('setupKey').textContent = r.secret.replace(/(.{4})/g, '$1 ').trim();
        $('setupLink').href = r.uri;
        show('setup'); $('setupCode').focus();
      });
    }).catch(function (e) {
      if (e.status === 401) { setToken(null); showLogin(); }
      else if (e.status === 403) { setToken(null); showLogin("That account isn't an admin."); }
      else $('fatal').textContent = e.message;
    });
  }

  function card(label, big, rows) {
    var c = el('div', 'card');
    c.appendChild(el('div', 'label', label));
    c.appendChild(el('div', 'big', String(big == null ? 0 : big)));
    if (rows) {
      var r = el('div', 'rows');
      rows.forEach(function (x) { var d = el('div'); d.appendChild(el('span', 'muted', x[0])); d.appendChild(el('span', null, String(x[1] == null ? 0 : x[1]))); r.appendChild(d); });
      c.appendChild(r);
    }
    return c;
  }
  function renderStats(s) {
    var kind = function (k, top) { var r = s.kinds.filter(function (x) { return x.kind === k && (top == null || !!x.top === top); }); return r.reduce(function (n, x) { return n + x.n; }, 0); };
    var edited = s.kinds.reduce(function (n, x) { return n + (x.edited7 || 0); }, 0);
    var cards = $('cards'); cards.textContent = '';
    cards.appendChild(card('Accounts', s.users.total, [['New this week', s.users.new7], ['New in 30 days', s.users.new30], ['Switched off', s.users.disabled]]));
    cards.appendChild(card('Active people', s.users.active7, [['Today', s.users.active1], ['This week', s.users.active7], ['In 30 days', s.users.active30], ['Devices signed in', s.sessions.n]]));
    cards.appendChild(card('Shared productions', kind('shotsheet', true), [['Scripts', kind('script')], ['Call sheets', kind('callsheet')], ['Post documents', kind('post')], ['Budgets', kind('budget')], ['On set', kind('onset')], ['Equipment lists', kind('gear')], ['Edited this week', edited]]));
    cards.appendChild(card('Collaboration', s.members.invited, [['People invited to projects', s.members.invited], ['Projects with people', s.members.projects]]));
    cards.appendChild(card('Crew pages', s.crewLinks.n, [['Opened', s.crewLinks.opened], ['Call sheets sent', s.sheets.sent], ['"Got it"s', s.sheets.confirmed]]));
    cards.appendChild(card('Availability links', s.links.n, [['Answered', s.links.answered], ['Waiting', (s.links.n || 0) - (s.links.answered || 0)]]));
    cards.appendChild(card('Password codes (30 days)', s.resetCodes.n, [['Used', s.resetCodes.used]]));
    cards.appendChild(card('Backups', s.backups.n, [['Size', size(s.backups.bytes || 0)], ['Latest', s.backups.latest ? when(s.backups.latest) : 'none yet']]));
    var chart = $('chart'); chart.textContent = '';
    var max = Math.max.apply(null, s.signupsByWeek.map(function (w) { return w.n; }).concat([1]));
    s.signupsByWeek.forEach(function (w) {
      var b = el('div', 'bar'); b.style.height = Math.round((w.n / max) * 100) + '%';
      b.title = 'Week of ' + new Date(w.start).toLocaleDateString() + ': ' + w.n;
      b.appendChild(el('span', null, w.n ? String(w.n) : ''));
      chart.appendChild(b);
    });
    var v = $('versions'); v.textContent = '';
    if (!s.versions.length) v.appendChild(el('div', 'muted', 'Nobody yet'));
    s.versions.forEach(function (x) { var d = el('div'); d.appendChild(el('span', null, x.version)); d.appendChild(el('span', 'muted', x.n + (x.n === 1 ? ' person' : ' people'))); v.appendChild(d); });
  }

  function dialog(title, body, buttons) {
    var o = el('div', 'overlay'); var d = el('div', 'dialog');
    d.appendChild(el('h2', null, title)); body.forEach(function (n) { d.appendChild(n); });
    var bar = el('div', 'tools'); bar.style.marginTop = '14px';
    var close = function () { o.remove(); };
    (buttons || [['Close', close, true]]).forEach(function (b) { var x = el('button', b[2] ? 'primary' : '', b[0]); x.type = 'button'; x.onclick = function () { b[1](close); }; bar.appendChild(x); });
    d.appendChild(bar); o.appendChild(d); o.onclick = function (e) { if (e.target === o) close(); };
    document.body.appendChild(o);
    return close;
  }
  function failed(e) { if (e.twoStep) twoStep(); else alert(e.message); }

  function action(label, fn, cls) { var b = el('button', cls || '', label); b.type = 'button'; b.onclick = fn; return b; }
  function renderUsers(users) {
    var tb = $('users'); tb.textContent = '';
    $('count').textContent = users.length + (users.length === 1 ? ' account' : ' accounts') + (users.length === 500 ? ' (first 500; search to narrow)' : '');
    users.forEach(function (u) {
      var tr = el('tr', u.disabled ? 'off' : '');
      var name = el('td'); name.appendChild(el('strong', null, u.name + ' '));
      if (u.isAdmin) name.appendChild(el('span', 'pill admin', 'admin'));
      if (u.disabled) name.appendChild(el('span', 'pill off', 'switched off'));
      tr.appendChild(name);
      tr.appendChild(el('td', null, u.email));
      tr.appendChild(el('td', 'muted', new Date(u.createdAt).toLocaleDateString()));
      tr.appendChild(el('td', 'muted', when(u.lastSeen) + (u.devices ? ' · ' + u.devices + (u.devices === 1 ? ' device' : ' devices') : '')));
      tr.appendChild(el('td', 'muted', u.appVersion || '—'));
      tr.appendChild(el('td', 'muted', u.owned + ' owned · ' + u.sharedWith + ' shared with them'));
      var a = el('td', 'actions');
      a.appendChild(action('One-time code', function () {
        api('POST', '/api/admin/users/' + u.id + '/reset-code').then(function (r) {
          var code = r.code.slice(0, 5) + '-' + r.code.slice(5);
          dialog('One-time code for ' + u.name, [
            el('p', 'muted', 'Give this to ' + u.email + ' (it works once, until ' + new Date(r.expiresAt).toLocaleString() + '):'),
            el('div', 'code', code),
            el('p', 'small', 'In the app: Sign in → Forgot password? → enter their email, this code and a new password. Making a new code cancels this one.'),
          ]);
          loadLog();
        }).catch(failed);
      }));
      a.appendChild(action('Sign out everywhere', function () {
        if (!confirm('Sign ' + u.name + ' out on every device?')) return;
        api('POST', '/api/admin/users/' + u.id + '/signout').then(load).catch(failed);
      }));
      a.appendChild(action('Edit', function () {
        var name = prompt('Name', u.name); if (name == null) return;
        var email = prompt('Email', u.email); if (email == null) return;
        api('PATCH', '/api/admin/users/' + u.id, { name: name, email: email }).then(load).catch(failed);
      }));
      if (!u.isAdmin) {
        a.appendChild(action(u.disabled ? 'Switch on' : 'Switch off', function () {
          if (!u.disabled && !confirm('Switch off ' + u.name + "'s account? They're signed out and can't sign in until you switch it on again.")) return;
          api('POST', '/api/admin/users/' + u.id + '/disable', { disabled: !u.disabled }).then(load).catch(failed);
        }));
        a.appendChild(action('Delete', function () {
          if (!confirm('Delete ' + u.name + ' (' + u.email + ')? This can\\'t be undone.')) return;
          api('DELETE', '/api/admin/users/' + u.id).then(load).catch(failed);
        }, 'danger'));
      }
      tr.appendChild(a);
      tb.appendChild(tr);
    });
  }

  // ---- Backups: one row per document, with its copies in a dialog ----
  function renderBackups() {
    var q = $('backupSearch').value.trim().toLowerCase();
    var docs = [], byId = {};
    backupRows.forEach(function (b) {
      var d = byId[b.projectId];
      if (!d) { d = byId[b.projectId] = { id: b.projectId, title: b.title, kind: b.kind, deleted: b.deleted, copies: [] }; docs.push(d); }
      d.copies.push(b);
    });
    var shown = docs.filter(function (d) { return !q || d.title.toLowerCase().indexOf(q) >= 0; });
    $('backupCount').textContent = docs.length + (docs.length === 1 ? ' document' : ' documents');
    var tb = $('backups'); tb.textContent = '';
    if (!shown.length) { var tr0 = el('tr'); var td0 = el('td', 'muted', docs.length ? 'No matches.' : 'No backups yet. They start with the next change to each document (or press "Back up everything now").'); td0.colSpan = 6; tr0.appendChild(td0); tb.appendChild(tr0); }
    shown.forEach(function (d) {
      var tr = el('tr');
      tr.appendChild(el('td', null, d.title));
      tr.appendChild(el('td', 'muted', KINDS[d.kind] || d.kind));
      var st = el('td'); st.appendChild(el('span', 'pill ' + (d.deleted ? 'off' : 'ok'), d.deleted ? 'deleted' : 'in use')); tr.appendChild(st);
      tr.appendChild(el('td', 'muted', String(d.copies.length)));
      tr.appendChild(el('td', 'muted', stamp(d.copies[0].takenAt)));
      var a = el('td', 'actions');
      a.appendChild(action('Copies…', function () { copiesDialog(d); }));
      tr.appendChild(a);
      tb.appendChild(tr);
    });
  }
  function copiesDialog(d) {
    var list = el('table');
    var close;
    d.copies.forEach(function (b) {
      var tr = el('tr');
      tr.appendChild(el('td', null, stamp(b.takenAt)));
      tr.appendChild(el('td', 'muted', size(b.size)));
      var a = el('td', 'actions');
      a.appendChild(action('Download', function () { download('/api/admin/backups/' + b.id, 'backup.json').then(loadLog).catch(failed); }));
      a.appendChild(action(d.deleted ? 'Bring back' : 'Restore', function () {
        var msg = d.deleted
          ? 'Bring back "' + d.title + '" as it was on ' + stamp(b.takenAt) + '? Its people get it back too.'
          : 'Put "' + d.title + '" back to how it was on ' + stamp(b.takenAt) + '? Everyone with it open sees the change straight away. A copy of how it is now is kept first.';
        if (!confirm(msg)) return;
        api('POST', '/api/admin/backups/' + b.id + '/restore').then(function () { close(); alert('Restored.'); load(); }).catch(failed);
      }, 'primary'));
      tr.appendChild(a);
      list.appendChild(tr);
    });
    close = dialog(d.title + ' · ' + (KINDS[d.kind] || d.kind), [el('p', 'muted small', d.deleted ? 'This document was deleted. Bringing it back puts it where it was (a document inside a production needs the production to be there).' : 'Copies taken before the first change of each day, newest first.'), list]);
  }

  function loadLog() {
    return api('GET', '/api/admin/log').then(function (r) {
      var tb = $('log'); tb.textContent = '';
      if (!r.log.length) { var tr0 = el('tr'); var td0 = el('td', 'muted', 'Nothing yet.'); td0.colSpan = 5; tr0.appendChild(td0); tb.appendChild(tr0); }
      r.log.forEach(function (x) {
        var tr = el('tr');
        tr.appendChild(el('td', 'muted', stamp(x.at)));
        tr.appendChild(el('td', 'muted', x.admin));
        tr.appendChild(el('td', null, x.action));
        tr.appendChild(el('td', null, x.target || ''));
        tr.appendChild(el('td', 'muted', x.detail || ''));
        tb.appendChild(tr);
      });
    });
  }

  var searchTimer = null;
  function loadUsers() {
    return api('GET', '/api/admin/users?q=' + encodeURIComponent($('search').value.trim())).then(function (r) { renderUsers(r.users); });
  }
  function loadBackups() {
    return api('GET', '/api/admin/backups').then(function (r) { backupRows = r.backups; renderBackups(); });
  }
  function load() {
    return Promise.all([api('GET', '/api/admin/stats').then(renderStats), loadUsers(), loadBackups(), loadLog()]).then(function () {
      show('dash');
    }).catch(function (e) {
      if (e.status === 401) { setToken(null); showLogin(); }
      else if (e.twoStep) twoStep();
      else if (e.status === 403) { setToken(null); showLogin("That account isn't an admin."); }
      else $('fatal').textContent = e.message;
    });
  }

  $('login').addEventListener('submit', function (e) {
    e.preventDefault();
    $('loginError').textContent = '';
    api('POST', '/api/login', { email: $('email').value, password: $('password').value }).then(function (r) {
      setToken(r.token); $('password').value = '';
      return twoStep();
    }).catch(function (err) { $('loginError').textContent = err.message; });
  });
  $('setup').addEventListener('submit', function (e) {
    e.preventDefault();
    $('setupError').textContent = '';
    api('POST', '/api/admin/2fa/enable', { code: $('setupCode').value }).then(load).catch(function (err) { $('setupError').textContent = err.message; });
  });
  $('verify').addEventListener('submit', function (e) {
    e.preventDefault();
    $('verifyError').textContent = '';
    api('POST', '/api/admin/2fa/verify', { code: $('verifyCode').value }).then(load).catch(function (err) { $('verifyError').textContent = err.message; });
  });
  $('signout').addEventListener('click', function () {
    api('POST', '/api/logout').catch(function () {}).then(function () { setToken(null); showLogin(); });
  });
  $('refresh').addEventListener('click', load);
  $('search').addEventListener('input', function () { clearTimeout(searchTimer); searchTimer = setTimeout(loadUsers, 250); });
  $('backupSearch').addEventListener('input', renderBackups);
  $('backupNow').addEventListener('click', function () {
    var b = $('backupNow'); b.disabled = true; b.textContent = 'Backing up…';
    api('POST', '/api/admin/backups/now').then(function (r) { alert('Backed up ' + r.count + ' document' + (r.count === 1 ? '' : 's') + '.'); return load(); })
      .catch(failed).then(function () { b.disabled = false; b.textContent = 'Back up everything now'; });
  });
  $('exportAll').addEventListener('click', function () {
    var b = $('exportAll'); b.disabled = true;
    download('/api/admin/export', 'production-hub.json').then(loadLog).catch(failed).then(function () { b.disabled = false; });
  });

  if (token) twoStep(); else showLogin();
})();
</script>
</body>
</html>`;
