// Regenerates tests/fixtures/night-diner.pdf: a screenplay laid out with
// standard US formatting (Courier 12pt, 1.5" left margin, scene numbers in
// both margins, title page, page numbers).
// Run: npx electron tests/fixtures/make-pdf.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const P = (cls, text, num) => `<p class="${cls}">${num ? `<span class="numL">${num}</span>` : ''}${text}${num ? `<span class="numR">${num}</span>` : ''}</p>`;
const body = [
  P('trans-left', 'FADE IN:'),
  P('heading', "EXT. ROSIE'S DINER - NIGHT", '1'),
  P('action', 'Rain hammers the neon sign. MAYA (30s), soaked, crosses the empty lot toward the door. The bell over the door is broken and the windows are fogged from the inside.'),
  P('heading', "INT. ROSIE'S DINER - NIGHT", '2'),
  P('action', "LOU (60s) wipes the counter. He doesn't look up."),
  P('character', 'MAYA'),
  P('dialogue', 'You still make it too strong. Twenty years and you never once made it right.'),
  P('character', 'LOU'),
  P('paren', '(not looking up)'),
  P('dialogue', 'You still drink it.'),
  P('action', 'Maya sits. Lou slides a mug across the counter.'),
  '<div class="pagebreak"></div>',
  P('heading', "INT. ROSIE'S DINER - BOOTH - LATER", '3'),
  P('action', 'Maya, Lou and DET. REYES crowd the booth. Nobody touches their coffee.'),
  P('character', 'REYES'),
  P('dialogue', 'Somebody start talking.'),
  P('character', 'MAYA'),
  P('dialogue', 'He knows what happened that night.'),
  P('character', "LOU (CONT'D)"),
  P('dialogue', 'I know what I saw.'),
  P('heading', 'EXT. PARKING LOT - CONTINUOUS', '4'),
  P('action', 'Maya runs to her car. Headlights sweep across her face.'),
  P('trans', 'FADE OUT.'),
].join('\n');

const html = `<!doctype html><html><head><style>
  @page { size: 8.5in 11in; margin: 0; }
  body { margin: 0; font: 12pt/12pt "Courier New", Courier, monospace; }
  .page { position: relative; width: 8.5in; height: 11in; box-sizing: border-box; padding: 1in 1in 1in 1.5in; page-break-after: always; overflow: hidden; }
  .pnum { position: absolute; top: 0.5in; right: 1in; }
  p { margin: 0 0 12pt; position: relative; }
  .heading { text-transform: uppercase; }
  .numL { position: absolute; left: -0.75in; }
  .numR { position: absolute; right: -0.5in; }
  .character { margin: 0 0 0 2.2in; }
  .paren { margin: 0 0 0 1.6in; width: 2in; }
  .dialogue { margin-left: 1in; width: 3.5in; }
  .trans { text-align: right; }
  .title { text-align: center; margin-top: 3.5in; }
</style></head><body>
  <div class="page"><p class="title">NIGHT DINER</p><p class="title" style="margin-top:0.3in">Written by</p><p class="title" style="margin-top:0">Test Fixture</p></div>
  ${body.split('<div class="pagebreak"></div>').map((chunk, i) => `<div class="page">${i ? `<span class="pnum">${i + 1}.</span>` : ''}${chunk}</div>`).join('')}
</body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const pdf = await win.webContents.printToPDF({ pageSize: 'Letter', margins: { marginType: 'none' }, preferCSSPageSize: true });
  fs.writeFileSync(path.join(__dirname, 'night-diner.pdf'), pdf);
  console.log('wrote night-diner.pdf', pdf.length, 'bytes');
  app.quit();
});
