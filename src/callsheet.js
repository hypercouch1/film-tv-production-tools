(function () {
  const { api, uid, $, mod, fmt, el, toast, relTime } = window.Common;
  const safeFileName = (s) => window.Common.safeFileName(s, 'call-sheet');

  let state = { sheets: [], activeId: null, sidebarHidden: false };
  let editing = false;
  let history = []; // item ids checked via keyboard/click, for undo
  let search = '';

  // ---------- Sample ----------
  function sampleSheet() {
    const mk = (title, items) => ({ title, items: items.map((text) => ({ text })) });
    return window.Formats.normalizeSheet({
      title: 'RTN Tonight',
      sections: [
        mk('Prep', ['Confirm talent mics and IFBs', 'Load graphics package', 'Check *server red/blue* clips cued', 'Start with countdown to intro']),
        mk('Live', ['Stand by, top of show', 'Roll countdown', 'We are *LIVE*']),
        mk('Intro / Stories', [
          'Ready intro, ready audio',
          'Take intro (server *red/blue*) , take audio',
          'Ready *cam 3*, ready clap in',
          'Take *Cam 3*, Take clapin',
          'Take lower thirds (cue talent)',
        ]),
        mk('Interview', ['Ready *cam 2* two-shot', 'Take *cam 2*, cue host', 'Lower third: guest name', 'Wrap interview, ready *cam 1*']),
        mk('Show & Tell', ['Ready *cam 4* close-up', 'Take *cam 4*, roll B-roll', 'Back to *cam 1*']),
        mk('Game', ['Ready game graphics', 'Take game board', 'Cue sound effects', 'Show scores']),
        mk('End', ['Ready outro, ready audio', 'Take outro', 'Roll credits', 'Fade to black, *CLEAR*']),
      ],
    });
  }

  function blankSheet() {
    return window.Formats.normalizeSheet({
      title: 'New Show',
      sections: [{ title: 'Prep', items: [{ text: '' }] }],
    });
  }

  // ---------- Persistence ----------
  // Shared (cloud) sheets live on the server, so only local sheets are saved here.
  const store = window.Common.createStore('callsheets', () => ({ ...state, sheets: collab.localOnly(state.sheets) }));
  function save() {
    const sheet = active();
    if (sheet) sheet.updatedAt = Date.now();
    store.save();
    collab.changed();
  }

  const active = () => state.sheets.find((s) => s.id === state.activeId);

  // ---------- Collaboration ----------
  const collab = window.Collab.attach({
    kind: 'callsheet',
    listKey: 'sheets',
    noun: 'call sheet',
    nounPlural: 'call sheets',
    getState: () => state,
    render: (opts = {}) => { if (opts.opened) { history = []; editing = false; } render(opts); if (opts.opened) $('sheet').scrollTop = 0; },
    renderSidebar: () => renderSidebar(),
    save: () => store.save(),
    normalize: (doc) => {
      doc.title = String(doc.title || 'Untitled');
      doc.sections = Array.isArray(doc.sections) ? doc.sections : [];
      doc.sections.forEach((s) => { s.items = Array.isArray(s.items) ? s.items : []; });
      return doc;
    },
    selectLocal: () => selectFirstLocal(),
    onRoleChange: (role) => { if (role === 'viewer') editing = false; },
  });

  function selectFirstLocal() {
    if (!collab.localOnly(state.sheets).length) state.sheets.push(blankSheet());
    state.activeId = collab.localOnly(state.sheets).sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
    editing = false;
    history = [];
    render();
    $('sheet').scrollTop = 0;
  }

  // Viewers can watch a shared sheet but not change it.
  function blockedReadOnly() {
    if (!collab.readOnly()) return false;
    toast('You have view-only access to this call sheet');
    return true;
  }

  function allItems(sheet) {
    return sheet.sections.flatMap((s) => s.items.map((i) => ({ item: i, section: s })));
  }

  // ---------- Sidebar ----------
  function renderSidebar() {
    $('app').classList.toggle('sidebar-hidden', state.sidebarHidden);
    const list = $('sheetList');
    list.innerHTML = '';
    const q = search.toLowerCase();
    collab.localOnly(state.sheets)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((s) => !q || s.title.toLowerCase().includes(q))
      .forEach((s) => {
        const items = allItems(s);
        const done = items.filter((x) => x.item.done).length;
        list.append(el('li', {
          class: s.id === state.activeId ? 'active' : '',
          onclick: () => { collab.leave(); state.activeId = s.id; history = []; save(); render(); $('sheet').scrollTop = 0; },
        },
        el('div', { class: 'name' }, s.title || 'Untitled'),
        el('div', { class: 'meta' }, `${done}/${items.length} · ${relTime(s.updatedAt)}`)));
      });
    collab.renderShared($('sharedList'));
  }

  // ---------- Run mode ----------
  function currentItem(sheet) {
    const found = allItems(sheet).find((x) => !x.item.done && x.item.text.trim());
    return found ? found.item : null;
  }

  function renderHeader(sheet) {
    const items = allItems(sheet).filter((x) => x.item.text.trim());
    const done = items.filter((x) => x.item.done).length;
    $('sheetTitle').textContent = sheet.title;
    $('sheetTitle').hidden = editing;
    const input = $('sheetTitleInput');
    input.hidden = !editing;
    if (editing && document.activeElement !== input) input.value = sheet.title;
    const counter = $('counter');
    counter.textContent = `${done}/${items.length}`;
    counter.classList.toggle('complete', items.length > 0 && done === items.length);

    const tabs = $('tabs');
    tabs.innerHTML = '';
    sheet.sections.forEach((s, idx) => {
      const live = s.items.filter((i) => i.text.trim());
      const complete = live.length > 0 && live.every((i) => i.done);
      tabs.append(el('button', {
        class: 'tab' + (complete ? ' done' : ''),
        'data-sec': s.id,
        title: idx < 9 ? `Jump to section (${idx + 1})` : null,
        onclick: () => scrollToSection(s.id),
      }, s.title.toUpperCase()));
    });
    updateActiveTab();
  }

  function renderRun(sheet) {
    const wrap = $('sections');
    wrap.innerHTML = '';
    if (!sheet.sections.length) {
      wrap.append(el('div', { class: 'empty' }, 'This call sheet is empty. Click Edit to add sections and cues.'));
      return;
    }
    const cur = currentItem(sheet);
    for (const s of sheet.sections) {
      const ul = el('ul', { class: 'items' });
      for (const it of s.items) {
        if (!it.text.trim()) continue;
        ul.append(el('li', {
          class: 'item' + (it.done ? ' checked' : '') + (cur === it ? ' current' : ''),
          'data-item': it.id,
          onclick: () => toggleItem(it),
        }, el('span', { class: 'box' }), el('span', { class: 'item-text', html: fmt(it.text) })));
      }
      wrap.append(el('section', { class: 'section', id: 'sec-' + s.id },
        el('h2', { class: 'section-title' }, s.title.toUpperCase()), ul));
    }
  }

  function toggleItem(it) {
    if (blockedReadOnly()) return;
    it.done = !it.done;
    if (it.done) history.push(it.id);
    else history = history.filter((id) => id !== it.id);
    save();
    render({ keepScroll: true });
  }

  function checkNext() {
    const sheet = active();
    const it = sheet && currentItem(sheet);
    if (!it) return;
    toggleItem(it);
    scrollToCurrent();
  }

  function undoLast() {
    const sheet = active();
    if (!sheet || blockedReadOnly()) return;
    const items = allItems(sheet).map((x) => x.item);
    let it = null;
    while (history.length && !it) {
      const id = history.pop();
      it = items.find((i) => i.id === id && i.done) || null;
    }
    if (!it) it = [...items].reverse().find((i) => i.done) || null;
    if (!it) return;
    it.done = false;
    save();
    render({ keepScroll: true });
    scrollToCurrent();
  }

  function scrollToCurrent() {
    const n = document.querySelector('.item.current');
    if (n) n.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function scrollToSection(id) {
    const n = document.getElementById('sec-' + id);
    if (n) n.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function updateActiveTab() {
    const sheetEl = $('sheet');
    const secs = [...document.querySelectorAll('.section, .edit-section')];
    if (!secs.length) return;
    const headerBottom = document.querySelector('.sheet-header').getBoundingClientRect().bottom;
    let activeId = secs[0].id.replace(/^sec-/, '');
    for (const s of secs) {
      if (s.getBoundingClientRect().top <= headerBottom + 40) activeId = s.id.replace(/^sec-/, '');
    }
    // At the very bottom, highlight the last section.
    if (sheetEl.scrollTop + sheetEl.clientHeight >= sheetEl.scrollHeight - 4) {
      activeId = secs[secs.length - 1].id.replace(/^sec-/, '');
    }
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.sec === activeId));
  }

  // ---------- Edit mode ----------
  let dragData = null;

  function renderEdit(sheet) {
    const wrap = $('sections');
    wrap.innerHTML = '';
    wrap.append(el('div', { class: 'edit-help', html:
      'Wrap words in asterisks to highlight them in yellow — <code>Take *cam 3*</code> shows as Take <mark>cam 3</mark>. ' +
      'Press Enter in a cue to add another; Backspace on an empty cue removes it. Drag ⠿ to reorder.' }));

    sheet.sections.forEach((s, sIdx) => {
      const itemsWrap = el('div', { class: 'edit-items' });
      s.items.forEach((it, iIdx) => itemsWrap.append(editItemRow(sheet, s, it, iIdx)));
      // Dropping on the empty area of a section appends there.
      itemsWrap.addEventListener('dragover', (e) => { if (dragData && dragData.type === 'item') e.preventDefault(); });
      itemsWrap.addEventListener('drop', (e) => {
        if (!dragData || dragData.type !== 'item' || e.target !== itemsWrap) return;
        e.preventDefault();
        moveItem(dragData, s, s.items.length);
      });

      const secRow = el('div', { class: 'edit-row' },
        el('span', { class: 'drag', title: 'Drag to reorder section' }, '⠿'),
        el('input', {
          class: 'edit-input section-input',
          value: s.title,
          placeholder: 'SECTION NAME',
          oninput: (e) => { s.title = e.target.value; save(); renderHeader(sheet); renderSidebar(); },
        }),
        el('button', { class: 'icon-btn', title: 'Move up', onclick: () => moveSection(sIdx, -1) }, '↑'),
        el('button', { class: 'icon-btn', title: 'Move down', onclick: () => moveSection(sIdx, 1) }, '↓'),
        el('button', { class: 'icon-btn del', title: 'Delete section', onclick: () => {
          if (s.items.some((i) => i.text.trim()) && !confirm(`Delete section "${s.title}" and its ${s.items.length} cues?`)) return;
          sheet.sections.splice(sIdx, 1); save(); render({ keepScroll: true });
        } }, '✕'));
      makeDraggable(secRow, { type: 'section', sIdx });
      secRow.addEventListener('dragover', (e) => {
        if (dragData && dragData.type === 'section') { e.preventDefault(); secRow.classList.add('drag-over'); }
      });
      secRow.addEventListener('dragleave', () => secRow.classList.remove('drag-over'));
      secRow.addEventListener('drop', (e) => {
        secRow.classList.remove('drag-over');
        if (!dragData || dragData.type !== 'section') return;
        e.preventDefault();
        const [moved] = sheet.sections.splice(dragData.sIdx, 1);
        const to = dragData.sIdx < sIdx ? sIdx - 1 : sIdx;
        sheet.sections.splice(to, 0, moved);
        save(); render({ keepScroll: true });
      });

      wrap.append(el('div', { class: 'edit-section', id: 'sec-' + s.id },
        secRow,
        itemsWrap,
        el('button', { class: 'add-btn', onclick: () => {
          const it = { id: uid(), text: '', done: false };
          s.items.push(it); save(); render({ keepScroll: true }); focusItem(it.id);
        } }, '+ Add cue')));
    });

    wrap.append(el('button', { class: 'add-section-btn', onclick: () => {
      const s = { id: uid(), title: 'New Section', items: [{ id: uid(), text: '', done: false }] };
      sheet.sections.push(s); save(); render({ keepScroll: true });
      const inp = document.querySelector(`#sec-${s.id} .section-input`);
      if (inp) { inp.scrollIntoView({ block: 'center' }); inp.select(); }
    } }, '+ ADD SECTION'));
  }

  function editItemRow(sheet, s, it, iIdx) {
    const row = el('div', { class: 'edit-row', 'data-item': it.id },
      el('span', { class: 'drag', title: 'Drag to reorder cue' }, '⠿'),
      el('input', {
        class: 'edit-input',
        value: it.text,
        placeholder: 'Cue — e.g. Take *cam 3*, cue talent',
        oninput: (e) => { it.text = e.target.value; save(); renderHeader(sheet); },
        onkeydown: (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const n = { id: uid(), text: '', done: false };
            s.items.splice(iIdx + 1, 0, n); save(); render({ keepScroll: true }); focusItem(n.id);
          } else if (e.key === 'Backspace' && e.target.value === '' && s.items.length > 0) {
            e.preventDefault();
            s.items.splice(iIdx, 1); save(); render({ keepScroll: true });
            const prev = s.items[Math.max(0, iIdx - 1)];
            if (prev) focusItem(prev.id);
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            const inputs = [...document.querySelectorAll('.edit-items .edit-input')];
            const next = inputs[inputs.indexOf(e.target) + (e.key === 'ArrowUp' ? -1 : 1)];
            if (next) { e.preventDefault(); next.focus(); }
          }
        },
      }),
      el('button', { class: 'icon-btn del', title: 'Delete cue', onclick: () => {
        s.items.splice(iIdx, 1); save(); render({ keepScroll: true });
      } }, '✕'));
    makeDraggable(row, { type: 'item', sec: s, iIdx });
    row.addEventListener('dragover', (e) => {
      if (dragData && dragData.type === 'item') { e.preventDefault(); row.classList.add('drag-over'); }
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (e) => {
      row.classList.remove('drag-over');
      if (!dragData || dragData.type !== 'item') return;
      e.preventDefault(); e.stopPropagation();
      moveItem(dragData, s, iIdx);
    });
    return row;
  }

  // Rows only become draggable while the handle is held, so text inputs stay selectable.
  function makeDraggable(row, data) {
    const handle = row.querySelector('.drag');
    handle.addEventListener('mousedown', () => (row.draggable = true));
    row.addEventListener('mouseup', () => (row.draggable = false));
    row.addEventListener('dragstart', (e) => { dragData = data; e.dataTransfer.effectAllowed = 'move'; });
    row.addEventListener('dragend', () => { row.draggable = false; dragData = null; });
  }

  function moveItem(from, toSec, toIdx) {
    const [moved] = from.sec.items.splice(from.iIdx, 1);
    if (from.sec === toSec && from.iIdx < toIdx) toIdx--;
    toSec.items.splice(toIdx, 0, moved);
    save(); render({ keepScroll: true });
  }

  function moveSection(idx, dir) {
    const sheet = active();
    const to = idx + dir;
    if (to < 0 || to >= sheet.sections.length) return;
    const [s] = sheet.sections.splice(idx, 1);
    sheet.sections.splice(to, 0, s);
    save(); render({ keepScroll: true });
  }

  function focusItem(id) {
    const inp = document.querySelector(`.edit-row[data-item="${id}"] .edit-input`);
    if (inp) { inp.focus(); inp.scrollIntoView({ block: 'nearest' }); }
  }

  // ---------- Render ----------
  function render({ keepScroll = false } = {}) {
    const sheetEl = $('sheet');
    const top = sheetEl.scrollTop;
    renderSidebar();
    const sheet = active();
    $('editBtn').textContent = editing ? 'Done' : 'Edit';
    $('editBtn').hidden = collab.readOnly();
    $('app').classList.toggle('editing', editing);
    $('resetBtn').hidden = editing || collab.readOnly();
    $('deleteLabel').textContent = collab.isCloud(sheet) ? (sheet._cloud.role === 'owner' ? 'Delete for everyone' : 'Leave shared sheet') : 'Delete sheet';
    collab.updateToolbar();
    if (!sheet) {
      $('sections').innerHTML = '';
      return;
    }
    renderHeader(sheet);
    if (editing) renderEdit(sheet);
    else renderRun(sheet);
    $('hint').innerHTML = editing
      ? `<kbd>${mod}+E</kbd> done editing`
      : '<kbd>Space</kbd> check next &nbsp; <kbd>⌫</kbd> undo &nbsp; <kbd>1–9</kbd> jump to section';
    if (keepScroll) sheetEl.scrollTop = top;
    updateActiveTab();
  }

  // ---------- Actions ----------
  function addSheet(sheet, { edit = false } = {}) {
    collab.leave();
    state.sheets.push(sheet);
    state.activeId = sheet.id;
    history = [];
    editing = edit;
    save(); render();
    $('sheet').scrollTop = 0;
  }

  function newSheet() {
    addSheet(blankSheet(), { edit: true });
    const t = $('sheetTitleInput'); t.focus(); t.select();
  }

  function duplicateSheet() {
    const s = active();
    if (!s) return;
    const copy = window.Formats.normalizeSheet(JSON.parse(window.Formats.toCallsheet(s)), s.title);
    copy.title = s.title + ' (copy)';
    allItems(copy).forEach((x) => (x.item.done = false));
    addSheet(copy);
    toast('Duplicated');
  }

  function deleteSheet() {
    const s = active();
    if (!s) return;
    if (collab.isCloud(s)) return collab.deleteOrLeave(s);
    if (!confirm(`Delete "${s.title}"? This cannot be undone.`)) return;
    state.sheets = state.sheets.filter((x) => x.id !== s.id);
    save();
    selectFirstLocal();
  }

  function resetChecks() {
    const s = active();
    if (!s || blockedReadOnly()) return;
    allItems(s).forEach((x) => (x.item.done = false));
    history = [];
    save(); render();
    $('sheet').scrollTop = 0;
    toast('All cues reset');
  }

  function toggleEdit() {
    if (!editing && blockedReadOnly()) return;
    editing = !editing;
    render({ keepScroll: true });
  }

  function ingest(files) {
    let added = 0;
    let last = null;
    const errors = [];
    for (const f of files) {
      try {
        for (const sheet of window.Formats.importFile(f)) {
          state.sheets.push(sheet); last = sheet; added++;
        }
      } catch (err) {
        errors.push(`${f.name}: ${err.message}`);
      }
    }
    if (last) { collab.leave(); state.activeId = last.id; editing = false; history = []; save(); render(); $('sheet').scrollTop = 0; }
    if (errors.length) alert('Some files could not be imported:\n\n' + errors.join('\n'));
    else if (added) toast(`Imported ${added} call sheet${added > 1 ? 's' : ''}`);
  }

  async function importFiles() {
    ingest(await api.importFiles({ label: 'Call Sheets', extensions: ['callsheet', 'json', 'csv', 'md', 'markdown', 'txt'] }));
  }

  async function exportAs(kind) {
    const s = active();
    if (!s && kind !== 'all') return;
    const name = s ? safeFileName(s.title) : 'call-sheets';
    const F = window.Formats;
    let saved = null;
    if (kind === 'pdf') {
      const wasEditing = editing;
      editing = false; render();
      saved = await api.exportPdf({ defaultName: name + '.pdf' });
      editing = wasEditing; render({ keepScroll: true });
    } else {
      const map = {
        callsheet: { ext: 'callsheet', label: 'Call Sheet', content: () => F.toCallsheet(s) },
        csv: { ext: 'csv', label: 'CSV', content: () => F.toCSV(s) },
        md: { ext: 'md', label: 'Markdown', content: () => F.toMarkdown(s) },
        all: { ext: 'json', label: 'JSON Backup', content: () => F.toBackup(state.sheets), name: 'call-sheets-backup' },
      }[kind];
      saved = await api.exportFile({
        defaultName: (map.name || name) + '.' + map.ext,
        ext: map.ext,
        label: map.label,
        content: map.content(),
      });
    }
    if (saved) toast('Exported → ' + saved.split(/[\\/]/).pop());
  }

  // ---------- Events ----------
  function wireMenus() {
    window.Common.wireDropdowns();
    document.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => exportAs(b.dataset.export)));
    document.querySelector('[data-more="duplicate"]').addEventListener('click', duplicateSheet);
    document.querySelector('[data-more="delete"]').addEventListener('click', deleteSheet);
  }

  function wire() {
    $('newSheetBtn').addEventListener('click', newSheet);
    $('importBtn').addEventListener('click', importFiles);
    $('resetBtn').addEventListener('click', resetChecks);
    $('editBtn').addEventListener('click', toggleEdit);
    $('sidebarToggle').addEventListener('click', () => { state.sidebarHidden = !state.sidebarHidden; save(); renderSidebar(); });
    $('search').addEventListener('input', (e) => { search = e.target.value; renderSidebar(); });
    $('sheetTitleInput').addEventListener('input', (e) => {
      const s = active(); s.title = e.target.value; save(); renderSidebar();
    });
    $('sheet').addEventListener('scroll', updateActiveTab, { passive: true });
    $('homeBtn').addEventListener('click', () => window.Common.goHome(store));
    wireMenus();
    window.Common.onFileDrop(ingest);

    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
      const cmd = e.ctrlKey || e.metaKey;
      if (typing && e.key === 'Escape') { document.activeElement.blur(); return; }
      if (typing || cmd || editing) return;
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); checkNext(); }
      else if (e.key === 'Backspace' || e.key === 'ArrowUp') { e.preventDefault(); undoLast(); }
      else if (/^[1-9]$/.test(e.key)) {
        const s = active() && active().sections[Number(e.key) - 1];
        if (s) scrollToSection(s.id);
      }
    });

    api.onMenu((channel, arg) => {
      ({
        new: newSheet,
        duplicate: duplicateSheet,
        import: importFiles,
        export: () => exportAs(arg === 'native' ? 'callsheet' : arg),
        home: () => window.Common.goHome(store),
        toggleEdit,
        reset: resetChecks,
        toggleSidebar: () => { state.sidebarHidden = !state.sidebarHidden; save(); renderSidebar(); },
      }[channel] || (() => {}))();
    });
    api.onFileOpened((file) => ingest([file]));
  }

  async function init() {
    const stored = await api.loadStore('callsheets');
    if (stored && Array.isArray(stored.sheets) && stored.sheets.length) {
      state = { sidebarHidden: false, ...stored };
      if (!active()) state.activeId = state.sheets[0].id;
    } else {
      const s = sampleSheet();
      state = { sheets: [s], activeId: s.id, sidebarHidden: false };
      save();
    }
    wire();
    collab.mountToolbar(document.querySelector('.toolbar'), $('resetBtn'));
    render();
    collab.init();
    const pending = await api.takePendingFile();
    if (pending) ingest([pending]);
  }

  init();
})();
