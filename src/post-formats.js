// Post production document: one per production (store 'post', or a shared 'post' document
// inside a shared production). Kept apart from the production document so a big take log or
// media catalogue doesn't weigh down the rest.
//   takes:    take log    { id, dayId, sceneId, shotId, take, roll, clip, tc, status, notes }
//   media:    catalogue   { id, name, path, kind, size, modified, drive, sceneId, shotId, takeId, notes, tags }
//   tasks:    tracker     { id, area, title, status, assignee, due, notes, sceneIds, source }
//   versions: cuts        { id, name, stage, date, link, notes: [{ id, tc, text, author, at, resolved }] }
(function (root) {
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  const TAKE_STATUS = [['', '—'], ['circle', '◯ Circled'], ['good', '✓ Good'], ['ng', '✕ No good']];
  const AREAS = [
    { id: 'vfx', label: 'Visual effects', color: '#7fd0ea' },
    { id: 'sound', label: 'Sound (ADR, foley, mix)', color: '#c49a6c' },
    { id: 'music', label: 'Music', color: '#e9a6e0' },
    { id: 'color', label: 'Colour', color: '#f2994a' },
    { id: 'edit', label: 'Edit', color: '#e6cf2e' },
    { id: 'other', label: 'Other', color: '#9fb0c4' },
  ];
  const STATUSES = [['todo', 'To do'], ['doing', 'In progress'], ['review', 'In review'], ['done', 'Done']];
  const STAGES = [['assembly', 'Assembly'], ['rough', 'Rough cut'], ['fine', 'Fine cut'], ['lock', 'Picture lock'], ['online', 'Online / conform'], ['other', 'Other']];
  // What kind of file, from its extension.
  const KINDS = {
    video: ['mov', 'mp4', 'mxf', 'r3d', 'braw', 'ari', 'arx', 'avi', 'mkv', 'm4v', 'mts', 'm2ts', 'crm', 'dng', 'webm'],
    audio: ['wav', 'bwf', 'aif', 'aiff', 'mp3', 'm4a', 'flac', 'aac', 'ogg'],
    image: ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'heic', 'psd', 'exr', 'dpx', 'gif', 'webp', 'cr2', 'cr3', 'nef', 'arw'],
    project: ['prproj', 'drp', 'aep', 'fcpxml', 'fcpbundle', 'avb', 'avp', 'edl', 'xml', 'aaf', 'omf', 'ptx', 'sesx'],
    document: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'xls', 'xlsx', 'csv', 'fdx', 'fountain', 'pages', 'numbers', 'key', 'pptx'],
    subtitle: ['srt', 'vtt', 'scc', 'stl'],
  };
  const KIND_LABEL = { video: 'Video', audio: 'Audio', image: 'Image', project: 'Edit / project', document: 'Document', subtitle: 'Captions', other: 'Other' };
  function kindOf(name) {
    const ext = String(name || '').split('.').pop().toLowerCase();
    for (const [k, exts] of Object.entries(KINDS)) if (exts.includes(ext)) return k;
    return 'other';
  }

  const isItem = (x) => x && typeof x === 'object' && !Array.isArray(x) && typeof x.id === 'string';
  const items = (list) => (Array.isArray(list) ? list.filter(isItem) : []);
  const s = (v, max = 500) => String(v == null ? '' : v).slice(0, max);
  const oneOf = (v, list, d) => (list.some(([k]) => k === v) ? v : d);
  const idOrNull = (v) => (typeof v === 'string' && v ? v : null);

  // Fills in and cleans every field (shared documents come from other people).
  function normalizePost(d) {
    d = d || {};
    d.title = s(d.title || 'Post', 200);
    if (typeof d.productionId !== 'string') delete d.productionId;
    d.takes = items(d.takes).map((t) => ({
      id: t.id, dayId: idOrNull(t.dayId), sceneId: idOrNull(t.sceneId), shotId: idOrNull(t.shotId),
      take: s(t.take, 20), roll: s(t.roll, 60), clip: s(t.clip, 120), tc: s(t.tc, 40),
      status: oneOf(t.status, TAKE_STATUS, ''), notes: s(t.notes, 1000),
    }));
    d.media = items(d.media).map((m) => ({
      id: m.id, name: s(m.name, 300), path: s(m.path, 1000), kind: KIND_LABEL[m.kind] ? m.kind : kindOf(m.name),
      size: Number.isFinite(m.size) ? m.size : 0, modified: Number.isFinite(m.modified) ? m.modified : 0,
      drive: s(m.drive, 120), sceneId: idOrNull(m.sceneId), shotId: idOrNull(m.shotId), takeId: idOrNull(m.takeId),
      notes: s(m.notes, 1000), tags: s(m.tags, 300),
    }));
    d.tasks = items(d.tasks).map((t) => ({
      id: t.id, area: AREAS.some((a) => a.id === t.area) ? t.area : 'other', title: s(t.title, 300),
      status: oneOf(t.status, STATUSES, 'todo'), assignee: s(t.assignee, 120), due: /^\d{4}-\d{2}-\d{2}$/.test(t.due) ? t.due : '',
      notes: s(t.notes, 2000), sceneIds: Array.isArray(t.sceneIds) ? t.sceneIds.filter((x) => typeof x === 'string') : [], source: s(t.source, 200),
    }));
    d.versions = items(d.versions).map((v) => ({
      id: v.id, name: s(v.name || 'Cut', 200), stage: oneOf(v.stage, STAGES, 'other'),
      date: /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? v.date : '', link: s(v.link, 1000),
      notes: items(v.notes).map((n) => ({ id: n.id, tc: s(n.tc, 40), text: s(n.text, 2000), author: s(n.author, 120), at: Number(n.at) || 0, resolved: !!n.resolved })),
    }));
    d.comments = Array.isArray(d.comments) ? d.comments : [];
    return d;
  }

  function newPost(productionId) {
    return normalizePost({ id: uid(), productionId, title: 'Post', takes: [], media: [], tasks: [], versions: [] });
  }

  // The next take number for a shot ("1", "2"… or after "4A" comes "5").
  function nextTake(post, shotId) {
    const nums = post.takes.filter((t) => t.shotId === shotId).map((t) => parseInt(t.take, 10)).filter((n) => !isNaN(n));
    return String(nums.length ? Math.max(...nums) + 1 : 1);
  }

  // Links catalogued files to logged takes by clip name ("A001C003" matches A001C003.mov).
  // Returns how many files were linked.
  function matchMedia(post) {
    const byClip = new Map(post.takes.filter((t) => t.clip.trim()).map((t) => [t.clip.trim().toLowerCase(), t]));
    let n = 0;
    for (const m of post.media) {
      if (m.takeId) continue;
      const base = m.name.replace(/\.[^.]+$/, '').toLowerCase();
      const t = byClip.get(base);
      if (t) { m.takeId = t.id; m.shotId = t.shotId; m.sceneId = t.sceneId; n++; }
    }
    return n;
  }

  // ---- CSV ----
  // Cells starting with = + - @ would run as formulas in a spreadsheet: they get a leading '.
  const field = (v) => {
    let x = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(x)) x = "'" + x;
    return /[",\n\r]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x;
  };
  const csv = (rows) => rows.map((r) => r.map(field).join(',')).join('\n') + '\n';
  const statusLabel = (v, list) => (list.find(([k]) => k === v) || [v, v])[1];

  // codeOf(shotId) → "12B"; dayOf(dayId) → "Day 2 (2026-11-03)"
  function takesCSV(post, { codeOf, sceneOf, dayOf }) {
    return csv([['Day', 'Scene', 'Shot', 'Take', 'Roll / card', 'Clip', 'Timecode', 'Status', 'Notes'],
      ...post.takes.map((t) => [dayOf(t.dayId), sceneOf(t.sceneId), codeOf(t.shotId), t.take, t.roll, t.clip, t.tc, t.status ? statusLabel(t.status, TAKE_STATUS).replace(/^[^ ]+ /, '') : '', t.notes])]);
  }
  function mediaCSV(post, { codeOf, sceneOf }) {
    return csv([['Name', 'Kind', 'Size (bytes)', 'Modified', 'Drive', 'Path', 'Scene', 'Shot', 'Notes', 'Tags'],
      ...post.media.map((m) => [m.name, KIND_LABEL[m.kind], m.size, m.modified ? new Date(m.modified).toISOString().slice(0, 10) : '', m.drive, m.path, sceneOf(m.sceneId), codeOf(m.shotId), m.notes, m.tags])]);
  }
  function tasksCSV(post, { scenesOf }) {
    return csv([['Area', 'Task', 'Status', 'Who', 'Due', 'Scenes', 'Notes'],
      ...post.tasks.map((t) => [(AREAS.find((a) => a.id === t.area) || {}).label, t.title, statusLabel(t.status, STATUSES), t.assignee, t.due, scenesOf(t.sceneIds), t.notes])]);
  }
  function notesCSV(post) {
    return csv([['Cut', 'Stage', 'Date', 'Timecode', 'Note', 'By', 'Resolved'],
      ...post.versions.flatMap((v) => v.notes.map((n) => [v.name, statusLabel(v.stage, STAGES), v.date, n.tc, n.text, n.author, n.resolved ? 'yes' : '']))]);
  }

  root.PostFormats = {
    uid, AREAS, STATUSES, STAGES, TAKE_STATUS, KIND_LABEL, kindOf, normalizePost, newPost, nextTake, matchMedia,
    takesCSV, mediaCSV, tasksCSV, notesCSV,
  };
})(typeof window !== 'undefined' ? window : globalThis);
