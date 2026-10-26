// A cast or crew member's personal page and calendar, worked out from the production
// document: the shoot days they're on, their call time, and each day's call sheet once
// the production has sent it. Contact details are never included.

const str = (v) => (v == null ? '' : String(v));
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
const validDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const validTime = (t) => typeof t === 'string' && /^\d{2}:\d{2}$/.test(t);

// Scenes being shot on a day: any scene with a shot that day (or, without shots, a scene
// scheduled on the stripboard) — the same rule the app uses.
const shotsOf = (s) => arr(s.shots);
const onDay = (s, dayId) => (shotsOf(s).length ? shotsOf(s).some((x) => x.dayId === dayId) : s.dayId === dayId);
const ids = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

export function findPerson(doc, personId) {
  const c = arr(doc.characters).find((x) => x.id === personId);
  if (c) return { id: c.id, cast: true, name: str(c.actor) || str(c.name) || 'Cast', role: c.actor ? str(c.name) : 'Cast' };
  const k = arr(doc.crew).find((x) => x.id === personId);
  if (k) return { id: k.id, cast: false, allDays: !!k.allDays, name: str(k.name) || str(k.role) || 'Crew', role: k.name ? str(k.role) : 'Crew' };
  return null;
}

function sceneCode(doc, s) {
  const ep = doc.type === 'tv' ? arr(doc.episodes).find((e) => e.id === s.episodeId) : null;
  return ep ? `${str(ep.number)}-${str(s.number)}` : str(s.number);
}

// The shoot days a person works, in date order, with the details for their page.
// sends: Map(dayId → sentAt); confirms: Map(dayId → confirmedAt) for this person.
export function crewDays(doc, person, { sends = new Map(), confirms = new Map() } = {}) {
  const days = arr(doc.days).filter((d) => validDate(d.date)).sort((a, b) => a.date.localeCompare(b.date));
  const scenes = arr(doc.scenes);
  const characters = arr(doc.characters);
  const out = [];
  days.forEach((day, i) => {
    const todays = scenes.filter((s) => onDay(s, day.id));
    const works = person.cast
      ? todays.some((s) => ids(s.castIds).includes(person.id))
      : person.allDays || todays.some((s) => ids(s.crewIds).includes(person.id));
    if (!works) return;
    const calls = day.calls && typeof day.calls === 'object' ? day.calls : {};
    const fallback = person.cast ? day.call : day.crewCall || day.call;
    const call = validTime(calls[person.id]) ? calls[person.id] : validTime(fallback) ? fallback : '';
    const sentAt = sends.get(day.id) || null;
    const confirmedAt = confirms.get(day.id) || null;
    const entry = {
      id: str(day.id), date: day.date, number: i + 1, of: days.length, call,
      location: str(day.location).slice(0, 500),
      scenes: todays.map((s) => ({
        code: sceneCode(doc, s), heading: str(s.heading).slice(0, 200), synopsis: str(s.synopsis).slice(0, 300),
        eighths: Number.isFinite(s.eighths) ? s.eighths : 0,
        mine: person.cast ? ids(s.castIds).includes(person.id) : ids(s.crewIds).includes(person.id),
      })),
      sentAt,
      // A confirmation counts for the latest version sent.
      confirmedAt: sentAt && confirmedAt && confirmedAt >= sentAt ? confirmedAt : null,
    };
    // The full call sheet only once the production has sent it.
    if (sentAt) {
      const castIds = new Set(todays.flatMap((s) => ids(s.castIds)));
      entry.sheet = {
        crewCall: validTime(day.crewCall) ? day.crewCall : '', shootingCall: validTime(day.call) ? day.call : '', wrap: validTime(day.wrap) ? day.wrap : '',
        parking: str(day.parking).slice(0, 500), hospital: str(day.hospital).slice(0, 500), notes: str(day.notes).slice(0, 2000),
        weather: str(day.weather).slice(0, 300), sunrise: str(day.sunrise).slice(0, 20), sunset: str(day.sunset).slice(0, 20),
        cast: characters.filter((c) => castIds.has(c.id)).map((c) => ({
          number: characters.indexOf(c) + 1, character: str(c.name), actor: str(c.actor),
          call: validTime(calls[c.id]) ? calls[c.id] : validTime(day.call) ? day.call : '',
        })),
        crew: arr(doc.crew).filter((k) => k.allDays || todays.some((s) => ids(s.crewIds).includes(k.id))).map((k) => ({
          role: str(k.role), name: str(k.name),
          call: validTime(calls[k.id]) ? calls[k.id] : validTime(day.crewCall) ? day.crewCall : validTime(day.call) ? day.call : '',
        })),
      };
    }
    out.push(entry);
  });
  return out;
}

