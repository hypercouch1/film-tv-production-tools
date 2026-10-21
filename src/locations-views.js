// Locations: where the production shoots, and which scenes are shot where.
// p.locations = [{ id, name, address, contact, parking, hospital, power, permit, permitNotes,
// cost, notes, sets: [set name] }]. Scenes match a location through its sets, or by
// scene.locationId (see ShotFormats.locationOf).
(function () {
  const F = () => window.ShotFormats;
  const add = (node, ...kids) => { node.append(...kids.filter((k) => k != null && k !== false)); return node; };

  // Sets in the scene headings that no location covers yet: [{ set, scenes }].
  function unmatchedSets(p) {
    const map = new Map();
    for (const s of p.scenes) {
      if (F().locationOf(p, s)) continue;
      const set = F().setOf(s.heading);
      if (!set) continue;
      const key = set.toLowerCase();
      if (!map.has(key)) map.set(key, { set, scenes: [] });
      map.get(key).scenes.push(s);
    }
    return [...map.values()];
  }

  // The locations of some scenes (e.g. a shoot day's), in scene order, without repeats.
  function locationsFor(p, scenes) {
    const out = [];
    for (const s of scenes) {
      const l = F().locationOf(p, s);
      if (l && !out.includes(l)) out.push(l);
    }
    return out;
  }

  function list(ctx) {
    const { p, el } = ctx;
    const ro = ctx.readOnly();
    p.locations = p.locations || [];
    const wrap = el('div', { class: 'locations' });
    const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    const newLocation = (set) => {
      const l = { id: ctx.uid(), name: set ? titleCase(set) : '', address: '', contact: '', parking: '', hospital: '', power: '', permit: '', permitNotes: '', cost: '', notes: '', sets: set ? [set] : [] };
      p.locations.push(l);
      ctx.save(); ctx.render({ keepScroll: true });
      const n = document.querySelector(`[data-item="${l.id}"] input`);
      if (n) { n.focus(); n.scrollIntoView({ block: 'center' }); }
    };

    // Sets in the script that no location covers yet.
    const loose = unmatchedSets(p);
    if (loose.length) {
      wrap.append(el('section', { class: 'loc-loose' },
        el('h2', { class: 'section-title' }, `SETS WITHOUT A LOCATION (${loose.length})`),
        el('p', { class: 'muted small' }, 'From your scene headings. Add each to a location, so call sheets can fill in the address, parking and hospital.'),
        ...loose.map(({ set, scenes }) => add(el('div', { class: 'loc-loose-row' },
          el('span', { class: 'loc-set' }, set),
          el('span', { class: 'muted small' }, 'SC ' + scenes.map((s) => ctx.sceneCode(p, s)).join(', '))),
        ro ? null : el('button', { class: 'ghost-btn', type: 'button', onclick: () => newLocation(set) }, 'New location'),
        ro || !p.locations.length ? null : el('select', { class: 'field loc-assign', onchange: (e) => {
          const l = p.locations.find((x) => x.id === e.target.value);
          if (!l) return;
          l.sets = [...l.sets, set];
          ctx.save(); ctx.render({ keepScroll: true });
        } }, el('option', { value: '' }, 'Add to…'), ...p.locations.map((l) => el('option', { value: l.id }, l.name || 'Unnamed location')))))));
    }

    add(wrap, el('div', { class: 'loc-head' },
      el('h2', { class: 'section-title' }, `LOCATIONS (${p.locations.length})`),
      ro ? null : el('button', { class: 'ghost-btn', type: 'button', onclick: () => newLocation('') }, '+ Add location')));
    if (!p.locations.length) wrap.append(el('div', { class: 'empty' }, 'No locations yet. Add one, or create them from the sets above.'));

    for (const l of p.locations) {
      const scenes = p.scenes.filter((s) => F().locationOf(p, s) === l);
      const days = ctx.sortedDays(p).filter((d) => scenes.some((s) => ctx.daysForScene(p, s).includes(d)));
      const field = (key, label, opts = {}) => el('label', { class: 'loc-field' + (opts.wide ? ' loc-wide' : '') },
        el('span', {}, label),
        el(opts.multiline ? 'textarea' : 'input', {
          class: 'field', value: l[key] || '', placeholder: opts.placeholder || '', disabled: ro, rows: opts.multiline ? 2 : null,
          oninput: (e) => { l[key] = e.target.value; ctx.save(); },
        }, opts.multiline ? l[key] || '' : null));
      const permit = el('select', { class: 'field', disabled: ro, onchange: (e) => { l.permit = e.target.value; ctx.save(); ctx.render({ keepScroll: true }); } },
        ...F().PERMITS.map(([k, label]) => el('option', { value: k }, label)));
      permit.value = l.permit || '';
      wrap.append(el('section', { class: 'loc-card' + (l.permit ? ' permit-' + l.permit : ''), 'data-item': l.id },
        el('div', { class: 'loc-card-head' },
          el('input', { class: 'loc-name', value: l.name, placeholder: 'Location name', disabled: ro, oninput: (e) => { l.name = e.target.value; ctx.save(); } }),
          l.address ? el('a', { class: 'link-btn', href: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(l.address), target: '_blank', title: 'Open the address in Google Maps' }, 'Map ↗') : null,
          el('span', { class: 'muted small loc-days' }, days.length ? days.map((d) => `Day ${ctx.dayNum(p, d.id)}`).join(', ') : 'Not scheduled'),
          ro ? null : el('button', { class: 'icon-btn del', type: 'button', title: 'Delete location', onclick: () => {
            if (!confirm(`Delete the location "${l.name || 'Unnamed'}"? Its scenes keep their headings.`)) return;
            p.locations = p.locations.filter((x) => x !== l);
            p.scenes.forEach((s) => { if (s.locationId === l.id) s.locationId = null; });
            ctx.save(); ctx.render({ keepScroll: true });
          } }, '✕')),
        el('div', { class: 'loc-grid' },
          field('address', 'Address', { placeholder: 'Street, city', wide: true }),
          field('contact', 'Contact', { placeholder: 'Name, phone, email' }),
          field('cost', 'Fee', { placeholder: 'e.g. $1,500 / day' }),
          field('parking', 'Parking', { multiline: true, placeholder: 'Where crew and trucks park' }),
          field('hospital', 'Nearest hospital', { multiline: true, placeholder: 'Name, address, phone' }),
          field('power', 'Power & facilities', { multiline: true, placeholder: 'Power, toilets, holding area, load-in…' }),
          el('label', { class: 'loc-field' }, el('span', {}, 'Permit'), permit),
          field('permitNotes', 'Permit notes', { placeholder: 'Who issues it, reference, deadline' }),
          field('notes', 'Notes', { multiline: true, placeholder: 'Access, restrictions, neighbours, noise…', wide: true })),
        el('div', { class: 'loc-sets' },
          el('span', { class: 'field-label' }, 'Sets shot here'),
          ...l.sets.map((set, i) => el('span', { class: 'role-chip' }, set,
            ro ? null : el('button', { type: 'button', class: 'role-x', title: 'Remove', onclick: () => { l.sets.splice(i, 1); ctx.save(); ctx.render({ keepScroll: true }); } }, '×'))),
          ro ? null : el('input', { class: 'role-add loc-set-add', placeholder: '+ Set (as in the scene headings)', onkeydown: (e) => {
            if (e.key !== 'Enter' || !e.target.value.trim()) return;
            l.sets.push(e.target.value.trim()); ctx.save(); ctx.render({ keepScroll: true });
          } })),
        el('div', { class: 'loc-scenes muted small' }, scenes.length ? `${scenes.length} scene${scenes.length === 1 ? '' : 's'}: ` + scenes.map((s) => `${ctx.sceneCode(p, s)} ${s.heading}`).join(' · ') : 'No scenes matched yet.')));
    }
    return wrap;
  }

  window.LocationsViews = { list, unmatchedSets, locationsFor };
})();
