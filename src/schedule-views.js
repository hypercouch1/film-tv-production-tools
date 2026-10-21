// Schedule page views that work on whole scenes and people: the stripboard, Day Out of
// Days and availability. The calendar and call sheets live in shotsheet.js; this file gets
// what it needs from there through a context object (see ctx() in shotsheet.js).
//
// Scheduling model: a scene is shot on the days its shots are scheduled on (a scene can be
// split over days). A scene without shots uses scene.dayId. day.sceneOrder keeps the strip
// order within a day. Availability: p.availability[personId] = { off: ['YYYY-MM-DD'], note }.
(function () {
  // ---------- Shared helpers ----------
  // node.append() would show null as the text "null"; skip empty parts.
  const add = (node, ...kids) => { node.append(...kids.filter((k) => k != null && k !== false)); return node; };
  function sceneDays(p, s) {
    if (!s.shots.length) return s.dayId ? [s.dayId] : [];
    return [...new Set(s.shots.map((x) => x.dayId).filter(Boolean))];
  }
  const isUnscheduled = (s) => (s.shots.length ? s.shots.some((x) => !x.dayId) : !s.dayId);
  const scenesOn = (p, dayId) => p.scenes.filter((s) => sceneDays(p, s).includes(dayId));

  // Scenes on a day in strip order (day.sceneOrder first, then production order).
  function orderedScenes(p, day) {
    const on = scenesOn(p, day.id);
    const order = Array.isArray(day.sceneOrder) ? day.sceneOrder : [];
    return on.sort((a, b) => {
      const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return p.scenes.indexOf(a) - p.scenes.indexOf(b);
    });
  }

  // INT/EXT and DAY/NIGHT, for strip colours.
  function sceneKind(heading) {
    const h = String(heading || '').toUpperCase();
    const ext = /^(E\/I|I\/E|INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT)/.test(h) ? 'ie' : /^EXT/.test(h) ? 'ext' : /^INT/.test(h) ? 'int' : '';
    const night = /\b(NIGHT|EVENING|DUSK|LATER\s+-\s+NIGHT)\b/.test(h);
    const day = /\b(DAY|MORNING|AFTERNOON|DAWN|NOON|SUNRISE|SUNSET)\b/.test(h);
    return { ie: ext === 'ext' ? 'EXT' : ext === 'ie' ? 'I/E' : ext === 'int' ? 'INT' : '', dn: night ? 'N' : day ? 'D' : '', cls: `strip-${ext || 'x'}-${night ? 'n' : 'd'}` };
  }
  // The set: heading without INT./EXT. and the time of day.
  const setName = (heading) => String(heading || '').replace(/^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?|INT\.?|EXT\.?)\s*/i, '').replace(/\s+-\s+[^-]*$/, '').trim();

  const castNumber = (p, c) => p.characters.indexOf(c) + 1;
  const offDays = (p, personId) => {
    const a = p.availability && p.availability[personId];
    return new Set(a && Array.isArray(a.off) ? a.off : []);
  };
  // People needed on a day who said they can't work then: [{ person, name }].
  function conflictsOn(p, day) {
    const scenes = scenesOn(p, day.id);
    const out = [];
    for (const c of p.characters) {
      if (scenes.some((s) => s.castIds.includes(c.id)) && offDays(p, c.id).has(day.date)) out.push({ person: c, name: c.actor || c.name });
    }
    for (const k of p.crew) {
      if ((k.allDays || scenes.some((s) => s.crewIds.includes(k.id))) && offDays(p, k.id).has(day.date)) out.push({ person: k, name: k.name || k.role });
    }
    return out;
  }

  // ---------- Stripboard ----------
  // Moves a scene's shots that are on `from` (a day id, or null for unscheduled) to `to`.
  function moveScene(p, s, from, to, beforeId) {
    if (s.shots.length) s.shots.forEach((x) => { if ((x.dayId || null) === from) x.dayId = to; });
    else s.dayId = to;
    for (const d of p.days) {
      d.sceneOrder = (Array.isArray(d.sceneOrder) ? d.sceneOrder : []).filter((id) => id !== s.id || sceneDays(p, s).includes(d.id));
    }
    if (to) {
      const day = p.days.find((d) => d.id === to);
      const order = orderedScenes(p, day).map((x) => x.id).filter((id) => id !== s.id);
      const at = beforeId ? order.indexOf(beforeId) : -1;
      order.splice(at >= 0 ? at : order.length, 0, s.id);
      day.sceneOrder = order;
    }
  }

  function strips(ctx) {
    const { p, el } = ctx;
    const ro = ctx.readOnly();
    const days = ctx.sortedDays(p);
    let drag = null; // { sceneId, from }
    const wrap = el('div', { class: 'stripboard' });

    const drop = (to, beforeId) => (e) => {
      e.preventDefault();
      e.currentTarget.classList.remove('drop-over');
      if (!drag || ro) return;
      const s = p.scenes.find((x) => x.id === drag.sceneId);
      if (!s || (drag.from === to && !beforeId)) return;
      moveScene(p, s, drag.from, to, beforeId);
      drag = null;
      ctx.save(); ctx.render({ keepScroll: true });
    };
    const dropZone = (node, to, beforeId) => {
      node.addEventListener('dragover', (e) => { if (drag) { e.preventDefault(); node.classList.add('drop-over'); } });
      node.addEventListener('dragleave', () => node.classList.remove('drop-over'));
      node.addEventListener('drop', drop(to, beforeId));
      return node;
    };

    const moveSelect = (s, from) => {
      const sel = el('select', { class: 'strip-move', title: 'Move to another day', disabled: ro, onchange: (e) => {
        const to = e.target.value === 'none' ? null : e.target.value;
        moveScene(p, s, from, to);
        ctx.save(); ctx.render({ keepScroll: true });
      } },
      el('option', { value: from || 'none' }, 'Move…'),
      ...days.filter((d) => d.id !== from).map((d) => el('option', { value: d.id }, `Day ${ctx.dayNum(p, d.id)} · ${ctx.fmtDate(d.date, { month: 'short', day: 'numeric' })}`)),
      from ? el('option', { value: 'none' }, 'Unscheduled') : null);
      return sel;
    };

    const strip = (s, from) => {
      const k = sceneKind(s.heading);
      const cast = p.characters.filter((c) => s.castIds.includes(c.id));
      const dayShots = s.shots.filter((x) => (x.dayId || null) === from).length;
      const split = s.shots.length && dayShots < s.shots.length;
      const node = el('div', {
        class: `strip ${k.cls}` + (split ? ' split' : ''), draggable: ro ? 'false' : 'true', 'data-scene': s.id,
        title: s.synopsis || s.heading,
      },
      el('span', { class: 'strip-grip' }, ro ? '' : '⠿'),
      el('span', { class: 'strip-code' }, ctx.sceneCode(p, s)),
      el('span', { class: 'strip-ie' }, k.ie || '—'),
      el('span', { class: 'strip-dn' }, k.dn || '—'),
      el('span', { class: 'strip-set' }, setName(s.heading) || s.heading || 'Untitled scene',
        s.synopsis ? el('span', { class: 'strip-syn' }, s.synopsis) : null),
      el('span', { class: 'strip-pages' }, s.eighths ? ctx.formatEighths(s.eighths) : ''),
      el('span', { class: 'strip-cast', title: cast.map((c) => `${castNumber(p, c)}. ${c.name}`).join('\n') }, cast.map((c) => castNumber(p, c)).join(', ')),
      el('span', { class: 'strip-shots' }, s.shots.length ? (split ? `${dayShots} of ${s.shots.length} shots` : `${s.shots.length} shot${s.shots.length === 1 ? '' : 's'}`) : 'no shots'),
      moveSelect(s, from));
      node.addEventListener('dragstart', (e) => { drag = { sceneId: s.id, from }; e.dataTransfer.effectAllowed = 'move'; node.classList.add('dragging'); });
      node.addEventListener('dragend', () => { node.classList.remove('dragging'); drag = null; });
      if (from) dropZone(node, from, s.id); // drop on a strip: insert before it
      return node;
    };

    const unscheduled = p.scenes.filter(isUnscheduled);
    wrap.append(el('div', { class: 'strip-help muted small' },
      'Drag strips between shoot days (or use Move…). A strip moves the scene’s shots planned for that day. Colours: ',
      el('span', { class: 'legend strip-int-d' }, 'INT day'), el('span', { class: 'legend strip-ext-d' }, 'EXT day'),
      el('span', { class: 'legend strip-int-n' }, 'INT night'), el('span', { class: 'legend strip-ext-n' }, 'EXT night')));

    for (const d of days) {
      const scenes = orderedScenes(p, d);
      const eighths = scenes.reduce((n, s) => n + (s.eighths || 0), 0);
      const clashes = conflictsOn(p, d);
      const box = dropZone(el('section', { class: 'strip-day' + (d.date < ctx.todayStr() ? ' past' : '') }), d.id, null);
      const amount = !scenes.length ? 'Nothing scheduled'
        : `${scenes.length} scene${scenes.length === 1 ? '' : 's'}${eighths ? ` · ${ctx.formatEighths(eighths)} pgs` : ''}`;
      add(box,
        el('header', { class: 'strip-day-head' },
          el('span', { class: 'strip-day-num' }, `DAY ${ctx.dayNum(p, d.id)}`),
          el('span', {}, ctx.fmtDate(d.date, { weekday: 'short', month: 'short', day: 'numeric' })),
          d.location ? el('span', { class: 'muted' }, d.location) : null,
          el('span', { class: 'strip-day-pages' }, amount),
          clashes.length ? el('span', { class: 'clash', title: 'Needed, but said they can’t work this day' }, `⚠ ${clashes.map((x) => x.name).join(', ')} unavailable`) : null,
          el('button', { class: 'link-btn', onclick: () => ctx.openSummary(d.id) }, 'Call sheet')),
        ...scenes.map((s) => strip(s, d.id)),
        scenes.length ? null : el('div', { class: 'strip-empty muted small' }, 'Drop scenes here'));
      wrap.append(box);
    }
    add(wrap,
      ro ? null : el('button', { class: 'ghost-btn add-day-btn', onclick: () => {
        const last = days[days.length - 1];
        const next = last ? ctx.parseYmd(last.date) : new Date();
        if (last) next.setDate(next.getDate() + 1);
        while (p.days.some((x) => x.date === ctx.ymd(next))) next.setDate(next.getDate() + 1);
        ctx.addDay(ctx.ymd(next));
      } }, '+ Add shoot day'),
      dropZone(el('section', { class: 'strip-day unscheduled' },
        el('header', { class: 'strip-day-head' }, el('span', { class: 'strip-day-num' }, 'UNSCHEDULED'),
          el('span', { class: 'muted' }, `${unscheduled.length} scene${unscheduled.length === 1 ? '' : 's'}`)),
        ...unscheduled.map((s) => strip(s, null)),
        unscheduled.length ? null : el('div', { class: 'strip-empty muted small' }, 'Every scene is scheduled.')), null, null));
    return wrap;
  }

  // ---------- Day Out of Days ----------
  // SW start work · W work · H hold (between work days) · WF work finish · SWF single day.
  function doodRow(days, working) {
    const idx = days.map((d, i) => (working(d) ? i : -1)).filter((i) => i >= 0);
    const first = idx[0], last = idx[idx.length - 1];
    const cells = days.map((d, i) => {
      if (working(d)) return idx.length === 1 ? 'SWF' : i === first ? 'SW' : i === last ? 'WF' : 'W';
      return first != null && i > first && i < last ? 'H' : '';
    });
    return { cells, work: idx.length, hold: cells.filter((c) => c === 'H').length, first, last };
  }

  function dood(ctx) {
    const { p, el } = ctx;
    const days = ctx.sortedDays(p);
    if (!days.length) return el('div', { class: 'empty' }, 'Add shoot days (Calendar or Stripboard) to see who works when.');
    const head = el('tr', {},
      el('th', { class: 'dood-name' }, ''),
      ...days.map((d) => el('th', { class: 'dood-day' }, el('div', {}, `${ctx.dayNum(p, d.id)}`), el('div', { class: 'muted' }, ctx.fmtDate(d.date, { month: 'numeric', day: 'numeric' })))),
      ...['Work', 'Hold', 'Total', 'Start', 'Finish'].map((h) => el('th', { class: 'dood-tot' }, h)));
    const table = (rows) => el('table', { class: 'dood' }, el('thead', {}, head.cloneNode(true)), el('tbody', {}, ...rows));
    const row = (label, sub, personId, working) => {
      const r = doodRow(days, working);
      const off = offDays(p, personId);
      return el('tr', {},
        el('td', { class: 'dood-name' }, el('strong', {}, label), sub ? el('span', { class: 'muted small' }, ' ' + sub) : null),
        ...r.cells.map((c, i) => el('td', {
          class: 'dood-cell' + (c ? ' c-' + c.toLowerCase() : '') + (c && c !== 'H' && off.has(days[i].date) ? ' conflict' : '') + (!c && off.has(days[i].date) ? ' off' : ''),
          title: off.has(days[i].date) ? 'Said they can’t work this day' : '',
        }, c)),
        el('td', { class: 'dood-tot' }, String(r.work)),
        el('td', { class: 'dood-tot' }, String(r.hold)),
        el('td', { class: 'dood-tot' }, r.first == null ? '—' : String(r.last - r.first + 1)),
        el('td', { class: 'dood-tot' }, r.first == null ? '—' : ctx.fmtDate(days[r.first].date, { month: 'short', day: 'numeric' })),
        el('td', { class: 'dood-tot' }, r.last == null ? '—' : ctx.fmtDate(days[r.last].date, { month: 'short', day: 'numeric' })));
    };
    const castRows = p.characters.map((c) => row(`${castNumber(p, c)}. ${c.name || 'Unnamed'}`, c.actor, c.id,
      (d) => scenesOn(p, d.id).some((s) => s.castIds.includes(c.id))));
    const crewRows = p.crew.map((k) => row(k.name || k.role || 'Crew', k.name ? k.role : '', k.id,
      (d) => k.allDays || scenesOn(p, d.id).some((s) => s.crewIds.includes(k.id))));
    return el('div', { class: 'dood-wrap' },
      el('p', { class: 'muted small' }, 'SW start work · W work · H hold (paid, not shooting) · WF work finish · SWF start and finish the same day. Red: scheduled on a day they said they can’t work.'),
      el('h2', { class: 'section-title' }, 'CAST'),
      castRows.length ? table(castRows) : el('div', { class: 'muted small' }, 'No characters yet.'),
      el('h2', { class: 'section-title' }, 'CREW'),
      crewRows.length ? table(crewRows) : el('div', { class: 'muted small' }, 'No crew yet.'));
  }

  // ---------- Availability ----------
  // Days people can't work. Click a date to mark it; shoot days are highlighted, and a
  // marked shoot day that the person is needed on shows as a clash.
  let availStart = null; // first date shown (a Sunday)
  function availability(ctx) {
    const { p, el } = ctx;
    const ro = ctx.readOnly();
    p.availability = p.availability && typeof p.availability === 'object' && !Array.isArray(p.availability) ? p.availability : {};
    const days = ctx.sortedDays(p);
    if (!availStart) {
      const base = days.find((d) => d.date >= ctx.todayStr()) || days[0];
      const d = base ? ctx.parseYmd(base.date) : new Date();
      d.setDate(d.getDate() - d.getDay());
      availStart = ctx.ymd(d);
    }
    const start = ctx.parseYmd(availStart);
    const dates = Array.from({ length: 35 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return ctx.ymd(d); });
    const shootOn = new Map(days.map((d) => [d.date, d]));
    const shift = (n) => { const d = ctx.parseYmd(availStart); d.setDate(d.getDate() + n * 7); availStart = ctx.ymd(d); ctx.render({ keepScroll: true }); };

    const toggle = (personId, date) => {
      if (ro) return;
      const a = p.availability[personId] = p.availability[personId] || { off: [], note: '' };
      a.off = Array.isArray(a.off) ? a.off : [];
      a.off = a.off.includes(date) ? a.off.filter((x) => x !== date) : [...a.off, date].sort();
      a.updatedAt = Date.now();
      ctx.save(); ctx.render({ keepScroll: true });
    };
    const needed = (person, isCast, d) => !!d && (isCast
      ? scenesOn(p, d.id).some((s) => s.castIds.includes(person.id))
      : person.allDays || scenesOn(p, d.id).some((s) => s.crewIds.includes(person.id)));

    const head = el('tr', {}, el('th', { class: 'av-name' }, ''),
      ...dates.map((date) => {
        const d = ctx.parseYmd(date);
        const shoot = shootOn.get(date);
        return el('th', { class: 'av-date' + (shoot ? ' shoot' : '') + (d.getDay() === 0 || d.getDay() === 6 ? ' weekend' : '') + (date === ctx.todayStr() ? ' today' : ''),
          title: shoot ? `Day ${ctx.dayNum(p, shoot.id)}` : '' },
        el('div', {}, d.toLocaleDateString(undefined, { weekday: 'narrow' })),
        el('div', {}, String(d.getDate())),
        shoot ? el('div', { class: 'av-day' }, `D${ctx.dayNum(p, shoot.id)}`) : el('div', { class: 'av-day' }, ''));
      }),
      el('th', { class: 'av-note' }, 'Note'));
    const row = (person, label, sub, isCast) => {
      const off = offDays(p, person.id);
      const a = p.availability[person.id];
      return el('tr', {},
        el('td', { class: 'av-name' }, el('strong', {}, label), sub ? el('div', { class: 'muted small' }, sub) : null,
          a && a.source === 'web' ? el('div', { class: 'av-src muted small' }, 'from their link') : null),
        ...dates.map((date) => {
          const shoot = shootOn.get(date);
          const isOff = off.has(date);
          const clash = isOff && needed(person, isCast, shoot);
          return el('td', {
            class: 'av-cell' + (shoot ? ' shoot' : '') + (isOff ? ' off' : '') + (clash ? ' clash' : '') + (ro ? '' : ' editable'),
            title: clash ? 'Can’t work, but scheduled this day' : isOff ? 'Can’t work' : ro ? '' : 'Click to mark as can’t work',
            onclick: () => toggle(person.id, date),
          }, isOff ? '✕' : '');
        }),
        el('td', { class: 'av-note' }, el('input', {
          class: 'field', value: (a && a.note) || '', placeholder: 'e.g. mornings only', disabled: ro,
          onchange: (e) => { const x = p.availability[person.id] = p.availability[person.id] || { off: [], note: '' }; x.note = e.target.value; x.updatedAt = Date.now(); ctx.save(); },
        })));
    };
    const first = ctx.parseYmd(dates[0]), last = ctx.parseYmd(dates[dates.length - 1]);
    const clashCount = days.reduce((n, d) => n + conflictsOn(p, d).length, 0);
    return el('div', { class: 'avail-wrap' },
      el('div', { class: 'avail-head' },
        el('button', { class: 'icon-btn', title: 'Earlier', onclick: () => shift(-1) }, '‹'),
        el('span', { class: 'cal-title' }, `${first.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${last.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`),
        el('button', { class: 'icon-btn', title: 'Later', onclick: () => shift(1) }, '›'),
        clashCount ? el('span', { class: 'clash' }, `⚠ ${clashCount} clash${clashCount === 1 ? '' : 'es'} with the schedule`) : el('span', { class: 'muted small' }, 'No clashes with the schedule'),
        ctx.availabilityActions ? ctx.availabilityActions() : null),
      el('p', { class: 'muted small' }, ro ? 'Days people can’t work.' : 'Click a date to mark a day someone can’t work. Highlighted columns are shoot days; red means they’re scheduled anyway.'),
      el('div', { class: 'avail-scroll' }, el('table', { class: 'avail' },
        el('thead', {}, head),
        el('tbody', {},
          el('tr', { class: 'av-group' }, el('td', { colspan: dates.length + 2 }, 'CAST')),
          ...p.characters.map((c) => row(c, c.actor || c.name || 'Unnamed', c.actor ? `as ${c.name}` : 'No actor yet', true)),
          el('tr', { class: 'av-group' }, el('td', { colspan: dates.length + 2 }, 'CREW')),
          ...p.crew.map((k) => row(k, k.name || k.role || 'Crew', k.name ? k.role : '', false))))));
  }

  window.ScheduleViews = { strips, dood, availability, conflictsOn, sceneDays, scenesOn, sceneKind, doodRow, moveScene, orderedScenes };
})();
