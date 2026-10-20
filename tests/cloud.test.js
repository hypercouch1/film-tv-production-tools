// Run: node tests/cloud.test.js
// Live connection keep-alive: a connection that stops answering (sleep, network change)
// is replaced, and coming back to the app checks the connection straight away.
const assert = require('assert');
const { mock } = require('node:test');

mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 });

// Just enough of a browser for cloud.js.
const listeners = {};
const on = (name, fn) => { (listeners[name] = listeners[name] || new Set()).add(fn); };
const off = (name, fn) => listeners[name] && listeners[name].delete(fn);
const fire = (name) => [...(listeners[name] || [])].forEach((fn) => fn());
globalThis.window = globalThis;
window.addEventListener = on;
window.removeEventListener = off;
globalThis.document = { visibilityState: 'visible', addEventListener: on, removeEventListener: off };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
window.APP_CONFIG = { serverUrl: 'https://hub.example.test' };
globalThis.fetch = async () => { throw new Error('offline'); };

const sockets = [];
class FakeSocket {
  constructor(url, protocols) {
    this.url = url; this.protocols = protocols; this.readyState = 0; this.sent = [];
    this.answers = true; // replies to pings
    sockets.push(this);
  }
  send(data) {
    this.sent.push(data);
    if (data === 'ping' && this.answers) queueMicrotask(() => this.onmessage && this.onmessage({ data: 'pong' }));
  }
  close() { this.readyState = 3; }
  open() {
    this.readyState = 1;
    this.onopen && this.onopen();
    this.onmessage({ data: JSON.stringify({ type: 'snapshot', doc: { title: 'T' }, clientId: 'c1', role: 'editor' }) });
  }
}
globalThis.WebSocket = FakeSocket;

require('../src/sync-core.js');
require('../src/cloud.js');

const flush = () => new Promise((r) => setImmediate(r));
const advance = async (ms) => { for (let t = 0; t < ms; t += 1000) { mock.timers.tick(1000); await flush(); } };

(async () => {
  const states = [];
  const session = window.Cloud.connect('p1', { onDoc() {}, getLocal: () => ({ title: 'T' }), onStatus: (s) => states.push(s) });
  await flush();
  assert.strictEqual(sockets.length, 1);
  assert.deepStrictEqual(sockets[0].protocols, ['production-tools', 'auth.'], 'token goes in a subprotocol');
  sockets[0].open();
  assert.strictEqual(session.state, 'live');

  // A healthy connection stays put.
  await advance(5 * 60_000);
  assert.strictEqual(sockets.length, 1, 'no reconnects while pings are answered');
  assert.ok(sockets[0].sent.filter((s) => s === 'ping').length >= 10);
  console.log('  ✓ a connection that answers pings is kept');

  // The connection dies silently: pings go unanswered. It's replaced within a minute.
  sockets[0].answers = false;
  await advance(60_000);
  assert.strictEqual(sockets.length, 2, 'silent connection replaced');
  assert.ok(states.includes('offline'));
  sockets[1].open();
  assert.strictEqual(session.state, 'live');
  console.log('  ✓ a connection that stops answering is replaced');

  // Coming back to the window checks at once (no waiting for the next ping).
  sockets[1].answers = false;
  await advance(1000);
  fire('focus');
  await advance(PONG_WAIT());
  assert.strictEqual(sockets.length, 3, 'focus found the dead connection');
  sockets[2].open();
  fire('focus'); // healthy: stays
  await advance(PONG_WAIT());
  assert.strictEqual(sockets.length, 3);
  console.log('  ✓ focusing the window checks the connection');

  // Network drops, the connection closes; when the network returns it reconnects now,
  // rather than after the retry delay.
  sockets[2].readyState = 3;
  sockets[2].onclose({ code: 1006 });
  assert.strictEqual(session.state, 'offline');
  fire('online');
  await flush();
  assert.strictEqual(sockets.length, 4, 'reconnects as soon as the network is back');
  console.log('  ✓ reconnects when the network comes back');

  // An attempt that never opens is abandoned and retried.
  await advance(20_000);
  assert.ok(sockets.length >= 5, 'hung connection attempt retried');
  sockets[sockets.length - 1].open();
  assert.strictEqual(session.state, 'live');
  console.log('  ✓ a connection attempt that hangs is retried');

  // Closing stops everything.
  session.close();
  const n = sockets.length;
  fire('focus'); fire('online');
  await advance(120_000);
  assert.strictEqual(sockets.length, n, 'closed sessions stay closed');
  console.log('cloud: all checks passed');
  mock.timers.reset();
})().catch((e) => { console.error(e); process.exit(1); });

function PONG_WAIT() { return 11_000; }
