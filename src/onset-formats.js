// What happens on set: one "on set" document per production (store 'onset', or a shared
// 'onset' document inside a shared production).
//   reports: daily production reports, one per shoot day
//     { id, dayId, times: { crewCall, firstShot, lunchStart, lunchEnd, afterLunch, wrap, lastOut },
//       scenes: { [sceneId]: { status: '' | 'part' | 'done', note } }, extraSceneIds: [],
//       cast: { [characterId]: { arrive, wrap, note } }, setups, takes (numbers, or null to
//       count from the take log), media, delays, incidents, equipment, notes, by }
//   notes: continuity notes { id, sceneId, shotId, take, cat, text, photos: [photoId], at, by }
// Photos are JPEGs kept beside the document: on this computer, or on the server for a shared
// production.
(function (root) {
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  const TIMES = [
    ['crewCall', 'Crew call'], ['firstShot', 'First shot'], ['lunchStart', 'Lunch'], ['lunchEnd', 'Back from lunch'],
    ['afterLunch', 'First shot after lunch'], ['wrap', 'Camera wrap'], ['lastOut', 'Last person out'],
  ];
  const SCENE_STATUS = [['', 'Not shot'], ['part', 'Part shot'], ['done', 'Completed']];
  const NOTE_CATS = [
    { id: 'wardrobe', label: 'Wardrobe', color: '#4fc1b8' },
    { id: 'props', label: 'Props', color: '#a98be8' },
    { id: 'makeup', label: 'Hair & makeup', color: '#f08bb4' },
    { id: 'set', label: 'Set dressing', color: '#9fb0c4' },
    { id: 'action', label: 'Action & blocking', color: '#f2994a' },
    { id: 'camera', label: 'Camera & lenses', color: '#7fd0ea' },
    { id: 'script', label: 'Dialogue & script', color: '#e6cf2e' },
    { id: 'other', label: 'Other', color: '#b5d35f' },
  ];
  const noteCat = (id) => NOTE_CATS.find((c) => c.id === id) || NOTE_CATS[NOTE_CATS.length - 1];

  const isItem = (x) => x && typeof x === 'object' && !Array.isArray(x) && typeof x.id === 'string';
  const items = (list) => (Array.isArray(list) ? list.filter(isItem) : []);
  const s = (v, max = 2000) => String(v == null ? '' : v).slice(0, max);
  const time = (v) => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : '');
  const map = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const count = (v) => (v === null || v === undefined || v === '' ? null : Math.max(0, Math.round(Number(v)) || 0));
  const ids = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

  function normalizeReport(r) {
    const times = map(r.times);
    return {
      id: r.id, dayId: typeof r.dayId === 'string' ? r.dayId : '',
      times: Object.fromEntries(TIMES.map(([k]) => [k, time(times[k])])),
      scenes: Object.fromEntries(Object.entries(map(r.scenes)).map(([k, v]) => [k, {
        status: SCENE_STATUS.some(([x]) => x === map(v).status) ? map(v).status : '', note: s(map(v).note, 500),
      }])),
      extraSceneIds: ids(r.extraSceneIds),
      cast: Object.fromEntries(Object.entries(map(r.cast)).map(([k, v]) => [k, { arrive: time(map(v).arrive), wrap: time(map(v).wrap), note: s(map(v).note, 300) }])),
      setups: count(r.setups), takes: count(r.takes),
      media: s(r.media, 500), delays: s(r.delays), incidents: s(r.incidents), equipment: s(r.equipment), notes: s(r.notes),
      by: s(r.by, 100),
    };
  }
  function normalizeOnset(d) {
    d = d || {};
    d.title = s(d.title || 'On set', 200);
    if (typeof d.productionId !== 'string') delete d.productionId;
    d.reports = items(d.reports).map(normalizeReport);
    d.notes = items(d.notes).map((n) => ({
      id: n.id, sceneId: typeof n.sceneId === 'string' ? n.sceneId : '', shotId: typeof n.shotId === 'string' ? n.shotId : '',
      take: s(n.take, 20), cat: noteCat(n.cat).id, text: s(n.text, 4000),
      photos: ids(n.photos).filter((p) => /^[\w-]{8,40}$/.test(p)).slice(0, 24),
      at: Number.isFinite(n.at) ? n.at : 0, by: s(n.by, 100),
    }));
    d.comments = Array.isArray(d.comments) ? d.comments : [];
    return d;
  }
  const newOnset = (productionId) => normalizeOnset({ id: uid(), productionId, title: 'On set', reports: [], notes: [] });
  const newReport = (dayId) => normalizeReport({ id: uid(), dayId });
  const newNote = (fields = {}) => ({ id: uid(), sceneId: '', shotId: '', take: '', cat: 'wardrobe', text: '', photos: [], at: Date.now(), by: '', ...fields });

  // Scenes on a shoot day (a shot scheduled that day, or a scene without shots on the stripboard).
  const onDay = (sc, dayId) => (sc.shots.length ? sc.shots.some((x) => x.dayId === dayId) : sc.dayId === dayId);

  // The day's numbers: scenes and pages planned and shot, and the same to date (every report up
  // to and including this day). prod: the production; reports: every report.
  function progress(prod, reports, day) {
    const days = [...prod.days].sort((a, b) => a.date.localeCompare(b.date));
    const upTo = days.filter((d) => d.date <= day.date);
    const byDay = new Map(reports.map((r) => [r.dayId, r]));
    const eighths = (sc) => sc.eighths || 0;
    const tally = (d) => {
      const r = byDay.get(d.id);
      const planned = prod.scenes.filter((sc) => onDay(sc, d.id));
      const extra = r ? r.extraSceneIds.map((id) => prod.scenes.find((sc) => sc.id === id)).filter(Boolean) : [];
      const done = [...planned, ...extra].filter((sc) => r && r.scenes[sc.id] && r.scenes[sc.id].status === 'done');
      return { planned: planned.length, plannedPages: planned.reduce((n, sc) => n + eighths(sc), 0), done: done.length, donePages: done.reduce((n, sc) => n + eighths(sc), 0), reported: !!r };
    };
    const today = tally(day);
    const toDate = upTo.map(tally).reduce((a, t) => ({
      planned: a.planned + t.planned, plannedPages: a.plannedPages + t.plannedPages, done: a.done + t.done, donePages: a.donePages + t.donePages,
    }), { planned: 0, plannedPages: 0, done: 0, donePages: 0 });
    // A scene finished on any day so far counts once.
    const finished = new Set();
    for (const d of upTo) { const r = byDay.get(d.id); if (r) for (const [id, v] of Object.entries(r.scenes)) if (v.status === 'done') finished.add(id); }
    return {
      dayNumber: days.indexOf(day) + 1, days: days.length, today, toDate,
      scenesFinished: finished.size, scenesTotal: prod.scenes.length,
      pagesTotal: prod.scenes.reduce((n, sc) => n + eighths(sc), 0),
      pagesFinished: prod.scenes.filter((sc) => finished.has(sc.id)).reduce((n, sc) => n + eighths(sc), 0),
      // Pages behind (negative) or ahead of the schedule so far.
      aheadBy: toDate.donePages - toDate.plannedPages,
    };
  }

  // From the take log (post document): setups (shots with at least one take) and takes that day.
  function takeCounts(post, dayId) {
    const takes = post && Array.isArray(post.takes) ? post.takes.filter((t) => t.dayId === dayId) : [];
    return { setups: new Set(takes.map((t) => t.shotId).filter(Boolean)).size, takes: takes.length, circled: takes.filter((t) => t.status === 'circle').length };
  }

  root.OnsetFormats = { uid, TIMES, SCENE_STATUS, NOTE_CATS, noteCat, normalizeOnset, normalizeReport, newOnset, newReport, newNote, onDay, progress, takeCounts };
})(typeof window !== 'undefined' ? window : globalThis);
