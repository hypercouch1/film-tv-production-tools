// Read aloud: plays the script in natural voices (one per character, plus a narrator for
// headings and action), highlighting each line as it's read. Rehearse mode leaves a gap for
// the actor's own lines. Voices come from the main process (tts.js); see readaloud-core.js.
(function () {
  const { api, $, el, toast } = window.Common;
  const R = window.ReadAloudCore;
  const SPEEDS = [0.8, 0.9, 1, 1.1, 1.25, 1.5];

  // opts: { getDoc(), nodeOf(id), speakers(doc) → Map(name → { lines }),
  //         settings() → this production's { voices, speed, narrate, sceneOnly, rehearse }, save() }
  function attach(opts) {
    const tts = api.tts;
    let bar = null;
    let ctx = null;
    let source = null;
    let queue = [];
    let pos = 0;
    let run = 0;          // bumps on every start/stop, so old loops know to end
    let playing = false;  // reading (even while paused)
    let paused = false;
    let turn = null;      // rehearsal: { resolve, left } while waiting for the actor
    const cache = new Map(); // voice|speed|text → Promise<AudioBuffer>

    const settings = () => {
      const s = opts.settings();
      if (!s.voices) s.voices = {};
      if (!SPEEDS.includes(s.speed)) s.speed = 1;
      if (s.narrate === undefined) s.narrate = true;
      return s;
    };
    const cast = () => {
      const doc = opts.getDoc();
      return doc ? opts.speakers(doc) : new Map();
    };
    // Every character has a voice before anything is read.
    function voices() {
      const s = settings();
      const names = [...cast().keys()];
      const v = R.castVoices(names, s.voices);
      if (JSON.stringify(v) !== JSON.stringify(s.voices)) { s.voices = v; opts.save(); }
      return v;
    }

    // ---- Audio ----
    function audio() {
      if (!ctx) ctx = new AudioContext();
      return ctx;
    }
    function speech(text, voice, speed) {
      const key = `${voice}|${speed}|${text}`;
      if (!cache.has(key)) {
        const p = tts.speak({ text, voice, speed }).then(({ audio: samples, rate }) => {
          const data = samples instanceof Float32Array ? samples : new Float32Array(samples);
          const buf = audio().createBuffer(1, Math.max(1, data.length), rate);
          buf.copyToChannel(data, 0);
          return buf;
        });
        p.catch(() => cache.delete(key));
        cache.set(key, p);
        if (cache.size > 300) cache.delete(cache.keys().next().value);
      }
      return cache.get(key);
    }
    const voiceOf = (item, v) => v[item.speaker] || v[''];
    const rehearsing = (item) => !!item.speaker && item.speaker === settings().rehearse;
    function play(buf, mine) {
      return new Promise((resolve) => {
        const src = audio().createBufferSource();
        src.buffer = buf;
        src.connect(audio().destination);
        src.done = resolve;
        src.onended = () => { if (source === src) source = null; resolve(); };
        source = src;
        if (mine !== run) { resolve(); return; }
        src.start();
      });
    }
    function silence() {
      const src = source;
      if (!src) return;
      source = null;
      src.onended = null;
      try { src.stop(); } catch { /* not started */ }
      src.done();
    }
    // Rehearsal: wait about as long as the line takes to say (Space or ⏭ to go on sooner).
    function actorsTurn(item, mine) {
      return new Promise((resolve) => {
        let left = R.speakingSeconds(queue.filter((q) => q.id === item.id).map((q) => q.text).join(' '));
        turn = { resolve: () => { clearInterval(tick); turn = null; resolve(); } };
        const tick = setInterval(() => {
          if (mine !== run) { turn && turn.resolve(); return; }
          if (paused) return;
          left -= 0.1;
          setStatus(`Your line — say it now (${Math.max(0, Math.ceil(left))}s · Space to go on)`);
          if (left <= 0) turn.resolve();
        }, 100);
      });
    }

    // ---- Reading ----
    async function readFrom(i) {
      const mine = ++run;
      silence();
      playing = true; paused = false;
      if (ctx && ctx.state === 'suspended') await ctx.resume();
      const v = voices();
      const s = settings();
      pos = i;
      drawBar();
      while (pos < queue.length && mine === run) {
        const item = queue[pos];
        highlight(item);
        // This line first, then the next few get ready while it plays.
        const now = rehearsing(item) ? null : speech(item.text, voiceOf(item, v), s.speed);
        if (now) now.catch(() => {});
        for (let k = pos + 1; k < Math.min(queue.length, pos + 4); k++) {
          if (!rehearsing(queue[k])) speech(queue[k].text, voiceOf(queue[k], v), s.speed).catch(() => {});
        }
        if (!now) {
          if (item.first) await actorsTurn(item, mine);
        } else {
          setStatus(item.speaker ? R.speakerName(item.speaker) : 'Narrator');
          let buf;
          try { buf = await now; }
          catch (err) {
            if (mine !== run) return;
            toast('Couldn\'t read that line: ' + (err.message || err));
            stop();
            return;
          }
          if (mine !== run) return;
          await play(buf, mine);
        }
        if (mine !== run) return;
        pos++;
      }
      if (mine === run) { stop(); setStatus('Finished'); }
    }
    // Where to start: the line with the cursor (once the person has put it somewhere: opening
    // a script puts it at the end on its own), or else the first line showing.
    let placed = false;
    const mark = () => (placed = true);
    $('paper').addEventListener('mousedown', mark);
    $('paper').addEventListener('keydown', mark);
    $('sceneNav').addEventListener('click', mark);
    function startLine() {
      const a = document.activeElement;
      const node = placed && a && a.closest && a.closest('.el[data-item]');
      if (node) return node.dataset.item;
      const top = $('desk').getBoundingClientRect().top;
      const doc = opts.getDoc();
      const first = doc.elements.find((e) => { const n = opts.nodeOf(e.id); return n && n.getBoundingClientRect().bottom > top + 8; });
      return first ? first.id : null;
    }
    function start(from = startLine()) {
      const doc = opts.getDoc();
      if (!doc) return;
      const s = settings();
      queue = R.readingQueue(doc.elements, { from, narrate: s.narrate, sceneOnly: s.sceneOnly });
      if (!queue.length) { toast(s.narrate ? 'Nothing to read here.' : 'No dialogue to read from here.'); return; }
      tts.cancel();
      // Out of the text, so Space pauses (and moves rehearsal on) instead of typing.
      if (document.activeElement && document.activeElement.closest('#paper')) document.activeElement.blur();
      readFrom(0);
    }
    function stop() {
      run++;
      silence();
      if (turn) turn.resolve();
      tts.cancel();
      playing = false; paused = false;
      highlight(null);
      drawBar();
    }
    function pause() {
      if (!playing) return;
      paused = !paused;
      if (ctx) paused ? ctx.suspend() : ctx.resume();
      drawBar();
    }
    // Skip to the start of the next (or previous) line.
    function skip(dir) {
      if (!playing) return;
      if (dir > 0 && turn) { turn.resolve(); return; }
      let i = pos;
      const id = queue[pos] && queue[pos].id;
      if (dir > 0) { while (i < queue.length && queue[i].id === id) i++; }
      else {
        while (i > 0 && queue[i - 1].id === id) i--;
        if (i > 0) { const prev = queue[i - 1].id; i--; while (i > 0 && queue[i - 1].id === prev) i--; }
      }
      if (i >= queue.length) { stop(); return; }
      tts.cancel();
      readFrom(i);
    }
    let lit = null;
    function highlight(item) {
      if (lit) lit.classList.remove('reading', 'your-line');
      lit = item ? opts.nodeOf(item.id) : null;
      if (!lit) return;
      lit.classList.add('reading');
      if (rehearsing(item)) lit.classList.add('your-line');
      const r = lit.getBoundingClientRect();
      const desk = $('desk').getBoundingClientRect();
      if (r.top < desk.top + 40 || r.bottom > desk.bottom - 40) lit.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    // ---- The player bar ----
    let statusEl = null;
    const setStatus = (t) => { if (statusEl) statusEl.textContent = t; };
    function drawBar() {
      if (!bar) return;
      const s = settings();
      bar.innerHTML = '';
      const btn = (label, title, fn, extra = '') => el('button', { class: 'icon-btn ' + extra, title, onclick: fn }, label);
      const speed = el('select', { class: 'ra-select', title: 'Reading speed' }, ...SPEEDS.map((x) => el('option', { value: x }, x + '×')));
      speed.value = s.speed;
      speed.addEventListener('change', () => { s.speed = Number(speed.value); opts.save(); if (playing) readFrom(pos); });
      const rehearse = el('select', { class: 'ra-select', title: 'Rehearse: leave a gap for one character\'s lines so you can say them' },
        el('option', { value: '' }, 'Read every part'),
        ...[...cast().keys()].map((n) => el('option', { value: n }, 'Rehearse as ' + n)));
      rehearse.value = s.rehearse && cast().has(s.rehearse) ? s.rehearse : '';
      rehearse.addEventListener('change', () => { s.rehearse = rehearse.value || null; opts.save(); });
      const check = (key, label, title) => {
        const box = el('input', { type: 'checkbox' });
        box.checked = !!s[key];
        box.addEventListener('change', () => { s[key] = box.checked; opts.save(); if (playing) start(queue[pos] && queue[pos].id); });
        return el('label', { class: 'ra-check', title }, box, label);
      };
      statusEl = el('span', { class: 'ra-status' }, playing ? (paused ? 'Paused' : 'Reading…') : 'Reads from the cursor, or the top of the screen');
      bar.append(
        el('span', { class: 'ra-title' }, '🔊 Read aloud'),
        btn('⏮', 'Previous line', () => skip(-1)),
        playing
          ? btn(paused ? '▶' : '⏸', paused ? 'Carry on (Space)' : 'Pause (Space)', pause, 'ra-main')
          : btn('▶', 'Read from the cursor (Space)', begin, 'ra-main'),
        btn('⏭', 'Next line', () => skip(1)),
        btn('■', 'Stop (Esc)', stop),
        statusEl,
        el('span', { class: 'ra-spacer' }),
        check('narrate', 'Narrate action', 'Also read scene headings, action and transitions'),
        check('sceneOnly', 'This scene only', 'Stop at the end of the scene'),
        speed, rehearse,
        el('button', { class: 'ghost-btn', onclick: openVoices }, 'Voices…'),
        btn('✕', 'Close', close));
    }
    function onKey(e) {
      if (!bar) return;
      const typing = /^(TEXTAREA|INPUT|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
      if (document.querySelector('.modal-overlay')) return;
      if (e.key === 'Escape' && playing) { e.preventDefault(); stop(); }
      else if (e.key === ' ' && !typing) {
        e.preventDefault();
        if (turn) turn.resolve(); else if (playing) pause(); else begin();
      }
    }
    function open() {
      if (bar) return;
      bar = el('div', { class: 'ra-bar', role: 'toolbar', 'aria-label': 'Read aloud' });
      document.querySelector('.statusbar').before(bar);
      document.addEventListener('keydown', onKey);
      drawBar();
    }
    function close() {
      stop();
      document.removeEventListener('keydown', onKey);
      if (bar) bar.remove();
      bar = null;
    }

    // ---- First time: the one-time download ----
    let ready = false;
    let progressCb = null;
    if (tts) tts.onProgress((p) => progressCb && progressCb(p));
    async function ensureReady() {
      if (ready) return true;
      if (!tts) { toast('Reading aloud needs the desktop app.'); return false; }
      const status = await tts.status();
      if (status.downloaded) {
        setStatus('Warming up the voices…');
        try { await tts.prepare(); ready = true; return true; }
        catch (err) { toast('The voices didn\'t start: ' + (err.message || err)); return false; }
      }
      return new Promise((resolve) => {
        const mb = (n) => Math.round(n / 1e6);
        const bodyEl = el('div', {});
        const fill = el('div', { class: 'ra-progress-fill' });
        const line = el('p', { class: 'muted small' }, '');
        const go = el('button', { class: 'primary-btn wide', type: 'button' }, `Download voices (${mb(status.bytes)} MB)`);
        let done = false;
        const m = window.Common.modal('Natural voices', bodyEl);
        const finish = (ok) => { if (done) return; done = true; progressCb = null; m.close(); resolve(ok); };
        // Closing the dialog without downloading.
        const watch = new MutationObserver(() => { if (!bodyEl.isConnected) { watch.disconnect(); finish(false); } });
        watch.observe(document.body, { childList: true });
        go.addEventListener('click', async () => {
          go.disabled = true; go.textContent = 'Downloading…';
          bodyEl.append(el('div', { class: 'ra-progress' }, fill), line);
          progressCb = ({ loaded, total }) => {
            fill.style.width = Math.round((loaded / total) * 100) + '%';
            line.textContent = `${mb(loaded)} MB of ${mb(total)} MB`;
          };
          try {
            await tts.prepare();
            ready = true;
            toast('Voices ready');
            finish(true);
          } catch (err) {
            go.disabled = false; go.textContent = 'Try again';
            line.textContent = 'Couldn\'t download the voices. Check your internet connection and try again.';
          }
        });
        bodyEl.append(
          el('p', {}, 'Reading aloud uses natural-sounding voices that run on this computer, so your script never leaves it.'),
          el('p', { class: 'muted small' }, `They need a one-time download of about ${mb(status.bytes)} MB. After that they work offline.`),
          go);
      });
    }
    async function begin() {
      if (!(await ensureReady())) return;
      start();
    }

    // ---- Casting voices ----
    function openVoices() {
      const s = settings();
      const v = voices();
      const people = cast();
      const doc = opts.getDoc();
      const firstLine = (name) => {
        const q = R.readingQueue(doc ? doc.elements : [], { narrate: false }).find((x) => x.speaker === name);
        return q ? q.text : `Hi, I'm ${name.charAt(0) + name.slice(1).toLowerCase()}.`;
      };
      const options = () => [
        el('optgroup', { label: 'Women' }, ...R.VOICES.filter((x) => x.gender === 'f').map((x) => el('option', { value: x.id }, `${x.name} (${x.accent})`))),
        el('optgroup', { label: 'Men' }, ...R.VOICES.filter((x) => x.gender === 'm').map((x) => el('option', { value: x.id }, `${x.name} (${x.accent})`))),
      ];
      let previewing = 0;
      const preview = async (text, voice, button) => {
        if (!(await ensureReady())) return;
        if (playing) stop();
        const mine = ++previewing;
        button.textContent = '…';
        try {
          const buf = await speech(text, voice, s.speed);
          if (mine !== previewing) return;
          silence();
          button.textContent = '▶';
          await play(buf, run);
        } catch (err) { toast('Couldn\'t play that voice: ' + (err.message || err)); button.textContent = '▶'; }
      };
      const row = (key, label, sub, sample) => {
        const sel = el('select', { class: 'field' }, ...options());
        sel.value = v[key];
        const say = el('button', { class: 'icon-btn', type: 'button', title: 'Hear this voice' }, '▶');
        sel.addEventListener('change', () => { s.voices[key] = sel.value; opts.save(); preview(sample, sel.value, say); });
        say.addEventListener('click', () => preview(sample, sel.value, say));
        return el('div', { class: 'ra-voice-row' }, el('div', {}, el('div', { class: 'ra-voice-name' }, label), el('div', { class: 'muted small' }, sub)), sel, say);
      };
      const body = el('div', {},
        el('p', { class: 'muted small' }, 'Pick a voice for each character. Changes are saved for this production on this computer.'),
        row('', 'Narrator', 'Scene headings, action and transitions', 'Interior. Night diner. Night. The rain hasn\'t stopped for three days.'),
        ...[...people.entries()].map(([name, c]) => row(name, name, `${c.lines} line${c.lines === 1 ? '' : 's'}`, firstLine(name))));
      if (!people.size) body.append(el('p', { class: 'muted small' }, 'No characters in this script yet.'));
      body.append(el('div', { class: 'modal-foot' },
        el('button', { class: 'ghost-btn', type: 'button', onclick: () => { s.voices = {}; opts.save(); m.close(); openVoices(); } }, 'Choose for me again')));
      const m = window.Common.modal('Voices', body, { wide: true });
    }

    return { toggle: () => { if (bar) close(); else { open(); begin(); } }, open, close, stop, get isOpen() { return !!bar; } };
  }

  window.ReadAloud = { attach };
})();
