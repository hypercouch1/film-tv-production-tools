// Screenplay documents for the Script Writer: formatting rules, pagination,
// import/export (Fountain, Final Draft) and conversion to call sheets.
// Doc: { id, title, updatedAt, titlePage: { credit, author, contact, draftDate },
//        sceneNumbers, elements: [{ id, type, text }] }
// Loaded as a <script> in the app and with require() in tests (after script-parse.js).
(function (root) {
  const uid = () => (root.Common && root.Common.uid ? root.Common.uid() : Math.random().toString(36).slice(2, 12));

  const TYPES = ['heading', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot'];
  const LABELS = {
    heading: 'Scene Heading', action: 'Action', character: 'Character', parenthetical: 'Parenthetical',
    dialogue: 'Dialogue', transition: 'Transition', shot: 'Shot',
  };
  // What Enter creates after each element, and what Tab / Shift+Tab switch to (Final Draft style).
  const NEXT_ON_ENTER = {
    heading: 'action', action: 'action', character: 'dialogue', parenthetical: 'dialogue',
    dialogue: 'action', transition: 'heading', shot: 'action',
  };
  const NEXT_ON_TAB = {
    action: 'character', character: 'transition', transition: 'heading', heading: 'shot', shot: 'action',
    dialogue: 'parenthetical', parenthetical: 'dialogue',
  };
  const PREV_ON_TAB = Object.fromEntries(Object.entries(NEXT_ON_TAB).map(([k, v]) => [v, k]));
  PREV_ON_TAB.dialogue = 'parenthetical';
  PREV_ON_TAB.parenthetical = 'dialogue';
  const UPPERCASE = new Set(['heading', 'character', 'transition', 'shot']);

  const HEADING = /^(?:INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT|I\/E|INT|EXT|EST)[.\s]/i;
  const TRANSITIONS = ['CUT TO:', 'DISSOLVE TO:', 'SMASH CUT TO:', 'MATCH CUT TO:', 'JUMP CUT TO:', 'FADE OUT.', 'FADE TO BLACK.', 'FADE IN:'];
  const TIMES = ['DAY', 'NIGHT', 'CONTINUOUS', 'LATER', 'MOMENTS LATER', 'MORNING', 'AFTERNOON', 'EVENING', 'DUSK', 'DAWN', 'SAME'];

  const isCaps = (s) => /[A-Za-z]/.test(s) && s === s.toUpperCase();

  // Switch an Action line to the type its text implies (e.g. typing "INT." starts a scene heading).
  function autoType(text, type) {
    if (type !== 'action') return type;
    const t = text.trim();
    if (HEADING.test(t)) return 'heading';
    if (t.length > 3 && isCaps(t) && /\bTO:$/.test(t)) return 'transition';
    return type;
  }

  // Text as it appears on the page.
  function displayText(el) {
    let t = el.text;
    if (UPPERCASE.has(el.type)) t = t.toUpperCase();
    if (el.type === 'parenthetical') t = wrapParens(t);
    return t;
  }
  function wrapParens(t) {
    const s = t.trim();
    if (!s) return s;
    return (s.startsWith('(') ? '' : '(') + s + (s.endsWith(')') ? '' : ')');
  }

  function cleanCharacter(text) {
    return text.toUpperCase().replace(/\s*\((?:V\.?\s*O\.?|O\.?\s*S\.?|O\.?\s*C\.?|CONT['’]?D|CONT)[^)]*\)/g, '').replace(/\(.*?\)/g, '')
      .replace(/\^$/, '').replace(/\s+/g, ' ').trim();
  }
  const titleCase = (n) => n.toLowerCase().replace(/(^|[\s.-])([a-z])/g, (m, p, c) => p + c.toUpperCase());

  // ---------- Documents ----------
  function newDoc(title = 'Untitled Script') {
    return normalizeDoc({
      title,
      elements: [
        { type: 'transition', text: 'FADE IN:' },
        { type: 'heading', text: 'INT. ' },
      ],
    });
  }

  function normalizeDoc(raw) {
    raw = raw || {};
    const tp = raw.titlePage || {};
    const elements = (Array.isArray(raw.elements) ? raw.elements : [])
      .filter((e) => e && TYPES.includes(e.type))
      .map((e) => ({ id: typeof e.id === 'string' && e.id ? e.id : uid(), type: e.type, text: String(e.text || '') }));
    if (!elements.length) elements.push({ id: uid(), type: 'action', text: '' });
    return {
      id: raw.id || uid(),
      title: String(raw.title || 'Untitled Script'),
      updatedAt: raw.updatedAt || Date.now(),
      titlePage: {
        credit: String(tp.credit == null ? 'Written by' : tp.credit),
        author: String(tp.author || ''),
        contact: String(tp.contact || ''),
        draftDate: String(tp.draftDate || ''),
      },
      sceneNumbers: raw.sceneNumbers !== false,
      elements,
      revisions: cleanRevisions(raw.revisions),
      comments: cleanComments(raw.comments),
      // The production (and TV episode) this script belongs to.
      ...(typeof raw.productionId === 'string' ? { productionId: raw.productionId } : {}),
      ...(typeof raw.episodeId === 'string' ? { episodeId: raw.episodeId } : {}),
    };
  }

  const isItem = (x) => x && typeof x === 'object' && !Array.isArray(x) && typeof x.id === 'string';
  function cleanRevisions(list) {
    return (Array.isArray(list) ? list : []).filter((r) => isItem(r) && Array.isArray(r.elements)).map((r) => ({
      id: r.id, name: String(r.name || 'Revision'), color: String(r.color || 'White'), author: String(r.author || ''),
      at: Number(r.at) || Date.now(),
      elements: r.elements.filter(isItem).map((e) => ({ id: e.id, type: TYPES.includes(e.type) ? e.type : 'action', text: String(e.text || '') })),
    }));
  }
  // Comments are shared by all three systems: { id, target, text, author, authorId, at, resolved }.
  function cleanComments(list) {
    return (Array.isArray(list) ? list : []).filter(isItem).map((c) => ({
      id: c.id, target: String(c.target || ''), text: String(c.text || ''), author: String(c.author || ''),
      authorId: String(c.authorId || ''), at: Number(c.at) || Date.now(), resolved: !!c.resolved,
    }));
  }

  // Fills in missing fields in place (used for shared docs arriving from the server).
  function upgradeDoc(d) {
    const n = normalizeDoc(d);
    d.title = n.title;
    d.titlePage = n.titlePage;
    d.sceneNumbers = n.sceneNumbers;
    d.elements = (Array.isArray(d.elements) ? d.elements : []).filter((e) => e && typeof e === 'object');
    if (!d.elements.length) d.elements = n.elements;
    for (const e of d.elements) {
      if (!TYPES.includes(e.type)) e.type = 'action';
      if (typeof e.text !== 'string') e.text = String(e.text == null ? '' : e.text);
      if (typeof e.id !== 'string' || !e.id) e.id = uid();
    }
    d.revisions = n.revisions;
    d.comments = n.comments;
    return d;
  }

  // ---------- Import (uses the screenplay parser from script-parse.js) ----------
  // script: { kind: 'pdf', lines } | { kind: 'fdx', xml } | { kind: 'text', text }, plus name
  function fromImport(script) {
    const SP = root.ScriptParse;
    const parsed = script.kind === 'pdf' ? SP.fromPdfLines(script.lines)
      : script.kind === 'fdx' ? SP.fromFdx(script.xml)
        : SP.fromText(script.text);
    const elements = parsed.elements
      .filter((e) => TYPES.includes(e.type) && e.text.trim())
      .map((e) => ({
        type: e.type,
        text: e.type === 'heading' ? SP.parseHeading(e.text).heading : e.text.trim(),
      }));
    if (!elements.length) throw new Error('No script text was found in this file.');
    const name = script.name ? script.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() : '';
    const tp = parsed.titlePage || {};
    return normalizeDoc({
      title: parsed.title ? titleCase(parsed.title) : name || 'Imported Script',
      titlePage: { credit: tp.credit || 'Written by', author: tp.author || '', contact: tp.contact || '', draftDate: tp.draftDate || '' },
      elements,
    });
  }

  // Input for ScriptParse.parseScript, for sending a script to Shot Sheet.
  function toParseInput(doc) {
    return {
      kind: 'elements',
      name: doc.title,
      title: doc.title,
      elements: doc.elements.filter((e) => e.text.trim()).map((e) => ({ type: e.type, text: displayText(e) })),
    };
  }

  // ---------- Pagination ----------
  // Courier 12pt is 10 characters per inch and 6 lines per inch.
  const WIDTH = { heading: 60, action: 60, character: 38, parenthetical: 24, dialogue: 35, transition: 60, shot: 60 };
  const SPACE_BEFORE = { heading: 1, action: 1, character: 1, parenthetical: 0, dialogue: 0, transition: 1, shot: 1 };
  const LINES_PER_PAGE = 52;

  // Lines a paragraph takes when word-wrapped at `width` characters.
  function wrapCount(text, width) {
    let lines = 0;
    for (const para of String(text).split('\n')) {
      let count = 1;
      let line = 0;
      for (const word of para.split(/\s+/).filter(Boolean)) {
        let len = word.length;
        if (line > 0 && line + 1 + len > width) { count++; line = 0; }
        if (line > 0) line += 1;
        // A word longer than the line spills onto further lines.
        while (line + len > width) { count++; len -= width - line; line = 0; }
        line += len;
      }
      lines += count;
    }
    return Math.max(1, lines);
  }

  // Returns the page each element starts on and the total page count.
  function paginate(elements) {
    const pageOf = [];
    let page = 1;
    let used = 0;
    elements.forEach((el, i) => {
      const body = wrapCount(displayText(el) || ' ', WIDTH[el.type] || 60);
      const space = used === 0 ? 0 : SPACE_BEFORE[el.type] || 0;
      // Keep a character name with the first line of their speech.
      const keep = el.type === 'character' || el.type === 'heading' ? 2 : 0;
      if (used > 0 && used + space + body + keep > LINES_PER_PAGE) {
        page++;
        used = body;
      } else {
        used += space + body;
      }
      pageOf[i] = page;
    });
    return { pageOf, pages: elements.length ? page : 0 };
  }

  // ---------- Scenes & stats ----------
  function scenes(doc) {
    const out = [];
    let cur = null;
    doc.elements.forEach((el, index) => {
      if (el.type === 'heading') {
        cur = { number: String(out.length + 1), heading: displayText(el), index, elements: [] };
        out.push(cur);
      } else if (cur) {
        cur.elements.push(el);
      }
    });
    return out;
  }

  function characters(doc) {
    const counts = new Map();
    for (const el of doc.elements) {
      if (el.type !== 'character') continue;
      const name = cleanCharacter(el.text);
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  }

  function stats(doc) {
    const words = doc.elements.reduce((n, e) => n + (e.text.match(/\S+/g) || []).length, 0);
    return { words, scenes: scenes(doc).length, pages: paginate(doc.elements).pages, characters: characters(doc).length };
  }

  // ---------- Suggestions while typing ----------
  function suggestions(doc, el) {
    const typed = el.text.toUpperCase();
    let pool = [];
    let replaceFrom = 0;
    if (el.type === 'character') {
      pool = characters(doc);
    } else if (el.type === 'heading') {
      const dash = typed.lastIndexOf(' - ');
      if (dash >= 0) {
        replaceFrom = dash + 3;
        pool = TIMES;
      } else {
        const seen = new Set();
        for (const e of doc.elements) {
          if (e.type !== 'heading' || e === el) continue;
          const place = e.text.toUpperCase().split(' - ')[0].trim();
          if (place && !seen.has(place)) { seen.add(place); pool.push(place); }
        }
      }
    } else if (el.type === 'transition') {
      pool = TRANSITIONS;
    } else {
      return { items: [], replaceFrom: 0 };
    }
    const part = typed.slice(replaceFrom).trim();
    const items = pool.filter((p) => p.startsWith(part) && p !== part).slice(0, 6);
    return { items, replaceFrom };
  }

  // ---------- Export: Fountain ----------
  function toFountain(doc) {
    const tp = doc.titlePage;
    const out = [];
    out.push(`Title: ${doc.title}`);
    if (tp.credit) out.push(`Credit: ${tp.credit}`);
    if (tp.author) out.push(`Author: ${tp.author}`);
    if (tp.draftDate) out.push(`Draft date: ${tp.draftDate}`);
    if (tp.contact) out.push('Contact:', ...tp.contact.split('\n').map((l) => '    ' + l));
    out.push('');
    let prev = null;
    for (const el of doc.elements) {
      const t = displayText(el).trim();
      if (!t) continue;
      const tight = (el.type === 'dialogue' || el.type === 'parenthetical') && prev && ['character', 'parenthetical', 'dialogue'].includes(prev);
      if (!tight) out.push('');
      switch (el.type) {
        case 'heading': out.push(HEADING.test(t) ? t : '.' + t); break;
        case 'character': out.push(/[A-Z]/.test(t) ? t : '@' + t); break;
        case 'transition': out.push(/TO:$/.test(t) ? t : '> ' + t); break;
        case 'action': out.push(isCaps(t) ? '!' + t : t); break;
        default: out.push(t);
      }
      prev = el.type;
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  // ---------- Export: Final Draft (.fdx) ----------
  const FDX_TYPE = {
    heading: 'Scene Heading', action: 'Action', character: 'Character', parenthetical: 'Parenthetical',
    dialogue: 'Dialogue', transition: 'Transition', shot: 'Shot',
  };
  const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function toFdx(doc) {
    const tp = doc.titlePage;
    let sceneNo = 0;
    const paras = doc.elements.filter((e) => e.text.trim()).map((el) => {
      const num = el.type === 'heading' && doc.sceneNumbers ? ` Number="${++sceneNo}"` : '';
      const lines = displayText(el).split('\n').map((l) => `<Text>${xml(l)}</Text>`).join('<Text>&#10;</Text>');
      return `    <Paragraph${num} Type="${FDX_TYPE[el.type]}">${lines}</Paragraph>`;
    });
    const titleParas = [
      `<Paragraph Alignment="Center" Type="Action"><Text>${xml(doc.title.toUpperCase())}</Text></Paragraph>`,
      tp.credit && `<Paragraph Alignment="Center" Type="Action"><Text>${xml(tp.credit)}</Text></Paragraph>`,
      tp.author && `<Paragraph Alignment="Center" Type="Action"><Text>${xml(tp.author)}</Text></Paragraph>`,
      tp.draftDate && `<Paragraph Alignment="Center" Type="Action"><Text>${xml(tp.draftDate)}</Text></Paragraph>`,
      ...tp.contact.split('\n').filter(Boolean).map((l) => `<Paragraph Alignment="Left" Type="Action"><Text>${xml(l)}</Text></Paragraph>`),
    ].filter(Boolean).map((p) => '      ' + p);
    return [
      '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>',
      '<FinalDraft DocumentType="Script" Template="No" Version="5">',
      '  <Content>',
      ...paras,
      '  </Content>',
      '  <TitlePage>',
      '    <Content>',
      ...titleParas,
      '    </Content>',
      '  </TitlePage>',
      '</FinalDraft>',
      '',
    ].join('\n');
  }

  // ---------- Call sheet from a script ----------
  // One section per scene; cues for places, each character's first line, transitions, and clearing the scene.
  function toCallsheet(doc) {
    const sections = scenes(doc).map((s) => {
      const items = [];
      const speakers = [];
      for (const el of s.elements) {
        if (el.type === 'character') {
          const name = cleanCharacter(el.text);
          if (name && !speakers.includes(name)) speakers.push(name);
        }
      }
      if (speakers.length) items.push(`Places: ${speakers.map((n) => `*${titleCase(n)}*`).join(', ')}`);
      const cued = new Set();
      for (const el of s.elements) {
        const t = displayText(el).trim();
        if (!t) continue;
        if (el.type === 'character') {
          const name = cleanCharacter(el.text);
          if (name && !cued.has(name)) { cued.add(name); items.push(`Cue *${titleCase(name)}*`); }
        } else if (el.type === 'transition') {
          items.push(`Take *${t}*`);
        } else if (el.type === 'shot') {
          items.push(`Shot: ${t}`);
        }
      }
      items.push(`Clear scene ${s.number}`);
      return { title: `SC ${s.number} — ${s.heading}`, items };
    });
    if (!sections.length) throw new Error('This script has no scene headings yet.');
    return { title: doc.title, sections };
  }

  // ---------- Splitting long speeches across pages ----------
  // Word-wraps text the way the editor's textarea does (break at spaces, long words broken).
  function wrapLines(text, width) {
    const out = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const word of para.split(/ +/)) {
        let w = word;
        if (line && line.length + 1 + w.length > width) { out.push(line); line = ''; }
        line = line ? line + ' ' + w : w;
        while (line.length > width) { out.push(line.slice(0, width)); line = line.slice(width); }
      }
      out.push(line);
    }
    return out;
  }

  // Splits a speech so the first part fits in `fitLines` lines before "(MORE)", or returns
  // null to move the whole speech to the next page. Screenplay convention: break only
  // after a sentence (the next sentence starts the new page), with at least two lines
  // left behind.
  const SENTENCE_BREAK = /(?<=[.!?…]["'”’)\]]*|--|—)\s+/;
  function splitSpeech(text, width, fitLines) {
    const sentences = String(text).trim().split(SENTENCE_BREAK).filter(Boolean);
    for (let n = sentences.length - 1; n >= 1; n--) {
      const first = sentences.slice(0, n).join(' ');
      const firstLines = wrapLines(first, width).length;
      if (firstLines > fitLines) continue;
      if (firstLines < 2) return null;
      const rest = sentences.slice(n).join(' ');
      return { first, rest, firstLines, restLines: wrapLines(rest, width).length };
    }
    return null;
  }

  // The character a dialogue line belongs to, for "NAME (CONT'D)" on the next page.
  function speakerOf(elements, index) {
    for (let i = index - 1; i >= 0; i--) {
      const t = elements[i].type;
      if (t === 'character') return cleanCharacter(elements[i].text) || 'CONT';
      if (t !== 'parenthetical' && t !== 'dialogue') break;
    }
    return '';
  }

  // ---------- Revisions ----------
  // Industry order of revision page colours.
  const REVISION_COLORS = [
    ['White', '#ffffff'], ['Blue', '#a9c8f0'], ['Pink', '#f5b5c8'], ['Yellow', '#f4e27a'], ['Green', '#a8d8a0'],
    ['Goldenrod', '#e6b84c'], ['Buff', '#e9d3a8'], ['Salmon', '#f2a68c'], ['Cherry', '#d9707a'],
  ];
  const nextRevisionColor = (doc) => REVISION_COLORS[(doc.revisions || []).length % REVISION_COLORS.length][0];
  const revisionHex = (name) => (REVISION_COLORS.find(([n]) => n === name) || REVISION_COLORS[0])[1];

  // A saved draft: the script's lines at this moment.
  function makeRevision(doc, { name, color, author }) {
    return {
      id: uid(),
      name: name || `${color} Revision`,
      color,
      author: author || '',
      at: Date.now(),
      elements: doc.elements.map(({ id, type, text }) => ({ id, type, text })),
    };
  }

  // Lines added or changed since a revision (by line id), and lines removed since.
  function revisionChanges(doc, revision) {
    const before = new Map((revision.elements || []).map((e) => [e.id, e]));
    const changed = new Set();
    const added = new Set();
    for (const e of doc.elements) {
      const old = before.get(e.id);
      if (!old) { if (e.text.trim()) added.add(e.id); } else if (old.text !== e.text || old.type !== e.type) changed.add(e.id);
    }
    const now = new Set(doc.elements.map((e) => e.id));
    const removed = (revision.elements || []).filter((e) => !now.has(e.id) && e.text.trim());
    return { changed, added, removed };
  }

  // ---------- Scene fingerprints (to notice script changes in linked shot sheets) ----------
  function hashText(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
  // Empty lines don't count, so adding or removing a blank line isn't a "change".
  function sceneHash(scene) {
    const lines = scene.elements.map((e) => [e.type, displayText(e).trim()]).filter(([, t]) => t);
    return hashText(scene.heading.trim() + '\n' + lines.map(([type, t]) => type + ':' + t).join('\n'));
  }
  // One entry per scene: the heading line's id and a fingerprint of the scene's content.
  function sceneLinks(doc) {
    return scenes(doc).map((s) => ({ id: doc.elements[s.index].id, hash: sceneHash(s) }));
  }

  root.Screenplay = {
    TYPES, LABELS, NEXT_ON_ENTER, NEXT_ON_TAB, PREV_ON_TAB, UPPERCASE, TRANSITIONS, TIMES, REVISION_COLORS,
    autoType, displayText, wrapParens, cleanCharacter, newDoc, normalizeDoc, upgradeDoc,
    fromImport, toParseInput, paginate, scenes, characters, stats, suggestions, toFountain, toFdx, toCallsheet,
    wrapLines, splitSpeech, speakerOf, nextRevisionColor, revisionHex, makeRevision, revisionChanges,
    sceneHash, sceneLinks,
  };
})(typeof window !== 'undefined' ? window : globalThis);
