// The emails the app sends from the person's Gmail (mail.js): a call sheet, and a request for
// availability. Each is { subject, html, text }. HTML email is old-fashioned on purpose:
// tables and inline styles, which every email app shows the same way.
(function (root) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const br = (s) => esc(s).replace(/\r?\n/g, '<br>');

  // The first email address in a contact field ("555-0100 · ana@example.com").
  function emailIn(contact) {
    const m = String(contact || '').match(/[^\s@<>(),;:"']+@[^\s@<>(),;:"']+\.[A-Za-z]{2,}/);
    return m ? m[0] : '';
  }

  const FONT = "Helvetica, Arial, sans-serif";
  const DISPLAY = "'Bebas Neue', Impact, 'Arial Narrow', Arial, sans-serif";

  function frame({ production, kicker, sub, body, footer }) {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#ebe8e3;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ebe8e3;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:${FONT};color:#1c1915;">
<tr><td style="background:#16130f;padding:22px 28px 24px;">
<div style="font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#a39d95;"><span style="color:#e2332b;">&#9679;</span>&nbsp; Production Tools · ${esc(kicker)}</div>
<div style="font-family:${DISPLAY};font-size:46px;line-height:1.05;letter-spacing:1px;color:#ece9e4;padding-top:8px;">${esc(String(production || '').toUpperCase())}</div>
${sub ? `<div style="font-size:15px;color:#c9c3ba;padding-top:6px;">${esc(sub)}</div>` : ''}
</td></tr>
<tr><td style="padding:26px 28px 8px;font-size:15px;line-height:1.5;">${body}</td></tr>
<tr><td style="border-top:1px solid #e3ded6;padding:16px 28px 22px;font-size:12px;line-height:1.5;color:#6b655d;">${footer}</td></tr>
</table></td></tr></table></body></html>`;
  }
  const button = (href, label) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 6px;"><tr><td align="center" style="background:#e6cf2e;border-radius:10px;">
<a href="${esc(href)}" style="display:block;padding:16px 18px;font-family:${FONT};font-size:17px;font-weight:bold;color:#2a2405;text-decoration:none;">${esc(label)}</a></td></tr></table>`;
  const box = (label, value) => `<td width="33%" valign="top" style="padding:4px;"><div style="border:1px solid #e3ded6;border-radius:8px;padding:9px 11px;">
<div style="font-size:11px;font-weight:bold;letter-spacing:.8px;text-transform:uppercase;color:#6b655d;">${esc(label)}</div>
<div style="font-size:14px;font-weight:bold;padding-top:2px;">${br(value || '—')}</div></div></td>`;

  // d: { production, dayNum, of, dateLong, person: { name, role, cast }, call, location, mapsUrl,
  //      crewCall, shootingCall, wrap, weather, parking, hospital, notes,
  //      scenes: [{ code, heading, synopsis, pages }], link, appleCal, googleCal, sender }
  // Times arrive formatted ("7:00 AM").
  function callSheet(d) {
    const first = String(d.person.name || '').split(/\s+/)[0] || 'there';
    const playing = d.person.cast && d.person.role && d.person.role !== 'Cast' ? ` You’re playing <strong>${esc(d.person.role)}</strong>` : '';
    const sceneWord = `${d.scenes.length} scene${d.scenes.length === 1 ? '' : 's'}`;
    const subject = `Call sheet: ${d.production}, Day ${d.dayNum}, ${d.dateShort} · Your call ${d.call || 'TBC'}`;
    const rows = [];
    const details = [['Crew call', d.crewCall], ['Shooting call', d.shootingCall], ['Est. wrap', d.wrap], ['Weather', d.weather], ['Parking', d.parking], ['Nearest hospital', d.hospital]];
    for (let i = 0; i < details.length; i += 3) rows.push(`<tr>${details.slice(i, i + 3).map(([l, v]) => box(l, v)).join('')}</tr>`);
    const body = `<p style="margin:0 0 16px;">Hi ${esc(first)}, here’s your call sheet.${playing}${d.scenes.length ? ` in ${sceneWord}` : ''}.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf7e3;border:1px solid #e6cf2e;border-radius:10px;"><tr>
<td style="padding:16px 20px;" valign="middle"><div style="font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#6b5c08;">Your call</div>
<div style="font-family:${DISPLAY};font-size:46px;line-height:1;">${esc(d.call || 'TBC')}</div></td>
<td style="padding:16px 20px;font-size:14px;line-height:1.4;" align="right" valign="middle">${d.location ? br(d.location) : 'Location to be confirmed'}${d.mapsUrl ? `<br><a href="${esc(d.mapsUrl)}" style="color:#1d6fa5;font-weight:bold;">Open in Maps</a>` : ''}</td>
</tr></table>
${button(d.link, 'Open your call sheet and tap Got it')}
<p style="margin:0 0 16px;text-align:center;font-size:13px;color:#6b655d;">One tap tells the production you’ve got it. No app or account needed.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 -4px;">${rows.join('')}</table>
${d.scenes.length ? `<div style="font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#6b655d;padding:18px 0 6px;border-bottom:2px solid #1c1915;">Your scenes</div>
${d.scenes.map((s) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #e3ded6;"><tr>
<td width="34" valign="top" style="padding:9px 0;font-family:${DISPLAY};font-size:22px;color:#1d6fa5;">${esc(s.code)}</td>
<td style="padding:9px 0;"><div style="font-size:14px;font-weight:bold;">${esc(s.heading || 'Scene')}</div>${s.synopsis || s.pages ? `<div style="font-size:13px;color:#6b655d;">${esc([s.synopsis, s.pages].filter(Boolean).join(' · '))}</div>` : ''}</td></tr></table>`).join('')}` : ''}
${d.notes ? `<div style="background:#f5f2ed;border-radius:8px;padding:12px 14px;margin-top:16px;font-size:14px;"><strong>Notes from the production:</strong> ${br(d.notes)}</div>` : ''}
${d.appleCal || d.googleCal ? `<p style="margin:16px 0 4px;font-size:14px;">Your shoot days in your calendar: ${d.appleCal ? `<a href="${esc(d.appleCal)}" style="color:#1d6fa5;font-weight:bold;">Apple / Outlook</a>` : ''}${d.appleCal && d.googleCal ? ' &nbsp;·&nbsp; ' : ''}${d.googleCal ? `<a href="${esc(d.googleCal)}" style="color:#1d6fa5;font-weight:bold;">Google Calendar</a>` : ''}</p>` : ''}`;
    const footer = `Sent by ${esc(d.sender || 'the production')} for ${esc(d.production)}. Questions? Just reply to this email.<br>This link is personal to you. Please don’t forward it. If the call sheet changes, you’ll get a new email and your page updates.`;
    // (null: left out; '': a blank line between parts)
    const text = [
      `Hi ${first}, here’s your call sheet for ${d.production}: Day ${d.dayNum} of ${d.of}, ${d.dateLong}.`,
      '', `YOUR CALL: ${d.call || 'TBC'}`, d.location ? `Location: ${d.location.replace(/\n/g, ', ')}` : null,
      '', `Open your call sheet and tap Got it: ${d.link}`, '',
      ...details.filter(([, v]) => v).map(([l, v]) => `${l}: ${String(v).replace(/\n/g, ', ')}`),
      ...(d.scenes.length ? ['', 'Your scenes:', ...d.scenes.map((s) => `  ${s.code}  ${s.heading}${s.pages ? ` (${s.pages})` : ''}`)] : []),
      ...(d.notes ? ['', `Notes: ${d.notes}`] : []),
      ...(d.googleCal ? ['', `Add your shoot days to Google Calendar: ${d.googleCal}`] : []),
      '', `Sent by ${d.sender || 'the production'}. Questions? Just reply.`, 'This link is personal to you. Please don’t forward it.',
    ].filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n');
    return { subject, html: frame({ production: d.production, kicker: 'Call sheet', sub: `Day ${d.dayNum} of ${d.of} · ${d.dateLong}`, body, footer }), text };
  }

  // d: { production, person: { name, role }, from, to (dates, formatted), link, sender }
  function availability(d) {
    const first = String(d.person.name || '').split(/\s+/)[0] || 'there';
    const subject = `${d.production}: when can’t you work? (${d.from} – ${d.to})`;
    const body = `<p style="margin:0 0 12px;">Hi ${esc(first)}, we’re planning the shoot for <strong>${esc(d.production)}</strong>${d.person.role ? ` (you: ${esc(d.person.role)})` : ''}.</p>
<p style="margin:0 0 4px;">Please tap the days between <strong>${esc(d.from)}</strong> and <strong>${esc(d.to)}</strong> you <strong>can’t</strong> work. It takes a minute, and you can change it any time.</p>
${button(d.link, 'Mark the days you can’t work')}
<p style="margin:0;text-align:center;font-size:13px;color:#6b655d;">No app or account needed.</p>`;
    const footer = `Sent by ${esc(d.sender || 'the production')} for ${esc(d.production)}. Questions? Just reply to this email.<br>This link is personal to you. Please don’t forward it.`;
    const text = `Hi ${first}, we’re planning the shoot for ${d.production}.\n\nPlease mark the days between ${d.from} and ${d.to} you can’t work (no app or account needed):\n${d.link}\n\nSent by ${d.sender || 'the production'}. Questions? Just reply.\nThis link is personal to you. Please don’t forward it.`;
    return { subject, html: frame({ production: d.production, kicker: 'Availability', sub: `${d.from} – ${d.to}`, body, footer }), text };
  }

  root.MailTemplates = { emailIn, callSheet, availability, esc };
})(typeof window !== 'undefined' ? window : globalThis);
