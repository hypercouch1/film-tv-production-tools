// Comments on parts of a document (script lines, shots, scenes, cues). They live in
// doc.comments, so shared projects sync them like any other edit.
// Comment: { id, target, text, author, authorId, at, resolved }
(function () {
  const { el, uid, relTime } = window.Common;

  // Makes doc.comments a clean list (used when loading local and shared documents).
  function clean(doc) {
    const list = Array.isArray(doc.comments) ? doc.comments : [];
    doc.comments = list.filter((c) => c && typeof c === 'object' && typeof c.id === 'string').map((c) => ({
      id: c.id, target: String(c.target || ''), text: String(c.text || ''), author: String(c.author || ''),
      authorId: String(c.authorId || ''), at: Number(c.at) || Date.now(), resolved: !!c.resolved,
    }));
    return doc;
  }

  function me() {
    const u = window.Cloud && window.Cloud.user;
    return u ? { name: u.name, id: u.id } : { name: 'You', id: 'local' };
  }

  // opts: { getDoc, save, rerender, describe(target) -> label or null, jump(target), readOnly() }
  function attach(o) {
    let panel = null;
    let target = null;      // what new comments attach to
    let showResolved = false;

    const list = () => { const d = o.getDoc(); return d ? (d.comments = d.comments || []) : []; };
    const openFor = (t) => list().filter((c) => c.target === t && !c.resolved);

    function badge(t) {
      const n = openFor(t).length;
      if (!n) return null;
      return el('button', {
        class: 'cm-badge', type: 'button', title: `${n} comment${n === 1 ? '' : 's'}`,
        onmousedown: (e) => e.preventDefault(),
        onclick: (e) => { e.stopPropagation(); open(t); },
      }, '💬 ' + n);
    }

    function open(t) {
      if (t !== undefined) target = t;
      if (!panel) {
        panel = el('aside', { class: 'cm-panel', role: 'complementary', 'aria-label': 'Comments' });
        document.body.append(panel);
      }
      render();
      const box = panel.querySelector('textarea');
      if (box && target) box.focus();
    }

    function close() {
      if (panel) panel.remove();
      panel = null;
    }

    function add(text) {
      if (!text.trim() || !target || o.readOnly()) return;
      const who = me();
      list().push({ id: uid(), target, text: text.trim(), author: who.name, authorId: who.id, at: Date.now(), resolved: false });
      o.save();
      o.rerender();
      render();
    }

    function render() {
      if (!panel) return;
      const ro = o.readOnly();
      const who = me();
      const groups = new Map();
      for (const c of list()) {
        if (c.resolved && !showResolved) continue;
        if (!groups.has(c.target)) groups.set(c.target, []);
        groups.get(c.target).push(c);
      }
      if (target && !groups.has(target)) groups.set(target, []);
      const body = el('div', { class: 'cm-body' });
      if (!groups.size) body.append(el('p', { class: 'cm-empty' }, 'No comments yet. Select something and click Comment to start one.'));
      for (const [t, items] of groups) {
        const label = o.describe(t);
        body.append(el('section', { class: 'cm-group' + (t === target ? ' current' : '') },
          el('button', { class: 'cm-target', type: 'button', onclick: () => { target = t; o.jump(t); render(); } }, label || 'Removed item'),
          ...items.sort((a, b) => a.at - b.at).map((c) => el('div', { class: 'cm-item' + (c.resolved ? ' resolved' : '') },
            el('div', { class: 'cm-meta' }, el('strong', {}, c.author || 'Someone'), ' · ', relTime(c.at)),
            el('div', { class: 'cm-text' }, c.text),
            ro ? null : el('div', { class: 'cm-actions' },
              el('button', { class: 'link-btn', type: 'button', onclick: () => { c.resolved = !c.resolved; o.save(); o.rerender(); render(); } }, c.resolved ? 'Reopen' : 'Resolve'),
              c.authorId === who.id || c.authorId === 'local'
                ? el('button', { class: 'link-btn danger', type: 'button', onclick: () => {
                  const all = list();
                  all.splice(all.indexOf(c), 1);
                  o.save(); o.rerender(); render();
                } }, 'Delete')
                : null)))));
      }
      const box = el('textarea', { class: 'field', rows: 3, placeholder: target ? 'Write a comment… (Ctrl/⌘+Enter to post)' : 'Select something first', disabled: ro || !target });
      box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add(box.value); } });
      const resolvedCount = list().filter((c) => c.resolved).length;
      panel.replaceChildren(
        el('div', { class: 'cm-head' },
          el('h2', {}, 'Comments'),
          resolvedCount ? el('label', { class: 'cm-toggle' },
            el('input', { type: 'checkbox', checked: showResolved, onchange: (e) => { showResolved = e.target.checked; render(); } }),
            ` Resolved (${resolvedCount})`) : null,
          el('button', { class: 'icon-btn', title: 'Close', onclick: close }, '✕')),
        body,
        el('div', { class: 'cm-foot' },
          ro ? el('p', { class: 'cm-empty' }, 'View only: you can read comments but not add them.')
            : el('div', {},
              el('div', { class: 'cm-on' }, target ? 'On: ' + (o.describe(target) || 'Removed item') : 'Nothing selected'),
              box,
              el('button', { class: 'primary-btn', type: 'button', disabled: !target, onclick: () => add(box.value) }, 'Comment'))));
    }

    return {
      badge,
      open,
      close,
      refresh: render,
      setTarget: (t) => { target = t; render(); },
      get isOpen() { return !!panel; },
      openCount: () => list().filter((c) => !c.resolved).length,
    };
  }

  window.Comments = { attach, clean };
})();
