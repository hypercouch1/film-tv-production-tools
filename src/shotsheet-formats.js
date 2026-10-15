// Shot sheet data model, option lists, and import/export converters.
// Project: { id, title, updatedAt, scenes: [Scene], days: [Day] }
// Scene:   { id, number, heading, shots: [Shot] }
// Shot:    { id, type, angle, move, lens, cam, fps, audio, desc, notes, dayId, done }
// Day:     { id, date: 'YYYY-MM-DD', call: 'HH:MM', wrap: 'HH:MM', location, notes }
(function () {
  const { uid, parseCSV, csvField } = window.Common;

  // Edit these lists to change the options offered in the editor.
  const OPTIONS = {
    type: [
      ['EWS', 'Extreme Wide Shot'],
      ['WS', 'Wide Shot'],
      ['LS', 'Long Shot'],
      ['FS', 'Full Shot'],
      ['MLS', 'Medium Long Shot'],
      ['MS', 'Medium Shot'],
      ['MCU', 'Medium Close-Up'],
      ['CU', 'Close-Up'],
      ['ECU', 'Extreme Close-Up'],
      ['OTS', 'Over the Shoulder'],
      ['POV', 'Point of View'],
      ['2S', 'Two Shot'],
      ['INS', 'Insert'],
      ['EST', 'Establishing'],
    ],
    angle: ['Eye Level', 'High', 'Low', 'Dutch', 'Overhead', 'Ground'],
    move: ['Static', 'Pan', 'Tilt', 'Push In', 'Pull Out', 'Dolly', 'Truck', 'Tracking', 'Handheld', 'Gimbal', 'Crane', 'Zoom', 'Whip Pan'],
    cam: ['A', 'B', 'C'],
    fps: ['24', '25', '30', '48', '60', '120'],
    audio: ['Sync', 'MOS', 'VO'],
    lens: ['14mm', '18mm', '24mm', '35mm', '50mm', '85mm', '100mm', '135mm'],
  };

  const SHOT_DEFAULTS = { type: 'MS', angle: 'Eye Level', move: 'Static', lens: '35mm', cam: 'A', fps: '24', audio: 'Sync' };

  function newShot(from) {
    const base = from
      ? { type: from.type, angle: from.angle, move: from.move, lens: from.lens, cam: from.cam, fps: from.fps, audio: from.audio, dayId: from.dayId }
      : { ...SHOT_DEFAULTS, dayId: null };
    return { id: uid(), ...base, desc: '', notes: '', done: false };
  }

  const str = (v, d = '') => (v == null ? d : String(v));

  // Accepts the internal shape (shot.dayId + day.id) or the file shape (shot.day = 'YYYY-MM-DD').
  function normalizeProject(raw, fallbackTitle) {
    raw = raw || {};
    const idMap = {};
    const dateMap = {};
    const days = (Array.isArray(raw.days) ? raw.days : [])
      .filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d.date))
      .map((d) => {
        const day = {
          id: uid(), date: d.date, call: str(d.call), wrap: str(d.wrap),
          location: str(d.location), notes: str(d.notes),
        };
        if (d.id) idMap[d.id] = day.id;
        dateMap[d.date] = day.id;
        return day;
      });
    const scenes = (Array.isArray(raw.scenes) ? raw.scenes : []).map((s, i) => ({
      id: uid(),
      number: str(s && s.number, String(i + 1)),
      heading: str(s && s.heading),
      shots: (Array.isArray(s && s.shots) ? s.shots : []).map((sh) => ({
        id: uid(),
        type: str(sh.type, SHOT_DEFAULTS.type),
        angle: str(sh.angle, SHOT_DEFAULTS.angle),
        move: str(sh.move, SHOT_DEFAULTS.move),
        lens: str(sh.lens),
        cam: str(sh.cam, SHOT_DEFAULTS.cam),
        fps: str(sh.fps, SHOT_DEFAULTS.fps),
        audio: str(sh.audio, SHOT_DEFAULTS.audio),
        desc: str(sh.desc),
        notes: str(sh.notes),
        dayId: (sh.dayId && idMap[sh.dayId]) || (sh.day && dateMap[sh.day]) || null,
        done: !!sh.done,
      })),
    }));
    return { id: uid(), title: str(raw.title, fallbackTitle || 'Untitled Project'), updatedAt: Date.now(), scenes, days };
  }

  const baseName = (n) => n.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();

  function toFileShape(p) {
    const dateOf = Object.fromEntries(p.days.map((d) => [d.id, d.date]));
    return {
      format: 'shotsheet',
      version: 1,
      title: p.title,
      days: [...p.days].sort((a, b) => a.date.localeCompare(b.date))
        .map(({ date, call, wrap, location, notes }) => ({ date, call, wrap, location, notes })),
      scenes: p.scenes.map((s) => ({
        number: s.number,
        heading: s.heading,
        shots: s.shots.map(({ type, angle, move, lens, cam, fps, audio, desc, notes, dayId, done }) =>
          ({ type, angle, move, lens, cam, fps, audio, desc, notes, day: dateOf[dayId] || null, done })),
      })),
    };
  }

  const toShotsheet = (p) => JSON.stringify(toFileShape(p), null, 2);
  const toBackup = (ps) => JSON.stringify({
    format: 'shotsheet-backup', version: 1, exportedAt: new Date().toISOString(), projects: ps.map(toFileShape),
  }, null, 2);

  function fromJSON(content, name) {
    const data = JSON.parse(content);
    const fb = baseName(name);
    if (Array.isArray(data)) return data.map((p) => normalizeProject(p, fb));
    if (data && Array.isArray(data.projects)) return data.projects.map((p) => normalizeProject(p, fb));
    if (data && Array.isArray(data.scenes)) return [normalizeProject(data, fb)];
    throw new Error('JSON file does not look like a shot sheet.');
  }

  // ---- CSV ----
  const CSV_COLS = ['scene', 'heading', 'shot', 'type', 'angle', 'movement', 'lens', 'camera', 'fps', 'audio',
    'description', 'notes', 'shoot_date', 'call_time', 'location', 'done'];

  function shotLetter(i) {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    return i < 26 ? A[i] : A[Math.floor(i / 26) - 1] + A[i % 26];
  }

  function toCSV(p) {
    const dayOf = Object.fromEntries(p.days.map((d) => [d.id, d]));
    const lines = [CSV_COLS.join(','), ['#title', p.title].map(csvField).join(',')];
    for (const s of p.scenes) {
      s.shots.forEach((sh, i) => {
        const d = dayOf[sh.dayId];
        lines.push([s.number, s.heading, s.number + shotLetter(i), sh.type, sh.angle, sh.move, sh.lens, sh.cam,
          sh.fps, sh.audio, sh.desc, sh.notes, d ? d.date : '', d ? d.call : '', d ? d.location : '',
          sh.done ? 'x' : ''].map(csvField).join(','));
      });
    }
    // Shoot days with no shots would otherwise be lost.
    const used = new Set(p.scenes.flatMap((s) => s.shots.map((x) => x.dayId)));
    for (const d of p.days) {
      if (!used.has(d.id)) lines.push(['#day', '', '', '', '', '', '', '', '', '', '', d.notes, d.date, d.call, d.location, ''].map(csvField).join(','));
    }
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  function fromCSV(content, name) {
    const rows = parseCSV(content.replace(/^\uFEFF/, ''));
    if (!rows.length) throw new Error('CSV file is empty.');
    const head = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    const hasHeader = head.includes('scene') || head.includes('type') || head.includes('description');
    const cols = hasHeader ? head : CSV_COLS;
    const col = (r, k) => {
      const alias = { movement: ['movement', 'move'], camera: ['camera', 'cam'], description: ['description', 'desc'], shoot_date: ['shoot_date', 'date'] }[k] || [k];
      for (const a of alias) { const i = cols.indexOf(a); if (i >= 0) return (r[i] || '').trim(); }
      return '';
    };
    const raw = { title: baseName(name), scenes: [], days: [] };
    const dayByDate = {};
    const addDay = (r) => {
      const date = col(r, 'shoot_date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      if (!dayByDate[date]) {
        dayByDate[date] = { date, call: col(r, 'call_time'), wrap: '', location: col(r, 'location'), notes: '' };
        raw.days.push(dayByDate[date]);
      }
      return date;
    };
    for (const r of rows.slice(hasHeader ? 1 : 0)) {
      const sc = col(r, 'scene');
      if (sc === '#title') { raw.title = col(r, 'heading') || raw.title; continue; }
      if (sc === '#day') { const d = addDay(r); if (d) dayByDate[d].notes = col(r, 'notes'); continue; }
      const heading = col(r, 'heading');
      const key = sc || '1';
      let scene = raw.scenes.find((s) => s.number === key);
      if (!scene) { scene = { number: key, heading, shots: [] }; raw.scenes.push(scene); }
      if (!scene.heading && heading) scene.heading = heading;
      scene.shots.push({
        type: (col(r, 'type') || SHOT_DEFAULTS.type).toUpperCase(),
        angle: col(r, 'angle') || SHOT_DEFAULTS.angle,
        move: col(r, 'movement') || SHOT_DEFAULTS.move,
        lens: col(r, 'lens'),
        cam: col(r, 'camera') || SHOT_DEFAULTS.cam,
        fps: col(r, 'fps') || SHOT_DEFAULTS.fps,
        audio: col(r, 'audio') || SHOT_DEFAULTS.audio,
        desc: col(r, 'description'),
        notes: col(r, 'notes'),
        day: addDay(r),
        done: /^(1|true|yes|x|done|✓)$/i.test(col(r, 'done')),
      });
    }
    return [normalizeProject(raw, raw.title)];
  }

  // ---- iCalendar (.ics) of shoot days ----
  function icsEscape(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }
  function fold(line) {
    const out = [];
    while (line.length > 73) { out.push(line.slice(0, 73)); line = ' ' + line.slice(73); }
    out.push(line);
    return out.join('\r\n');
  }
  const compactDate = (d) => d.replace(/-/g, '');
  function addDays(date, n) {
    const d = new Date(date + 'T00:00');
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }

  function toICS(p) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const days = [...p.days].sort((a, b) => a.date.localeCompare(b.date));
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Production Hub//Shot Sheet//EN', 'CALSCALE:GREGORIAN'];
    days.forEach((d, i) => {
      const shots = [];
      for (const s of p.scenes) s.shots.forEach((sh, j) => {
        if (sh.dayId === d.id) shots.push(`${s.number}${shotLetter(j)} ${sh.type} — ${sh.desc.replace(/\*/g, '')}`);
      });
      lines.push('BEGIN:VEVENT', `UID:${d.id}@shotsheet`, `DTSTAMP:${stamp}`);
      if (d.call) {
        const start = compactDate(d.date) + 'T' + d.call.replace(':', '') + '00';
        let end;
        if (d.wrap && d.wrap > d.call) end = compactDate(d.date) + 'T' + d.wrap.replace(':', '') + '00';
        else {
          const [h, m] = d.call.split(':').map(Number);
          const t = new Date(`${d.date}T00:00`); t.setHours(h + 12, m);
          end = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}T${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}00`;
        }
        lines.push(`DTSTART:${start}`, `DTEND:${end}`);
      } else {
        lines.push(`DTSTART;VALUE=DATE:${compactDate(d.date)}`, `DTEND;VALUE=DATE:${addDays(d.date, 1)}`);
      }
      lines.push(fold('SUMMARY:' + icsEscape(`${p.title} — Shoot Day ${i + 1}`)));
      if (d.location) lines.push(fold('LOCATION:' + icsEscape(d.location)));
      const desc = [d.notes, shots.length ? `${shots.length} shots:\n` + shots.join('\n') : ''].filter(Boolean).join('\n\n');
      if (desc) lines.push(fold('DESCRIPTION:' + icsEscape(desc)));
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  function importFile({ name, ext, content }) {
    if (ext === 'csv') return fromCSV(content, name);
    return fromJSON(content, name);
  }

  window.ShotFormats = {
    OPTIONS, SHOT_DEFAULTS, newShot, shotLetter, normalizeProject, importFile, toShotsheet, toBackup, toCSV, toICS,
  };
})();
