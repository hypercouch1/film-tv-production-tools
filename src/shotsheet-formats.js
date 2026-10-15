// Shot sheet data model, option lists, and import/export converters.
// Project: { id, title, updatedAt, scenes: [Scene], days: [Day] }
// Project also has characters: [{ id, name, actor, contact }] and crew: [{ id, role, name, contact, allDays }].
// Scene:   { id, number, heading, synopsis, castIds, crewIds, props, equipment, eighths (page length in 1/8 pages), shots: [Shot] }
// Shot:    { id, type, angle, move, lens, cam, fps, audio, desc, notes, dayId, done }
// Day:     { id, date: 'YYYY-MM-DD', call: 'HH:MM', wrap: 'HH:MM', location, notes, equipment }
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

  // Common crew roles offered when typing a role (any text is allowed).
  const CREW_ROLES = [
    'Director', 'Producer', '1st AD', '2nd AD', 'Script Supervisor', 'Director of Photography', 'Camera Operator',
    '1st AC', '2nd AC', 'DIT', 'Gaffer', 'Best Boy Electric', 'Key Grip', 'Dolly Grip', 'Sound Mixer', 'Boom Operator',
    'Production Designer', 'Art Director', 'Prop Master', 'Set Dresser', 'Costume Designer', 'Wardrobe',
    'Hair & Makeup', 'Stunt Coordinator', 'Location Manager', 'Production Assistant', 'Catering', 'Driver',
  ];

  const ids = (list, map) => (Array.isArray(list) ? list.map((x) => map[x] || null).filter(Boolean) : []);

  // Accepts the internal shape (shot.dayId + day.id) or the file shape (shot.day = 'YYYY-MM-DD').
  function normalizeProject(raw, fallbackTitle) {
    raw = raw || {};
    const idMap = {};
    const dateMap = {};
    const charMap = {};
    const crewMap = {};
    const characters = (Array.isArray(raw.characters) ? raw.characters : []).map((c) => {
      const out = { id: uid(), name: str(c.name), actor: str(c.actor), contact: str(c.contact) };
      if (c.id) charMap[c.id] = out.id;
      return out;
    });
    const crew = (Array.isArray(raw.crew) ? raw.crew : []).map((c) => {
      const out = { id: uid(), role: str(c.role), name: str(c.name), contact: str(c.contact), allDays: !!c.allDays };
      if (c.id) crewMap[c.id] = out.id;
      return out;
    });
    const days = (Array.isArray(raw.days) ? raw.days : [])
      .filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d.date))
      .map((d) => {
        const day = {
          id: uid(), date: d.date, call: str(d.call), wrap: str(d.wrap),
          location: str(d.location), notes: str(d.notes), equipment: str(d.equipment),
        };
        if (d.id) idMap[d.id] = day.id;
        dateMap[d.date] = day.id;
        return day;
      });
    const scenes = (Array.isArray(raw.scenes) ? raw.scenes : []).map((s, i) => ({
      id: uid(),
      number: str(s && s.number, String(i + 1)),
      heading: str(s && s.heading),
      synopsis: str(s && s.synopsis),
      castIds: ids(s && s.castIds, charMap),
      crewIds: ids(s && s.crewIds, crewMap),
      // Older files and script imports list cast by name; upgradeProject turns these into characters.
      ...(Array.isArray(s && s.cast) && s.cast.length ? { cast: s.cast.map(String) } : {}),
      props: str(s && s.props),
      equipment: str(s && s.equipment),
      eighths: Number.isFinite(s && s.eighths) ? s.eighths : 0,
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
    return upgradeProject({
      id: uid(), title: str(raw.title, fallbackTitle || 'Untitled Project'), updatedAt: Date.now(), scenes, days, characters, crew,
    });
  }

  // Fills in fields added in later versions, in place, so older local and shared
  // projects keep working. Scene cast given as names becomes character entries.
  function upgradeProject(p) {
    if (!Array.isArray(p.characters)) p.characters = [];
    if (!Array.isArray(p.crew)) p.crew = [];
    if (!Array.isArray(p.days)) p.days = [];
    if (!Array.isArray(p.scenes)) p.scenes = [];
    for (const d of p.days) if (typeof d.equipment !== 'string') d.equipment = '';
    const byName = new Map(p.characters.map((c) => [c.name.trim().toLowerCase(), c]));
    for (const s of p.scenes) {
      if (!Array.isArray(s.shots)) s.shots = [];
      if (!Array.isArray(s.castIds)) s.castIds = [];
      if (!Array.isArray(s.crewIds)) s.crewIds = [];
      if (typeof s.props !== 'string') s.props = '';
      if (typeof s.equipment !== 'string') s.equipment = '';
      if (Array.isArray(s.cast)) {
        for (const name of s.cast) {
          const key = String(name).trim().toLowerCase();
          if (!key) continue;
          let c = byName.get(key);
          if (!c) {
            c = { id: uid(), name: String(name).trim(), actor: '', contact: '' };
            p.characters.push(c);
            byName.set(key, c);
          }
          if (!s.castIds.includes(c.id)) s.castIds.push(c.id);
        }
        delete s.cast;
      }
    }
    return p;
  }

  // Splits a free-text list ("mug, keys\nnewspaper") into items.
  const listItems = (text) => String(text || '').split(/[,\n;]+/).map((x) => x.trim()).filter(Boolean);

  // Equipment implied by how shots are filmed.
  const MOVE_GEAR = {
    Dolly: 'Dolly & track', Truck: 'Dolly & track', Tracking: 'Dolly / tracking vehicle',
    'Push In': 'Dolly or slider', 'Pull Out': 'Dolly or slider', Crane: 'Crane / jib', Gimbal: 'Gimbal', Zoom: 'Zoom lens',
  };
  // Returns [{ item, refs: [shot codes] }] for the given shots ({ shot, code }).
  function shotEquipment(shots) {
    const found = new Map();
    const add = (item, code) => {
      if (!found.has(item)) found.set(item, []);
      if (!found.get(item).includes(code)) found.get(item).push(code);
    };
    const lenses = new Set();
    for (const { shot, code } of shots) {
      if (MOVE_GEAR[shot.move]) add(MOVE_GEAR[shot.move], code);
      if (shot.cam && shot.cam !== 'A') add(`${shot.cam} camera`, code);
      if (parseInt(shot.fps, 10) >= 48) add(`High-speed capture (${shot.fps} fps)`, code);
      if (shot.audio === 'Sync') add('Sound kit (sync sound)', code);
      if (shot.lens) lenses.add(shot.lens);
    }
    const out = [...found].map(([item, refs]) => ({ item, refs }));
    if (lenses.size) {
      const sorted = [...lenses].sort((a, b) => parseFloat(a) - parseFloat(b) || a.localeCompare(b));
      out.unshift({ item: `Lenses: ${sorted.join(', ')}`, refs: [] });
    }
    return out;
  }

  const baseName = (n) => n.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();

  function toFileShape(p) {
    const dateOf = Object.fromEntries(p.days.map((d) => [d.id, d.date]));
    return {
      format: 'shotsheet',
      version: 1,
      title: p.title,
      characters: (p.characters || []).map(({ id, name, actor, contact }) => ({ id, name, actor, contact })),
      crew: (p.crew || []).map(({ id, role, name, contact, allDays }) => ({ id, role, name, contact, allDays })),
      days: [...p.days].sort((a, b) => a.date.localeCompare(b.date))
        .map(({ date, call, wrap, location, notes, equipment }) => ({ date, call, wrap, location, notes, equipment: equipment || '' })),
      scenes: p.scenes.map((s) => ({
        number: s.number,
        heading: s.heading,
        synopsis: s.synopsis || '',
        castIds: s.castIds || [],
        crewIds: s.crewIds || [],
        props: s.props || '',
        equipment: s.equipment || '',
        eighths: s.eighths || 0,
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
      const castIds = new Set(p.scenes.filter((s) => s.shots.some((x) => x.dayId === d.id)).flatMap((s) => s.castIds || []));
      const cast = (p.characters || []).filter((c) => castIds.has(c.id)).map((c) => (c.actor ? `${c.name} (${c.actor})` : c.name));
      const desc = [d.notes, cast.length ? 'Cast: ' + cast.join(', ') : '', shots.length ? `${shots.length} shots:\n` + shots.join('\n') : '']
        .filter(Boolean).join('\n\n');
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
    OPTIONS, SHOT_DEFAULTS, CREW_ROLES, newShot, shotLetter, normalizeProject, upgradeProject, listItems, shotEquipment,
    importFile, toShotsheet, toBackup, toCSV, toICS,
  };
})();
