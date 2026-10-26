// Run: node tests/readaloud.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
require('../src/readaloud-core.js');
const R = globalThis.ReadAloudCore;
const { createVoices, MODEL_FILE, MODEL_BYTES } = require('../tts.js');

const els = [
  { id: 'h1', type: 'heading', text: 'INT. NIGHT DINER - NIGHT' },
  { id: 'a1', type: 'action', text: 'MAYA (30s) wipes the counter -- slowly. FRANK watches.' },
  { id: 'c1', type: 'character', text: 'MAYA (V.O.)' },
  { id: 'p1', type: 'parenthetical', text: '(quietly)' },
  { id: 'd1', type: 'dialogue', text: "We're closed, Frank... (beat) Go HOME." },
  { id: 'c2', type: 'character', text: 'FRANK' },
  { id: 'd2', type: 'dialogue', text: 'Not tonight.' },
  { id: 't1', type: 'transition', text: 'CUT TO:' },
  { id: 'h2', type: 'heading', text: 'EXT. PARKING LOT - CONTINUOUS' },
  { id: 'c3', type: 'character', text: "MAYA (CONT'D)" },
  { id: 'd3', type: 'dialogue', text: 'Wait.' },
];

assert.strictEqual(R.sayHeading('INT. NIGHT DINER - NIGHT'), 'Interior. Night Diner. Night.');
assert.strictEqual(R.sayHeading('EXT./INT. CAR - MOVING - DAY'), 'Exterior, interior. Car. Moving. Day.');
assert.strictEqual(R.sayHeading('.FLASHBACK'), 'Flashback.');
assert.strictEqual(R.sayTransition('CUT TO:'), 'Cut to.');
assert.strictEqual(R.sayable('MAYA (30s) wipes the counter -- slowly. OK, FBI.'), 'Maya (30s) wipes the counter, slowly. OK, FBI.', 'long shouted words read as words; short ones stay');
console.log('  ✓ headings, transitions and action read naturally');

const q = R.readingQueue(els);
assert.deepStrictEqual(q.map((x) => [x.id, x.speaker]), [['h1', ''], ['a1', ''], ['d1', 'MAYA'], ['d2', 'FRANK'], ['t1', ''], ['h2', ''], ['d3', 'MAYA']]);
assert.strictEqual(q[2].text, "We're closed, Frank… Go Home.", 'parentheticals inside dialogue are skipped');
assert.deepStrictEqual(R.readingQueue(els, { narrate: false }).map((x) => x.id), ['d1', 'd2', 'd3'], 'dialogue only');
assert.deepStrictEqual(R.readingQueue(els, { from: 'd2' }).map((x) => x.id)[0], 'd2');
assert.deepStrictEqual(R.readingQueue(els, { from: 'p1', narrate: false }).map((x) => [x.id, x.speaker])[0], ['d1', 'MAYA'], 'starting inside a speech finds its speaker');
assert.deepStrictEqual(R.readingQueue(els, { from: 'a1', sceneOnly: true }).map((x) => x.id), ['a1', 'd1', 'd2', 't1'], 'stops at the next scene');
assert.deepStrictEqual(R.readingQueue([{ id: 'x', type: 'dialogue', text: 'Orphan line' }]), [], 'dialogue with no character is skipped');
console.log('  ✓ reading queue');

const long = 'One two three four five. '.repeat(30);
const parts = R.pieces(long);
assert.ok(parts.length > 1 && parts.every((p) => p.length <= 220), 'long text splits');
assert.strictEqual(parts.join(' ').replace(/\s+/g, ' '), long.trim(), 'nothing lost');
const run = 'word, '.repeat(100);
assert.ok(R.pieces(run).every((p) => p.length <= 220), 'a sentence with no full stops splits at commas');
assert.ok(R.pieces('a '.repeat(400)).every((p) => p.length <= 220), 'or words');
const longLine = R.readingQueue([{ id: 'a', type: 'action', text: long }]);
assert.deepStrictEqual(longLine.map((x) => x.first), [true, ...Array(longLine.length - 1).fill(false)]);
console.log('  ✓ long lines split into pieces');

