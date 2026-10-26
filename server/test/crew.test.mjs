// Unit checks for personal crew pages, their calendar, and authenticator codes (no server needed).
import assert from 'node:assert/strict';
import { findPerson, crewDays, crewEvents, crewCalendar } from '../src/crew.js';
import { base32, unbase32, codeAt, checkCode, stepAt } from '../src/totp.js';
import { describeAll, mergeItems } from '../src/activity.js';

const step = (name) => console.log('  ✓ ' + name);

const doc = {
  title: 'Night Diner', type: 'film',
  characters: [{ id: 'c1', name: 'Maya', actor: 'Ana Ruiz', contact: 'ana@example.com' }, { id: 'c2', name: 'Lou', actor: '' }],
  crew: [{ id: 'k1', role: 'Gaffer', name: 'Sam', contact: '555-0100', allDays: false }, { id: 'k2', role: '1st AD', name: 'Jo', allDays: true }],
  days: [
    { id: 'd2', date: '2026-11-03', call: '08:00', crewCall: '07:00', wrap: '19:00', location: "Rosie's Diner\n12 Main St", parking: 'Lot B', hospital: 'St Mary', notes: 'Bring layers', calls: { c1: '09:30' } },
    { id: 'd1', date: '2026-11-02', call: '06:00', crewCall: '', wrap: '', location: 'Studio', calls: {} },
  ],
  scenes: [
    { id: 's1', number: '1', heading: 'INT. DINER - NIGHT', castIds: ['c1'], crewIds: ['k1'], eighths: 12, shots: [{ id: 'x1', dayId: 'd2' }] },
    { id: 's2', number: '2', heading: 'EXT. STREET - DAY', castIds: ['c2'], crewIds: [], shots: [], dayId: 'd1' },
  ],
};

const maya = findPerson(doc, 'c1');
assert.deepEqual([maya.name, maya.role, maya.cast], ['Ana Ruiz', 'Maya', true]);
assert.equal(findPerson(doc, 'nobody'), null);
let days = crewDays(doc, maya);
assert.equal(days.length, 1, 'Maya only works the day her scene is shot');
assert.deepEqual([days[0].id, days[0].number, days[0].of, days[0].call], ['d2', 2, 2, '09:30'], 'her own call time, numbered in date order');
assert.equal(days[0].sheet, undefined, 'no call sheet before it is sent');
const jo = crewDays(doc, findPerson(doc, 'k2'));
assert.deepEqual(jo.map((d) => [d.id, d.call]), [['d1', '06:00'], ['d2', '07:00']], 'every-day crew: crew call, or the shooting call');
assert.deepEqual(crewDays(doc, findPerson(doc, 'k1')).map((d) => d.id), ['d2'], 'crew picked for a scene');
step('which days each person works, and their call time');

days = crewDays(doc, maya, { sends: new Map([['d2', 1000]]), confirms: new Map([['d2', 500]]) });
assert.equal(days[0].sentAt, 1000);
assert.equal(days[0].confirmedAt, null, 'a "Got it" for an older version doesn\'t count');
assert.equal(days[0].sheet.parking, 'Lot B');
assert.deepEqual(days[0].sheet.cast.map((c) => [c.number, c.character, c.call]), [[1, 'Maya', '09:30']]);
assert.deepEqual(days[0].sheet.crew.map((k) => k.name), ['Sam', 'Jo']);
assert.ok(!JSON.stringify(days).includes('ana@example.com') && !JSON.stringify(days).includes('555-0100'), 'no contact details');
days = crewDays(doc, maya, { sends: new Map([['d2', 1000]]), confirms: new Map([['d2', 2000]]) });
assert.equal(days[0].confirmedAt, 2000);
step('the call sheet once sent, without contact details; "Got it" for the latest version');

const ics = crewCalendar(doc, maya, days, { now: Date.UTC(2026, 9, 1), pageUrl: 'https://film.example/c/ABCDEFGHJK' });
assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
assert.match(ics, /DTSTART:20261103T093000\r\n/);
assert.match(ics, /DTEND:20261103T190000\r\n/, 'ends at wrap');
assert.match(ics, /LOCATION:Rosie's Diner\r\n/);
assert.match(ics, /UID:d2\.c1@production-tools/);
assert.ok(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75), 'long lines are folded');
const lou = findPerson(doc, 'c2');
const louIcs = crewCalendar(doc, lou, crewDays(doc, lou));
assert.match(louIcs, /DTSTART:20261102T060000\r\nDTEND:20261102T180000/, 'no wrap: 12 hours');
const noCall = crewCalendar({ ...doc, days: [{ id: 'd9', date: '2026-12-31', calls: {} }], scenes: [{ id: 's', castIds: ['c2'], shots: [], dayId: 'd9' }] }, lou,
  crewDays({ ...doc, days: [{ id: 'd9', date: '2026-12-31', calls: {} }], scenes: [{ id: 's', castIds: ['c2'], shots: [], dayId: 'd9' }] }, lou));