// Events that aren't shoot days (table reads, meetings…) a person is invited to, in date order.
const EVENT_KINDS = { tableread: 'Table read', meeting: 'Production meeting', rehearsal: 'Rehearsal', fitting: 'Fitting', scout: 'Location scout', tech: 'Tech scout', prep: 'Prep day', other: 'Event' };
export function crewEvents(doc, person) {
  return arr(doc.events)
    .filter((e) => validDate(e.date) && (e.everyone || ids(e.peopleIds).includes(person.id)))
    .map((e) => ({
      id: str(e.id), date: e.date, start: validTime(e.start) ? e.start : '', end: validTime(e.end) ? e.end : '',
      kind: EVENT_KINDS[e.kind] || 'Event', title: str(e.title).slice(0, 200) || EVENT_KINDS[e.kind] || 'Event',
      location: str(e.location).slice(0, 500), notes: str(e.notes).slice(0, 2000),
    }))
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

// ---- Calendar (iCalendar feed people subscribe to) ----
const icsText = (s) => str(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// Lines longer than 75 bytes are folded (continuation lines start with a space).
function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts = [];
  let cur = '';
  let len = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (len + n > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; len = 0; }
    cur += ch; len += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}
const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const compactDate = (d) => d.replace(/-/g, '');
function addMinutes(date, time, minutes) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, h, min + minutes));
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}T${p(t.getUTCHours())}${p(t.getUTCMinutes())}00`;
}
const minutesOf = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

// Times are "floating" (the local time wherever the phone is), like a call sheet.
export function crewCalendar(doc, person, days, { now = Date.now(), pageUrl = '', events = [] } = {}) {
  const title = str(doc.title) || 'Production';
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Production Tools//Crew calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(`${title} — ${person.name}`)}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
  ];
  for (const d of days) {
    const date = compactDate(d.date);
    const wrap = d.sheet && d.sheet.wrap ? d.sheet.wrap : '';
    lines.push('BEGIN:VEVENT', `UID:${d.id}.${person.id}@production-tools`, `DTSTAMP:${stamp(now)}`);
    if (d.call) {
      lines.push(`DTSTART:${addMinutes(d.date, d.call, 0)}`);
      const length = wrap && minutesOf(wrap) > minutesOf(d.call) ? minutesOf(wrap) - minutesOf(d.call) : 12 * 60;
      lines.push(`DTEND:${addMinutes(d.date, d.call, length)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${date}`, `DTEND;VALUE=DATE:${addMinutes(d.date, '00:00', 24 * 60).slice(0, 8)}`);
    }
    lines.push(`SUMMARY:${icsText(`${title}: Day ${d.number}${d.call ? ` (call ${d.call})` : ''}`)}`);
    if (d.location) lines.push(`LOCATION:${icsText(d.location.split('\n')[0])}`);
    const desc = [
      d.call ? `Your call: ${d.call}` : 'Call time to be confirmed',
      d.scenes.length ? 'Scenes: ' + d.scenes.map((s) => `${s.code} ${s.heading}`).join('; ') : '',
      pageUrl ? `Call sheet: ${pageUrl}` : '',
    ].filter(Boolean).join('\n');
    lines.push(`DESCRIPTION:${icsText(desc)}`);
    if (pageUrl) lines.push(`URL:${pageUrl}`);
    lines.push('END:VEVENT');
  }
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}.${person.id}@production-tools`, `DTSTAMP:${stamp(now)}`);
    if (e.start) {
      lines.push(`DTSTART:${addMinutes(e.date, e.start, 0)}`);
      const length = e.end && minutesOf(e.end) > minutesOf(e.start) ? minutesOf(e.end) - minutesOf(e.start) : 60;
      lines.push(`DTEND:${addMinutes(e.date, e.start, length)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(e.date)}`, `DTEND;VALUE=DATE:${addMinutes(e.date, '00:00', 24 * 60).slice(0, 8)}`);
    }
    lines.push(`SUMMARY:${icsText(`${title}: ${e.title}`)}`);
    if (e.location) lines.push(`LOCATION:${icsText(e.location.split('\n')[0])}`);
    const desc = [e.title !== e.kind ? e.kind : '', e.notes, pageUrl ? `Your page: ${pageUrl}` : ''].filter(Boolean).join('\n');
    if (desc) lines.push(`DESCRIPTION:${icsText(desc)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
