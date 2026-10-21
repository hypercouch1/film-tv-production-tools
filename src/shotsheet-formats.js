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

  // A crew member can have several roles ("Director, Producer"). They're kept as one
  // comma-separated `role` string, so files, exports and older versions of the app (in
  // shared projects) all keep working and show every role.
  function crewRoles(k) {
    const seen = new Set();
    return str(k && k.role).split(',').map((r) => r.trim()).filter((r) => {
      const key = r.toLowerCase();
      if (!r || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function setCrewRoles(k, roles) {
    k.role = crewRoles({ role: roles.join(',') }).join(', ');
    return k;
  }

  const ids = (list, map) => (Array.isArray(list) ? list.map((x) => map[x] || null).filter(Boolean) : []);

  // Call sheet details for a shoot day (all free text), besides date / call / wrap / location / notes.
  // crewCall: general crew call; call: shooting call. calls: { [characterId or crewId]: 'HH:MM' }.
  const DAY_EXTRA_KEYS = ['crewCall', 'parking', 'hospital', 'weather', 'sunrise', 'sunset', 'weatherPlace'];

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
          ...DAY_EXTRA_KEYS.reduce((o, k) => ({ ...o, [k]: str(d[k]) }), {}),
          calls: {}, // filled in below once character / crew ids are known
          _rawCalls: d.calls,
        };
        if (d.id) idMap[d.id] = day.id;
        dateMap[d.date] = day.id;
        return day;
      });
    const epMap = {};
    const episodes = (Array.isArray(raw.episodes) ? raw.episodes : []).map((e, i) => {
      const out = { id: uid(), number: str(e && e.number, String(i + 1)), title: str(e && e.title), scriptLink: (e && e.scriptLink) || null };
      if (e && e.id) epMap[e.id] = out.id;
      return out;
    });
    const scenes = (Array.isArray(raw.scenes) ? raw.scenes : []).map((s, i) => ({
      id: uid(),
      ...(s && s.episodeId && epMap[s.episodeId] ? { episodeId: epMap[s.episodeId] } : {}),
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
      // The script scene this came from: its heading line id and a fingerprint of its content.
      scriptScene: s && s.scriptScene && typeof s.scriptScene.id === 'string'
        ? { id: s.scriptScene.id, hash: str(s.scriptScene.hash), ...(typeof s.scriptScene.number === 'string' ? { number: s.scriptScene.number } : {}) } : null,
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
    // Call times are keyed by person; remap them to the new ids.
    for (const d of days) {
      const raw = d._rawCalls && typeof d._rawCalls === 'object' ? d._rawCalls : {};
      for (const [k, v] of Object.entries(raw)) {
        const id = charMap[k] || crewMap[k];
        if (id && typeof v === 'string') d.calls[id] = v;
      }
      delete d._rawCalls;
    }
    const link = raw.scriptLink && typeof raw.scriptLink.scriptId === 'string'
      ? { scriptId: raw.scriptLink.scriptId, title: str(raw.scriptLink.title), auto: raw.scriptLink.auto !== false, ignored: raw.scriptLink.ignored } : null;
    return upgradeProject({
      id: uid(), title: str(raw.title, fallbackTitle || 'Untitled Project'), updatedAt: Date.now(), scenes, days, characters, crew,
      scriptLink: link, comments: Array.isArray(raw.comments) ? raw.comments : [],
      type: raw.type === 'tv' ? 'tv' : 'film', episodes,
    });
  }

  // A project is a production: a film, or a TV show with episodes (each with its own
  // script and scenes; cast, crew and the schedule are shared). Safe to call repeatedly.
  function upgradeProduction(p) {
    if (p.type !== 'tv') p.type = 'film';
    p.episodes = items(p.episodes).map((e, i) => ({
      id: e.id,
      number: String(e.number == null || e.number === '' ? i + 1 : e.number),
      title: String(e.title == null ? '' : e.title),
      scriptLink: e.scriptLink && typeof e.scriptLink.scriptId === 'string'
        ? { ...e.scriptLink, title: String(e.scriptLink.title || ''), auto: e.scriptLink.auto !== false, ignored: idList(e.scriptLink.ignored) } : null,
    }));
    if (p.type === 'tv' && !p.episodes.length) p.episodes.push({ id: uid(), number: '1', title: '', scriptLink: null });
    const epIds = new Set(p.episodes.map((e) => e.id));
    for (const s of Array.isArray(p.scenes) ? p.scenes : []) {
      if (p.type === 'tv') { if (!epIds.has(s.episodeId)) s.episodeId = p.episodes[0].id; } else delete s.episodeId;
    }
    return p;
  }

  // Fills in fields added in later versions, in place, so older local and shared
  // projects keep working. Scene cast given as names becomes character entries.
  // Also makes every field the expected type: shared projects come from other people,
  // and malformed data shouldn't be able to break the page.
  const isItem = (x) => x && typeof x === 'object' && !Array.isArray(x) && typeof x.id === 'string';
  const items = (list) => (Array.isArray(list) ? list.filter(isItem) : []);
  const texts = (o, keys) => keys.forEach((k) => { if (typeof o[k] !== 'string') o[k] = o[k] == null ? '' : String(o[k]); });
  const idList = (list) => (Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []);

  function upgradeProject(p) {
    p.title = String(p.title == null ? 'Untitled Project' : p.title);
    p.characters = items(p.characters);
    p.crew = items(p.crew);
    p.days = items(p.days).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date));
    p.scenes = items(p.scenes);
    p.characters.forEach((c) => texts(c, ['name', 'actor', 'contact']));
    p.crew.forEach((k) => { texts(k, ['role', 'name', 'contact']); k.allDays = !!k.allDays; });
    p.days.forEach((d) => {
      texts(d, ['call', 'wrap', 'location', 'notes', 'equipment', ...DAY_EXTRA_KEYS]);
      const calls = d.calls && typeof d.calls === 'object' && !Array.isArray(d.calls) ? d.calls : {};
      d.calls = Object.fromEntries(Object.entries(calls).filter(([, v]) => typeof v === 'string'));
    });
    if (!p.scriptLink || typeof p.scriptLink.scriptId !== 'string') p.scriptLink = null;
    else {
      p.scriptLink.auto = p.scriptLink.auto !== false; // keep in step with the script automatically
      p.scriptLink.ignored = idList(p.scriptLink.ignored); // script scenes left out on purpose
    }
    // Comments: { id, target, text, author, authorId, at, resolved }
    p.comments = items(p.comments).map((c) => ({
      id: c.id, target: String(c.target || ''), text: String(c.text || ''), author: String(c.author || ''),
      authorId: String(c.authorId || ''), at: Number(c.at) || Date.now(), resolved: !!c.resolved,
    }));
    const byName = new Map(p.characters.map((c) => [c.name.trim().toLowerCase(), c]));
    for (const s of p.scenes) {
      texts(s, ['number', 'heading', 'synopsis', 'props', 'equipment']);
      if (!Number.isFinite(s.eighths)) s.eighths = 0;
      if (!s.scriptScene || typeof s.scriptScene.id !== 'string') s.scriptScene = null;
      else if (s.scriptScene.number != null && typeof s.scriptScene.number !== 'string') delete s.scriptScene.number;
      s.shots = items(s.shots);
      s.shots.forEach((sh) => {
        texts(sh, ['type', 'angle', 'move', 'lens', 'cam', 'fps', 'audio', 'desc', 'notes']);
        if (typeof sh.dayId !== 'string') sh.dayId = null;
        sh.done = !!sh.done;
      });
      s.castIds = idList(s.castIds);
      s.crewIds = idList(s.crewIds);
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
    return upgradeProduction(p);
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
        .map((d) => ({
          date: d.date, call: d.call, wrap: d.wrap, location: d.location, notes: d.notes, equipment: d.equipment || '',
          ...DAY_EXTRA_KEYS.reduce((o, k) => ({ ...o, [k]: d[k] || '' }), {}),
          calls: d.calls || {},
        })),
      scriptLink: p.scriptLink || null,
      comments: p.comments || [],
      type: p.type === 'tv' ? 'tv' : 'film',
      episodes: (p.episodes || []).map(({ id, number, title, scriptLink }) => ({ id, number, title, scriptLink: scriptLink || null })),
      scenes: p.scenes.map((s) => ({
        ...(s.episodeId ? { episodeId: s.episodeId } : {}),
        number: s.number,
        heading: s.heading,
        synopsis: s.synopsis || '',
        castIds: s.castIds || [],
        crewIds: s.crewIds || [],
        props: s.props || '',
        equipment: s.equipment || '',
        eighths: s.eighths || 0,
        scriptScene: s.scriptScene || null,
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
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Production Tools//Shot Sheet//EN', 'CALSCALE:GREGORIAN'];
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
    OPTIONS, SHOT_DEFAULTS, CREW_ROLES, crewRoles, setCrewRoles, upgradeProduction, newShot, shotLetter, normalizeProject, upgradeProject, listItems, shotEquipment,
    importFile, toShotsheet, toBackup, toCSV, toICS,
  };
})();
