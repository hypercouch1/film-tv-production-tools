// Reading a script aloud: what's read, in which voice, in pieces the voice model can say.
// A queue item: { id (the script line), speaker (character name, or '' for the narrator),
//                 text, first (the first piece of its line) }.
// Casting: { voices: { NAME: voiceId, '': narratorVoiceId } } per production.
(function (root) {
  // The Kokoro voices that ship with the app, best first within each group.
  const VOICES = [
    { id: 'af_heart', name: 'Heart', gender: 'f', accent: 'US' },
    { id: 'af_bella', name: 'Bella', gender: 'f', accent: 'US' },
    { id: 'af_nicole', name: 'Nicole', gender: 'f', accent: 'US' },
    { id: 'bf_emma', name: 'Emma', gender: 'f', accent: 'UK' },
    { id: 'af_aoede', name: 'Aoede', gender: 'f', accent: 'US' },
    { id: 'af_kore', name: 'Kore', gender: 'f', accent: 'US' },
    { id: 'af_sarah', name: 'Sarah', gender: 'f', accent: 'US' },
    { id: 'bf_isabella', name: 'Isabella', gender: 'f', accent: 'UK' },
    { id: 'af_nova', name: 'Nova', gender: 'f', accent: 'US' },
    { id: 'af_alloy', name: 'Alloy', gender: 'f', accent: 'US' },
    { id: 'af_sky', name: 'Sky', gender: 'f', accent: 'US' },
    { id: 'bf_alice', name: 'Alice', gender: 'f', accent: 'UK' },
    { id: 'bf_lily', name: 'Lily', gender: 'f', accent: 'UK' },
    { id: 'af_jessica', name: 'Jessica', gender: 'f', accent: 'US' },
    { id: 'af_river', name: 'River', gender: 'f', accent: 'US' },
    { id: 'am_michael', name: 'Michael', gender: 'm', accent: 'US' },
    { id: 'am_fenrir', name: 'Fenrir', gender: 'm', accent: 'US' },
    { id: 'am_puck', name: 'Puck', gender: 'm', accent: 'US' },
    { id: 'bm_george', name: 'George', gender: 'm', accent: 'UK' },
    { id: 'bm_fable', name: 'Fable', gender: 'm', accent: 'UK' },
    { id: 'am_echo', name: 'Echo', gender: 'm', accent: 'US' },
    { id: 'am_eric', name: 'Eric', gender: 'm', accent: 'US' },
    { id: 'am_liam', name: 'Liam', gender: 'm', accent: 'US' },
    { id: 'am_onyx', name: 'Onyx', gender: 'm', accent: 'US' },
    { id: 'bm_lewis', name: 'Lewis', gender: 'm', accent: 'UK' },
    { id: 'bm_daniel', name: 'Daniel', gender: 'm', accent: 'UK' },
    { id: 'am_adam', name: 'Adam', gender: 'm', accent: 'US' },
    { id: 'am_santa', name: 'Santa', gender: 'm', accent: 'US' },
  ];
  const NARRATOR = 'bm_george';
  const voice = (id) => VOICES.find((v) => v.id === id) || null;

  // "MAYA (V.O.)" and "MAYA (CONT'D)" are both Maya.
  const speakerName = (text) => String(text || '').replace(/\([^)]*\)/g, '').replace(/\^\s*$/, '').trim().toUpperCase();

  // A first guess at who sounds like whom, from common first names (the person picks in Voices…).
  const FEMALE = new Set(('mary patricia jennifer linda elizabeth barbara susan jessica sarah karen nancy lisa betty margaret sandra ashley '
    + 'kimberly emily donna michelle carol amanda dorothy melissa deborah stephanie rebecca sharon laura cynthia kathleen amy angela '
    + 'shirley anna brenda pamela emma nicole helen samantha katherine christine debra rachel carolyn janet catherine maria heather '
    + 'diane ruth julie olivia joyce virginia victoria kelly lauren christina joan evelyn judith megan andrea cheryl hannah jacqueline '
    + 'martha gloria teresa ann sara madison frances kathryn janice jean abigail alice judy sophia grace denise amber doris marilyn '
    + 'danielle beverly isabella theresa diana natalie brittany charlotte marie kayla alexis lori maya ava mia zoe chloe ella lily '
    + 'nora claire jane kate rose ellie ruby sophie lucy molly jenny beth meg sue liz annie mom mother grandma aunt sister girl woman '
    + 'lady queen princess waitress nurse mrs ms miss').split(' '));
  const MALE = new Set(('james robert john michael david william richard joseph thomas charles christopher daniel matthew anthony mark '
    + 'donald steven paul andrew joshua kenneth kevin brian george timothy ronald edward jason jeffrey ryan jacob gary nicholas eric '
    + 'jonathan stephen larry justin scott brandon benjamin samuel gregory alexander frank patrick raymond jack dennis jerry tyler '
    + 'aaron jose adam nathan henry douglas zachary peter kyle noah ethan jeremy walter christian keith roger terry austin sean '
    + 'gerald carl harold dylan arthur lawrence jordan jesse bryan billy bruce gabriel joe logan albert willie alan eugene russell '
    + 'vincent philip bobby johnny bradley roy ralph randy wayne liam lucas mason oliver elijah leo max sam ben tom tim jim bob '
    + 'bill mike dave steve rick nick tony dan matt chris pete harry charlie ray ted ed frankie eddie al gus hank vic dad father '
    + 'grandpa uncle brother boy man guy king prince sheriff cop officer detective waiter mr sir').split(' '));
  function guessGender(name) {
    const words = String(name || '').toLowerCase().replace(/[^a-z\s.]/g, ' ').split(/[\s.]+/).filter(Boolean);
    for (const w of words) {
      if (FEMALE.has(w)) return 'f';
      if (MALE.has(w)) return 'm';
    }
    return null;
  }

  // Everyone in the cast gets a voice: kept if already chosen, otherwise the best one not yet
  // used that suits their name (alternating when there's no telling). The narrator is ''.
  function castVoices(names, current = {}) {
    const voices = { ...current };
    if (!voice(voices[''])) voices[''] = NARRATOR;
    const used = new Set(Object.values(voices));
    const pick = (gender) => {
      const pool = VOICES.filter((v) => !gender || v.gender === gender);
      return (pool.find((v) => !used.has(v.id)) || pool[used.size % pool.length]).id;
    };
    let alternate = 0;
    for (const name of names) {
      if (voice(voices[name])) continue;
      const gender = guessGender(name) || (alternate++ % 2 ? 'm' : 'f');
      voices[name] = pick(gender);
      used.add(voices[name]);
    }
    return voices;
  }

  // ---- Making script text sayable ----
  const titleCase = (w) => w.charAt(0) + w.slice(1).toLowerCase();
  // Shouted or introduced words (MAYA, DINER) read as words, not letters; short ones (OK, FBI) stay.
  const unshout = (s) => s.replace(/\b[A-Z][A-Z']{3,}\b/g, titleCase);
  function sayable(text) {
    return unshout(String(text || ''))
      .replace(/\[\[[\s\S]*?\]\]/g, ' ')            // Fountain notes
      .replace(/[*_]+/g, '')                          // emphasis marks
      .replace(/\s*(--|—|–)\s*/g, ', ')               // dashes: a pause
      .replace(/\.{3,}|…/g, '… ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const PLACES = { 'INT.': 'Interior.', 'EXT.': 'Exterior.', 'INT./EXT.': 'Interior, exterior.', 'EXT./INT.': 'Exterior, interior.', 'I/E.': 'Interior, exterior.', 'I/E': 'Interior, exterior.', 'EST.': 'Establishing.' };
  // "INT. DINER - NIGHT" → "Interior. Diner. Night."
  function sayHeading(text) {
    let t = String(text || '').trim().replace(/^\./, '').replace(/\s*#[^#]*#\s*$/, '');
    const m = t.match(/^(INT\.\/EXT\.|EXT\.\/INT\.|I\/E\.?|INT\.|EXT\.|EST\.)\s*/i);
    let lead = '';
    if (m) { lead = PLACES[m[1].toUpperCase()] || ''; t = t.slice(m[0].length); }
    const parts = t.split(/\s+[-–—]+\s+/).map((p) => p.toLowerCase().replace(/(^|\s)([a-z])/g, (_, s, c) => s + c.toUpperCase()).trim()).filter(Boolean);
    return [lead, ...parts.map((p) => p + '.')].filter(Boolean).join(' ');
  }
  const sayTransition = (text) => {
    const t = String(text || '').replace(/^>\s*/, '').replace(/:\s*$/, '').trim().toLowerCase();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) + '.' : '';
  };

  // Pieces short enough for the voice model (it stops after about 500 sounds): whole sentences,
  // put together up to max characters; a sentence too long on its own splits at commas, then words.
  function pieces(text, max = 220) {
    const sentences = String(text || '').match(/[^.!?…]+(?:[.!?…]+["')\]]*|$)\s*/g) || [];
    const out = [];
    let cur = '';
    const push = (s) => {
      if (!s.trim()) return;
      if (cur && (cur + s).length > max) { out.push(cur.trim()); cur = ''; }
      cur += s;
    };
    for (const s of sentences) {
      if (s.length <= max) { push(s); continue; }
      for (const part of s.split(/(?<=[,;:])\s+/)) {
        if (part.length <= max) { push(part + ' '); continue; }
        const words = part.split(/\s+/);
        for (let i = 0; i < words.length; i += 30) push(words.slice(i, i + 30).join(' ') + ' ');
      }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  // The reading queue for a script's elements, starting at the line with id `from` (or the top).
  // narrate: also read headings, action and transitions in the narrator's voice.
  // sceneOnly: stop at the next scene heading.
  function readingQueue(elements, { from = null, narrate = true, sceneOnly = false } = {}) {
    const list = elements || [];
    let start = from ? list.findIndex((e) => e.id === from) : 0;
    if (start < 0) start = 0;
    // Starting inside a speech: go back to its character cue so the right voice reads it.
    while (start > 0 && (list[start].type === 'dialogue' || list[start].type === 'parenthetical')) start--;
    const out = [];
    let who = null;
    for (let i = start; i < list.length; i++) {
      const e = list[i];
      if (sceneOnly && e.type === 'heading' && i > start) break;
      let text = '';
      let speaker = '';
      if (e.type === 'character') { who = speakerName(e.text) || null; continue; }
      if (e.type === 'parenthetical') continue;
      if (e.type === 'dialogue') {
        if (!who) continue;
        speaker = who;
        text = sayable(String(e.text || '').replace(/\([^)]*\)/g, ' '));
      } else {
        who = null;
        if (!narrate) continue;
        if (e.type === 'heading') text = sayHeading(e.text);
        else if (e.type === 'transition') text = sayTransition(e.text);
        else text = sayable(e.text);
      }
      pieces(text).forEach((p, n) => out.push({ id: e.id, speaker, text: p, first: n === 0 }));
    }
    return out;
  }

  // About how long someone takes to say a line (rehearsal: the gap left for the actor).
  const speakingSeconds = (text) => Math.max(2, Math.round((String(text || '').split(/\s+/).filter(Boolean).length / 2.6 + 1.5) * 10) / 10);

  root.ReadAloudCore = { VOICES, NARRATOR, voice, speakerName, guessGender, castVoices, sayable, sayHeading, sayTransition, pieces, readingQueue, speakingSeconds };
})(typeof window !== 'undefined' ? window : globalThis);
