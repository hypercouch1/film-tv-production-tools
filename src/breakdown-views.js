// Script breakdown: what each scene needs (props, wardrobe, vehicles, extras…).
// Items come from two places, merged by category + name:
// - tags in the script (Script Writer: select words, 🏷), found through each scene's link to
//   its script scene (scene.scriptScene.id = the heading line);
// - items added here by hand: p.elements = [{ id, category, name, notes, sceneIds }]
//   (an entry also holds the notes for an item tagged in the script).
(function () {
  const F = () => window.ShotFormats;
  const add = (node, ...kids) => { node.append(...kids.filter((k) => k != null && k !== false)); return node; };

  // Map(script heading line id → [tag]) across the production's scripts.
  function tagIndex(scripts) {
    const out = new Map();
    for (const raw of scripts || []) {
      const doc = window.Screenplay.normalizeDoc(raw);
      for (const [h, tags] of window.Screenplay.tagsByScene(doc)) out.set(h, (out.get(h) || []).concat(tags));
    }
    return out;
  }

  // Every breakdown item in the production: Map(key → { key, category, name, scenes: Set(sceneId),
  // fromScript: Set(sceneId), entry }).
  function catalogue(p, tags) {
    const items = new Map();
    const get = (category, name) => {
      const key = F().elementKey(category, name);
      if (!items.has(key)) items.set(key, { key, category, name: String(name).trim(), scenes: new Set(), fromScript: new Set(), entry: null });
      return items.get(key);
    };
    for (const s of p.scenes) {
      const t = s.scriptScene && tags.get(s.scriptScene.id);
      for (const tag of t || []) {
        if (!F().breakdownCategory(tag.category)) continue;
        const it = get(tag.category, tag.text);
        it.scenes.add(s.id);
        it.fromScript.add(s.id);
      }
    }
    for (const e of p.elements || []) {
      if (!e.name.trim()) continue;
      const it = get(e.category, e.name);
      it.entry = e;
      e.sceneIds.forEach((id) => it.scenes.add(id));
    }
    return items;
  }

  // The items for some scenes, grouped by category in breakdown order:
  // [{ category, items: [{ name, sceneIds, fromScript, notes }] }].
  function forScenes(p, scenes, tags) {
    const ids = new Set(scenes.map((s) => s.id));
    const groups = new Map();
    for (const it of catalogue(p, tags).values()) {
      const hit = [...it.scenes].filter((id) => ids.has(id));
      if (!hit.length) continue;
      if (!groups.has(it.category)) groups.set(it.category, []);
      groups.get(it.category).push({ name: it.name, sceneIds: hit, fromScript: hit.some((id) => it.fromScript.has(id)), notes: it.entry ? it.entry.notes : '' });
    }
    return F().BREAKDOWN.filter((c) => groups.has(c.id)).map((c) => ({
      category: c, items: groups.get(c.id).sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }

  function addItem(p, s, category, name) {
    name = String(name || '').trim();
    if (!name) return;
    const key = F().elementKey(category, name);
    let e = (p.elements || []).find((x) => F().elementKey(x.category, x.name) === key);
    if (!e) {
      e = { id: window.Common.uid(), category, name, notes: '', sceneIds: [] };
      p.elements = [...(p.elements || []), e];
    }
    if (!e.sceneIds.includes(s.id)) e.sceneIds.push(s.id);
  }
  function removeItem(p, s, key) {
    const e = (p.elements || []).find((x) => F().elementKey(x.category, x.name) === key);
    if (e) e.sceneIds = e.sceneIds.filter((id) => id !== s.id);
  }
  function setNotes(p, it, notes) {
    if (!it.entry) {
      it.entry = { id: window.Common.uid(), category: it.category, name: it.name, notes: '', sceneIds: [] };
      p.elements = [...(p.elements || []), it.entry];
    }
    it.entry.notes = notes;
  }

  // ---------- By scene: one breakdown sheet per scene ----------
  function sheets(ctx) {
    const { p, el } = ctx;
    const ro = ctx.readOnly();
    const tags = tagIndex(ctx.scripts);
    const cat = catalogue(p, tags);
    const wrap = el('div', { class: 'breakdown' });
    const scenes = ctx.epScenes(p);
    if (!scenes.length) {
      wrap.append(el('div', { class: 'empty' }, 'No scenes yet. Build the shot list from the script first (Shot Sheet → Import script), then break it down here.'));
      return wrap;
    }
    add(wrap, el('p', { class: 'muted small' },
      'What each scene needs. Items tagged in the script (Script Writer: select words, then 🏷) appear here automatically and are marked 📄; add others below. Each shoot day’s call sheet lists the items for its scenes.'),
    ctx.linkedScript ? null : el('p', { class: 'muted small' }, 'This shot list isn’t linked to a script, so script tags can’t be shown. Use Shot Sheet → Import script with your Script Writer script to link it.'));

    for (const s of scenes) {
      const groups = new Map(F().BREAKDOWN.map((c) => [c.id, []]));
      for (const it of cat.values()) if (it.scenes.has(s.id)) groups.get(it.category).push(it);
      const cast = p.characters.filter((c) => s.castIds.includes(c.id));
      const days = ctx.daysForScene(p, s);
      const box = (c) => {
        const list = groups.get(c.id).sort((a, b) => a.name.localeCompare(b.name));
        const options = [...cat.values()].filter((it) => it.category === c.id).map((it) => it.name);
        const input = ro ? null : el('input', {
          class: 'bd-add', placeholder: '+ Add', list: 'bd-' + c.id,
          onkeydown: (e) => {
            if (e.key !== 'Enter' || !e.target.value.trim()) return;
            e.preventDefault();
            addItem(p, s, c.id, e.target.value);
            ctx.save(); ctx.render({ keepScroll: true });
            const again = document.querySelector(`[data-bd="${CSS.escape(`${s.id}:${c.id}`)}"] .bd-add`);
            if (again) again.focus();
          },
        });
        return add(el('div', { class: 'bd-box' + (list.length ? '' : ' empty-box'), style: `--tag:${c.color}`, 'data-bd': `${s.id}:${c.id}` },
          el('div', { class: 'bd-cat' }, c.label),
          ...list.map((it) => {
            const script = it.fromScript.has(s.id);
            return el('span', { class: 'bd-item', title: script ? 'Tagged in the script (remove the tag there)' : '' },
              script ? el('span', { class: 'bd-src' }, '📄') : null, it.name,
              !script && !ro ? el('button', { class: 'bd-x', type: 'button', title: 'Remove from this scene', onclick: () => { removeItem(p, s, it.key); ctx.save(); ctx.render({ keepScroll: true }); } }, '×') : null);
          })), input, options.length && input ? el('datalist', { id: 'bd-' + c.id }, ...options.map((o) => el('option', { value: o }))) : null);
      };
      wrap.append(el('section', { class: 'bd-sheet', id: 'bd-' + s.id },
        el('header', { class: 'bd-head' },
          el('span', { class: 'bd-code' }, `SC ${s.number}`),
          el('span', { class: 'bd-heading' }, s.heading || 'Untitled scene'),
          s.eighths ? el('span', { class: 'muted small' }, `${ctx.formatEighths(s.eighths)} pg`) : null,
          el('span', { class: 'muted small bd-days' }, days.length ? days.map((d) => `Day ${ctx.dayNum(p, d.id)}`).join(', ') : 'Not scheduled')),
        s.synopsis ? el('p', { class: 'bd-syn muted small' }, s.synopsis) : null,
        el('div', { class: 'bd-cast' }, el('span', { class: 'bd-cat' }, 'Cast'), cast.length ? cast.map((c) => `${p.characters.indexOf(c) + 1}. ${c.name}`).join(' · ') : el('span', { class: 'muted small' }, 'None picked (Shot Sheet → Edit)')),
        el('div', { class: 'bd-grid' }, ...F().BREAKDOWN.map(box))));
    }
    return wrap;
  }

  // ---------- Elements: everything across the production ----------
  function elements(ctx) {
    const { p, el } = ctx;
    const ro = ctx.readOnly();
    const cat = catalogue(p, tagIndex(ctx.scripts));
    const all = [...cat.values()].filter((it) => it.scenes.size || it.entry);
    const wrap = el('div', { class: 'breakdown' });
    if (!all.length) {
      wrap.append(el('div', { class: 'empty' }, 'Nothing broken down yet. Tag words in the script (🏷 in the Script Writer) or add items per scene in "By scene".'));
      return wrap;
    }
    const sceneById = new Map(p.scenes.map((s) => [s.id, s]));
    for (const c of F().BREAKDOWN) {
      const list = all.filter((it) => it.category === c.id).sort((a, b) => a.name.localeCompare(b.name));
      if (!list.length) continue;
      wrap.append(el('section', { class: 'bd-el-group', style: `--tag:${c.color}` },
        el('h2', { class: 'section-title' }, `${c.label.toUpperCase()} (${list.length})`),
        el('div', { class: 'bd-el-rows' }, ...list.map((it) => {
          const scenes = [...it.scenes].map((id) => sceneById.get(id)).filter(Boolean);
          const days = ctx.sortedDays(p).filter((d) => scenes.some((s) => ctx.daysForScene(p, s).includes(d)));
          return el('div', { class: 'bd-el-row' },
            el('span', { class: 'bd-el-name' }, it.name, it.fromScript.size ? el('span', { class: 'bd-src', title: 'Tagged in the script' }, ' 📄') : null),
            el('span', { class: 'muted small' }, scenes.length ? 'SC ' + scenes.map((s) => ctx.sceneCode(p, s)).join(', ') : 'No scenes'),
            el('span', { class: 'muted small' }, days.length ? days.map((d) => `Day ${ctx.dayNum(p, d.id)}`).join(', ') : 'Not scheduled'),
            el('input', { class: 'field', value: it.entry ? it.entry.notes : '', placeholder: 'Notes: quantity, source, who’s bringing it…', disabled: ro,
              onchange: (e) => { setNotes(p, it, e.target.value); ctx.save(); } }));
        }))));
    }
    return wrap;
  }

  window.BreakdownViews = { sheets, elements, tagIndex, catalogue, forScenes, addItem, removeItem };
})();
