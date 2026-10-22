// Sending call sheets to cast and crew's phones (shared productions only). Each person gets a
// personal page (film.prismdashboard.cc/c/<code>) with their shoot days and call times, each
// day's call sheet once it's sent, a "Got it" button, and a calendar to subscribe to. Codes
// are kept in p.crewLinks so anyone in the production can copy them again.
(function () {
  const { el, toast, modal } = window.Common;
  const Cloud = window.Cloud;

  const fmt = (s, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => new Date(s + 'T00:00').toLocaleDateString(undefined, opts);
  const time = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
  const when = (ms) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const t = el('textarea', { style: 'position:fixed;opacity:0' }, text);
      document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
    }
    toast('Copied');
  }

  // Everyone in the production: [{ id, name, role }] (the actor's name for cast).
  const everyoneIn = (p) => [
    ...p.characters.map((c) => ({ id: c.id, name: c.actor || c.name || 'Unnamed', role: c.actor ? c.name : 'Cast' })),
    ...p.crew.map((k) => ({ id: k.id, name: k.name || k.role || 'Crew', role: k.name ? k.role : 'Crew' })),
  ];
  // Who works a shoot day (the call sheet's cast and crew), with their call time.
  const onDay = (s, dayId) => (s.shots.length ? s.shots.some((x) => x.dayId === dayId) : s.dayId === dayId);
  function peopleOn(p, day) {
    const scenes = p.scenes.filter((s) => onDay(s, day.id));
    const calls = day.calls || {};
    const byId = new Map(everyoneIn(p).map((x) => [x.id, x]));
    return [
      ...p.characters.filter((c) => scenes.some((s) => s.castIds.includes(c.id))).map((c) => ({ ...byId.get(c.id), call: calls[c.id] || day.call })),
      ...p.crew.filter((k) => k.allDays || scenes.some((s) => s.crewIds.includes(k.id))).map((k) => ({ ...byId.get(k.id), call: calls[k.id] || day.crewCall || day.call })),
    ];
  }

  const notShared = () => alert('Call sheets go to people’s phones in shared productions.\n\nClick Share (top right) to move this production online, then send the call sheet from here. You can still print it or export a PDF.');

  // Makes personal pages for these people (a new one replaces an old one).
  async function makePages(p, opts, people) {
    const links = await Cloud.createCrewLinks(opts.cloudId, people.map((x) => ({ personId: x.id, name: x.name, role: x.role })));
    const now = Date.now();
    for (const l of links) p.crewLinks[l.personId] = { code: l.code, at: now };
    opts.save();
    return links;
  }

  // The call sheet's "Send to cast & crew" dialog. opts: { save, render, readOnly, isCloud,
  // cloudId, dayNum }.
  function sendDialog(p, day, opts) {
    if (!opts.isCloud) return notShared();
    p.crewLinks = p.crewLinks || {};
    const ro = opts.readOnly();
    const people = peopleOn(p, day);
    const list = el('div', { class: 'cl-list' }, el('p', { class: 'muted' }, 'Loading…'));
    const status = el('p', { class: 'muted small' });
    const error = el('p', { class: 'form-error' });
    const sendBtn = el('button', { class: 'primary-btn', type: 'button' }, 'Send call sheet');
    const message = (x) => `${p.title}: Day ${opts.dayNum} call sheet, ${fmt(day.date, { weekday: 'long', month: 'long', day: 'numeric' })}. Your call ${time(x.call) || 'TBC'}. ${Cloud.crewLink(p.crewLinks[x.id].code)}`;
    const copyAll = el('button', { class: 'ghost-btn', type: 'button', onclick: () => {
      const withPages = people.filter((x) => p.crewLinks[x.id]);
      if (!withPages.length) { toast('Nobody has a page yet'); return; }
      copy(withPages.map((x) => `${x.name}: ${message(x)}`).join('\n\n'));
    } }, 'Copy messages for everyone');
    const body = el('div', {},
      el('p', { class: 'muted small' }, 'Everyone on this day gets a personal page on their phone with their call time and this call sheet, a "Got it" button, and their shoot days in their calendar. No app or account needed. Text or email each person their link once; after that, sending again updates their page.'),
      status, list, error,
      el('div', { class: 'modal-foot spread' }, copyAll, ro ? el('span') : sendBtn));
    const m = modal(`Day ${opts.dayNum} call sheet · ${fmt(day.date)}`, body, { wide: true });

    let state = { sentAt: null, confirms: new Map(), opened: new Map() };
    const draw = () => {
      status.textContent = state.sentAt ? `Sent ${when(state.sentAt)}. ${state.confirms.size} of ${people.length} ${people.length === 1 ? 'has' : 'have'} said "Got it". Changed something? Send it again and everyone confirms the new version.` : 'Not sent yet.';
      sendBtn.textContent = state.sentAt ? 'Send again' : 'Send call sheet';
      list.replaceChildren(...(people.length ? people.map((x) => {
        const l = p.crewLinks[x.id];
        const got = state.confirms.get(x.id);
        const opened = state.opened.get(x.id);
        return el('div', { class: 'cl-row' },
          el('div', {}, el('strong', {}, x.name), el('div', { class: 'muted small' }, `${x.role} · call ${time(x.call) || 'TBC'}`)),
          l ? el('input', { class: 'field cl-url', value: Cloud.crewLink(l.code), readonly: true, onclick: (e) => e.target.select() }) : el('span', { class: 'muted small' }, 'No page yet: made when you send'),
          l ? el('button', { class: 'ghost-btn', type: 'button', title: 'Copy a message with their call time and link', onclick: () => copy(message(x)) }, 'Copy') : el('span'),
          el('span', { class: 'small ' + (got ? 'cl-ok' : 'muted') }, got ? `✓ Got it ${when(got)}` : !l ? '' : opened ? 'Opened, not confirmed' : 'Not opened yet'));
      }) : [el('p', { class: 'muted' }, 'Nobody is on this day yet. Pick cast for the day’s scenes, and mark core crew "Every day" in Cast & Crew.')]));
    };
    const refresh = () => Promise.all([
      Cloud.callSheetStatus(opts.cloudId, day.id),
      Cloud.crewLinks(opts.cloudId).catch(() => []),
    ]).then(([s, links]) => {
      state = { sentAt: s.sentAt, confirms: new Map(s.confirms.map((c) => [c.personId, c.confirmedAt])), opened: new Map(links.filter((l) => l.openedAt).map((l) => [l.personId, l.openedAt])) };
      // Pages made on another computer (or revoked) since this copy was saved.
      const live = new Set(links.map((l) => l.personId));
      let changed = false;
      for (const id of Object.keys(p.crewLinks)) if (!live.has(id) && !ro) { delete p.crewLinks[id]; changed = true; }
      if (changed) opts.save();
      draw();
    }).catch((err) => { error.textContent = err.message; draw(); });

    sendBtn.addEventListener('click', async () => {
      error.textContent = '';
      if (!people.length) { error.textContent = 'Nobody is on this day yet.'; return; }
      sendBtn.disabled = true;
      try {
        const missing = people.filter((x) => !p.crewLinks[x.id]);
        if (missing.length) await makePages(p, opts, missing);
        await Cloud.sendCallSheet(opts.cloudId, day.id);
        opts.render({ keepScroll: true });
        toast(missing.length ? `Sent. ${missing.length} new page${missing.length === 1 ? '' : 's'}: copy the messages and send them` : 'Sent: everyone’s page shows the new call sheet');
        await refresh();
      } catch (err) { error.textContent = err.message; }
      sendBtn.disabled = false;
    });
    draw();
    refresh();
    return m;
  }

  // Everyone's pages: copy, see who has opened theirs, make new ones, revoke.
  function pagesDialog(p, opts) {
    if (!opts.isCloud) return notShared();
    p.crewLinks = p.crewLinks || {};
    const ro = opts.readOnly();
    const everyone = everyoneIn(p);
    const list = el('div', { class: 'cl-list' }, el('p', { class: 'muted' }, 'Loading…'));
    const error = el('p', { class: 'form-error' });
    const makeAll = el('button', { class: 'primary-btn', type: 'button' }, 'Make pages for everyone without one');
    const body = el('div', {},
      el('p', { class: 'muted small' }, 'Each person’s page shows their shoot days and call times, each day’s call sheet once it’s sent (with "Got it"), and a calendar they can subscribe to. Send each person their link once.'),
      list, error,
      el('div', { class: 'modal-foot spread' },
        el('button', { class: 'ghost-btn', type: 'button', onclick: () => {
          const rows = everyone.filter((x) => p.crewLinks[x.id]);
          if (!rows.length) { toast('Nobody has a page yet'); return; }
          copy(rows.map((x) => `${x.name} (${x.role}): ${Cloud.crewLink(p.crewLinks[x.id].code)}`).join('\n'));
        } }, 'Copy all'),
        ro ? el('span') : makeAll));
    modal('Crew pages', body, { wide: true });
    let opened = new Map();
    const draw = () => {
      list.replaceChildren(...(everyone.length ? everyone.map((x) => {
        const l = p.crewLinks[x.id];
        return el('div', { class: 'cl-row pages' },
          el('div', {}, el('strong', {}, x.name), el('div', { class: 'muted small' }, x.role)),
          l ? el('input', { class: 'field cl-url', value: Cloud.crewLink(l.code), readonly: true, onclick: (e) => e.target.select() }) : el('span', { class: 'muted small' }, 'No page'),
          l ? el('button', { class: 'ghost-btn', type: 'button', onclick: () => copy(Cloud.crewLink(l.code)) }, 'Copy') : el('span'),
          el('span', { class: 'small ' + (opened.get(x.id) ? 'cl-ok' : 'muted') }, l ? (opened.get(x.id) ? `Opened ${when(opened.get(x.id))}` : 'Not opened yet') : ''),
          ro ? null : l
            ? el('button', { class: 'icon-btn del', type: 'button', title: 'Stop this page working', onclick: async () => {
              if (!confirm(`Stop ${x.name}'s page working? You can make a new one later.`)) return;
              try { await Cloud.revokeCrewLink(opts.cloudId, x.id); } catch (err) { alert(err.message); return; }
              delete p.crewLinks[x.id]; opts.save(); draw();
            } }, '✕')
            : el('button', { class: 'ghost-btn', type: 'button', onclick: async () => {
              try { await makePages(p, opts, [x]); } catch (err) { error.textContent = err.message; return; }
              draw();
            } }, 'Make page'));
      }) : [el('p', { class: 'muted' }, 'Add cast and crew first (Shot Sheet → Cast & Crew).')]));
    };
    makeAll.addEventListener('click', async () => {
      const missing = everyone.filter((x) => !p.crewLinks[x.id]);
      if (!missing.length) { toast('Everyone has a page'); return; }
      makeAll.disabled = true;
      try { await makePages(p, opts, missing); draw(); toast(`${missing.length} page${missing.length === 1 ? '' : 's'} made`); } catch (err) { error.textContent = err.message; }
      makeAll.disabled = false;
    });
    Cloud.crewLinks(opts.cloudId).then((links) => { opened = new Map(links.filter((l) => l.openedAt).map((l) => [l.personId, l.openedAt])); draw(); }).catch(() => draw());
    draw();
  }

  window.CrewLinks = { sendDialog, pagesDialog, peopleOn };
})();