assert.match(noCall, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/, 'no call time: an all-day event');
assert.match(crewCalendar({ title: 'A, B; C' }, maya, []), /X-WR-CALNAME:A\\, B\\; C/, 'text is escaped');
step('calendar feed: call to wrap, all-day without a call, folded and escaped');

// RFC 6238 test secret ("12345678901234567890"), last 6 digits of the published codes.
const secret = base32(new TextEncoder().encode('12345678901234567890'));
assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
assert.deepEqual([...unbase32(secret)], [...new TextEncoder().encode('12345678901234567890')]);
assert.equal(await codeAt(secret, stepAt(59_000)), '287082');
assert.equal(await codeAt(secret, stepAt(1111111109_000)), '081804');
assert.equal(await checkCode(secret, '081804', 1111111109_000), stepAt(1111111109_000));
assert.equal(await checkCode(secret, '081804', 1111111109_000 + 30_000), stepAt(1111111109_000), 'one step of clock drift');
assert.equal(await checkCode(secret, '081804', 1111111109_000 + 120_000), null, 'old codes stop working');
assert.equal(await checkCode(secret, 'abc'), null);
step('authenticator codes (RFC 6238 test values)');

// Events (table reads, meetings…) for the people invited.
const evDoc = { ...doc, events: [
  { id: 'e2', date: '2026-11-05', start: '18:00', end: '20:30', title: '', kind: 'tableread', location: 'Studio B\nUpstairs', everyone: true },
  { id: 'e1', date: '2026-11-01', start: '10:00', title: 'Wardrobe fitting', kind: 'fitting', peopleIds: ['c1'] },
  { id: 'e3', date: '2026-11-02', title: 'Rig day', kind: 'prep', peopleIds: ['k1'] },
] };
assert.deepStrictEqual(crewEvents(evDoc, maya).map((e) => [e.id, e.title, e.kind]), [['e1', 'Wardrobe fitting', 'Fitting'], ['e2', 'Table read', 'Table read']], 'invited ones only, in date order');
assert.deepStrictEqual(crewEvents(evDoc, findPerson(doc, 'k1')).map((e) => e.id), ['e3', 'e2']);
const evIcs = crewCalendar(evDoc, maya, [], { now: Date.UTC(2026, 9, 1), events: crewEvents(evDoc, maya) });
assert.match(evIcs, /UID:e2\.c1@production-tools\r\nDTSTAMP:\d+T\d+Z\r\nDTSTART:20261105T180000\r\nDTEND:20261105T203000/);
assert.match(evIcs, /SUMMARY:Night Diner: Table read\r\nLOCATION:Studio B\r\n/);
assert.match(evIcs, /DTSTART:20261101T100000\r\nDTEND:20261101T110000/, 'no end time: an hour');
step('events on crew pages and in their calendars, for the people invited');

// Recent activity labels.
const before = { title: 'Night Diner', scenes: [{ id: 's1', number: '4' }], days: [{ id: 'd1', date: '2026-11-03' }], crew: [{ id: 'k1', name: '', role: 'Gaffer' }] };
const after = { ...before, scenes: [{ id: 's1', number: '4', heading: 'X' }], crew: [] };
assert.deepEqual(describeAll('shotsheet', [
  { t: 'set', p: ['scenes', '#s1', 'heading'], v: 'X' },
  { t: 'set', p: ['scenes', '#s1', 'synopsis'], v: 'Y' },
  { t: 'del', p: ['crew'], id: 'k1' },
  { t: 'set', p: ['days', '#d1', 'call'], v: '07:00' },
  { t: 'set', p: ['claims', 'c1'], v: 'u1' },
  { t: 'ins', p: ['characters'], after: null, v: { id: 'c9', name: 'Lou' } },
], before, after), ['Scene 4', 'Crew: Gaffer', 'Shoot day 2026-11-03', 'Cast: Lou'], 'named from either side of the change, bookkeeping left out');
assert.deepEqual(describeAll('post', [{ t: 'ins', p: ['takes'], after: null, v: { id: 't1' } }], {}, {}), ['Take log']);
assert.deepEqual(describeAll('script', [{ t: 'set', p: ['elements', '#e1', 'text'], v: 'x' }], {}, {}, 'Pilot'), ['Script: Pilot']);
assert.deepEqual(mergeItems(['a', 'b'], ['b', 'c']), ['a', 'b', 'c']);
step('recent activity: what changed, in a few words');

console.log('crew: all checks passed');
