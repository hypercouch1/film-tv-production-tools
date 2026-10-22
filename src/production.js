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

  // ---- Sharing a production ----
  // Moves a production on this computer online with everything in it (scripts, call sheets),
  // keeping every id so the links between them keep working. Afterwards the production is
  // opened from the server; its local copies are removed. Resolves to true when it's online.
  async function share(pid) {
    const Cloud = window.Cloud;
    if (!Cloud.signedIn) {
      window.Collab.openAccount(() => window.Common.toast('Signed in. Click Share again to invite people.'));
      return false;
    }
    const shots = (await api.loadStore('shotsheets')) || {};
    const prod = (shots.projects || []).find((p) => p.id === pid);
    if (!prod) return false;
    const scripts = (await api.loadStore('scripts')) || {};
    const sheets = (await api.loadStore('callsheets')) || {};
    const myScripts = (scripts.scripts || []).filter((d) => d.productionId === pid);
    const mySheets = (sheets.sheets || []).filter((d) => d.productionId === pid);
    const parts = [myScripts.length && `${myScripts.length} script${myScripts.length === 1 ? '' : 's'}`, mySheets.length && `${mySheets.length} call sheet${mySheets.length === 1 ? '' : 's'}`].filter(Boolean);
    if (!confirm(`Move "${prod.title}"${parts.length ? ` and its ${parts.join(' and ')}` : ''} online so you can invite people?\n\n`
      + 'Everyone you add gets the whole production. It will be saved on your server and removed from this computer.')) return false;
    const { clone, stripLocal } = window.SyncCore;
    try {
      await Cloud.createProject('shotsheet', stripLocal(clone(prod)), { id: prod.id });
    } catch (err) {
      alert(err.message);
      return false;
    }
    shots.projects = shots.projects.filter((p) => p.id !== pid);
    await api.saveStore('shotsheets', shots);
    // Then everything inside it. Anything that fails stays on this computer (still in the
    // production) and can be shared again from its page.
    const failed = [];
    const upload = async (kind, docs, store, key) => {
      const done = new Set();
      for (const d of docs) {
        try {
          await Cloud.createProject(kind, stripLocal(clone(d)), { id: d.id, parent: pid });
          done.add(d.id);
        } catch (err) { failed.push(`${d.title || kind}: ${err.message}`); }
      }
      store[key] = (store[key] || []).filter((d) => !done.has(d.id));
      await api.saveStore({ script: 'scripts', callsheet: 'callsheets', post: 'post', budget: 'budget', onset: 'onset', gear: 'gear' }[kind], store);
    };
    await upload('script', myScripts, scripts, 'scripts');
    await upload('callsheet', mySheets, sheets, 'sheets');
    // Post production (take log, media catalogue, tracker, cuts).
    const post = (await api.loadStore('post')) || {};
    const myPost = (post.docs || []).filter((d) => d.productionId === pid);
    if (myPost.length) await upload('post', myPost, post, 'docs');
    // The budget (seen only by the production's owner and editors once it's online).
    const budget = (await api.loadStore('budget')) || {};
    const myBudget = (budget.docs || []).filter((d) => d.productionId === pid);
    if (myBudget.length) await upload('budget', myBudget, budget, 'docs');
    // Equipment, and on-set reports and continuity notes. Continuity photos go up first (into
    // the production), and the notes point at their new ids.
    const gear = (await api.loadStore('gear')) || {};
    const myGear = (gear.docs || []).filter((d) => d.productionId === pid);
    if (myGear.length) await upload('gear', myGear, gear, 'docs');
    const onset = (await api.loadStore('onset')) || {};
    const myOnset = (onset.docs || []).filter((d) => d.productionId === pid);
    const localNotes = new Map(myOnset.map((d) => [d.id, JSON.stringify(d.notes || [])]));
    for (const d of myOnset) {
      for (const n of Array.isArray(d.notes) ? d.notes : []) {
        n.photos = await Promise.all((n.photos || []).map(async (id) => {
          try {
            const bytes = await api.loadPhoto(id);
            return bytes ? await Cloud.uploadPhoto(pid, new Blob([bytes], { type: 'image/jpeg' })) : id;
          } catch (err) { failed.push(`A continuity photo: ${err.message}`); return id; }
        }));
      }
    }
    if (myOnset.length) {
      await upload('onset', myOnset, onset, 'docs');
      // Anything that stayed on this computer keeps pointing at its photos here.
      const stayed = onset.docs.filter((d) => localNotes.has(d.id));
      stayed.forEach((d) => { d.notes = JSON.parse(localNotes.get(d.id)); });
      if (stayed.length) await api.saveStore('onset', onset);
    }
    if (failed.length) alert('These couldn’t be moved online and are still on this computer:\n\n' + failed.join('\n'));
    return true;
  }

  // A shared production: open its people dialog.
  function openPeople(pid, { title, role, onDelete } = {}) {
    return window.Collab.membersDialog({ projectId: pid, title, isOwner: role === 'owner', inProduction: true, onDelete });
  }

  window.Production = { id, episode, remember, link, goHome, goPicker, blank, upgrade, migrate, list, episodeLabel, typeLabel, share, openPeople };
})();
