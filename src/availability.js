// Asking cast and crew for their availability with personal links (shared productions only).
// Each person gets a code; they open film.prismdashboard.cc/a/<code>, tap the days they can't
// work, and their answer lands in the production's availability (live, for everyone).
// Codes are kept in p.availabilityLinks so anyone in the production can copy them again.
(function () {
  const { el, toast, modal } = window.Common;
  const Cloud = window.Cloud;

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => new Date(s + 'T00:00');
  const fmt = (s) => parse(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  // Everyone who can be asked: [{ id, name, role, kind }].
  function people(p) {
    return [
      ...p.characters.map((c) => ({ id: c.id, name: c.actor || c.name || 'Unnamed', role: c.actor ? c.name : 'Cast', kind: 'Cast' })),
      ...p.crew.map((k) => ({ id: k.id, name: k.name || k.role || 'Crew', role: k.name ? k.role : 'Crew', kind: 'Crew' })),
    ];
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const t = el('textarea', { style: 'position:fixed;opacity:0' }, text);
      document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
    }
    toast('Copied');
  }

  // Dates to ask about: around the shoot days (or the next two months).
  function defaultRange(p) {
    const days = p.days.map((d) => d.date).sort();
    const today = ymd(new Date());
    const start = days.length ? days[0] : today;
    const s = parse(start); s.setDate(s.getDate() - 7);
    const e = parse(days.length ? days[days.length - 1] : start); e.setDate(e.getDate() + (days.length ? 7 : 60));
    return { start: ymd(s) < today ? today : ymd(s), end: ymd(e) };
  }

  function requestDialog(p, opts) {
    const range = defaultRange(p);
    const start = el('input', { class: 'field', type: 'date', value: range.start });
    const end = el('input', { class: 'field', type: 'date', value: range.end });
    const rows = people(p).map((x) => {
      const box = el('input', { type: 'checkbox', checked: !p.availabilityLinks[x.id] });
      return { x, box, node: el('label', { class: 'av-pick' }, box, el('span', {}, el('strong', {}, x.name), el('span', { class: 'muted small' }, ` ${x.role}`)),
        p.availabilityLinks[x.id] ? el('span', { class: 'muted small' }, 'already has a link (a new one replaces it)') : null) };
    });
    const go = el('button', { class: 'primary-btn', type: 'button' }, 'Create links');
    const error = el('p', { class: 'form-error' });
    const body = el('div', { class: 'av-request' },
      el('p', { class: 'muted small' }, 'Each person gets a personal link to mark the days they can’t work — no app or account needed. Their answers appear here, and clashes with the schedule are flagged.'),
      el('div', { class: 'av-range' }, el('label', {}, el('span', {}, 'From'), start), el('label', {}, el('span', {}, 'To'), end)),
      el('div', { class: 'av-people' },
        rows.length ? null : el('p', { class: 'muted' }, 'Add cast and crew first (Shot Sheet → Cast & Crew).'),
        ...rows.map((r) => r.node)),
      error,
      el('div', { class: 'modal-foot' }, go));
    const m = modal('Ask for availability', body, { wide: true });
    go.addEventListener('click', async () => {
      error.textContent = '';
      const chosen = rows.filter((r) => r.box.checked).map((r) => r.x);
      if (!chosen.length) { error.textContent = 'Choose at least one person.'; return; }
      if (!start.value || !end.value || end.value < start.value) { error.textContent = 'Choose the dates to ask about.'; return; }
      go.disabled = true;
      try {
        const links = await Cloud.createAvailabilityLinks(p.id, { start: start.value, end: end.value, people: chosen.map((x) => ({ personId: x.id, name: x.name, role: x.role })) });
        const now = Date.now();
        for (const l of links) p.availabilityLinks[l.personId] = { code: l.code, at: now, start: start.value, end: end.value };
        opts.save(); opts.render({ keepScroll: true });
        m.close();
        linksDialog(p, opts, new Set(links.map((l) => l.personId)));
      } catch (err) { error.textContent = err.message; go.disabled = false; }
    });
  }

  function linksDialog(p, opts, fresh = new Set()) {
    const ro = opts.readOnly();
    const list = el('div', { class: 'av-links' }, el('p', { class: 'muted' }, 'Loading…'));
    const all = () => people(p).filter((x) => p.availabilityLinks[x.id]);
    const copyAll = el('button', { class: 'ghost-btn', type: 'button', onclick: () => copy(all().map((x) => `${x.name} (${x.role}): ${Cloud.availabilityLink(p.availabilityLinks[x.id].code)}`).join('\n')) }, 'Copy all');
    const body = el('div', {},
      el('p', { class: 'muted small' }, fresh.size ? 'Send each person their link (text or email). They can change their answer any time.' : 'The links sent out, and who has answered.'),
      list,
      el('div', { class: 'modal-foot spread' }, copyAll, ro ? el('span') : el('button', { class: 'ghost-btn', type: 'button', onclick: () => { m.close(); requestDialog(p, opts); } }, 'Ask more people…')));
    const m = modal('Availability links', body, { wide: true });
    const draw = (status) => {
      const rows = all();
      list.replaceChildren(...(rows.length ? rows.map((x) => {
        const l = p.availabilityLinks[x.id];
        const url = Cloud.availabilityLink(l.code);
        const st = status.get(x.id);
        return el('div', { class: 'av-link-row' + (fresh.has(x.id) ? ' fresh' : '') },
          el('div', {}, el('strong', {}, x.name), el('div', { class: 'muted small' }, `${x.role} · ${l.start && l.end ? `${fmt(l.start)} – ${fmt(l.end)}` : ''}`)),
          el('input', { class: 'field av-url', value: url, readonly: true, onclick: (e) => e.target.select() }),
          el('button', { class: 'ghost-btn', type: 'button', onclick: () => copy(url) }, 'Copy'),
          el('span', { class: 'small ' + (st && st.respondedAt ? 'av-answered' : 'muted') },
            !st ? 'Not active' : st.respondedAt ? `Answered ${new Date(st.respondedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'Waiting'),
          ro ? null : el('button', { class: 'icon-btn del', type: 'button', title: 'Stop this link working', onclick: async () => {
            if (!confirm(`Stop ${x.name}'s link working? Their answers so far stay.`)) return;
            try { await Cloud.revokeAvailabilityLink(p.id, x.id); } catch (err) { alert(err.message); return; }
            delete p.availabilityLinks[x.id];
            opts.save(); opts.render({ keepScroll: true });
            status.delete(x.id); draw(status);
          } }, '✕'));
      }) : [el('p', { class: 'muted' }, 'No links yet.')]));
    };
    Cloud.availabilityLinks(p.id)
      .then((ls) => draw(new Map(ls.map((x) => [x.personId, x]))))
      .catch(() => draw(new Map()));
  }

  // Buttons on the Availability view.
  function actions(p, opts) {
    p.availabilityLinks = p.availabilityLinks || {};
    const n = Object.keys(p.availabilityLinks).length;
    if (!opts.isCloud) {
      return el('span', { class: 'avail-actions' }, el('button', {
        class: 'ghost-btn', type: 'button', title: 'Personal links need the production online',
        onclick: () => alert('Personal availability links work for shared productions.\n\nClick Share (top right) to move this production online, then ask people here. You can also mark days by clicking the grid.'),
      }, 'Ask by link…'));
    }
    return el('span', { class: 'avail-actions' },
      n ? el('button', { class: 'ghost-btn', type: 'button', onclick: () => linksDialog(p, opts) }, `Links (${n})`) : null,
      opts.readOnly() ? null : el('button', { class: 'primary-btn', type: 'button', onclick: () => requestDialog(p, opts) }, 'Ask by link…'));
  }

  window.Availability = { actions, people, defaultRange };
})();
