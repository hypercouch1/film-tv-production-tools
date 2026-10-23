// Run: node tests/mail.test.js
// Sending from Gmail (mail.js) against a stand-in Google, and the email layouts.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createMailer, buildMime } = require('../mail.js');
require('../src/mail-templates.js');
const T = globalThis.MailTemplates;

const decodeParts = (raw) => [...raw.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/g)].map((m) => Buffer.from(m[1].replace(/\r\n/g, ''), 'base64').toString('utf8'));

(async () => {
  // ---- The message ----
  const raw = buildMime({ from: 'me@gmail.com', fromName: 'Alice Moreno', to: 'ana@example.com', toName: 'Ana Ruiz', replyTo: 'me@gmail.com', subject: 'Call sheet: Día 1 · 7:00 AM', text: 'Hola', html: '<p>Hola</p>' });
  assert.match(raw, /^From: "Alice Moreno" <me@gmail\.com>\r\nTo: "Ana Ruiz" <ana@example\.com>\r\nReply-To: me@gmail\.com\r\n/);
  assert.match(raw, /Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=\r\n/, 'non-ASCII subjects are encoded');
  assert.deepStrictEqual(decodeParts(raw), ['Hola', '<p>Hola</p>']);
  const sneaky = buildMime({ from: 'me@gmail.com', to: 'ana@example.com', subject: 'Hi\r\nBcc: everyone@example.com', text: '', html: '' });
  assert.ok(!/\r\nBcc:/.test(sneaky), 'no extra headers through the subject');
  assert.throws(() => buildMime({ from: 'me@gmail.com', to: 'ana@example.com\r\nBcc: x@y.z', subject: 's' }), /Not an email address/);
  assert.throws(() => buildMime({ from: 'me@gmail.com', to: 'not an address', subject: 's' }), /Not an email address/);
  console.log('  ✓ MIME message: encoded subject and names, both versions, no header injection');

  // ---- Connecting and sending, with a stand-in Google ----
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-mail-'));
  const calls = [];
  const sent = [];
  const fakeFetch = async (url, opts = {}) => {
    calls.push(url);
    const body = opts.body ? (typeof opts.body === 'string' ? opts.body : '') : '';
    const reply = (status, data) => ({ ok: status < 300, status, json: async () => data });
    if (url.startsWith('https://g/token')) {
      const p = new URLSearchParams(body);
      if (p.get('grant_type') === 'authorization_code') {
        assert.strictEqual(p.get('code'), 'the-code');
        assert.ok(p.get('code_verifier') && p.get('redirect_uri').startsWith('http://127.0.0.1:'), 'PKCE and the loopback address');
        const idToken = 'x.' + Buffer.from(JSON.stringify({ email: 'alice@gmail.com', name: 'Alice Moreno' })).toString('base64url') + '.y';
        return reply(200, { access_token: 'at1', refresh_token: 'rt-secret', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/gmail.send', id_token: idToken });
      }
      if (p.get('refresh_token') === 'rt-secret') return reply(200, { access_token: 'at2', expires_in: 3600 });
      return reply(400, { error: 'invalid_grant' });
    }
    if (url.startsWith('https://g/send')) {
      assert.match(opts.headers.Authorization, /^Bearer at\d$/);
      const { raw: r } = JSON.parse(opts.body);
      const text = Buffer.from(r, 'base64url').toString('utf8');
      if (/To: .*bounce@example\.com/.test(text)) return reply(400, { error: { message: 'Invalid To header' } });
      sent.push(text);
      return reply(200, { id: 'm1' });
    }
    if (url.startsWith('https://g/revoke')) return reply(200, {});
    throw new Error('unexpected ' + url);
  };
  // The "browser": follows the sign-in link back to the app, as Google would after consent.
  const browser = (authUrl) => {
    const u = new URL(authUrl);
    assert.strictEqual(u.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(u.searchParams.get('scope').includes('gmail.send') && !u.searchParams.get('scope').includes('gmail.readonly'), 'only the send permission');
    const back = new URL(u.searchParams.get('redirect_uri'));
    back.searchParams.set('code', 'the-code');
    back.searchParams.set('state', u.searchParams.get('state'));
    http.get(back.toString(), (res) => res.resume());
  };
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('ENC:' + [...s].reverse().join('')),
    decryptString: (b) => [...b.toString().slice(4)].reverse().join(''),
  };
  const mailer = createMailer({
    dir, safeStorage, fetch: fakeFetch, openExternal: browser, config: { clientId: 'cid', clientSecret: 'cs' },
    endpoints: { auth: 'https://g/auth', token: 'https://g/token', revoke: 'https://g/revoke', send: 'https://g/send' },
  });
  assert.deepStrictEqual([mailer.status().configured, mailer.status().connected], [true, false]);
  const st = await mailer.connect();
  assert.deepStrictEqual([st.connected, st.email], [true, 'alice@gmail.com']);
  const onDisk = fs.readFileSync(path.join(dir, 'mail.json'), 'utf8');
  assert.ok(!onDisk.includes('rt-secret') && JSON.parse(onDisk).encrypted, 'the Gmail key is stored encrypted');
  console.log('  ✓ connect: browser sign-in, PKCE, send-only permission, key kept encrypted');

  const results = await mailer.send([
    { to: 'ana@example.com', toName: 'Ana', subject: 'Call sheet', text: 't', html: '<b>h</b>' },
    { to: 'bounce@example.com', subject: 'x', text: 't', html: 'h' },
    { to: 'no address', subject: 'x', text: 't', html: 'h' },
  ]);
  assert.deepStrictEqual(results.map((r) => r.ok), [true, false, false], 'each message has its own result');
  assert.match(results[1].error, /Invalid To/);
  assert.match(sent[0], /From: "Alice Moreno" <alice@gmail\.com>/, 'sent as the connected account');
  console.log('  ✓ send: as the connected account, one result per message');

  await mailer.disconnect();
  assert.strictEqual(mailer.status().connected, false);
  assert.ok(calls.some((c) => c.startsWith('https://g/revoke?token=rt-secret')), 'the key is revoked at Google');
  const after = await mailer.send([{ to: 'ana@example.com', subject: 's', text: 't', html: 'h' }]);
  assert.match(after[0].error, /Connect your Google account/);
  const unset = createMailer({ dir, safeStorage, fetch: fakeFetch, openExternal: () => {}, config: {} });
  assert.strictEqual(unset.status().configured, false);
  await assert.rejects(unset.connect(), /isn’t set up/);
  console.log('  ✓ disconnect revokes the key; not set up says so');

  // ---- The emails ----
  assert.strictEqual(T.emailIn('Ana · 555-0100 · ana.ruiz@example.co.uk'), 'ana.ruiz@example.co.uk');
  assert.strictEqual(T.emailIn('555-0100'), '');
  const cs = T.callSheet({
    production: 'Night <Diner>', dayNum: 1, of: 2, dateLong: 'Thursday, October 29', dateShort: 'Thu, Oct 29',
    person: { name: 'Ana Ruiz', role: 'Maya', cast: true }, call: '7:00 AM', location: "Rosie's Diner\n214 4th St", mapsUrl: 'https://maps.example/?q=x',
    crewCall: '6:30 AM', shootingCall: '7:30 AM', wrap: '7:00 PM', weather: 'Rain', parking: 'Lot', hospital: "St Mary's", notes: 'Bring <layers>',
    scenes: [{ code: '1', heading: 'EXT. DINER - NIGHT', synopsis: 'Maya crosses', pages: '1 2/8 pages' }],
    link: 'https://film.example/c/ABC', appleCal: 'webcal://film.example/c/ABC/calendar.ics', googleCal: 'https://calendar.google.com/x', sender: 'Alice',
  });
  assert.strictEqual(cs.subject, 'Call sheet: Night <Diner>, Day 1, Thu, Oct 29 · Your call 7:00 AM');
  assert.ok(cs.html.includes('NIGHT &lt;DINER&gt;') && cs.html.includes('Bring &lt;layers&gt;') && !cs.html.includes('<layers>'), 'text is escaped');
  assert.ok(cs.html.includes('href="https://film.example/c/ABC"') && cs.html.includes("Rosie&#39;s Diner<br>214 4th St"));
  assert.ok(cs.text.includes('YOUR CALL: 7:00 AM') && cs.text.includes('https://film.example/c/ABC') && cs.text.includes('1  EXT. DINER - NIGHT (1 2/8 pages)'));
  const av = T.availability({ production: 'Night Diner', person: { name: 'Sam Lee', role: 'Gaffer' }, from: 'Nov 1', to: 'Nov 30', link: 'https://film.example/a/XYZ', sender: 'Alice' });
  assert.ok(av.subject.includes('Nov 1 – Nov 30') && av.html.includes('href="https://film.example/a/XYZ"') && av.text.startsWith('Hi Sam,'));
  console.log('  ✓ call sheet and availability emails: escaped, links, plain-text version');
  console.log('mail: all checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
