// Screenplay import: turns a script (PDF lines, Final Draft .fdx, or Fountain /
// plain text) into scenes, then into a shot sheet project with starter shots.
// Loaded as a <script> in the app and with require() in tests.
(function (root) {
  const HEADING = /^(?:\d+[A-Z]{0,2}\.?\s+)?(?:INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT|I\/E|INT|EXT|EST|INTERIOR|EXTERIOR)(?:\.|\s|$)/i;
  const INT_EXT = /^(INT\.?\s*\/\s*EXT\.?|EXT\.?\s*\/\s*INT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.?|INTERIOR|EXTERIOR)\s*(.*)$/i;
  const TRANSITION = /^(?:[A-Z][A-Z .']*TO:|FADE (?:IN|OUT|TO BLACK)[.:]?|CUT TO BLACK\.?|THE END\.?)$/;
  const PAGE_NUMBER = /^\d+\.?$/;
  const CONTINUED = /^\(?(?:MORE|CONTINUED|CONT'D|CONT’D)\)?(?::\s*(?:\(\d+\))?)?$/i;
  const EXTENSION = /\s*\((?:V\.?\s*O\.?|O\.?\s*S\.?|O\.?\s*C\.?|CONT['’]?D|CONT|INTO PHONE|ON PHONE|PRE-LAP|FILTERED)[^)]*\)/gi;

  const hasLetters = (s) => /[A-Za-z]/.test(s);
  const isCaps = (s) => hasLetters(s) && s === s.toUpperCase();
  const collapse = (s) => String(s).replace(/\s+/g, ' ').trim();

  function cleanCharacter(text) {
    return collapse(text.replace(/^@/, '').replace(EXTENSION, '').replace(/\(.*?\)/g, '').replace(/\^$/, ''));
  }

  function titleCase(name) {
    return name.toLowerCase().replace(/(^|[\s.-])([a-z])/g, (m, p, c) => p + c.toUpperCase());
  }

  // ---------- Elements from each source format ----------
  // Element: { type: heading|action|character|dialogue|parenthetical|transition, text, page?, y?, number? }

  function fromPdfLines(lines) {
    const kept = lines.filter((l) => l.text && !PAGE_NUMBER.test(l.text) && !CONTINUED.test(l.text));
    if (!kept.length) throw new Error('This PDF has no selectable text. It may be a scan. Export the script from your screenwriting app again, or use a Final Draft (.fdx) or Fountain file.');

    // The action margin is the leftmost indent that's used a lot.
    const counts = new Map();
    for (const l of kept) {
      const k = Math.round(l.x * 10) / 10;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const threshold = Math.max(3, kept.length * 0.04);
    const common = [...counts].filter(([, n]) => n >= threshold).map(([k]) => k);
    const base = common.length ? Math.min(...common) : Math.min(...kept.map((l) => l.x));

    const out = [];
    let inDialogue = false;
    let prev = null;
    for (const l of kept) {
      const rel = l.x - base;
      const t = l.text;
      let el;
      if (rel < 0.6 && HEADING.test(t)) {
        el = { type: 'heading', text: t };
        inDialogue = false;
      } else if (isCaps(t) && (TRANSITION.test(t) || (rel >= 3.3 && /:$/.test(t)))) {
        el = { type: 'transition', text: t };
        inDialogue = false;
      } else if (rel >= 1.75 && rel < 3.3 && !t.startsWith('(') && t.length <= 50 && isCaps(cleanCharacter(t))) {
        el = { type: 'character', text: t };
        inDialogue = true;
      } else if (inDialogue && rel >= 0.6 && rel < 2.4) {
        el = { type: t.startsWith('(') ? 'parenthetical' : 'dialogue', text: t };
      } else {
        el = { type: 'action', text: t };
        inDialogue = false;
      }
      el.page = l.page;
      el.y = l.y;
      // Join wrapped lines of the same paragraph / speech.
      const sameBlock = prev && prev.type === el.type && (el.type === 'dialogue' || el.type === 'action') &&
        prev.endPage === l.page && l.y - prev.endY < 0.24;
      if (sameBlock) {
        prev.text += ' ' + t;
        prev.endY = l.y;
      } else {
        el.endPage = l.page;
        el.endY = l.y;
        out.push(el);
        prev = el;
      }
    }
    // Title: the first line on page 1 before the script starts.
    const firstHeading = out.findIndex((e) => e.type === 'heading');
    const titleLine = kept.find((l) => l.page === 1 && !HEADING.test(l.text) && !TRANSITION.test(l.text) &&
      !/^(written by|by|screenplay by|story by|draft|revised|copyright|©)/i.test(l.text) && hasLetters(l.text));
    const title = firstHeading !== 0 && titleLine && titleLine.text.length <= 60 && (out[firstHeading] || {}).page !== 1 ? titleLine.text : null;
    return { elements: out, title, positioned: true };
  }

  function decodeXml(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
      const map = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return map[e.toLowerCase()];
    });
  }

  function fromFdx(xml) {
    if (!/<FinalDraft/i.test(xml)) throw new Error("This doesn't look like a Final Draft (.fdx) file.");
    const paraText = (inner) => collapse(decodeXml([...inner.matchAll(/<Text\b[^>]*>([\s\S]*?)<\/Text>/g)].map((m) => m[1]).join('')));
    const titleMatch = xml.match(/<TitlePage>([\s\S]*?)<\/TitlePage>/i);
    let title = null;
    if (titleMatch) {
      const first = [...titleMatch[1].matchAll(/<Paragraph\b[^>]*>([\s\S]*?)<\/Paragraph>/g)].map((m) => paraText(m[1])).find(Boolean);
      if (first && first.length <= 60) title = first;
    }
    const body = xml.replace(/<TitlePage>[\s\S]*?<\/TitlePage>/i, '');
    const TYPE = {
      'scene heading': 'heading', character: 'character', dialogue: 'dialogue', parenthetical: 'parenthetical',
      transition: 'transition', action: 'action', general: 'action', shot: 'action',
    };
    const elements = [];
    for (const m of body.matchAll(/<Paragraph\b([^>]*)>([\s\S]*?)<\/Paragraph>/g)) {
      const attrs = m[1];
      const typeAttr = (attrs.match(/\bType="([^"]*)"/) || [])[1] || 'Action';
      const text = paraText(m[2]);
      if (!text) continue;
      const el = { type: TYPE[typeAttr.toLowerCase()] || 'action', text };
      const num = (attrs.match(/\bNumber="([^"]*)"/) || [])[1];
      if (num) el.number = num;
      elements.push(el);
    }
    return { elements, title, positioned: false };
  }

  // Fountain (https://fountain.io) and plain-text scripts.
  function fromText(text) {
    let src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\[\[[\s\S]*?\]\]/g, '');
    let title = null;
    // Fountain title page: "Key: value" lines at the top, ended by a blank line.
    const tp = src.match(/^((?:[A-Za-z ]+:.*\n(?:[ \t]+.*\n)*)+)\n/);
    if (tp && /^(title|credit|author|authors|source|draft date|contact)\s*:/im.test(tp[1])) {
      const t = tp[1].match(/^title\s*:\s*(.*)\n?((?:[ \t]+.*\n?)*)/im);
      if (t) title = collapse((t[1] + ' ' + t[2]).replace(/[_*]/g, '')) || null;
      src = src.slice(tp[0].length);
    }
    const lines = src.split('\n');
    const elements = [];
    let prevBlank = true;
    let inDialogue = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) { prevBlank = true; inDialogue = false; continue; }
      const nextHasText = i + 1 < lines.length && lines[i + 1].trim() !== '';
      let el = null;
      if (PAGE_NUMBER.test(line) || CONTINUED.test(line) || /^[#=]/.test(line) || line === '===') {
        el = null; // page numbers, Fountain sections/synopses, page breaks
      } else if ((line.startsWith('.') && !line.startsWith('..')) || (prevBlank && HEADING.test(line))) {
        el = { type: 'heading', text: line.replace(/^\./, '') };
        inDialogue = false;
      } else if ((line.startsWith('>') && !line.endsWith('<')) || (prevBlank && isCaps(line) && TRANSITION.test(line))) {
        el = { type: 'transition', text: line.replace(/^>\s*/, '') };
        inDialogue = false;
      } else if (inDialogue) {
        el = { type: line.startsWith('(') ? 'parenthetical' : 'dialogue', text: line };
      } else if (line.startsWith('@') || (prevBlank && nextHasText && !line.startsWith('!') && line.length <= 50 && isCaps(cleanCharacter(line)))) {
        el = { type: 'character', text: line };
        inDialogue = true;
      } else {
        el = { type: 'action', text: line.replace(/^!/, '') };
        const last = elements[elements.length - 1];
        if (!prevBlank && last && last.type === 'action') { last.text += ' ' + el.text; el = null; }
      }
      if (el) {
        const last = elements[elements.length - 1];
        if (el.type === 'dialogue' && last && last.type === 'dialogue') last.text += ' ' + el.text;
        else elements.push(el);
      }
      prevBlank = false;
    }
    return { elements, title, positioned: false };
  }

  // ---------- Scenes ----------
  function parseHeading(text, explicitNumber) {
    let h = collapse(text);
    let number = explicitNumber || null;
    let m;
    if ((m = h.match(/\s*#([\w.-]+)#\s*$/))) { number = number || m[1]; h = h.slice(0, m.index); }
    if ((m = h.match(/^(\d+[A-Z]{0,2})\.?\s+/))) { number = number || m[1]; h = h.slice(m[0].length); }
    if ((m = h.match(/\s+(\d+[A-Z]{0,2})\.?$/))) { number = number || m[1]; h = h.slice(0, m.index); }
    h = h.toUpperCase();
    let intExt = '';
    let location = h;
    let time = '';
    if ((m = h.match(INT_EXT))) {
      intExt = m[1].replace(/\s+/g, '').replace(/\.$/, '').replace('INTERIOR', 'INT').replace('EXTERIOR', 'EXT');
      const parts = m[2].split(/\s+[-–—]+\s+/);
      if (parts.length > 1) { time = parts.pop(); location = parts.join(' - '); } else location = m[2];
    }
    return { heading: h, number, intExt, location: location.replace(/^[.\s]+/, '').trim(), time: time.trim() };
  }

  const BODY = 9.0;   // inches of text on a script page (11" minus 1" margins)
  const LINE = 1 / 6; // 12pt Courier line
  const GAP = 1 / 6;  // blank line before the next element
  const WRAP = { action: 60, dialogue: 35, parenthetical: 25 };

  function estimateLines(el) {
    if (el.type === 'heading' || el.type === 'transition') return 2;
    if (el.type === 'character') return 1;
    return Math.ceil(el.text.length / (WRAP[el.type] || 60)) + (el.type === 'action' ? 1 : 0);
  }

  function synopsisOf(actions) {
    const text = collapse(actions.join(' '));
    if (text.length <= 140) return text;
    const cut = text.slice(0, 140);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    return end > 60 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…';
  }

  // input: { kind: 'pdf', lines } | { kind: 'fdx', xml } | { kind: 'text', text }, plus optional name
  function parseScript(input) {
    const parsed = input.kind === 'pdf' ? fromPdfLines(input.lines)
      : input.kind === 'fdx' ? fromFdx(input.xml)
        : fromText(input.text);
    const { elements, positioned } = parsed;

    const scenes = [];
    const speakingCount = new Map();
    let cur = null;
    for (const el of elements) {
      if (el.type === 'heading') {
        cur = { ...parseHeading(el.text, el.number), speakers: [], actions: [], lines: 2, extent: new Map() };
        scenes.push(cur);
      }
      if (!cur) continue; // title page, "FADE IN:" etc.
      if (positioned) {
        // Track how much of each page the scene's lines cover.
        for (const [page, y] of [[el.page, el.y], [el.endPage, el.endY]]) {
          const e = cur.extent.get(page) || { min: y, max: y };
          cur.extent.set(page, { min: Math.min(e.min, y), max: Math.max(e.max, y) });
        }
      }
      if (el.type === 'heading') continue;
      cur.lines += estimateLines(el);
      if (el.type === 'character') {
        const name = cleanCharacter(el.text);
        if (name && !cur.speakers.includes(name)) cur.speakers.push(name);
        if (name) speakingCount.set(name, (speakingCount.get(name) || 0) + 1);
      } else if (el.type === 'action') {
        cur.actions.push(el.text);
      }
    }
    if (!scenes.length) {
      throw new Error('No scene headings were found. Scene headings are lines that start with INT. or EXT.');
    }

    const known = [...speakingCount.keys()].filter((n) => n.length >= 3);
    scenes.forEach((s, i) => {
      // Page length in eighths: measured from the layout for PDFs, estimated otherwise.
      // Each line is ~1/6"; the gap before the next scene's heading counts toward this one.
      if (positioned) {
        let inches = 0;
        for (const { min, max } of s.extent.values()) inches += max - min + LINE + GAP;
        s.eighths = Math.max(1, Math.round((inches / BODY) * 8));
      } else {
        s.eighths = Math.max(1, Math.round((s.lines / 54) * 8));
      }
      // Cast: everyone who speaks, plus known characters named in the action.
      const action = ' ' + s.actions.join(' ').toUpperCase() + ' ';
      const mentioned = known.filter((n) => !s.speakers.includes(n) &&
        new RegExp(`[^A-Z]${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:'S)?[^A-Z]`).test(action));
      s.cast = [...s.speakers, ...mentioned].map(titleCase);
      s.speakers = s.speakers.map(titleCase);
      s.synopsis = synopsisOf(s.actions);
      if (!s.number) s.number = String(i + 1);
      delete s.extent; delete s.lines; delete s.actions;
    });

    const name = input.name ? input.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() : '';
    const characters = [...speakingCount.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => titleCase(n));
    const totalEighths = scenes.reduce((n, s) => n + s.eighths, 0);
    return { title: parsed.title ? titleCase(parsed.title) : name || 'Imported Script', scenes, characters, totalEighths };
  }

  // ---------- Shot sheet ----------
  const LENS = { EST: '24mm', WS: '24mm', MS: '35mm', '2S': '35mm', OTS: '50mm', MCU: '50mm', CU: '85mm' };

  function starterShots(scene, prevPlace, o) {
    const audio = scene.speakers.length ? 'Sync' : 'MOS';
    const S = (type, desc, extra = {}) => ({ type, desc, angle: 'Eye Level', move: 'Static', lens: LENS[type], cam: 'A', fps: '24', audio, notes: '', ...extra });
    const shots = [];
    const where = titleCase(scene.location || scene.heading);
    const place = (scene.location || '').split(/\s+-\s+|\//)[0].trim();
    if (o.establishing && place && place !== prevPlace) {
      shots.push(S('EST', `Establishing — ${where}${scene.time ? ', ' + scene.time.toLowerCase() : ''}`, { audio: 'MOS' }));
    }
    if (o.master) shots.push(S('WS', 'Master — whole scene'));
    if (o.coverage) {
      const sp = scene.speakers.slice(0, 6);
      if (sp.length === 0) {
        // Action-only scene: cover the first beat of the action.
        const beat = (scene.synopsis.match(/^.*?[.!?](?=\s|$)/) || [scene.synopsis])[0];
        if (beat) shots.push(S('MS', `Action — ${beat.length > 70 ? beat.slice(0, 70).replace(/\s+\S*$/, '') + '…' : beat}`));
      } else if (sp.length === 1) {
        shots.push(S('MCU', `*${sp[0]}* — single`));
      } else if (sp.length === 2) {
        const [a, b] = sp;
        shots.push(S('2S', `*${a}* and *${b}*`));
        shots.push(S('OTS', `Over *${b}* onto *${a}*`));
        shots.push(S('OTS', `Over *${a}* onto *${b}*`, { cam: 'B' }));
      } else {
        shots.push(S('MS', `Group — ${sp.map((n) => `*${n}*`).join(', ')}`));
        sp.forEach((n) => shots.push(S('MCU', `*${n}* — single`)));
      }
    }
    return { shots, place };
  }

  // opts: { title, include: Set<index> | null, establishing, master, coverage }
  function buildProject(parsed, opts) {
    let prevPlace = null;
    const scenes = [];
    parsed.scenes.forEach((s, i) => {
      if (opts.include && !opts.include.has(i)) return;
      const { shots, place } = starterShots(s, prevPlace, opts);
      prevPlace = place || prevPlace;
      scenes.push({
        number: s.number,
        heading: s.heading,
        synopsis: s.synopsis,
        cast: s.cast,
        eighths: s.eighths,
        shots,
      });
    });
    return { title: opts.title || parsed.title, days: [], scenes };
  }

  // 11 → "1 3/8"
  function formatEighths(n) {
    if (!n) return '';
    const whole = Math.floor(n / 8);
    const rest = n % 8;
    return [whole || null, rest ? `${rest}/8` : null].filter(Boolean).join(' ');
  }

  root.ScriptParse = { parseScript, buildProject, formatEighths, parseHeading, fromText, fromFdx, fromPdfLines };
})(typeof window !== 'undefined' ? window : globalThis);
