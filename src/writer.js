(function () {
  const { api, uid, $, el, toast, relTime } = window.Common;
  const S = window.Screenplay;
  const safeFileName = (s) => window.Common.safeFileName(s, 'script');

  let state = { scripts: [], activeId: null, sidebarHidden: false };
  let currentId = null; // element with the cursor
  let compare = null;   // { docId, revisionId }: show changes since this revision
  // The production this page works in: scripts are its scripts (one per episode for TV).
  const P = window.Production;
  let prod = null;      // { id, title, type, episodes }
  let cloudProd = false; // a shared production: its scripts live on the server
  const isTv = () => !!prod && prod.type === 'tv';
  const mine = () => state.scripts.filter((d) => d.productionId === (prod && prod.id) || (d._cloud && !d.productionId));
  const episodeOf = (d) => (isTv() && d ? prod.episodes.find((e) => e.id === d.episodeId) : null);
  // Every script in this production: on this computer, plus (shared production) the ones
  // online, as { id, title, episodeId, updatedAt, doc? }.
  function entries() {
    const local = collab.localOnly(mine()).map((d) => ({ id: d.id, title: d.title, episodeId: d.episodeId, updatedAt: d.updatedAt, doc: d }));
    const open = state.scripts.find((d) => d._cloud);
    const online = collab.shared.map((x) => ({ ...x, doc: open && open._cloud.id === x.id ? open : null }));
    return [...online, ...local];
  }
  const openEntry = (x) => (x.doc && !x.doc._cloud ? selectScript(x.id) : collab.open(x.id));

  // Shared (cloud) scripts live on the server, so only local scripts are saved here.
  const store = window.Common.createStore('scripts', () => ({ ...state, scripts: collab.localOnly(state.scripts) }));
  const active = () => state.scripts.find((d) => d.id === state.activeId);
  function save() {
    const d = active();
    if (d) d.updatedAt = Date.now();
    store.save();
    collab.changed();
    history.record();
    undoUi.update();
  }

  // ---------- Undo / redo ----------
  const history = window.History.createHistory({
    getDoc: () => active(),
    onApply: () => {
      save();
      renderPaper(active());
      renderNav();
      updateStatus();
      renderSidebar();
      renderElementBar();
    },
  });
  // Every edit in the script goes through the app's history, so Ctrl/⌘+Z is always app-level here.
  const undoUi = window.Common.wireUndo(history, { textFieldsUndoNatively: false });

  // ---------- Comments ----------
  const comments = window.Comments.attach({
    getDoc: () => active(),
    save: () => save(),
    rerender: () => updateBadges(),
    readOnly: () => readOnly(),
    describe: (target) => {
      const d = active();
      const item = d && d.elements.find((e) => e.id === target);
      if (!item) return null;
      const text = S.displayText(item).trim();
      return `${S.LABELS[item.type]}: ${text.length > 48 ? text.slice(0, 48) + '…' : text || '(empty line)'}`;
    },
    jump: (target) => focusElement(target, 0, true),
  });

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
    onRoleChange: () => {},
    production: true,
    parent: () => (cloudProd ? prod.id : null),
    productionTitle: () => (cloudProd ? prod.title : null),
    // Share: the whole production (or, in a shared one, this script left on the computer).
    share: async () => {
      const d = active();
      if (cloudProd && d) {
        try {
          await window.Cloud.createProject('script', window.SyncCore.stripLocal(JSON.parse(JSON.stringify(d))), { id: d.id, parent: prod.id });
          state.scripts = state.scripts.filter((x) => x !== d);
          await store.flush();
          await collab.refreshList();
          collab.open(d.id);
        } catch (err) { alert(err.message); }
        return;
      }
      await store.flush();
      if (await P.share(prod.id)) location.reload();
    },
  });
  const readOnly = () => collab.readOnly();

  // Opens this production's script (the episode asked for, or the first episode's for TV),
  // or the empty screen.
  function selectFirstLocal(episodeId) {
    const all = entries();
    const first = episodeId ? all.find((x) => x.episodeId === episodeId)
      : isTv() ? prod.episodes.map((e) => all.find((x) => x.episodeId === e.id)).find(Boolean)
        : all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    if (first) openEntry(first);
    else selectScript(null);
  }

  function selectScript(id) {
    collab.leave();
    state.activeId = id;
    // Keep the address in step, so reopening the page shows the same episode.
    const d = active();
    const url = new URL(location.href);
    if (d && d.episodeId) url.searchParams.set('episode', d.episodeId); else url.searchParams.delete('episode');
    window.history.replaceState(null, '', url);
    currentId = null;
    compare = null;
    store.save();
    render({ fresh: true });
  }

  // ---------- Sidebar ----------
  // This production's scripts; for TV, one row per episode (a click on an episode without a
  // script starts one).
  function renderSidebar() {
    $('app').classList.toggle('sidebar-hidden', state.sidebarHidden);
    $('sidebarTitle').textContent = prod ? prod.title : 'Scripts';
    $('sidebarSub').textContent = prod ? P.typeLabel(prod) : '';
    $('listHeading').textContent = isTv() ? 'Episodes' : 'Scripts';
    const list = $('list');
    list.innerHTML = '';
    const all = entries();
    const row = (x, name, onclick) => {
      const st = x && x.doc && S.stats(x.doc);
      const meta = !x ? 'No script yet — click to start'
        : st ? `${st.pages} pg · ${st.scenes} scenes · ${relTime(x.updatedAt || Date.now())}`
          : `☁ Shared · edited ${relTime(x.updatedAt || Date.now())}`;
      list.append(el('li', { class: x && x.id === state.activeId ? 'active' : '', onclick },
        el('div', { class: 'name' }, name),
        el('div', { class: 'meta' }, meta)));
    };
    if (collab.error) list.append(el('li', { class: 'list-note' }, collab.error));
    if (isTv()) {
      for (const e of prod.episodes) {
        const x = all.find((y) => y.episodeId === e.id);
        row(x, P.episodeLabel(e), () => (x ? openEntry(x) : newScript(e.id)));
      }
    } else {
      all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).forEach((x) => row(x, x.title || 'Untitled Script', () => openEntry(x)));
    }
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

  // Size a line's text box to its content, in whole 16px lines (the browser can report a
  // pixel extra, which would make page breaks drift from the PDF).
  function grow(ta) {
    ta.style.height = '0px';
    ta.style.height = Math.max(16, Math.round(ta.scrollHeight / 16) * 16) + 'px';
  }

  function nodeFor(item) {
    let node = nodes.get(item.id);
    if (node) return node;
    const ta = el('textarea', { class: 'el-text', rows: 1, spellcheck: 'true' });
    node = el('div', { class: 'el', 'data-item': item.id },
      el('span', { class: 'el-num left' }), ta, el('span', { class: 'el-num right' }));
    ta.addEventListener('input', () => onInput(node.dataset.item, ta));
    ta.addEventListener('keydown', (e) => onKeyDown(e, node.dataset.item, ta));
    ta.addEventListener('focus', () => {
      currentId = node.dataset.item;
      // A speech split across pages is edited as one piece, then split again afterwards.
      if (node.classList.contains('split')) updatePageBreaks();
      renderElementBar(); updateStatus(); highlightScene();
      if (comments.isOpen) comments.setTarget(currentId);
    });
    ta.addEventListener('blur', () => onBlur(node.dataset.item, ta));
    nodes.set(item.id, node);
    return node;
  }

  // ---------- Breakdown tags (props, wardrobe, vehicles… marked in the script) ----------
  const CATS = () => window.ShotFormats.BREAKDOWN;
  const catOf = (id) => window.ShotFormats.breakdownCategory(id) || { label: id, color: '#888' };

  // Tags on a line, shown in the left margin (outside the text, so page breaks don't move).
  function tagChips(doc, item) {
    const tags = (doc.tags || []).filter((t) => t.lineId === item.id);
    if (!tags.length) return null;
    return el('div', { class: 'el-tags' }, ...tags.map((t) => el('span', {
      class: 'el-tag', style: `--tag:${catOf(t.category).color}`, title: `${catOf(t.category).label}: ${t.text}` + (readOnly() ? '' : ' — click to remove'),
      onmousedown: (e) => e.preventDefault(),
      onclick: () => {
        if (readOnly()) return;
        doc.tags = doc.tags.filter((x) => x.id !== t.id);
        save(); updateBadges(); updateStatus();
      },
    }, t.text)));
  }

  // Tag the selected words on the current line for the breakdown.
  function tagSelection() {
    const doc = active();
    const ta = document.activeElement;
    const node = ta && ta.closest && ta.closest('.paper .el');
    if (!doc || readOnly()) return;
    const text = node && ta.selectionEnd > ta.selectionStart ? ta.value.slice(ta.selectionStart, ta.selectionEnd).replace(/\s+/g, ' ').trim() : '';
    if (!text) { toast('Select words in the script first (e.g. "chipped mug"), then tag them.'); return; }
    const lineId = node.dataset.item;
    const body = el('div', { class: 'tag-pick' },
      el('p', { class: 'muted small' }, `“${text}” is a…`),
      el('div', { class: 'tag-cats' }, ...CATS().map((c) => el('button', {
        class: 'tag-cat', type: 'button', style: `--tag:${c.color}`,
        onclick: () => {
          doc.tags = [...(doc.tags || []), { id: uid(), lineId, text, category: c.id }];
          m.close();
          save(); updateBadges(); updateStatus();
          toast(`Tagged as ${c.label}. It shows up in the production's Breakdown.`);
          focusElement(lineId, ta.selectionEnd);
        },
      }, c.label))));
    const m = window.Common.modal('Tag for the breakdown', body);
  }

  // Comment badges, revision marks ("*" in the right margin for changed lines) and tags.
  function updateBadges() {
    const doc = active();
    if (!doc) return;
    const rev = compare && compare.docId === doc.id && (doc.revisions || []).find((r) => r.id === compare.revisionId);
    const changes = rev ? S.revisionChanges(doc, rev) : null;
    for (const item of doc.elements) {
      const node = nodes.get(item.id);
      if (!node) continue;
      const oldTags = node.querySelector(':scope > .el-tags');
      if (oldTags) oldTags.remove();
      const chips = tagChips(doc, item);
      if (chips) node.append(chips);
      const old = node.querySelector(':scope > .cm-badge');
      if (old) old.remove();
      const b = comments.badge(item.id);
      if (b) node.append(b);
      node.classList.toggle('has-comment', !!b);
      node.classList.toggle('rev-mark', !!changes && (changes.changed.has(item.id) || changes.added.has(item.id)));
    }
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
    updateBadges();
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
  const DIALOGUE_CHARS = 35; // 3.5in of 12pt Courier
  let layout = { pageOf: [], endPageOf: [], pages: 0, fill: [], splits: new Map() };

  const focusedId = () => {
    const a = document.activeElement;
    const node = a && a.closest && a.closest('.paper .el');
    return node ? node.dataset.item : null;
  };

  function measurePages(doc) {
    const pageOf = [];
    const endPageOf = [];
    const fill = [];           // empty space left at the bottom of each page
    const splits = new Map();  // element index -> { first, rest, speaker } for speeches split across pages
    const editing = focusedId();
    let page = 1;
    let used = 0;
    const heightOf = (it) => {
      const n = it && nodes.get(it.id);
      const t = n && n.querySelector('textarea');
      return t ? t.offsetHeight : LINE;
    };
    doc.elements.forEach((item, i) => {
      const h = heightOf(item);
      const gap = used === 0 ? 0 : GAP_BEFORE[item.type] || 0;
      // Keep a scene heading or character name on the same page as the start of what
      // follows (its blank line plus at least two lines of it).
      const next = doc.elements[i + 1];
      const keep = (item.type === 'heading' || item.type === 'character') && next
        ? (GAP_BEFORE[next.type] || 0) + Math.min(heightOf(next), LINE * 2) : 0;
      pageOf[i] = page;
      if (used > 0 && used + gap + h + keep > PAGE_BODY) {
        // A long speech continues on the next page: "(MORE)" here, "NAME (CONT'D)" there.
        // (Not while it's being edited; it's split again when the cursor leaves it.)
        if (item.type === 'dialogue' && item.id !== editing) {
          const fitLines = Math.floor((PAGE_BODY - used - gap) / LINE) - 1;
          const sp = S.splitSpeech(S.displayText(item), DIALOGUE_CHARS, fitLines);
          if (sp) {
            splits.set(i, { ...sp, speaker: S.speakerOf(doc.elements, i) });
            fill[page] = PAGE_BODY - (used + gap + (sp.firstLines + 1) * LINE);
            page++;
            used = (1 + sp.restLines) * LINE;
            endPageOf[i] = page;
            return;
          }
        }
        fill[page] = PAGE_BODY - used;
        page++;
        pageOf[i] = page;
        used = h;
      } else {
        used += gap + h;
      }
      endPageOf[i] = page;
    });
    fill[page] = Math.max(0, PAGE_BODY - used);
    return { pageOf, endPageOf, pages: doc.elements.length ? page : 0, fill, splits };
  }

  const pageBreak = (fillPx, nextPage, extraClass = '') => el('div', { class: 'page-break ' + extraClass, 'aria-hidden': 'true' },
    el('div', { class: 'pb-bottom', style: `height:${Math.max(0, fillPx) + IN}px` }),
    el('div', { class: 'pb-gap' }),
    el('div', { class: 'pb-top' }, el('span', { class: 'pb-num' }, nextPage + '.'), revisionHeader()));

  function updatePageBreaks() {
    const doc = active();
    if (!doc) return;
    const paper = $('paper');
    paper.querySelectorAll('.page-break, .split-view').forEach((n) => n.remove());
    paper.querySelectorAll('.el.split').forEach((n) => n.classList.remove('split'));
    layout = measurePages(doc);
    const { pageOf, endPageOf, fill, splits } = layout;
    doc.elements.forEach((item, i) => {
      const node = nodes.get(item.id);
      if (!node) return;
      if (i > 0 && pageOf[i] !== endPageOf[i - 1]) paper.insertBefore(pageBreak(fill[endPageOf[i - 1]], pageOf[i]), node);
      const sp = splits.get(i);
      if (sp) {
        // Show the speech in two parts around the page break; clicking either part edits it.
        node.classList.add('split');
        const part = (text, cls, caret) => el('div', {
          class: cls,
          onmousedown: (e) => { e.preventDefault(); focusElement(item.id, caret); },
        }, text);
        node.append(el('div', { class: 'split-view' },
          part(sp.first, 'sv-text', sp.first.length),
          el('div', { class: 'sv-more' }, '(MORE)'),
          pageBreak(fill[pageOf[i]], endPageOf[i], 'in-split'),
          el('div', { class: 'sv-contd' }, `${sp.speaker} (CONT'D)`),
          part(sp.rest, 'sv-text', item.text.length)));
      }
    });
    // Pad the last page out to a full sheet.
    paper.style.paddingBottom = (fill[layout.pages] || 0) + IN + 'px';
  }

  // "Blue Rev. 10/18/26" at the top of each page while showing changes since a revision.
  function revisionHeader() {
    const doc = active();
    const rev = compare && doc && compare.docId === doc.id && (doc.revisions || []).find((r) => r.id === compare.revisionId);
    return rev ? el('span', { class: 'pb-rev' }, `${rev.color} Rev. ${new Date().toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' })}`) : null;
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
    const rev = compareRevision();
    const ch = rev ? S.revisionChanges(doc, rev) : null;
    $('statusbar').append(...[
      el('span', { class: 'st-type' }, cur ? S.LABELS[cur.type] : ''),
      el('span', { class: 'st-hint' }, cur && !readOnly() ? HINTS[cur.type] : readOnly() ? 'View only' : ''),
      el('span', { class: 'st-spacer' }),
      rev ? el('span', { class: 'st-rev' }, `Changes since ${rev.name}: ${ch.changed.size + ch.added.size} lines, ${ch.removed.length} removed`,
        el('button', { class: 'link-btn', onclick: () => setCompare(null) }, 'Hide')) : null,
      comments.openCount() ? el('button', { class: 'link-btn', onclick: () => comments.open() }, `💬 ${comments.openCount()} open`) : null,
      el('span', {}, `${st.pages} page${st.pages === 1 ? '' : 's'}`),
      el('span', {}, `${st.scenes} scene${st.scenes === 1 ? '' : 's'}`),
      el('span', {}, `${st.words.toLocaleString()} words`)].filter(Boolean));
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
    refreshLater(); // a long speech may split across pages again now
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

  // ---------- Revisions ----------
  const compareRevision = () => {
    const doc = active();
    return compare && doc && compare.docId === doc.id ? (doc.revisions || []).find((r) => r.id === compare.revisionId) : null;
  };

  function setCompare(revisionId) {
    const doc = active();
    compare = revisionId && doc ? { docId: doc.id, revisionId } : null;
    updateBadges();
    updatePageBreaks();
    updateStatus();
  }

  function openRevisions() {
    const doc = active();
    if (!doc) return;
    const ro = readOnly();
    const body = el('div', {});
    const m = window.Common.modal('Revisions', body, { wide: true });
    const draw = () => {
      body.innerHTML = '';
      const nextColor = S.nextRevisionColor(doc);
      const color = el('select', { class: 'field' }, ...S.REVISION_COLORS.map(([n]) => el('option', { value: n }, n)));
      color.value = nextColor;
      const name = el('input', { class: 'field', value: `${nextColor} Revision`, placeholder: 'Name' });
      color.addEventListener('change', () => { if (/Revision$/.test(name.value)) name.value = `${color.value} Revision`; });
      const saveBtn = el('button', { class: 'primary-btn', type: 'button' }, 'Save revision');
      saveBtn.addEventListener('click', () => {
        if (JSON.stringify(doc).length > 1200000) { alert('This script is getting too large to keep more revisions. Delete an old revision first.'); return; }
        const who = window.Cloud && window.Cloud.user ? window.Cloud.user.name : '';
        doc.revisions = doc.revisions || [];
        doc.revisions.push(S.makeRevision(doc, { name: name.value.trim(), color: color.value, author: who }));
        save();
        toast(`Saved ${name.value.trim() || color.value + ' Revision'}`);
        draw();
      });
      const cur = compareRevision();
      body.append(
        el('p', { class: 'muted small' }, 'Save a draft of the script as it is now. Later, choose "Show changes" to mark every line changed since that draft with * in the margin, as in production revisions. The marks also appear in the PDF.'),
        ro ? null : el('div', { class: 'rev-new' }, name, color, saveBtn),
        el('div', { class: 'rev-list' }, ...(doc.revisions || []).slice().reverse().map((r) => {
          const ch = S.revisionChanges(doc, r);
          const showing = cur && cur.id === r.id;
          return el('div', { class: 'rev-row' + (showing ? ' active' : '') },
            el('span', { class: 'rev-dot', style: `background:${S.revisionHex(r.color)}` }),
            el('div', {},
              el('div', { class: 'rev-name' }, r.name),
              el('div', { class: 'rev-meta' }, [
                r.author, new Date(r.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
                `${ch.changed.size + ch.added.size} changed · ${ch.removed.length} removed since`,
              ].filter(Boolean).join(' · '))),
            el('div', { class: 'rev-actions' },
              el('button', { class: 'ghost-btn', type: 'button', onclick: () => { setCompare(showing ? null : r.id); draw(); } }, showing ? 'Hide changes' : 'Show changes'),
              ro ? null : el('button', { class: 'ghost-btn', type: 'button', onclick: () => {
                if (!confirm(`Restore "${r.name}"? The script goes back to that draft. You can undo this.`)) return;
                doc.elements = r.elements.map((e) => ({ ...e }));
                structuralChange();
                draw();
              } }, 'Restore'),
              ro ? null : el('button', { class: 'icon-btn del', type: 'button', title: 'Delete revision', onclick: () => {
                if (!confirm(`Delete "${r.name}"?`)) return;
                doc.revisions.splice(doc.revisions.indexOf(r), 1);
                if (showing) setCompare(null);
                save();
                draw();
              } }, '✕')));
        })),
        (doc.revisions || []).length ? null : el('p', { class: 'muted small' }, 'No revisions saved yet.'),
        el('div', { class: 'modal-foot' }, el('button', { class: 'ghost-btn', type: 'button', onclick: () => m.close() }, 'Done')));
    };
    draw();
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
    // Same page breaks (and split speeches) as the editor shows.
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    updatePageBreaks();
    const { pageOf, endPageOf, splits } = layout;
    const rev = compare && compare.docId === doc.id && (doc.revisions || []).find((r) => r.id === compare.revisionId);
    const changes = rev ? S.revisionChanges(doc, rev) : null;
    const revLabel = rev ? `${rev.color} Rev. ${new Date().toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' })}` : '';
    let page = null;
    const newPage = (n) => {
      const header = [revLabel, n > 1 ? n + '.' : ''].filter(Boolean).join('    ');
      page = el('section', { class: 'print-page' }, header ? el('div', { class: 'print-num' }, header) : null);
      view.append(page);
    };
    const add = (type, text, opts = {}) => page.append(el('div', {
      class: 'el el-' + type + (page.querySelector('.el') ? '' : ' first') + (opts.marked ? ' rev-mark' : ''),
    },
    opts.num ? el('span', { class: 'el-num left' }, opts.num) : null,
    el('div', { class: 'el-text' }, text || ' '),
    opts.num ? el('span', { class: 'el-num right' }, opts.num) : null));
    let sceneNo = 0;
    doc.elements.forEach((item, i) => {
      if (!page || pageOf[i] !== endPageOf[i - 1]) newPage(pageOf[i]);
      const num = item.type === 'heading' && doc.sceneNumbers ? String(++sceneNo) : '';
      const marked = !!changes && (changes.changed.has(item.id) || changes.added.has(item.id));
      const sp = splits.get(i);
      if (sp) {
        add('dialogue', sp.first, { marked });
        add('more', '(MORE)');
        newPage(endPageOf[i]);
        add('character', `${sp.speaker} (CONT'D)`);
        add('dialogue', sp.rest, { marked });
      } else {
        add(item.type, S.displayText(item), { num, marked });
      }
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
      // The shot sheet remembers which script (and scene versions) it came from, so it can
      // flag scenes that change in the script later.
      payload = target === 'shotsheet'
        ? { to: 'shotsheet', name: doc.title, input: S.toParseInput(doc), link: { scriptId: doc.id, title: doc.title, scenes: S.sceneLinks(doc) } }
        : { to: 'callsheet', name: doc.title, sheet: S.toCallsheet(doc) };
      if (target === 'shotsheet' && !S.scenes(doc).length) throw new Error('This script has no scene headings yet.');
    } catch (err) {
      alert(err.message);
      return;
    }
    window.Common.setHandoff(payload);
    await store.flush();
    location.href = P.link(target + '.html', target === 'shotsheet' && doc.episodeId ? { episode: doc.episodeId } : {});
  }

  // ---------- Import ----------
  // New and imported scripts belong to this production (and, for TV, to an episode: the one
  // asked for, or the episode being viewed if it has no script yet).
  function addScript(doc, episodeId) {
    doc.productionId = prod.id;
    if (isTv()) {
      const taken = new Set(entries().map((x) => x.episodeId));
      const wanted = episodeId || P.episode();
      const free = prod.episodes.find((e) => !taken.has(e.id));
      doc.episodeId = wanted && !taken.has(wanted) ? wanted : free ? free.id : null;
      if (!doc.episodeId) {
        alert('Every episode already has a script. Add an episode on the production page first.');
        return false;
      }
    }
    if (cloudProd) {
      // A shared production: the script is created online, inside it.
      window.Cloud.createProject('script', doc, { parent: prod.id })
        .then(async (project) => { await collab.refreshList(); collab.open(project.id); })
        .catch((err) => alert(err.message));
      return true;
    }
    state.scripts.push(doc);
    selectScript(doc.id);
    return true;
  }

  function openImported(result) {
    if (!result) return;
    if (result.error) { alert(result.error); return; }
    try {
      const doc = S.fromImport(result.script);
      if (addScript(doc)) toast(`Imported ${result.script.name}: ${S.stats(doc).scenes} scenes`);
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
      const ep = isTv() ? prod.episodes.find((e) => e.id === P.episode()) || prod.episodes[0] : null;
      $('desk').append(Object.assign(window.Common.emptyState({
        title: ep ? `No script for ${P.episodeLabel(ep)}` : 'No script yet',
        text: 'Start writing, or import a script you have already written (PDF, Final Draft or Fountain).',
        actions: [
          { label: 'New script', primary: true, onclick: () => newScript(ep && ep.id) },
          { label: 'Import script…', onclick: async () => openImported(await api.importScript()) },
          { label: 'Load example', onclick: () => addScript(sampleScript(), ep && ep.id) },
        ],
      }), { id: 'emptyState' }));
      return;
    }
    $('numbersToggle').textContent = doc.sceneNumbers ? 'Hide scene numbers' : 'Show scene numbers';
    $('deleteLabel').textContent = collab.isCloud(doc) ? collab.deleteLabel(doc) : 'Delete script';
    $('app').classList.toggle('read-only', readOnly());
    renderPaper(doc, { fresh: !!(opts.fresh || opts.opened) });
    // A newly opened script starts a fresh undo history; a collaborator's edit becomes the
    // new starting point, so undo never reverses their work.
    if (opts.fresh || opts.opened) history.reset();
    else if (opts.remote) history.rebase();
    undoUi.update();
    comments.refresh();
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
  function newScript(episodeId) {
    const ep = isTv() && prod.episodes.find((e) => e.id === episodeId);
    const doc = S.newDoc();
    doc.title = ep ? `${prod.title} — ${P.episodeLabel(ep)}` : prod.title;
    if (addScript(doc, ep ? ep.id : undefined)) openTitlePage();
  }

  function duplicateScript() {
    const d = active();
    if (!d) return;
    const copy = S.normalizeDoc({ ...JSON.parse(JSON.stringify(window.SyncCore.stripLocal(d))), id: null, title: d.title + ' (copy)' });
    copy.elements.forEach((e) => (e.id = uid()));
    copy.revisions = []; // they refer to the original's lines
    copy.comments = [];
    if (addScript(copy)) toast('Duplicated');
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
    $('homeBtn').addEventListener('click', () => P.goHome(store));
    $('newBtn').addEventListener('click', () => newScript());
    $('importBtn').addEventListener('click', async () => openImported(await api.importScript()));
    $('sidebarToggle').addEventListener('click', toggleSidebar);
    $('titlePageBtn').addEventListener('click', openTitlePage);
    $('revisionsBtn').addEventListener('click', openRevisions);
    $('commentBtn').addEventListener('mousedown', (e) => e.preventDefault()); // keep the current line
    $('commentBtn').addEventListener('click', () => comments.open(currentId || undefined));
    $('tagBtn').addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection
    $('tagBtn').addEventListener('click', tagSelection);
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 't') { e.preventDefault(); tagSelection(); }
    });
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
        new: () => newScript(),
        duplicate: duplicateScript,
        import: async () => openImported(await api.importScript()),
        importScript: async () => openImported(await api.importScript()),
        export: () => exportAs(arg === 'native' ? 'fountain' : arg),
        home: () => P.goHome(store),
        toggleSidebar,
        undo: () => active() && undoUi.run(false, true),
        redo: () => active() && undoUi.run(true, true),
        comments: () => active() && comments.open(currentId || undefined),
      }[channel] || (() => {}))();
    });
    api.onFileOpened((file) => openImported({ script: fileToScript(file) }));
  }

  async function init() {
    // This page works in one production (?production=<id>, &episode=<id> for a TV episode).
    await P.migrate();
    const pid = P.id();
    if (!pid) { P.goPicker(); return; }
    prod = (await P.list()).find((p) => p.id === pid);
    if (!prod) {
      // A shared production: read its name, type and episodes from the server.
      try {
        prod = P.upgrade({ ...(await window.Cloud.doc(pid)), id: pid });
        cloudProd = true;
      } catch { P.goPicker(); return; }
    }
    const stored = await api.loadStore('scripts');
    state = { sidebarHidden: false, ...(stored || {}), scripts: stored && Array.isArray(stored.scripts) ? stored.scripts.map((d) => S.normalizeDoc(d)) : [] };
    const wanted = P.episode();
    const local = collab.localOnly(mine());
    const pick = wanted
      ? local.find((d) => d.episodeId === wanted) // none: that episode's "no script yet" screen
      : local.find((d) => d.id === state.activeId)
        || (isTv() ? prod.episodes.map((e) => local.find((d) => d.episodeId === e.id)).find(Boolean)
          : local.sort((a, b) => b.updatedAt - a.updatedAt)[0]);
    state.activeId = pick ? pick.id : null;
    wire();
    collab.mountToolbar(document.querySelector('.toolbar'), $('titlePageBtn'));
    render({ fresh: true });
    collab.init();
    if (cloudProd) {
      // Open the episode's (or the production's) script from the server.
      await collab.refreshList();
      if (!pick) selectFirstLocal(wanted || undefined);
    }
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
