// Extracts text lines from a PDF with their position, for screenplay parsing.
// Each line: { text, x, y, page }  (x, y in inches from the page's top-left).
const fs = require('fs');
const path = require('path');

const SCENE_NUMBER = /^\d+[A-Z]{0,2}\.?$/;
// Character maps and standard fonts let pdf.js read text from PDFs that don't embed them.
const PDFJS_DIR = path.dirname(require.resolve('pdfjs-dist/package.json'));

async function extractPdfLines(filePath) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
    cMapUrl: path.join(PDFJS_DIR, 'cmaps') + path.sep,
    cMapPacked: true,
    standardFontDataUrl: path.join(PDFJS_DIR, 'standard_fonts') + path.sep,
  }).promise;
  const lines = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const { height } = page.getViewport({ scale: 1 });
      const { items } = await page.getTextContent();
      // Group text runs that sit on the same baseline into rows.
      const rows = [];
      for (const it of items) {
        if (!it.str || !it.str.trim()) continue;
        const x = it.transform[4];
        const y = it.transform[5];
        let row = rows.find((r) => Math.abs(r.y - y) < 2);
        if (!row) { row = { y, items: [] }; rows.push(row); }
        row.items.push({ str: it.str, x, w: it.width || 0 });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const row of rows) {
        row.items.sort((a, b) => a.x - b.x);
        let text = '';
        let end = null;
        for (const it of row.items) {
          if (end !== null && it.x - end > 1.5 && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' ';
          text += it.str;
          end = it.x + it.w;
        }
        // A scene number printed in the left margin shouldn't count as the indent.
        const first = row.items[0];
        const indentItem = row.items.length > 1 && SCENE_NUMBER.test(first.str.trim()) && row.items[1].x - (first.x + first.w) > 12
          ? row.items[1] : first;
        lines.push({ text: text.replace(/\s+/g, ' ').trim(), x: indentItem.x / 72, y: (height - row.y) / 72, page: p });
      }
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return lines;
}

module.exports = { extractPdfLines };
