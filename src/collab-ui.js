// Collaboration UI shared by every system page: account dialog, shared list,
// share/members dialog, live status and who's online.
(function () {
  const { el, toast } = window.Common;
  const Cloud = window.Cloud;
  const { clone, stripLocal } = window.SyncCore;

  const ROLE_LABEL = { owner: 'Owner', editor: 'Can edit', viewer: 'View only' };
  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  // Stable colour per person so avatars are recognisable.
  const avatarColor = (key) => {
    let h = 0;
    for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `hsl(${h} 55% 45%)`;
  };
  const avatar = (name, key, cls = '') => el('span', { class: 'avatar ' + cls, style: `background:${avatarColor(key || name)}`, title: name }, initials(name));

  // ---------- Keep the cursor and the view where they were when the page re-renders ----------
  // A collaborator's edit re-renders the page, which can recreate the field you're typing in
  // and move everything below anything they added. So, around each remote update:
  // - the focused field gets its cursor and its own scroll position back (a long line would
  //   otherwise jump back to its start, hiding what you're typing), and
  // - the page scrolls so the field you're in (or, if none, the item at the top of the view)
  //   stays at the same spot on screen, even when things are added or removed above it.
  const CONTROLS = 'input, textarea, select';
  const SCROLLERS = '#sheet, .desk'; // the main scrolling area of each page
  const ANCHORS = '[data-item], [data-shot], .section[id]';
  const keyFor = (anchor) => (anchor.dataset.item ? `[data-item="${CSS.escape(anchor.dataset.item)}"]`
    : anchor.dataset.shot ? `[data-shot="${CSS.escape(anchor.dataset.shot)}"]`
      : '#' + CSS.escape(anchor.id));

  function captureFocus() {
    const a = document.activeElement;
    if (!a || !a.matches || !a.matches(CONTROLS)) return null;
    let selection = null;
    try { if (a.selectionStart != null) selection = [a.selectionStart, a.selectionEnd, a.selectionDirection]; } catch { /* not a text field */ }
    const view = { selection, scrollLeft: a.scrollLeft, scrollTop: a.scrollTop };
    if (a.id) return { id: a.id, ...view };
    const anchor = a.closest('[data-item], [data-shot], [id]');
    if (!anchor) return null;
    return { key: keyFor(anchor), index: [...anchor.querySelectorAll(CONTROLS)].indexOf(a), ...view };
  }
  // Returns the field that has the focus afterwards (the same one, or its replacement).
  function restoreFocus(f) {
    if (!f) return null;
    let n = null;
    if (f.id) n = document.getElementById(f.id);
    else {
      const anchor = document.querySelector(f.key);
      n = anchor ? anchor.querySelectorAll(CONTROLS)[f.index] : null;
    }
    if (!n || n.offsetParent === null) return null;
    if (n !== document.activeElement) {
      n.focus({ preventScroll: true });
      if (f.selection) try { n.setSelectionRange(...f.selection); } catch { /* not a text field */ }
    }
    n.scrollLeft = f.scrollLeft;
    n.scrollTop = f.scrollTop;
    return n;
  }

  function captureView() {
    const focus = captureFocus();
    const active = focus && document.activeElement;
    let scroller = active && active.closest(SCROLLERS);
    let anchorKey = null;
    let top = 0;
    if (scroller) {
      top = active.getBoundingClientRect().top;
    } else {
      // Not typing in the sheet: keep the first item in view where it is.
      scroller = [...document.querySelectorAll(SCROLLERS)].find((s) => s.offsetParent !== null);
      if (scroller) {
        const edge = scroller.getBoundingClientRect().top;
        const first = [...scroller.querySelectorAll(ANCHORS)].find((n) => n.getBoundingClientRect().bottom > edge + 1);
        if (first) { anchorKey = keyFor(first); top = first.getBoundingClientRect().top; } else scroller = null;
      }
    }
    return { focus, scroller, anchorKey, top };
  }
  function restoreView(v) {
    const field = restoreFocus(v.focus);
    if (!v.scroller || !v.scroller.isConnected) return;
    const target = v.anchorKey ? v.scroller.querySelector(v.anchorKey) : field && field.closest(SCROLLERS) === v.scroller ? field : null;
    if (!target) return;
    const delta = target.getBoundingClientRect().top - v.top;
    if (Math.abs(delta) >= 1) v.scroller.scrollTop += delta;
  }

  const { modal } = window.Common;

  function field(label, input) {
    return el('label', { class: 'form-field' }, el('span', {}, label), input);
  }

  function busy(button, fn) {
    return async (e) => {
      if (e) e.preventDefault();
      button.disabled = true;
      try { await fn(); } finally { button.disabled = false; }
    };
  }

  function serverSection(open) {
    const input = el('input', { class: 'field', value: Cloud.serverUrl(), placeholder: 'https://production-hub.<you>.workers.dev' });
    const save = el('button', { class: 'ghost-btn', type: 'button' }, 'Save');
    save.addEventListener('click', async () => {
      const changed = input.value.trim().replace(/\/+$/, '') !== Cloud.serverUrl();
      Cloud.setServerUrl(input.value);
      if (changed && Cloud.signedIn) await Cloud.logout();
      toast('Server saved');
    });
    return el('details', { class: 'server-details', open: open || !Cloud.serverUrl() },
      el('summary', {}, 'Server'),
      el('p', { class: 'muted small' }, 'The address of your Production Tools server (the Cloudflare Worker URL).'),
      el('div', { class: 'inline-form' }, input, save));
  }

  // ---------- Account dialog ----------
  function openAccount(after) {
    const body = el('div', { class: 'account-body' });
    let mode = 'login';
    const m = modal(Cloud.signedIn ? 'Account' : 'Sign in', body);

    function renderSignedOut() {
      const error = el('p', { class: 'form-error' });
      const name = el('input', { class: 'field', autocomplete: 'name', placeholder: 'Your name' });
      const email = el('input', { class: 'field', type: 'email', autocomplete: 'email', placeholder: 'you@example.com' });
      const password = el('input', { class: 'field', type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', placeholder: mode === 'login' ? 'Password' : 'At least 8 characters' });
      const submit = el('button', { class: 'primary-btn wide', type: 'submit' }, mode === 'login' ? 'Sign in' : 'Create account');
      const form = el('form', { class: 'account-form' },
        el('div', { class: 'seg tabs-seg' },
          el('button', { type: 'button', class: mode === 'login' ? 'active' : '', onclick: () => { mode = 'login'; render(); } }, 'Sign in'),
          el('button', { type: 'button', class: mode === 'signup' ? 'active' : '', onclick: () => { mode = 'signup'; render(); } }, 'Create account')),
        mode === 'signup' ? field('Name', name) : null,
        field('Email', email),
        field('Password', password),
        error,
        submit);
      form.addEventListener('submit', busy(submit, async () => {
        error.textContent = '';
        try {
          const u = mode === 'login'
            ? await Cloud.login(email.value, password.value)
            : await Cloud.signup(name.value, email.value, password.value);
          m.close();
          toast(`Signed in as ${u.name}`);
          if (after) after();
        } catch (err) {
          error.textContent = err.message;
        }
      }));
      body.append(form, serverSection(false));
    }

    function renderSignedIn() {
      const u = Cloud.user;
      const name = el('input', { class: 'field', value: u.name });
      const saveName = el('button', { class: 'ghost-btn', type: 'button' }, 'Save');
      saveName.addEventListener('click', busy(saveName, async () => {
        try { await Cloud.updateMe({ name: name.value }); toast('Name updated'); } catch (err) { alert(err.message); }
      }));
      const cur = el('input', { class: 'field', type: 'password', autocomplete: 'current-password', placeholder: 'Current password' });
      const next = el('input', { class: 'field', type: 'password', autocomplete: 'new-password', placeholder: 'New password (8+ characters)' });
      const pwBtn = el('button', { class: 'ghost-btn', type: 'button' }, 'Change password');
      const pwMsg = el('p', { class: 'form-error' });
      pwBtn.addEventListener('click', busy(pwBtn, async () => {
        pwMsg.textContent = '';
        try {
          await Cloud.updateMe({ currentPassword: cur.value, newPassword: next.value });
          cur.value = next.value = '';
          toast('Password changed. Other devices were signed out.');
        } catch (err) { pwMsg.textContent = err.message; }
      }));
      const signOut = el('button', { class: 'ghost-btn danger wide', type: 'button' }, 'Sign out');
      signOut.addEventListener('click', busy(signOut, async () => { await Cloud.logout(); m.close(); toast('Signed out'); }));
      body.append(
        el('div', { class: 'profile' }, avatar(u.name, u.id, 'large'),
          el('div', {}, el('div', { class: 'profile-name' }, u.name), el('div', { class: 'muted small' }, u.email))),
        field('Display name', el('div', { class: 'inline-form' }, name, saveName)),
        el('details', { class: 'server-details' }, el('summary', {}, 'Change password'),
          el('div', { class: 'stack' }, cur, next, pwMsg, pwBtn)),
        serverSection(false),
        signOut);
    }

    function render() {
      body.innerHTML = '';
      if (Cloud.signedIn) renderSignedIn(); else renderSignedOut();
    }
    render();
  }

  // Account button for toolbars / the home screen; keeps itself up to date.
  function accountButton() {
    const btn = el('button', { class: 'account-btn', onclick: () => openAccount() });
    const update = () => {
      btn.innerHTML = '';
      if (Cloud.signedIn) {
        btn.title = `${Cloud.user.name} (${Cloud.user.email})`;
        btn.append(avatar(Cloud.user.name, Cloud.user.id));
      } else {
        btn.title = 'Sign in to share and collaborate';
        btn.append('Sign in');
      }
    };
    Cloud.onAuth(update);
    update();
    return btn;
  }

  // ---------- Per-page controller ----------
  // opts: { kind, listKey, noun, nounPlural, getState, render, renderSidebar, save, normalize, selectLocal, onRoleChange }
  function attach(o) {
    const c = { shared: [], error: null, session: null, sessionId: null, status: null, presence: [], me: null };
    const list = () => o.getState()[o.listKey];
    const cloudDoc = () => list().find((d) => d._cloud);
    const activeDoc = () => list().find((d) => d.id === o.getState().activeId);

    c.isCloud = (d) => !!(d && d._cloud);
    c.activeIsCloud = () => c.isCloud(activeDoc());
    c.readOnly = () => { const d = activeDoc(); return !!(d && d._cloud && d._cloud.role === 'viewer'); };
    c.localOnly = (docs) => docs.filter((d) => !d._cloud);

    c.refreshList = async () => {
      if (!Cloud.signedIn || !Cloud.serverUrl()) { c.shared = []; c.error = null; o.renderSidebar(); return; }
      try { c.shared = await Cloud.projects(o.kind); c.error = null; } catch (err) { c.error = err.message; }
      o.renderSidebar();
    };

    c.renderShared = (container) => {
      container.innerHTML = '';
      container.append(el('div', { class: 'list-heading' }, 'Shared',
        Cloud.signedIn ? el('button', { class: 'link-btn', title: 'Refresh', onclick: () => c.refreshList() }, '↻') : null));
      if (!Cloud.signedIn) {
        container.append(el('button', { class: 'shared-signin', onclick: () => openAccount() }, `Sign in to share ${o.nounPlural} and work on them together`));
        return;
      }
      if (c.error) { container.append(el('div', { class: 'list-note' }, c.error)); return; }
      if (!c.shared.length) { container.append(el('div', { class: 'list-note' }, `Nothing shared yet. Open a ${o.noun} and click Share.`)); return; }
      const ul = el('ul', { class: 'sheet-list shared-list' });
      const open = cloudDoc();
      for (const p of c.shared) {
        const title = open && open.id === p.id ? open.title : p.title;
        ul.append(el('li', { class: c.sessionId === p.id ? 'active' : '', onclick: () => c.open(p.id) },
          el('div', { class: 'name' }, el('span', { class: 'cloud-icon' }, '☁'), title || 'Untitled'),
          el('div', { class: 'meta' }, `${p.role === 'owner' ? 'Yours' : p.ownerName} · ${ROLE_LABEL[p.role]} · ${p.memberCount} ${p.memberCount === 1 ? 'person' : 'people'}`)));
      }
      container.append(ul);
    };

    c.open = (id) => {
      if (c.sessionId === id) return;
      c.leave();
      c.sessionId = id;
      c.status = 'connecting';
      let first = true;
      o.renderSidebar();
      c.updateToolbar();
      const session = Cloud.connect(id, {
        getLocal: () => cloudDoc(),
        onDoc: (raw) => {
          if (c.session !== session) return;
          const opening = first;
          const view = opening ? null : captureView();
          const doc = o.normalize(raw);
          doc.id = id;
          doc.updatedAt = Date.now();
          doc._cloud = { id, role: session.role };
          const arr = list();
          const i = arr.findIndex((d) => d._cloud);
          if (i >= 0) arr[i] = doc; else arr.push(doc);
          if (first) {
            first = false;
            o.getState().activeId = id;
            o.render({ opened: true });
            // Just shared: now that the project is loaded, show who to invite.
            if (c.membersAfterOpen === id) { c.membersAfterOpen = null; c.openMembers(); }
          } else {
            o.render({ keepScroll: true, remote: true });
          }
          if (view) restoreView(view);
        },
        onStatus: (s) => { if (c.session === session) { c.status = s; c.updateToolbar(); } },
        onPresence: (users, me) => { if (c.session === session) { c.presence = users; c.me = me; c.updateToolbar(); } },
        onRole: (role) => {
          const d = cloudDoc();
          if (d) d._cloud.role = role;
          if (o.onRoleChange) o.onRoleChange(role);
          if (!first) o.render({ keepScroll: true });
        },
        onError: (msg) => toast(msg),
        onGone: (msg) => {
          if (c.session !== session) return;
          c.leave();
          o.selectLocal();
          c.refreshList();
          alert(msg);
        },
      });
      c.session = session;
    };

    // Disconnect from the open shared project (sending any last edits first).
    c.leave = () => {
      if (!c.session) return;
      c.session.close();
      c.session = null;
      c.sessionId = null;
      c.presence = [];
      c.status = null;
      const arr = list();
      const i = arr.findIndex((d) => d._cloud);
      if (i >= 0) arr.splice(i, 1);
    };

    // Pages call this after every change; edits to a shared project are sent shortly after.
    c.changed = () => {
      if (!c.session) return;
      clearTimeout(c.timer);
      c.timer = setTimeout(() => c.session && c.session.commit(), 120);
    };

    c.share = async () => {
      const doc = activeDoc();
      if (!doc) return;
      if (doc._cloud) return c.openMembers();
      if (!Cloud.signedIn) return openAccount(() => c.share());
      if (!confirm(`Move "${doc.title}" online so you can invite people?\n\nIt will be saved on your server and removed from the "On this computer" list. Use Duplicate first if you also want to keep a private copy.`)) return;
      try {
        const project = await Cloud.createProject(o.kind, stripLocal(clone(doc)));
        const arr = list();
        arr.splice(arr.indexOf(doc), 1);
        o.save();
        c.shared.unshift(project);
        c.membersAfterOpen = project.id;
        c.open(project.id);
      } catch (err) {
        alert(err.message);
      }
    };

    c.openMembers = () => {
      const doc = cloudDoc();
      if (!doc) return;
      const projectId = doc._cloud.id;
      const isOwner = doc._cloud.role === 'owner';
      const body = el('div', { class: 'members-body' });
      const m = modal(`Share “${doc.title}”`, body, { wide: true });
      const listEl = el('ul', { class: 'member-list' }, el('li', { class: 'muted' }, 'Loading…'));
      const error = el('p', { class: 'form-error' });

      const renderMembers = (members) => {
        listEl.innerHTML = '';
        for (const mem of members) {
          const me = Cloud.user && mem.id === Cloud.user.id;
          const roleCtl = isOwner && mem.role !== 'owner'
            ? el('select', { class: 'field role-select', onchange: async (e) => {
              try { renderMembers(await Cloud.setRole(projectId, mem.id, e.target.value)); } catch (err) { error.textContent = err.message; }
            } }, el('option', { value: 'editor' }, 'Can edit'), el('option', { value: 'viewer' }, 'View only'))
            : el('span', { class: 'role-pill' }, ROLE_LABEL[mem.role]);
          if (roleCtl.tagName === 'SELECT') roleCtl.value = mem.role;
          listEl.append(el('li', {},
            avatar(mem.name, mem.id),
            el('div', { class: 'member-who' }, el('div', {}, mem.name + (me ? ' (you)' : '')), el('div', { class: 'muted small' }, mem.email)),
            roleCtl,
            isOwner && mem.role !== 'owner'
              ? el('button', { class: 'icon-btn del', title: 'Remove from project', onclick: async () => {
                if (!confirm(`Remove ${mem.name} from this project?`)) return;
                try { renderMembers(await Cloud.removeMember(projectId, mem.id)); } catch (err) { error.textContent = err.message; }
              } }, '✕')
              : null));
        }
      };

      const email = el('input', { class: 'field', type: 'email', placeholder: 'Their account email' });
      const role = el('select', { class: 'field role-select' }, el('option', { value: 'editor' }, 'Can edit'), el('option', { value: 'viewer' }, 'View only'));
      const add = el('button', { class: 'primary-btn', type: 'submit' }, 'Add');
      const form = el('form', { class: 'inline-form invite-form' }, email, role, add);
      form.addEventListener('submit', busy(add, async () => {
        error.textContent = '';
        try {
          renderMembers(await Cloud.addMember(projectId, email.value, role.value));
          toast('Added. It will appear in their Shared list.');
          email.value = '';
        } catch (err) { error.textContent = err.message; }
      }));

      body.append(
        isOwner
          ? el('div', {}, el('p', { class: 'muted small' }, 'Add people by the email they signed up with. They will see this project under Shared.'), form)
          : el('p', { class: 'muted small' }, 'Only the owner can add or remove people.'),
        error,
        el('h3', { class: 'panel-title' }, 'People'),
        listEl,
        el('div', { class: 'modal-foot' },
          el('button', { class: 'ghost-btn danger', onclick: () => { m.close(); c.deleteOrLeave(doc); } },
            isOwner ? 'Delete for everyone' : 'Leave project')));

      Cloud.members(projectId).then(renderMembers).catch((err) => { error.textContent = err.message; });
    };

    c.deleteOrLeave = async (doc) => {
      const owner = doc._cloud.role === 'owner';
      if (!confirm(owner
        ? `Delete "${doc.title}" for everyone? This cannot be undone.`
        : `Leave "${doc.title}"? You'll lose access until the owner adds you again.`)) return;
      const id = doc._cloud.id;
      c.leave();
      try {
        await Cloud.deleteProject(id);
        toast(owner ? 'Project deleted' : 'You left the project');
      } catch (err) {
        alert(err.message);
      }
      o.selectLocal();
      c.refreshList();
    };

    // ---- Toolbar: live status, who's online, Share, account ----
    const statusEl = el('span', { class: 'live-status' });
    const presenceEl = el('span', { class: 'presence' });
    const shareBtn = el('button', { class: 'ghost-btn share-btn', onclick: () => c.share() }, 'Share');
    c.mountToolbar = (toolbar, before) => {
      const bar = el('div', { class: 'collab-bar' }, statusEl, presenceEl, shareBtn);
      toolbar.insertBefore(bar, before);
      toolbar.append(accountButton());
      c.updateToolbar();
    };
    c.updateToolbar = () => {
      const d = activeDoc();
      const cloud = c.isCloud(d) || !!c.sessionId;
      statusEl.hidden = !cloud;
      if (cloud) {
        const s = c.status || 'connecting';
        const label = { live: 'Live', connecting: 'Connecting…', offline: 'Offline · will sync', gone: 'Disconnected' }[s];
        statusEl.className = 'live-status ' + s;
        statusEl.title = s === 'offline' ? 'Your changes are kept and sent when the connection comes back.' : '';
        statusEl.textContent = label + (c.readOnly() ? ' · View only' : '');
      }
      presenceEl.innerHTML = '';
      if (cloud) {
        const seen = new Set(Cloud.user ? [Cloud.user.id] : []);
        const others = c.presence.filter((u) => u.clientId !== c.me && !seen.has(u.userId) && seen.add(u.userId));
        others.slice(0, 5).forEach((u) => presenceEl.append(avatar(u.name, u.userId)));
        if (others.length > 5) presenceEl.append(el('span', { class: 'avatar more' }, '+' + (others.length - 5)));
        presenceEl.title = others.length ? 'Also here: ' + others.map((u) => u.name).join(', ') : 'Nobody else is here right now';
      }
      shareBtn.hidden = !d;
      shareBtn.textContent = c.isCloud(d) ? 'People' : 'Share';
    };

    c.init = () => {
      Cloud.onAuth(() => {
        if (!Cloud.signedIn && c.session) { c.leave(); o.selectLocal(); }
        c.refreshList();
        c.updateToolbar();
      });
      Cloud.refreshMe().then(() => c.refreshList());
      setInterval(() => c.refreshList(), 60000);
      window.addEventListener('focus', () => c.refreshList());
      window.addEventListener('pagehide', () => c.session && c.session.close());
    };

    return c;
  }

  window.Collab = { attach, openAccount, accountButton };
})();
