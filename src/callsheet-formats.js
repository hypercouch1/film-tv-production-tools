// Import/export converters. Every importer returns an array of call sheets:
// { id, title, updatedAt, sections: [{ id, title, items: [{ id, text, done }] }] }
(function () {
  const { uid, parseCSV, csvField } = window.Common;

  function normalizeSheet(raw, fallbackTitle) {
    const sections = Array.isArray(raw && raw.sections) ? raw.sections : [];
    return {
      id: uid(),
      title: String((raw && raw.title) || fallbackTitle || 'Untitled Show'),
      updatedAt: Date.now(),
      sections: sections.map((s) => ({
        id: uid(),
        title: String((s && s.title) || 'Section'),
        items: (Array.isArray(s && s.items) ? s.items : []).map((it) =>
          typeof it === 'string'
            ? { id: uid(), text: it, done: false }
            : { id: uid(), text: String((it && it.text) || ''), done: !!(it && it.done) }
        ),
      })),
    };
  }

  function baseName(fileName) {
    return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  }

  // ---- JSON / .callsheet ----
  function fromJSON(content, fileName) {
    const data = JSON.parse(content);
    if (Array.isArray(data)) return data.map((s) => normalizeSheet(s, baseName(fileName)));
    if (data && Array.isArray(data.sheets)) return data.sheets.map((s) => normalizeSheet(s, baseName(fileName)));
    if (data && Array.isArray(data.sections)) return [normalizeSheet(data, baseName(fileName))];
    throw new Error('JSON file does not look like a call sheet.');
  }

  function toCallsheet(sheet) {
    return JSON.stringify({
      format: 'callsheet',
      version: 1,
      title: sheet.title,
      sections: sheet.sections.map((s) => ({
        title: s.title,
        items: s.items.map((i) => ({ text: i.text, done: i.done })),
      })),
    }, null, 2);
  }

  function toBackup(sheets) {
    return JSON.stringify({
      format: 'callsheet-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      sheets: sheets.map((s) => JSON.parse(toCallsheet(s))),
    }, null, 2);
  }

  // ---- CSV: section,item[,done] ----
  function fromCSV(content, fileName) {
    const rows = parseCSV(content.replace(/^﻿/, ''));
    if (!rows.length) throw new Error('CSV file is empty.');
    let title = baseName(fileName);
    let start = 0;
    const head = rows[0].map((h) => h.trim().toLowerCase());
    if (head[0] === 'section' || head[1] === 'item' || head[1] === 'cue' || head[1] === 'task') start = 1;
    const sheet = { title, sections: [] };
    let current = null;
    for (const r of rows.slice(start)) {
      const sec = (r[0] || '').trim();
      const text = (r[1] || '').trim();
      const done = /^(1|true|yes|x|done|✓)$/i.test((r[2] || '').trim());
      if (sec.toLowerCase() === '#title') { sheet.title = text || title; continue; }
      if (sec && (!current || current.title !== sec)) {
        current = sheet.sections.find((s) => s.title === sec);
        if (!current) { current = { title: sec, items: [] }; sheet.sections.push(current); }
      }
      if (!current) { current = { title: 'Section', items: [] }; sheet.sections.push(current); }
      if (text) current.items.push({ text, done });
    }
    return [normalizeSheet(sheet, title)];
  }

  function toCSV(sheet) {
    const lines = ['section,item,done', ['#title', sheet.title, ''].map(csvField).join(',')];
    for (const s of sheet.sections) {
      if (!s.items.length) lines.push([s.title, '', ''].map(csvField).join(','));
      for (const i of s.items) lines.push([s.title, i.text, i.done ? 'x' : ''].map(csvField).join(','));
    }
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  // ---- Markdown / plain text ----
  // "# Title" + "## Section" + "- [ ] item", or "# Section" headings only,
  // or plain text where ALL-CAPS / "Heading:" lines start sections.
  function fromText(content, fileName) {
    const lines = content.replace(/^﻿/, '').split(/\r?\n/);
    const hasH2 = lines.some((l) => /^##\s+/.test(l));
    const sheet = { title: baseName(fileName), sections: [] };
    let current = null;
    const startSection = (t) => { current = { title: t.trim(), items: [] }; sheet.sections.push(current); };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      let m;
      if (hasH2 && (m = line.match(/^#\s+(.*)$/))) { sheet.title = m[1].trim(); continue; }
      if ((m = line.match(/^#{1,6}\s+(.*)$/))) { startSection(m[1]); continue; }
      if ((m = line.match(/^(?:[-*+]|\d+[.)])\s*\[( |x|X)\]\s*(.*)$/))) {
        if (!current) startSection('Section');
        current.items.push({ text: m[2].trim(), done: m[1].toLowerCase() === 'x' });
        continue;
      }
      if ((m = line.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/))) {
        if (!current) startSection('Section');
        current.items.push({ text: m[1].trim(), done: false });
        continue;
      }
      const isCapsHeading = line.length <= 40 && /[A-Z]/.test(line) && line === line.toUpperCase();
      const isColonHeading = /^[^:]{1,40}:$/.test(line);
      if (isCapsHeading || isColonHeading) { startSection(line.replace(/:$/, '')); continue; }
      if (!current) startSection('Section');
      current.items.push({ text: line, done: false });
    }
    if (!sheet.sections.length) throw new Error('No sections or items found in file.');
    return [normalizeSheet(sheet, sheet.title)];
  }

  function toMarkdown(sheet) {
    const out = ['# ' + sheet.title, ''];
    for (const s of sheet.sections) {
      out.push('## ' + s.title, '');
      for (const i of s.items) out.push(`- [${i.done ? 'x' : ' '}] ${i.text}`);
      out.push('');
    }
    return out.join('\n');
  }

  function importFile({ name, ext, content }) {
    switch (ext) {
      case 'json':
      case 'callsheet':
        return fromJSON(content, name);
      case 'csv':
        return fromCSV(content, name);
      default: {
        const trimmed = content.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          try { return fromJSON(content, name); } catch { /* fall through to text */ }
        }
        return fromText(content, name);
      }
    }
  }

  window.Formats = { uid, normalizeSheet, importFile, toCallsheet, toBackup, toCSV, toMarkdown };
})();
