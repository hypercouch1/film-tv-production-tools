// Productions: everything for one film or TV show, linked together.
// - A production is stored in the 'shotsheets' store (it grew out of the shot sheet project,
//   which already held the scenes, cast, crew and shoot days). New fields: type ('film' |
//   'tv') and episodes ([{ id, number, title, scriptLink }]); TV scenes carry an episodeId.
// - Scripts (store 'scripts') and call sheets (store 'callsheets') belong to a production by
//   productionId; TV scripts also have an episodeId.
// - Every page works on the current production, passed as ?production=<id> and remembered
//   for the session, so Home and the menus stay inside it.
(function () {
  const { api, uid } = window.Common;

  const KEY = 'production.current';
  function id() {
    const q = new URLSearchParams(location.search).get('production');
    if (q) { remember(q); return q; }
    try { return sessionStorage.getItem(KEY); } catch { return null; }
  }
  function remember(pid) {
    try { pid ? sessionStorage.setItem(KEY, pid) : sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  }
  function episode() {
    return new URLSearchParams(location.search).get('episode') || null;
  }
  // A page link that stays in the current production.
  function link(page, params = {}) {
    const q = new URLSearchParams({ production: id() || '', ...params });
    for (const [k, v] of [...q]) if (!v) q.delete(k);
    const s = q.toString();
    return s ? `${page}?${s}` : page;
  }
  async function goHome(store) {
    if (store) await store.flush();
    location.href = id() ? link('dashboard.html') : 'home.html';
  }
  async function goPicker(store) {
    if (store) await store.flush();
    remember(null);
    location.href = 'home.html';
  }

  // A new, empty production (the shot sheet page fills in the rest of the fields).
  function blank(title, type = 'film') {
    const now = Date.now();
    return {
      id: uid(), title: title || 'Untitled Production', type: type === 'tv' ? 'tv' : 'film',
      episodes: type === 'tv' ? [{ id: uid(), number: '1', title: '', scriptLink: null }] : [],
      scenes: [], days: [], characters: [], crew: [], comments: [], scriptLink: null,
      createdAt: now, updatedAt: now,
    };
  }

  // Fields a production needs beyond the shot sheet project (shared with shotsheet-formats.js,
  // which every page loads); safe to call repeatedly.
  const upgrade = (p) => window.ShotFormats.upgradeProduction(p);

  const episodeLabel = (e) => `Episode ${e.number}${e.title ? ' — ' + e.title : ''}`;
  const typeLabel = (p) => (p.type === 'tv' ? 'TV show' : 'Film');

  // One-time (and idempotent) grouping of everything made before productions existed:
  // - every shot sheet project becomes a film production;
  // - a script goes to the production linked to it, or gets a new production of its own;
  // - call sheets go together into a "Call Sheets" production.
  let migrated = null;
  function migrate() {
    if (!migrated) migrated = run();
    return migrated;
  }
  async function run() {
    const shots = (await api.loadStore('shotsheets')) || {};
    const scripts = (await api.loadStore('scripts')) || {};
    const sheets = (await api.loadStore('callsheets')) || {};
    shots.projects = Array.isArray(shots.projects) ? shots.projects : [];
    scripts.scripts = Array.isArray(scripts.scripts) ? scripts.scripts : [];
    sheets.sheets = Array.isArray(sheets.sheets) ? sheets.sheets : [];
    const dirty = new Set();

    for (const p of shots.projects) {
      const before = JSON.stringify([p.type, p.episodes]);
      upgrade(p);
      if (JSON.stringify([p.type, p.episodes]) !== before) dirty.add('shotsheets');
    }
    const ids = new Set(shots.projects.map((p) => p.id));
    for (const s of scripts.scripts) {
      if (s.productionId && ids.has(s.productionId)) continue;
      // (A productionId for a shared production isn't in this store; leave it alone.)
      if (s.productionId) continue;
      let owner = shots.projects.find((p) => (p.scriptLink && p.scriptLink.scriptId === s.id)
        || (p.episodes || []).some((e) => e.scriptLink && e.scriptLink.scriptId === s.id));
      if (!owner) {
        owner = blank(s.title || 'Untitled Script');
        owner.updatedAt = s.updatedAt || owner.updatedAt;
        shots.projects.push(owner);
        ids.add(owner.id);
        dirty.add('shotsheets');
      }
      s.productionId = owner.id;
      const ep = (owner.episodes || []).find((e) => e.scriptLink && e.scriptLink.scriptId === s.id);
      if (ep) s.episodeId = ep.id;
      dirty.add('scripts');
    }
    const loose = sheets.sheets.filter((c) => !c.productionId);
    if (loose.length) {
      const home = blank('Call Sheets');
      shots.projects.push(home);
      loose.forEach((c) => { c.productionId = home.id; });
      dirty.add('shotsheets');
      dirty.add('callsheets');
    }
    if (dirty.has('shotsheets')) await api.saveStore('shotsheets', shots);
    if (dirty.has('scripts')) await api.saveStore('scripts', scripts);
    if (dirty.has('callsheets')) await api.saveStore('callsheets', sheets);
    return shots.projects;
  }

  // Local productions (after migration), newest first.
  async function list() {
    await migrate();
    const shots = (await api.loadStore('shotsheets')) || {};
    return (Array.isArray(shots.projects) ? shots.projects : []).map(upgrade).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  window.Production = { id, episode, remember, link, goHome, goPicker, blank, upgrade, migrate, list, episodeLabel, typeLabel };
})();
