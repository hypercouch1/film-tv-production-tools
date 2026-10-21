// The page cast and crew open from their personal link (film.prismdashboard.cc/a/<code>) to
// say which days they can't work. No account needed: the code identifies them. Self-contained
// (inline style and script, allowed by a per-response nonce); all text is set with
// textContent, never as HTML.
export const AVAILABILITY_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Availability</title>
<style nonce="__NONCE__">
  :root { --bg: #0f0d0b; --panel: #16130f; --panel2: #1e1a15; --line: #2a251f; --text: #ece9e4; --muted: #8f99a3; --yellow: #e6cf2e; --red: #e2332b; --purple: #9b7be0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 28px 18px 60px; }
  .brand { font-size: 12px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: var(--muted); display: flex; align-items: center; gap: 8px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--red); box-shadow: 0 0 10px var(--red); }
  h1 { font-size: 34px; line-height: 1.1; margin: 14px 0 4px; letter-spacing: .5px; text-transform: uppercase; }
  .who { color: var(--muted); margin: 0 0 18px; }
  .who strong { color: var(--text); }
  .help { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; font-size: 15px; }
  .legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 8px; font-size: 13px; color: var(--muted); }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .sw { width: 16px; height: 16px; border-radius: 4px; display: inline-block; border: 1px solid var(--line); }
  .sw.off { background: var(--red); border-color: var(--red); }
  .sw.shoot { background: rgba(155, 123, 224, .35); border-color: var(--purple); }
  .month { margin-top: 22px; }
  .month h2 { font-size: 15px; letter-spacing: 1.5px; text-transform: uppercase; margin: 0 0 8px; }
  .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; }
  .dow { text-align: center; font-size: 11px; font-weight: 700; color: var(--muted); padding-bottom: 2px; }
  .day {
    position: relative; aspect-ratio: 1 / 1; min-height: 40px; border-radius: 8px; border: 1px solid var(--line);
    background: var(--panel); color: var(--text); font: 600 15px/1 inherit; cursor: pointer; padding: 0;
  }
  .day:hover { border-color: var(--muted); }
  .day.shoot { background: rgba(155, 123, 224, .22); border-color: var(--purple); }
  .day.shoot::after { content: 'shoot'; position: absolute; left: 0; right: 0; bottom: 4px; font-size: 9px; font-weight: 700; letter-spacing: .5px; color: #c7b6f2; text-transform: uppercase; }
  .day.off { background: var(--red); border-color: var(--red); color: #fff; }
  .day.off::before { content: '✕'; position: absolute; top: 3px; right: 6px; font-size: 11px; }
  .day.off.shoot::after { color: #ffe2e0; }
  .day.out { visibility: hidden; }
  .day.weekend:not(.off):not(.shoot) { color: var(--muted); }
  label.note { display: block; margin-top: 24px; font-size: 14px; color: var(--muted); }
  textarea { width: 100%; margin-top: 6px; min-height: 76px; background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 10px; font: inherit; resize: vertical; }
  textarea:focus, input:focus { outline: none; border-color: var(--yellow); }
  .bar { position: sticky; bottom: 0; margin-top: 18px; padding: 12px 0; background: linear-gradient(transparent, var(--bg) 30%); display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  button.save { background: var(--yellow); color: #2a2405; border: 0; border-radius: 8px; padding: 12px 22px; font: 700 16px inherit; cursor: pointer; }
  button.save:disabled { opacity: .5; cursor: default; }
  .status { font-size: 14px; color: var(--muted); }
  .status.ok { color: #6fcf7a; }
  .status.err { color: #ffb3ad; }
  .summary { font-size: 14px; color: var(--muted); }
  form.code { display: flex; gap: 10px; margin-top: 18px; flex-wrap: wrap; }
  form.code input { flex: 1; min-width: 200px; background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 12px; font: 600 18px/1 ui-monospace, Menlo, Consolas, monospace; letter-spacing: 3px; text-transform: uppercase; }
  .msg { margin-top: 18px; }
  .hidden { display: none !important; }
</style>
</head>
<body>
<main>
  <div class="brand"><span class="dot"></span><span>Production Tools · Availability</span></div>

  <section id="ask" class="hidden">
    <h1>Your availability</h1>
    <p class="who">Enter the code the production sent you.</p>
    <form class="code" id="codeForm">
      <input id="codeInput" autocomplete="off" spellcheck="false" placeholder="e.g. K7M2QX9PRT" maxlength="20" aria-label="Your code">
      <button class="save" type="submit">Continue</button>
    </form>
    <p class="status err msg" id="askError"></p>
  </section>

  <section id="form" class="hidden">
    <h1 id="production"></h1>
    <p class="who">For <strong id="name"></strong><span id="role"></span></p>
    <div class="help">
      <span id="range"></span> Tap the days you <strong>can't</strong> work. Tap again to undo.
      <div class="legend">
        <span><i class="sw off"></i> Can't work</span>
        <span><i class="sw shoot"></i> Planned shoot day</span>
      </div>
    </div>
    <div id="months"></div>
    <label class="note">Anything else? (e.g. "mornings only on the 14th")
      <textarea id="note" maxlength="500"></textarea>
    </label>
    <div class="bar">
      <button class="save" id="save" type="button">Send my availability</button>
      <span class="summary" id="summary"></span>
      <span class="status" id="status" role="status"></span>
    </div>
  </section>

  <p class="status err msg hidden" id="fatal"></p>
</main>
<script nonce="__NONCE__">
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var code = (location.pathname.match(/^\\/a\\/([A-Za-z0-9]+)/) || [])[1] || new URLSearchParams(location.search).get('c') || '';
  var data = null, off = new Set(), dirty = false;

  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function nice(s, opts) { return parse(s).toLocaleDateString(undefined, opts || { weekday: 'short', month: 'short', day: 'numeric' }); }

  function setDirty(v) {
    dirty = v;
    $('save').disabled = !v && !!data.respondedAt;
    $('status').textContent = v ? 'Not sent yet' : '';
    $('status').className = 'status';
    $('summary').textContent = off.size ? off.size + ' day' + (off.size === 1 ? '' : 's') + " you can't work" : "No days marked: you're free for all of them";
  }

  function render() {
    $('production').textContent = data.production;
    $('name').textContent = data.name;
    $('role').textContent = data.role ? ' (' + data.role + ')' : '';
    $('range').textContent = 'From ' + nice(data.start, { month: 'long', day: 'numeric' }) + ' to ' + nice(data.end, { month: 'long', day: 'numeric', year: 'numeric' }) + '.';
    $('note').value = data.note || '';
    var shoot = new Set(data.shootDays);
    var wrap = $('months');
    wrap.textContent = '';
    var start = parse(data.start), end = parse(data.end);
    // Only the weeks that touch the dates asked about.
    var firstShown = new Date(start); firstShown.setDate(start.getDate() - start.getDay());
    var lastShown = new Date(end); lastShown.setDate(end.getDate() + (6 - end.getDay()));
    var cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur <= end) {
      var section = document.createElement('section');
      section.className = 'month';
      var h = document.createElement('h2');
      h.textContent = cur.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      section.appendChild(h);
      var grid = document.createElement('div');
      grid.className = 'grid';
      for (var w = 0; w < 7; w++) {
        var dow = document.createElement('div');
        dow.className = 'dow';
        dow.textContent = new Date(2026, 1, w + 1).toLocaleDateString(undefined, { weekday: 'narrow' });
        grid.appendChild(dow);
      }
      var m = cur.getMonth();
      var from = cur < firstShown ? new Date(firstShown) : new Date(cur);
      if (from.getMonth() !== m) from = new Date(cur);
      for (var i = 0; i < from.getDay(); i++) { var blank = document.createElement('span'); grid.appendChild(blank); }
      for (var d = from; d.getMonth() === m && d <= lastShown; d.setDate(d.getDate() + 1)) {
        (function (date, dayNum, weekday) {
          var b = document.createElement('button');
          b.type = 'button';
          b.textContent = String(dayNum);
          var outside = date < data.start || date > data.end;
          b.className = 'day' + (outside ? ' out' : '') + (shoot.has(date) ? ' shoot' : '') + (off.has(date) ? ' off' : '') + (weekday === 0 || weekday === 6 ? ' weekend' : '');
          b.setAttribute('aria-pressed', off.has(date) ? 'true' : 'false');
          b.setAttribute('aria-label', nice(date, { weekday: 'long', month: 'long', day: 'numeric' }) + (shoot.has(date) ? ', shoot day' : ''));
          if (!outside) b.addEventListener('click', function () {
            if (off.has(date)) off.delete(date); else off.add(date);
            b.classList.toggle('off', off.has(date));
            b.setAttribute('aria-pressed', off.has(date) ? 'true' : 'false');
            setDirty(true);
          });
          grid.appendChild(b);
        })(ymd(d), d.getDate(), d.getDay());
      }
      section.appendChild(grid);
      wrap.appendChild(section);
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
    $('form').classList.remove('hidden');
    setDirty(false);
    if (data.respondedAt) {
      $('status').textContent = 'Last sent ' + new Date(data.respondedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '. You can change it any time.';
    }
  }

  function load() {
    fetch('/api/availability/' + encodeURIComponent(code.toUpperCase()))
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (!x.ok) throw new Error(x.j.error || 'Something went wrong.');
        data = x.j;
        off = new Set(data.off);
        document.title = 'Availability · ' + data.production;
        $('ask').classList.add('hidden');
        render();
      })
      .catch(function (e) {
        $('ask').classList.remove('hidden');
        $('askError').textContent = e.message;
      });
  }

  $('note').addEventListener('input', function () { setDirty(true); });
  $('save').addEventListener('click', function () {
    $('save').disabled = true;
    $('status').textContent = 'Sending…';
    $('status').className = 'status';
    fetch('/api/availability/' + encodeURIComponent(code.toUpperCase()), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ off: Array.from(off), note: $('note').value }),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (!x.ok) throw new Error(x.j.error || 'Something went wrong.');
        data.respondedAt = Date.now();
        dirty = false;
        $('status').textContent = '✓ Sent. Thank you, ' + data.name.split(' ')[0] + '! You can come back and change it any time.';
        $('status').className = 'status ok';
      })
      .catch(function (e) {
        $('save').disabled = false;
        $('status').textContent = e.message + ' Please try again.';
        $('status').className = 'status err';
      });
  });
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  $('codeForm').addEventListener('submit', function (e) {
    e.preventDefault();
    code = $('codeInput').value.trim();
    if (!code) return;
    history.replaceState(null, '', '/a/' + encodeURIComponent(code.toUpperCase()));
    load();
  });

  if (code) load(); else $('ask').classList.remove('hidden');
})();
</script>
</body>
</html>`;
