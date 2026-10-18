(function () {
  const { api, uid, $, el, toast, relTime } = window.Common;
  const S = window.Screenplay;
  const safeFileName = (s) => window.Common.safeFileName(s, 'script');

  let state = { scripts: [], activeId: null, sidebarHidden: false };
  let currentId = null; // element with the cursor
  let search = '';

  // Shared (cloud) scripts live on the server, so only local scripts are saved here.
  const store = window.Common.createStore('scripts', () => ({ ...state, scripts: collab.localOnly(state.scripts) }));
  const active = () => state.scripts.find((d) => d.id === state.activeId);
  function save() {
    const d = active();
    if (d) d.updatedAt = Date.now();
    store.save();
    collab.changed();
  }

  // ---------- Collaboration ----------
  const collab = window.Collab.attach({
    kind: 'script',
    listKey: 'scripts',
    noun: 'script',
    nounPlural: 'scripts',
    getState: () => state,
    render: (opts = {}) => render(opts),
    renderSidebar: () => renderSidebar(),
    save: () => store.save(),
    normalize: (doc) => S.upgradeDoc(doc),
    selectLocal: () => selectFirstLocal(),
  });
  const readOnly = () => collab.readOnly();

  // Opens the most recent local script, or the empty screen if there are none.
  function selectFirstLocal() {
    const local = collab.localOnly(state.scripts).sort((a, b) => b.updatedAt - a.updatedAt);
    selectScript(local.length ? local[0].id : null);
  }

  function selectScript(id) {
    collab.leave();
    state.activeId = id;
    currentId = null;
    store.save();
    render({ fresh: true });
  }

  // ---------- Sidebar ----------
  function renderSidebar() {
    $('app').classList.toggle('sidebar-hidden', state.sidebarHidden);
    const list = $('list');
    list.innerHTML = '';
    const q = search.toLowerCase();
    collab.localOnly(state.scripts)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((d) => !q || d.title.toLowerCase().includes(q))
      .forEach((d) => {
        const st = S.stats(d);
        list.append(el('li', { class: d.id === state.activeId ? 'active' : '', onclick: () => selectScript(d.id) },
          el('div', { class: 'name' }, d.title || 'Untitled Script'),
          el('div', { class: 'meta' }, `${st.pages} pg · ${st.scenes} scenes · ${relTime(d.updatedAt)}`)));
      });
    collab.renderShared($('sharedList'));
  }

  // ---------- Element type bar ----------
  const SHORT = { heading: 'Scene', action: 'Action', character: 'Character', parenthetical: 'Paren', dialogue: 'Dialogue', transition: 'Transition', shot: 'Shot' };
  function renderElementBar() {
    const bar = $('elementBar');
    if (!bar.children.length) {
      S.TYPES.forEach((type, i) => bar.append(el('button', {
        'data-type': type,
        title: `${S.LABELS[type]} (Ctrl/Cmd+${i + 1})`,
        onmousedown: (e) => e.preventDefault(), // keep the cursor in the script
        onclick: () => setTypeOfCurrent(type),
      }, SHORT[type])));
    }
    const cur = currentElement();
    bar.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', !!cur && b.dataset.type === cur.type);
      b.disabled = readOnly();
    });
  }

  // ---------- Paper (one auto-growing textarea per element, reused between renders) ----------
  const nodes = new Map(); // element id -> DOM node

  function grow(ta) {
    ta.style.height = '0px';
    ta.style.height = ta.scrollHeight + 'px';
  }

  function nodeFor(item) {
    let node = nodes.get(item.id);
    if (node) return node;
    const ta = el('textarea', { class: 'el-text', rows: 1, spellcheck: 'true' });
    node = el('div', { class: 'el', 'data-item': item.id },
      el('span', { class: 'el-num left' }), ta, el('span', { class: 'el-num right' }));
    ta.addEventListener('input', () => onInput(node.dataset.item, ta));
    ta.addEventListener('keydown', (e) => onKeyDown(e, node.dataset.item, ta));
    ta.addEventListener('focus', () => { currentId = node.dataset.item; renderElementBar(); updateStatus(); highlightScene(); });
    ta.addEventListener('blur', () => onBlur(node.dataset.item, ta));
    nodes.set(item.id, node);
    return node;
  }

  function renderPaper(doc, { fresh = false } = {}) {
    const paper = $('paper');
    if (fresh) { paper.innerHTML = ''; nodes.clear(); }
    paper.querySelectorAll('.page-break').forEach((n) => n.remove());
    paper.classList.toggle('numbered', doc.sceneNumbers);
    const keep = new Set();
    let prevNode = null;
    let sceneNo = 0;
    for (const item of doc.elements) {
      const node = nodeFor(item);
      keep.add(item.id);
      node.className = 'el el-' + item.type;
      const num = item.type === 'heading' ? String(++sceneNo) : '';
      node.querySelectorAll('.el-num').forEach((n) => (n.textContent = num));
      const ta = node.querySelector('textarea');
      ta.readOnly = readOnly();
      ta.placeholder = item === doc.elements[0] && doc.elements.length === 1 ? 'Start writing… (type INT. or EXT. for a scene heading)' : '';
      if (ta.value !== item.text) {
        // Keep the caret in place if someone else edited the line we're typing in.
        const focused = document.activeElement === ta;
        const pos = ta.selectionStart;
        ta.value = item.text;
        if (focused) ta.setSelectionRange(Math.min(pos, item.text.length), Math.min(pos, item.text.length));
      }
      const expected = prevNode ? prevNode.nextSibling : paper.firstChild;
      if (expected !== node) paper.insertBefore(node, expected);
      prevNode = node;
    }
    for (const [id, node] of nodes) {
      if (!keep.has(id)) { node.remove(); nodes.delete(id); }
    }
    paper.querySelectorAll('textarea').forEach(grow);
    updatePageBreaks();
  }

  // ---------- Pages ----------
  // The page area is 9in (54 lines of 12pt Courier) inside 1in top/bottom margins. Pages are
  // laid out from the measured height of every line, so the screen and the PDF break in the
  // same places. Each break draws the bottom of one sheet, a gap, and the top of the next.
  const IN = 96;
  const PAGE_BODY = 9 * IN;
  const LINE = 16;
  const GAP_BEFORE = { heading: LINE, action: LINE, character: LINE, transition: LINE, shot: LINE, parenthetical: 0, dialogue: 0 };
  let layout = { pageOf: [], pages: 0 };

  function measurePages(doc) {
    const pageOf = [];
    const fill = []; // empty space left at the bottom of each page
    let page = 1;
    let used = 0;
    doc.elements.forEach((item, i) => {
      const node = nodes.get(item.id);
      const h = node ? node.offsetHeight : LINE;
      const gap = used === 0 ? 0 : GAP_BEFORE[item.type] || 0;
      // Keep a scene heading or character name with at least the next line.
      const keep = item.type === 'heading' || item.type === 'character' ? LINE * 2 : 0;
      if (used > 0 && used + gap + h + keep > PAGE_BODY) {
        fill[page] = PAGE_BODY - used;
        page++;
        used = h;
      } else {
        used += gap + h;
      }
      pageOf[i] = page;
    });
    fill[page] = Math.max(0, PAGE_BODY - used);
    return { pageOf, pages: doc.elements.length ? page : 0, fill };
  }

  function updatePageBreaks() {
    const doc = active();
    if (!doc) return;
    const paper = $('paper');
    paper.querySelectorAll('.page-break').forEach((n) => n.remove());
    layout = measurePages(doc);
    const { pageOf, fill } = layout;
    doc.elements.forEach((item, i) => {
      if (i === 0 || pageOf[i] === pageOf[i - 1]) return;
      const node = nodes.get(item.id);
      if (!node) return;
      const prevPage = pageOf[i - 1];
      paper.insertBefore(el('div', { class: 'page-break', 'aria-hidden': 'true' },
        el('div', { class: 'pb-bottom', style: `height:${Math.max(0, fill[prevPage]) + IN}px` }),
        el('div', { class: 'pb-gap' }),
        el('div', { class: 'pb-top' }, el('span', { class: 'pb-num' }, pageOf[i] + '.'))), node);
    });
    // Pad the last page out to a full sheet.
    paper.style.paddingBottom = (fill[layout.pages] || 0) + IN + 'px';
  }

  let laterTimer = null;
  function refreshLater() {
    clearTimeout(laterTimer);
    laterTimer = setTimeout(() => { updatePageBreaks(); renderNav(); updateStatus(); renderSidebar(); }, 350);
  }

  // ---------- Scene navigator & status ----------
  function renderNav() {
    const doc = active();
    const nav = $('sceneNav');
    nav.innerHTML = '';
    if (!doc) return;
    const pageOf = layout.pageOf.length === doc.elements.length ? layout.pageOf : S.paginate(doc.elements).pageOf;
    const scenes = S.scenes(doc);
    nav.append(el('div', { class: 'nav-head' }, `Scenes (${scenes.length})`));
    if (!scenes.length) nav.append(el('div', { class: 'list-note' }, 'Scene headings appear here. Type INT. or EXT. to start one.'));
    for (const s of scenes) {
      const item = doc.elements[s.index];
      nav.append(el('button', {
        class: 'nav-scene', 'data-for': item.id,
        onclick: () => focusElement(item.id, 0, true),
      },
      el('span', { class: 'nav-num' }, s.number),
      el('span', { class: 'nav-title' }, s.heading.trim() || 'Untitled scene'),
      el('span', { class: 'nav-page' }, 'p' + pageOf[s.index])));
    }
    highlightScene();
  }

  function highlightScene() {
    const doc = active();
    if (!doc) return;
    const idx = doc.elements.findIndex((e) => e.id === currentId);
    let headingId = null;
    for (let i = idx; i >= 0; i--) if (doc.elements[i].type === 'heading') { headingId = doc.elements[i].id; break; }
    document.querySelectorAll('.nav-scene').forEach((b) => b.classList.toggle('active', b.dataset.for === headingId));
  }

  const HINTS = {
    heading: 'Enter → Action · Tab → Shot',
    action: 'Enter → Action · Tab → Character',
    character: 'Enter → Dialogue · Tab → Transition',
    parenthetical: 'Enter → Dialogue · Tab → Dialogue',
    dialogue: 'Enter → Action · Tab → Parenthetical',
    transition: 'Enter → Scene Heading · Tab → Scene Heading',
    shot: 'Enter → Action · Tab → Action',
  };
  function updateStatus() {
    const doc = active();
    if (!doc) return;
    const st = S.stats(doc);
    if (layout.pages) st.pages = layout.pages; // measured on screen, matches the PDF
    const cur = currentElement();
    $('statusbar').innerHTML = '';
    $('statusbar').append(
      el('span', { class: 'st-type' }, cur ? S.LABELS[cur.type] : ''),
      el('span', { class: 'st-hint' }, cur && !readOnly() ? HINTS[cur.type] : readOnly() ? 'View only' : ''),
      el('span', { class: 'st-spacer' }),
      el('span', {}, `${st.pages} page${st.pages === 1 ? '' : 's'}`),
      el('span', {}, `${st.scenes} scene${st.scenes === 1 ? '' : 's'}`),
      el('span', {}, `${st.words.toLocaleString()} words`));
  }

  // ---------- Editing ----------
  const currentElement = () => { const d = active(); return d && d.elements.find((e) => e.id === currentId); };
  const indexOf = (id) => active().elements.findIndex((e) => e.id === id);

  function focusElement(id, pos, scroll = false) {
    const node = nodes.get(id);
    if (!node) return;
    const ta = node.querySelector('textarea');
    ta.focus({ preventScroll: !scroll });
    const p = pos === 'end' || pos == null ? ta.value.length : Math.min(pos, ta.value.length);
    ta.setSelectionRange(p, p);
    if (scroll) node.scrollIntoView({ block: 'center' });
    else node.scrollIntoView({ block: 'nearest' });
  }

  function structuralChange(focusId, pos) {
    save();
    renderPaper(active());
    renderNav();
    updateStatus();
    renderSidebar();
    if (focusId) focusElement(focusId, pos);
    renderElementBar();
  }

  function setType(item, type) {
    if (item.type === type || readOnly()) return;
    item.type = type;
    const node = nodes.get(item.id);
    const ta = node.querySelector('textarea');
    const pos = ta.selectionStart;
    if (type === 'parenthetical' && !item.text.trim()) { item.text = '()'; ta.value = '()'; }
    structuralChange(item.id, type === 'parenthetical' && item.text === '()' ? 1 : pos);
  }

  function setTypeOfCurrent(type) {
    const cur = currentElement();
    if (cur) setType(cur, type);
  }

  function onInput(id, ta) {
    const doc = active();
    const item = doc.elements.find((e) => e.id === id);
    if (!item || readOnly()) return;
    item.text = ta.value;
    grow(ta);
    const auto = S.autoType(item.text, item.type);
    if (auto !== item.type) {
      item.type = auto;
      nodes.get(id).className = 'el el-' + auto;
      renderElementBar();
      renderPaper(doc); // scene numbers may change
      renderNav();
    }
    save();
    showSuggestions(item, ta);
    refreshLater();
  }

  function onBlur(id, ta) {
    // Close this line's suggestions (unless a click on them is in progress), but never a
    // box that has since opened for the next line.
    setTimeout(() => { if (suggest.itemId === id && document.activeElement !== ta) hideSuggestions(); }, 150);
    const item = active() && active().elements.find((e) => e.id === id);
    if (!item || readOnly()) return;
    if (item.type === 'parenthetical' && item.text.trim() && item.text !== S.wrapParens(item.text)) {
      item.text = S.wrapParens(item.text);
      ta.value = item.text;
      save();
    }
  }

  // Lines in a textarea: is the caret on the first / last visual line?
  const LINE_PX = 16;
  const singleLine = (ta) => ta.scrollHeight <= LINE_PX * 1.6;

  function onKeyDown(e, id, ta) {
    const doc = active();
    const i = indexOf(id);
    const item = doc.elements[i];
    if (!item) return;
    const mod = e.ctrlKey || e.metaKey;

    if (suggest.open && handleSuggestKey(e, item, ta)) return;

    if (mod && /^[1-7]$/.test(e.key)) {
      e.preventDefault();
      setType(item, S.TYPES[Number(e.key) - 1]);
      return;
    }
    if (readOnly()) return;

    if (e.key === 'Enter' && !e.shiftKey && !mod) {
      e.preventDefault();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      // Enter on an empty line that isn't Action turns it into Action (like Final Draft).
      if (!item.text.trim() && item.type !== 'action') { setType(item, 'action'); return; }
      const before = item.text.slice(0, start);
      const after = item.text.slice(end);
      if (item.type === 'parenthetical' && after === ')') {
        // Caret inside "(…)": move on to dialogue.
        const next = { id: uid(), type: 'dialogue', text: '' };
        doc.elements.splice(i + 1, 0, next);
        structuralChange(next.id, 0);
        return;
      }
      item.text = before.replace(/\s+$/, '');
      const next = { id: uid(), type: start === 0 && before === '' ? item.type : S.NEXT_ON_ENTER[item.type], text: after.replace(/^\s+/, '') };
      if (start === 0 && before === '') {
        // Enter at the very start pushes the line down instead of splitting it.
        item.text = '';
        next.text = after;
        doc.elements.splice(i + 1, 0, next);
        structuralChange(next.id, 0);
        return;
      }
      doc.elements.splice(i + 1, 0, next);
      structuralChange(next.id, 0);
      return;
    }

    if (e.key === 'Tab' && !mod) {
      e.preventDefault();
      setType(item, (e.shiftKey ? S.PREV_ON_TAB : S.NEXT_ON_TAB)[item.type] || 'action');
      return;
    }

    const atStart = ta.selectionStart === 0 && ta.selectionEnd === 0;
    const atEnd = ta.selectionStart === ta.value.length && ta.selectionEnd === ta.value.length;

    if (e.key === 'Backspace' && atStart && i > 0) {
      e.preventDefault();
      const prev = doc.elements[i - 1];
      const pos = prev.text.length;
      prev.text += item.text;
      doc.elements.splice(i, 1);
      structuralChange(prev.id, pos);
      return;
    }
    if (e.key === 'Delete' && atEnd && i < doc.elements.length - 1) {
      e.preventDefault();
      const next = doc.elements[i + 1];
      const pos = item.text.length;
      item.text += next.text;
      doc.elements.splice(i + 1, 1);
      structuralChange(item.id, pos);
      return;
    }
    if (e.key === 'ArrowUp' && i > 0 && (atStart || singleLine(ta))) {
      e.preventDefault();
      focusElement(doc.elements[i - 1].id, 'end');
      return;
    }
    if (e.key === 'ArrowDown' && i < doc.elements.length - 1 && (atEnd || singleLine(ta))) {
      e.preventDefault();
      focusElement(doc.elements[i + 1].id, 0);
    }
  }

  // ---------- Suggestions (characters, locations, times, transitions) ----------
  const suggest = { open: false, items: [], index: 0, replaceFrom: 0 };

  function showSuggestions(item, ta) {
    const { items, replaceFrom } = S.suggestions(active(), item);
    const box = $('suggest');
    if (!items.length || !item.text.trim() && item.type !== 'transition') { hideSuggestions(); return; }
    Object.assign(suggest, { open: true, items, index: 0, replaceFrom, itemId: item.id });
    box.innerHTML = '';
    items.forEach((s, i) => box.append(el('div', {
      class: 'suggest-item' + (i === 0 ? ' active' : ''),
      onmousedown: (e) => { e.preventDefault(); acceptSuggestion(item, ta, i); },
    }, s)));
    const r = ta.getBoundingClientRect();
    box.style.left = r.left + 'px';
    box.style.top = r.bottom + 4 + 'px';
    box.hidden = false;
  }

  function hideSuggestions() {
    suggest.open = false;
    $('suggest').hidden = true;
  }

  function acceptSuggestion(item, ta, i) {
    const value = suggest.items[i];
    const prefix = item.text.slice(0, suggest.replaceFrom);
    item.text = prefix + value;
    ta.value = item.text;
    ta.setSelectionRange(item.text.length, item.text.length);
    grow(ta);
    hideSuggestions();
    save();
    refreshLater();
  }

  function handleSuggestKey(e, item, ta) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      suggest.index = (suggest.index + (e.key === 'ArrowDown' ? 1 : -1) + suggest.items.length) % suggest.items.length;
      $('suggest').querySelectorAll('.suggest-item').forEach((n, i) => n.classList.toggle('active', i === suggest.index));
      return true;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
      e.preventDefault();
      acceptSuggestion(item, ta, suggest.index);
      return true;
    }
    if (e.key === 'Escape') { hideSuggestions(); return true; }
    return false;
  }

  // ---------- Title page ----------
  function openTitlePage() {
    const doc = active();
    if (!doc) return;
    const ro = readOnly();
    const f = (label, input) => el('label', { class: 'form-field' }, el('span', {}, label), input);
    const title = el('input', { class: 'field', value: doc.title, disabled: ro });
    const credit = el('input', { class: 'field', value: doc.titlePage.credit, disabled: ro });
    const author = el('input', { class: 'field', value: doc.titlePage.author, placeholder: 'Your name', disabled: ro });
    const draft = el('input', { class: 'field', value: doc.titlePage.draftDate, placeholder: 'e.g. First draft — October 2026', disabled: ro });
    const contact = el('textarea', { class: 'field', rows: 3, placeholder: 'Email, phone, agent…', disabled: ro }, doc.titlePage.contact);
    const done = el('button', { class: 'primary-btn wide', type: 'button' }, ro ? 'Close' : 'Save');
    const m = window.Common.modal('Title page', el('div', {}, f('Title', title), f('Credit', credit), f('Author', author), f('Draft', draft), f('Contact', contact), done));
    done.addEventListener('click', () => {
      if (!ro) {
        doc.title = title.value.trim() || 'Untitled Script';
        Object.assign(doc.titlePage, { credit: credit.value, author: author.value, draftDate: draft.value, contact: contact.value });
        save();
        render();
      }
      m.close();
    });
  }

  // ---------- Print / PDF ----------
  function buildPrintView(doc) {
    const view = $('printView');
    view.innerHTML = '';
    const tp = doc.titlePage;
    if (doc.title || tp.author) {
      view.append(el('section', { class: 'print-page title-page' },
        el('div', { class: 'tp-main' },
          el('div', { class: 'tp-title' }, doc.title.toUpperCase()),
          tp.credit && tp.author ? el('div', {}, tp.credit) : null,
          tp.author ? el('div', {}, tp.author) : null,
          tp.draftDate ? el('div', { class: 'tp-draft' }, tp.draftDate) : null),
        tp.contact ? el('div', { class: 'tp-contact' }, tp.contact) : null));
    }
    // Same page breaks as the editor shows.
    updatePageBreaks();
    const { pageOf } = layout;
    let page = null;
    let sceneNo = 0;
    doc.elements.forEach((item, i) => {
      if (!page || pageOf[i] !== pageOf[i - 1]) {
        page = el('section', { class: 'print-page' }, pageOf[i] > 1 ? el('div', { class: 'print-num' }, pageOf[i] + '.') : null);
        view.append(page);
      }
      const num = item.type === 'heading' && doc.sceneNumbers ? String(++sceneNo) : '';
      page.append(el('div', { class: 'el el-' + item.type + (page.children.length <= 1 ? ' first' : '') },
        num ? el('span', { class: 'el-num left' }, num) : null,
        el('div', { class: 'el-text' }, S.displayText(item) || ' '),
        num ? el('span', { class: 'el-num right' }, num) : null));
    });
  }

  // ---------- Export / send ----------
  async function exportAs(kind) {
    const doc = active();
    if (!doc) return;
    const name = safeFileName(doc.title);
    let saved = null;
    if (kind === 'pdf') {
      buildPrintView(doc);
      document.body.classList.add('print-script');
      try { saved = await api.exportPdf({ defaultName: name + '.pdf' }); } finally {
        document.body.classList.remove('print-script');
        $('printView').innerHTML = '';
      }
    } else if (kind === 'fountain') {
      saved = await api.exportFile({ defaultName: name + '.fountain', ext: 'fountain', label: 'Fountain', content: S.toFountain(doc) });
    } else if (kind === 'fdx') {
      saved = await api.exportFile({ defaultName: name + '.fdx', ext: 'fdx', label: 'Final Draft', content: S.toFdx(doc) });
    }
    if (saved) toast('Exported → ' + saved.split(/[\\/]/).pop());
  }

  // Hand the script to another system: it opens there with its import preview.
  async function sendTo(target) {
    const doc = active();
    if (!doc) return;
    let payload;
    try {
      payload = target === 'shotsheet'
        ? { to: 'shotsheet', name: doc.title, input: S.toParseInput(doc) }
        : { to: 'callsheet', name: doc.title, sheet: S.toCallsheet(doc) };
      if (target === 'shotsheet' && !S.scenes(doc).length) throw new Error('This script has no scene headings yet.');
    } catch (err) {
      alert(err.message);
      return;
    }
    window.Common.setHandoff(payload);
    await store.flush();
    location.href = target + '.html';
  }

  // ---------- Import ----------
  function addScript(doc) {
    state.scripts.push(doc);
    selectScript(doc.id);
  }

  function openImported(result) {
    if (!result) return;
    if (result.error) { alert(result.error); return; }
    try {
      const doc = S.fromImport(result.script);
      addScript(doc);
      toast(`Imported ${result.script.name}: ${S.stats(doc).scenes} scenes`);
    } catch (err) {
      alert(`${result.script.name}: ${err.message}`);
    }
  }

  // ---------- Render ----------
  function render(opts = {}) {
    renderSidebar();
    const doc = active();
    $('app').classList.toggle('is-empty', !doc);
    const empty = $('emptyState');
    if (empty) empty.remove();
    if (!doc) {
      $('paper').innerHTML = '';
      nodes.clear();
      $('sceneNav').innerHTML = '';
      $('desk').append(Object.assign(window.Common.emptyState({
        title: 'No scripts',
        text: 'Start a new screenplay, or import one you have already written (PDF, Final Draft or Fountain).',
        actions: [
          { label: 'New script', primary: true, onclick: newScript },
          { label: 'Import script…', onclick: async () => openImported(await api.importScript()) },
          { label: 'Load example', onclick: () => addScript(sampleScript()) },
        ],
      }), { id: 'emptyState' }));
      return;
    }
    $('numbersToggle').textContent = doc.sceneNumbers ? 'Hide scene numbers' : 'Show scene numbers';
    $('deleteLabel').textContent = collab.isCloud(doc) ? (doc._cloud.role === 'owner' ? 'Delete for everyone' : 'Leave shared script') : 'Delete script';
    $('app').classList.toggle('read-only', readOnly());
    renderPaper(doc, { fresh: !!(opts.fresh || opts.opened) });
    renderNav();
    renderElementBar();
    updateStatus();
    collab.updateToolbar();
    if (opts.fresh || opts.opened) {
      $('desk').scrollTop = 0;
      const first = doc.elements.find((e) => !e.text.trim()) || doc.elements[doc.elements.length - 1];
      if (!readOnly() && first) focusElement(first.id, 'end');
    }
  }

  // ---------- Actions ----------
  function newScript() {
    addScript(S.newDoc());
    openTitlePage();
  }

  function duplicateScript() {
    const d = active();
    if (!d) return;
    const copy = S.normalizeDoc({ ...JSON.parse(JSON.stringify(window.SyncCore.stripLocal(d))), id: null, title: d.title + ' (copy)' });
    copy.elements.forEach((e) => (e.id = uid()));
    addScript(copy);
    toast('Duplicated');
  }

  function deleteScript() {
    const d = active();
    if (!d) return;
    if (collab.isCloud(d)) return collab.deleteOrLeave(d);
    if (!confirm(`Delete "${d.title}"? This cannot be undone.`)) return;
    state.scripts = state.scripts.filter((x) => x.id !== d.id);
    store.save();
    selectFirstLocal();
  }

  function toggleNumbers() {
    const d = active();
    if (!d || readOnly()) return;
    d.sceneNumbers = !d.sceneNumbers;
    save();
    render();
  }

  function toggleSidebar() {
    state.sidebarHidden = !state.sidebarHidden;
    store.save();
    renderSidebar();
  }

  // ---------- Events ----------
  function wire() {
    $('homeBtn').addEventListener('click', () => window.Common.goHome(store));
    $('newBtn').addEventListener('click', newScript);
    $('importBtn').addEventListener('click', async () => openImported(await api.importScript()));
    $('sidebarToggle').addEventListener('click', toggleSidebar);
    $('titlePageBtn').addEventListener('click', openTitlePage);
    $('search').addEventListener('input', (e) => { search = e.target.value; renderSidebar(); });
    window.Common.wireDropdowns();
    document.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => exportAs(b.dataset.export)));
    document.querySelectorAll('[data-send]').forEach((b) => b.addEventListener('click', () => sendTo(b.dataset.send)));
    document.querySelector('[data-more="numbers"]').addEventListener('click', toggleNumbers);
    document.querySelector('[data-more="duplicate"]').addEventListener('click', duplicateScript);
    document.querySelector('[data-more="delete"]').addEventListener('click', deleteScript);
    $('desk').addEventListener('scroll', hideSuggestions, { passive: true });
    // Clicking the empty paper below the last line puts the cursor at the end.
    $('paper').addEventListener('mousedown', (e) => {
      if (e.target.id === 'paper') {
        const d = active();
        e.preventDefault();
        focusElement(d.elements[d.elements.length - 1].id, 'end');
      }
    });
    window.Common.onFileDrop((files) => {
      const f = files.find((x) => ['pdf', 'fdx', 'fountain', 'spmd', 'txt'].includes(x.ext));
      if (f) api.readDroppedScript(f.file).then(openImported);
    });
    api.onMenu((channel, arg) => {
      ({
        new: newScript,
        duplicate: duplicateScript,
        import: async () => openImported(await api.importScript()),
        importScript: async () => openImported(await api.importScript()),
        export: () => exportAs(arg === 'native' ? 'fountain' : arg),
        home: () => window.Common.goHome(store),
        toggleSidebar,
      }[channel] || (() => {}))();
    });
    api.onFileOpened((file) => openImported({ script: fileToScript(file) }));
  }

  async function init() {
    const stored = await api.loadStore('scripts');
    // Starting with no scripts is fine: the empty screen offers New, Import and an example.
    if (stored && Array.isArray(stored.scripts)) {
      state = { sidebarHidden: false, ...stored };
      state.scripts = state.scripts.map((d) => S.normalizeDoc(d));
      if (!active()) state.activeId = state.scripts.length ? state.scripts[0].id : null;
    } else {
      state = { scripts: [], activeId: null, sidebarHidden: false };
    }
    wire();
    collab.mountToolbar(document.querySelector('.toolbar'), $('titlePageBtn'));
    render({ fresh: true });
    collab.init();
    window.Common.initUpdates();
    const pending = await api.takePendingFile();
    if (pending) openImported({ script: fileToScript(pending) });
  }

  // A double-clicked .fountain / .fdx file handed over by the main process.
  const fileToScript = (file) => (file.ext === 'fdx'
    ? { name: file.name, kind: 'fdx', xml: file.content }
    : { name: file.name, kind: 'text', text: file.content });

  function sampleScript() {
    return S.normalizeDoc({
      title: 'Night Diner',
      titlePage: { author: '', draftDate: 'First draft' },
      elements: [
        { type: 'transition', text: 'FADE IN:' },
        { type: 'heading', text: "EXT. ROSIE'S DINER - NIGHT" },
        { type: 'action', text: 'Rain hammers a flickering neon sign. MAYA (30s), soaked through, crosses the empty lot toward the door.' },
        { type: 'heading', text: "INT. ROSIE'S DINER - NIGHT" },
        { type: 'action', text: "LOU (60s) wipes the counter. He doesn't look up." },
        { type: 'character', text: 'MAYA' },
        { type: 'dialogue', text: 'You still make it too strong.' },
        { type: 'character', text: 'LOU' },
        { type: 'parenthetical', text: '(not looking up)' },
        { type: 'dialogue', text: 'You still drink it.' },
        { type: 'action', text: 'Maya sits. Lou slides a chipped mug across the counter.' },
        { type: 'transition', text: 'CUT TO:' },
        { type: 'heading', text: 'EXT. PARKING LOT - CONTINUOUS' },
        { type: 'action', text: '' },
      ],
    });
  }

  init();
})();