assert.strictEqual(R.guessGender('MAYA'), 'f');
assert.strictEqual(R.guessGender('OLD FRANK'), 'm');
assert.strictEqual(R.guessGender('MRS. HENDERSON'), 'f');
assert.strictEqual(R.guessGender('ZORG'), null);
const cast = R.castVoices(['MAYA', 'FRANK', 'ZORG', 'GLORP', 'SARAH']);
assert.strictEqual(cast[''], R.NARRATOR, 'a narrator');
assert.strictEqual(R.voice(cast.MAYA).gender, 'f');
assert.strictEqual(R.voice(cast.FRANK).gender, 'm');
assert.notStrictEqual(R.voice(cast.ZORG).gender, R.voice(cast.GLORP).gender, 'unknown names alternate');
assert.strictEqual(new Set(Object.values(cast)).size, 6, 'everyone sounds different');
assert.deepStrictEqual(R.castVoices(['MAYA', 'FRANK'], { MAYA: 'bf_emma', '': 'af_sky' }).MAYA, 'bf_emma', 'choices are kept');
assert.strictEqual(R.castVoices(['MAYA'], { MAYA: 'nonsense' }).MAYA, 'af_heart', 'unknown voices are replaced');
const big = R.castVoices(Array.from({ length: 40 }, (_, i) => 'WOMAN ' + i));
assert.ok(Object.values(big).every((v) => R.voice(v)), 'a big cast still gets real voices');
assert.ok(R.speakingSeconds('Not tonight.') >= 2 && R.speakingSeconds(long) > 20);
console.log('  ✓ casting voices');

(async () => {
  // tts.js with a stand-in voice process.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-tts-'));
  const sent = [];
  let child;
  const fork = () => {
    child = new EventEmitter();
    child.postMessage = (m) => {
      sent.push(m);
      if (m.type === 'load') setTimeout(() => { child.emit('message', { id: m.id, progress: { loaded: 1, total: 2 } }); child.emit('message', { id: m.id, result: true }); }, 5);
      if (m.type === 'speak') setTimeout(() => child.emit('message', m.text === 'fail' ? { id: m.id, error: 'nope' } : { id: m.id, result: { audio: new Float32Array(3), rate: 24000 } }), 5);
    };
    child.kill = () => child.emit('exit');
    return child;
  };
  const v = createVoices({ dir, fork, workerPath: 'x', idleMs: 30 });
  assert.deepStrictEqual(v.status(), { downloaded: false, bytes: MODEL_BYTES });
  await assert.rejects(v.speak(1, { text: 'hi' }), /downloaded/, 'no speech before the download');
  const progress = [];
  assert.strictEqual(await v.prepare(1, (p) => progress.push(p)), true);
  assert.deepStrictEqual(progress, [{ loaded: 1, total: 2 }]);
  assert.deepStrictEqual(sent[0], { type: 'init', cacheDir: path.join(dir, 'voices') });
  assert.strictEqual(sent[1].download, true);
  fs.mkdirSync(path.dirname(path.join(dir, 'voices', MODEL_FILE)), { recursive: true });
  fs.writeFileSync(path.join(dir, 'voices', MODEL_FILE), Buffer.alloc(MODEL_BYTES));
  assert.strictEqual(v.status().downloaded, true);
  const r = await v.speak(1, { text: 'hello', voice: 'am_puck', speed: '1.2' });
  assert.strictEqual(r.rate, 24000);
  assert.deepStrictEqual([sent.at(-1).voice, sent.at(-1).speed], ['am_puck', 1.2]);
  await assert.rejects(v.speak(1, { text: 'fail' }), /nope/);
  v.cancel(7);
  assert.deepStrictEqual(sent.at(-1), { type: 'cancel', owner: 7 });
  // Idle: the process stops, and a stopped process fails what was waiting.
  let exited = false; child.on('exit', () => (exited = true));
  await new Promise((res) => setTimeout(res, 60));
  assert.ok(exited, 'stops when idle');
  const first = child;
  const again = v.speak(1, { text: 'hello' });
  assert.notStrictEqual(child, first, 'restarts when needed');
  await again;
  child.postMessage = () => {};
  const stuck = v.speak(1, { text: 'x' });
  v.stop();
  await assert.rejects(stuck, /stopped/);
  await v.remove();
  assert.strictEqual(fs.existsSync(path.join(dir, 'voices')), false, 'removed');
  console.log('  ✓ voice process (tts.js)');
  console.log('readaloud: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
