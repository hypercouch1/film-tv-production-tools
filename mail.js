// Sending email from the person's own Gmail account (call sheets, availability requests).
// They connect once: Google's sign-in opens in their browser and asks for one permission,
// sending email (the app can't read their mail). The refresh token is kept on this computer
// only, encrypted with the system's secure storage (safeStorage), and messages go straight
// from here to Gmail.
//
// Google sign-in for installed apps: a loopback redirect (http://127.0.0.1:<port>) with PKCE.
// The "Desktop app" client id and secret come from mail-config.json (see the README); for
// installed apps the secret isn't secret, Google just requires it.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.send'];
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_PER_SEND = 200;

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const validEmail = (e) => typeof e === 'string' && e.length <= 200 && /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(e);
const oneLine = (s, max = 300) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').slice(0, max);
// A header value with non-ASCII text (RFC 2047).
const encodeWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const wrap76 = (s) => s.replace(/.{1,76}/g, '$&\r\n').trimEnd();

// One email as a MIME message (plain text and HTML versions).
function buildMime({ from, fromName, to, toName, replyTo, subject, text, html }) {
  if (!validEmail(to)) throw new Error(`Not an email address: ${oneLine(to, 80)}`);
  const boundary = 'pt-' + crypto.randomBytes(12).toString('hex');
  const addr = (name, email) => (name ? `"${encodeWord(oneLine(name, 100).replace(/["\\]/g, ''))}" <${email}>` : `<${email}>`);
  const lines = [
    `From: ${addr(fromName, from)}`,
    `To: ${addr(toName, to)}`,
    ...(replyTo && validEmail(replyTo) ? [`Reply-To: ${replyTo}`] : []),
    `Subject: ${encodeWord(oneLine(subject, 250))}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(String(text || ''), 'utf8').toString('base64')),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(String(html || ''), 'utf8').toString('base64')),
    `--${boundary}--`,
    '',
  ];
  return lines.join('\r\n');
}

// The email address in an id_token (it comes straight from Google's token endpoint over
// HTTPS, so its signature doesn't need checking here).
function idTokenClaims(idToken) {
  try { return JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64').toString('utf8')); } catch { return {}; }
}

// deps: { dir (where the token file lives), safeStorage, fetch, openExternal, config:
// { clientId, clientSecret }, endpoints (tests only) }
function createMailer({ dir, safeStorage, fetch, openExternal, config, endpoints = {} }) {
  const ep = {
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    revoke: 'https://oauth2.googleapis.com/revoke',
    send: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    ...endpoints,
  };
  const file = path.join(dir, 'mail.json');
  let access = null; // { token, expires }
  let pending = null; // a sign-in in progress

  const configured = () => !!(config && config.clientId && config.clientSecret);
  function load() {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  }
  function refreshToken() {
    const saved = load();
    if (!saved || !saved.token) return null;
    try {
      return saved.encrypted ? safeStorage.decryptString(Buffer.from(saved.token, 'base64')) : saved.token;
    } catch { return null; }
  }
  function save(account, token) {
    const encrypted = safeStorage.isEncryptionAvailable();
    const stored = encrypted ? safeStorage.encryptString(token).toString('base64') : token;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ provider: 'google', email: account.email, name: account.name, encrypted, token: stored }, null, 2), { mode: 0o600 });
  }

  function status() {
    const saved = load();
    return { configured: configured(), connected: !!(saved && saved.email && refreshToken()), email: saved ? saved.email : null, name: saved ? saved.name : null, provider: 'google' };
  }

  async function tokenRequest(params) {
    const res = await fetch(ep.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error === 'invalid_grant' ? 'Gmail access was removed. Connect your Google account again.' : `Google refused the request (${data.error || res.status}).`);
      err.code = data.error;
      throw err;
    }
    return data;
  }

  // Opens Google's sign-in in the browser and waits for it to come back to this computer.
  function connect() {
    if (!configured()) return Promise.reject(new Error('Gmail sending isn’t set up in this copy of the app (no Google client id in mail-config.json).'));
    if (pending) pending.cancel(new Error('Started again.'));
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    return new Promise((resolve, reject) => {
      let done = false;
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname !== '/') { res.writeHead(404); res.end(); return; }
        const page = (title, text) => {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
          res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui,sans-serif;background:#16130f;color:#ece9e4;display:grid;place-items:center;height:90vh;margin:0"><div style="text-align:center"><h1 style="font-size:24px">${title}</h1><p>${text}</p></div>`);
        };
        if (url.searchParams.get('state') !== state) { page('Something went wrong', 'Please try connecting again from the app.'); return; }
        if (url.searchParams.get('error')) {
          page('Not connected', 'You can close this tab and go back to Production Tools.');
          finish(new Error(url.searchParams.get('error') === 'access_denied' ? 'Gmail wasn’t connected (permission not given).' : 'Google sign-in failed.'));
          return;
        }
        try {
          const port = server.address().port;
          const tokens = await tokenRequest({
            code: url.searchParams.get('code') || '', client_id: config.clientId, client_secret: config.clientSecret,
            redirect_uri: `http://127.0.0.1:${port}`, grant_type: 'authorization_code', code_verifier: verifier,
          });
          if (!tokens.refresh_token) throw new Error('Google didn’t give the app ongoing access. Try connecting again.');
          if (!String(tokens.scope || '').includes('gmail.send')) throw new Error('The “send email” permission wasn’t ticked. Connect again and allow it.');
          const claims = idTokenClaims(tokens.id_token);
          const account = { email: claims.email || '', name: claims.name || '' };
          if (!validEmail(account.email)) throw new Error('Couldn’t tell which Google account this is.');
          save(account, tokens.refresh_token);
          access = { token: tokens.access_token, expires: Date.now() + (Number(tokens.expires_in) || 3000) * 1000 - 60000 };
          page('Gmail connected', `Production Tools can now send email as ${account.email.replace(/[<>&"]/g, '')}. You can close this tab.`);
          finish(null, status());
        } catch (err) {
          page('Not connected', 'Something went wrong. Go back to Production Tools to see why.');
          finish(err);
        }
      });
      const timer = setTimeout(() => finish(new Error('Google sign-in took too long. Try again.')), SIGN_IN_TIMEOUT_MS);
      function finish(err, value) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        pending = null;
        setTimeout(() => server.close(), 500);
        if (err) reject(err); else resolve(value);
      }
      pending = { cancel: (err) => finish(err) };
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const q = new URLSearchParams({
          client_id: config.clientId, redirect_uri: `http://127.0.0.1:${port}`, response_type: 'code', scope: SCOPES.join(' '),
          code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent',
        });
        openExternal(`${ep.auth}?${q}`);
      });
    });
  }

  async function disconnect() {
    const token = refreshToken();
    access = null;
    try { fs.unlinkSync(file); } catch { /* not connected */ }
    if (token) {
      try { await fetch(`${ep.revoke}?token=${encodeURIComponent(token)}`, { method: 'POST' }); } catch { /* offline: the token is gone from here anyway */ }
    }
    return status();
  }

  async function accessToken() {
    if (access && access.expires > Date.now()) return access.token;
    const token = refreshToken();
    if (!token) throw new Error('Connect your Google account first (Account → Connect Gmail).');
    try {
      const t = await tokenRequest({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: token, grant_type: 'refresh_token' });
      access = { token: t.access_token, expires: Date.now() + (Number(t.expires_in) || 3000) * 1000 - 60000 };
      return access.token;
    } catch (err) {
      if (err.code === 'invalid_grant') { try { fs.unlinkSync(file); } catch { /* gone */ } }
      throw err;
    }
  }

  // messages: [{ to, toName, subject, text, html, replyTo }]. One at a time; each gets its
  // own result, so one bad address doesn't stop the rest.
  async function send(messages) {
    const list = (Array.isArray(messages) ? messages : []).slice(0, MAX_PER_SEND);
    const me = load();
    const results = [];
    for (const m of list) {
      try {
        const token = await accessToken();
        const raw = buildMime({ ...m, from: me && me.email, fromName: m.fromName || (me && me.name) });
        const res = await fetch(ep.send, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: b64url(Buffer.from(raw, 'utf8')) }) });
        if (res.status === 401) access = null;
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          const reason = data.error && data.error.message ? data.error.message : `Gmail error ${res.status}`;
          throw new Error(res.status === 429 ? 'Gmail’s sending limit was reached. Try again later.' : reason);
        }
        results.push({ to: m.to, ok: true });
      } catch (err) {
        results.push({ to: m.to, ok: false, error: err.message });
        if (/Connect your Google account|access was removed/.test(err.message)) {
          // Nothing else will go either.
          for (const rest of list.slice(results.length)) results.push({ to: rest.to, ok: false, error: err.message });
          break;
        }
      }
    }
    return results;
  }

  return { status, connect, disconnect, send };
}

module.exports = { createMailer, buildMime, validEmail };
