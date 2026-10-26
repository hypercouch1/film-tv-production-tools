// The page cast and crew open from their personal link (film.prismdashboard.cc/c/<code>):
// their shoot days and call times, each day's call sheet once it's sent (with "Got it"),
// and a calendar to subscribe to. No account needed: the code identifies them.
// Self-contained (inline style and script, allowed by a per-response nonce); all text is
// set with textContent, never as HTML.
export const CREW_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Call sheet</title>
<style nonce="__NONCE__">
  :root { --bg: #0f0d0b; --panel: #16130f; --panel2: #1e1a15; --line: #2a251f; --text: #ece9e4; --muted: #8f99a3; --yellow: #e6cf2e; --red: #e2332b; --green: #6fcf7a; --cyan: #7fd0ea; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 24px 16px 60px; }
  .brand { font-size: 12px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: var(--muted); display: flex; align-items: center; gap: 8px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--red); box-shadow: 0 0 10px var(--red); }
  h1 { font-size: 32px; line-height: 1.1; margin: 14px 0 4px; letter-spacing: .5px; text-transform: uppercase; }
  .who { color: var(--muted); margin: 0 0 16px; }
  .who strong { color: var(--text); }
  .cal { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; font-size: 14px; color: var(--muted); }
  .cal a { color: var(--text); background: var(--panel2); border: 1px solid var(--line); border-radius: 8px; padding: 7px 12px; text-decoration: none; font-weight: 600; }
  .cal a:hover { border-color: var(--muted); }
  h2 { font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--muted); margin: 26px 0 8px; }
  .day { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px; margin-top: 10px; }
  .day.today { border-color: var(--yellow); }
  .day-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .date { font-size: 19px; font-weight: 700; }
  .daynum { color: var(--muted); font-size: 13px; }
  .badge { margin-left: auto; font-size: 11px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; border-radius: 999px; padding: 2px 9px; border: 1px solid var(--line); color: var(--muted); }
  .badge.new { color: #2a2405; background: var(--yellow); border-color: var(--yellow); }
  .badge.ok { color: var(--green); border-color: var(--green); }
  .call { margin-top: 8px; font-size: 15px; color: var(--muted); }
  .call strong { font-size: 26px; color: var(--yellow); margin-left: 6px; letter-spacing: .5px; }
  .loc { margin-top: 6px; white-space: pre-line; }
  .scenes { margin: 10px 0 0; padding: 0; list-style: none; font-size: 14px; }
  .scenes li { padding: 4px 0; border-top: 1px solid var(--line); }
  .scenes li.theirs strong { color: var(--cyan); }
  .scenes .syn { color: var(--muted); font-size: 13px; }
  details { margin-top: 12px; border-top: 1px solid var(--line); padding-top: 10px; }
  summary { cursor: pointer; font-weight: 700; color: var(--text); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin-top: 10px; }
  .box { background: var(--panel2); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 14px; white-space: pre-line; }
  .label { display: block; font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: var(--muted); margin-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 8px; }
  th { text-align: left; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: var(--muted); padding: 4px 6px; border-bottom: 1px solid var(--line); }
  td { padding: 5px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
  h3 { font-size: 12px; letter-spacing: 1.2px; text-transform: uppercase; color: var(--muted); margin: 14px 0 0; }
  .confirm { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 12px; }
  button.got { background: var(--yellow); color: #2a2405; border: 0; border-radius: 8px; padding: 12px 22px; font: 700 16px inherit; cursor: pointer; }
  button.got:disabled { opacity: .5; cursor: default; }
  .status { font-size: 14px; color: var(--muted); }
  .status.ok { color: var(--green); }
  .status.err { color: #ffb3ad; }
  .pending { margin-top: 10px; font-size: 14px; color: var(--muted); }
  .empty { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px; color: var(--muted); margin-top: 10px; }
  form.code { display: flex; gap: 10px; margin-top: 18px; flex-wrap: wrap; }
  form.code input { flex: 1; min-width: 200px; background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 12px; font: 600 18px/1 ui-monospace, Menlo, Consolas, monospace; letter-spacing: 3px; text-transform: uppercase; }
  form.code input:focus { outline: none; border-color: var(--yellow); }
  .msg { margin-top: 18px; }
  .past summary { color: var(--muted); font-weight: 600; }
  .event { background: var(--panel); border: 1px solid var(--line); border-left: 4px solid var(--cyan); border-radius: 12px; padding: 12px 14px; margin-top: 10px; }
  .event .when { font-size: 13px; font-weight: 700; color: var(--cyan); }
  .event .what { font-size: 17px; font-weight: 700; margin-top: 2px; }
  .event .kind { font-size: 13px; color: var(--muted); }
  .event .notes { margin-top: 6px; font-size: 14px; white-space: pre-line; }
  .hidden { display: none !important; }
  @media print { body { background: #fff; color: #000; } .cal, .confirm, form.code { display: none !important; } .day, .box { background: #fff; border-color: #ccc; } }
</style>
</head>
<body>
<main>
  <div class="brand"><span class="dot"></span><span>Production Tools · Call sheet</span></div>

  <section id="ask" class="hidden">
    <h1>Your call sheets</h1>
    <p class="who">Enter the code the production sent you.</p>
    <form class="code" id="codeForm">
      <input id="codeInput" autocomplete="off" spellcheck="false" placeholder="e.g. K7M2QX9PRT" maxlength="20" aria-label="Your code">
      <button class="got" type="submit">Continue</button>
    </form>
    <p class="status err msg" id="askError"></p>
  </section>

  <section id="page" class="hidden">
    <h1 id="production"></h1>
    <p class="who">For <strong id="name"></strong><span id="role"></span></p>
    <div class="cal">
      <span>Your shoot days and events in your calendar, kept up to date:</span>
      <a id="calApple" href="#">Apple / Outlook</a>
      <a id="calGoogle" href="#" target="_blank" rel="noopener">Google Calendar</a>
    </div>
    <div id="days"></div>
  </section>

  <p class="status err msg hidden" id="fatal"></p>
</main>
<script nonce="__NONCE__">
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var code = ((location.pathname.match(/^\\/c\\/([A-Za-z0-9]+)/) || [])[1] || new URLSearchParams(location.search).get('c') || '').toUpperCase();
  var data = null;

  function make(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function nice(s, opts) { return parse(s).toLocaleDateString(undefined, opts || { weekday: 'long', month: 'long', day: 'numeric' }); }
  function time(t) { if (!t) return ''; var p = t.split(':'); return new Date(2000, 0, 1, +p[0], +p[1]).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
  function when(ms) { return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function box(label, value) { var b = make('div', 'box'); b.appendChild(make('span', 'label', label)); b.appendChild(document.createTextNode(value || '—')); return b; }
  function table(head, rows) {
    var t = make('table'), tr = make('tr');
    head.forEach(function (h) { tr.appendChild(make('th', null, h)); });
    var thead = make('thead'); thead.appendChild(tr); t.appendChild(thead);
    var tb = make('tbody');
    rows.forEach(function (r) { var row = make('tr'); r.forEach(function (c) { row.appendChild(make('td', null, c)); }); tb.appendChild(row); });
    t.appendChild(tb);
    return t;
  }

  function dayCard(d) {
    var card = make('article', 'day' + (d.date === today() ? ' today' : ''));
    var head = make('div', 'day-head');
    head.appendChild(make('span', 'date', nice(d.date)));
    head.appendChild(make('span', 'daynum', 'Day ' + d.number + ' of ' + d.of));
    var badge = make('span', 'badge');
    if (d.confirmedAt) { badge.textContent = '✓ Got it'; badge.className += ' ok'; }
    else if (d.sentAt) { badge.textContent = 'New call sheet'; badge.className += ' new'; }
    else badge.textContent = 'Call sheet not out yet';
    head.appendChild(badge);
    card.appendChild(head);
    var call = make('div', 'call', 'Your call');
    call.appendChild(make('strong', null, d.call ? time(d.call) : 'TBC'));
    card.appendChild(call);
    if (d.location) card.appendChild(make('div', 'loc', d.location));
    if (d.scenes.length) {
      var ul = make('ul', 'scenes');
      d.scenes.forEach(function (s) {
        var li = make('li', s.mine ? 'theirs' : '');
        li.appendChild(make('strong', null, s.code + '  '));
        li.appendChild(document.createTextNode(s.heading || 'Scene'));
        if (s.synopsis) { li.appendChild(make('div', 'syn', s.synopsis)); }
        ul.appendChild(li);
      });
      card.appendChild(ul);
    }
    if (!d.sheet) {
      card.appendChild(make('p', 'pending', 'The full call sheet will appear here when the production sends it.'));
      return card;
    }
    var s = d.sheet;
    var det = make('details');
    if (!d.confirmedAt) det.open = true;
    det.appendChild(make('summary', null, 'Call sheet'));
    var grid = make('div', 'grid');
    grid.appendChild(box('General crew call', time(s.crewCall)));
    grid.appendChild(box('Shooting call', time(s.shootingCall)));
    grid.appendChild(box('Estimated wrap', time(s.wrap)));
    grid.appendChild(box('Weather', [s.weather, s.sunrise ? 'Sunrise ' + s.sunrise : '', s.sunset ? 'Sunset ' + s.sunset : ''].filter(Boolean).join('\\n')));
    grid.appendChild(box('Parking', s.parking));
    grid.appendChild(box('Nearest hospital', s.hospital));
    det.appendChild(grid);
    if (s.notes) { var n = box('Notes', s.notes); n.style.marginTop = '8px'; det.appendChild(n); }
    if (s.cast.length) { det.appendChild(make('h3', null, 'Cast')); det.appendChild(table(['#', 'Character', 'Actor', 'Call'], s.cast.map(function (c) { return [String(c.number), c.character, c.actor || '—', time(c.call) || '—']; }))); }
    if (s.crew.length) { det.appendChild(make('h3', null, 'Crew')); det.appendChild(table(['Role', 'Name', 'Call'], s.crew.map(function (k) { return [k.role || '—', k.name || '—', time(k.call) || '—']; }))); }
    card.appendChild(det);
    var row = make('div', 'confirm');
    var status = make('span', 'status' + (d.confirmedAt ? ' ok' : ''), d.confirmedAt ? '✓ You confirmed this call sheet ' + when(d.confirmedAt) + '.' : 'Sent ' + when(d.sentAt) + '. Let the production know you have it:');
    if (!d.confirmedAt) {
      var btn = make('button', 'got', 'Got it');
      btn.type = 'button';
      btn.addEventListener('click', function () {
        btn.disabled = true;
        status.textContent = 'Sending…'; status.className = 'status';
        fetch('/api/crew/' + encodeURIComponent(code) + '/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dayId: d.id }) })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (x) {
            if (!x.ok) throw new Error(x.j.error || 'Something went wrong.');
            d.confirmedAt = x.j.confirmedAt;
            card.replaceWith(dayCard(d));
          })
          .catch(function (e) { btn.disabled = false; status.textContent = e.message + ' Please try again.'; status.className = 'status err'; });
      });
      row.appendChild(btn);
    }
    row.appendChild(status);
    card.appendChild(row);
    return card;
  }

  function render() {
    $('production').textContent = data.production;
    $('name').textContent = data.name;
    $('role').textContent = data.role ? ' (' + data.role + ')' : '';
    document.title = 'Call sheet · ' + data.production;
    var feed = location.host + '/c/' + encodeURIComponent(code) + '/calendar.ics';
    $('calApple').href = 'webcal://' + feed;
    $('calGoogle').href = 'https://calendar.google.com/calendar/render?cid=' + encodeURIComponent('webcal://' + feed);
    var wrap = $('days');
    wrap.textContent = '';
    var t = today();
    var upcoming = data.days.filter(function (d) { return d.date >= t; });
    var past = data.days.filter(function (d) { return d.date < t; });
    wrap.appendChild(make('h2', null, 'Your shoot days'));
    if (!upcoming.length) wrap.appendChild(make('div', 'empty', data.days.length ? 'No more shoot days for you. Thank you!' : 'You aren’t on any shoot days yet. This page updates as the schedule changes.'));
    upcoming.forEach(function (d) { wrap.appendChild(dayCard(d)); });
    var events = (data.events || []).filter(function (e) { return e.date >= t; });
    if (events.length) {
      wrap.appendChild(make('h2', null, 'Meetings and other events'));
      events.forEach(function (e) {
        var card = make('article', 'event');
        card.appendChild(make('div', 'when', nice(e.date, { weekday: 'long', month: 'long', day: 'numeric' }) + ' · ' + (e.start ? time(e.start) + (e.end ? ' – ' + time(e.end) : '') : 'All day')));
        card.appendChild(make('div', 'what', e.title));
        if (e.title !== e.kind) card.appendChild(make('div', 'kind', e.kind));
        if (e.location) card.appendChild(make('div', 'loc', e.location));
        if (e.notes) card.appendChild(make('div', 'notes', e.notes));
        wrap.appendChild(card);
      });
    }
    if (past.length) {
      var det = make('details', 'past');
      det.appendChild(make('summary', null, 'Earlier days (' + past.length + ')'));
      past.slice().reverse().forEach(function (d) { det.appendChild(dayCard(d)); });
      wrap.appendChild(det);
    }
    $('page').classList.remove('hidden');
  }

  function load() {
    fetch('/api/crew/' + encodeURIComponent(code))
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (!x.ok) throw new Error(x.j.error || 'Something went wrong.');
        data = x.j;
        $('ask').classList.add('hidden');
        render();
      })
      .catch(function (e) {
        $('page').classList.add('hidden');
        $('ask').classList.remove('hidden');
        $('askError').textContent = e.message;
      });
  }

  $('codeForm').addEventListener('submit', function (e) {
    e.preventDefault();
    code = $('codeInput').value.trim().toUpperCase();
    if (!code) return;
    history.replaceState(null, '', '/c/' + encodeURIComponent(code));
    load();
  });
  // Opened again later (or left open): show the latest.
  document.addEventListener('visibilitychange', function () { if (!document.hidden && data) load(); });

  if (code) load(); else $('ask').classList.remove('hidden');
})();
</script>
</body>
</html>`;
