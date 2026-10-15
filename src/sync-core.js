// Live-sync engine shared by the desktop app (loaded as a <script>) and the
// Cloudflare Worker (imported for its side effect). It turns two versions of a
// document into small operations and applies those operations.
//
// Lists of objects with an `id` (sections, items, scenes, shots, days) are
// addressed by id, so concurrent edits to different entries never collide:
//   { t: 'set',   p: ['sections', '#s1', 'title'], v: 'PREP' }
//   { t: 'unset', p: [...] }
//   { t: 'ins',   p: ['sections', '#s1', 'items'], after: 'i3' | null, v: {...} }
//   { t: 'del',   p: ['sections'], id: 's2' }
//   { t: 'mov',   p: ['sections'], id: 's2', after: 's5' | null }
// Keys named updatedAt or starting with "_" are local-only and never synced.
(function (root) {
  const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isIdList = (a) => Array.isArray(a) && a.every((x) => isObj(x) && typeof x.id === 'string');
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const skipKey = (k) => k === 'updatedAt' || k.startsWith('_');

  function stripLocal(v) {
    if (Array.isArray(v)) return v.map(stripLocal);
    if (!isObj(v)) return v;
    const out = {};
    for (const [k, x] of Object.entries(v)) if (!skipKey(k)) out[k] = stripLocal(x);
    return out;
  }

  function diff(a, b, path = [], ops = []) {
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const k of keys) {
      if (skipKey(k)) continue;
      const av = a[k], bv = b[k], p = [...path, k];
      if (isIdList(av) && isIdList(bv)) diffList(av, bv, p, ops);
      else if (isObj(av) && isObj(bv)) diff(av, bv, p, ops);
      else if (!same(av, bv)) ops.push(bv === undefined ? { t: 'unset', p } : { t: 'set', p, v: stripLocal(clone(bv)) });
    }
    return ops;
  }

  function diffList(a, b, p, ops) {
    const inB = new Set(b.map((x) => x.id));
    const inA = new Map(a.map((x) => [x.id, x]));
    for (const x of a) if (!inB.has(x.id)) ops.push({ t: 'del', p, id: x.id });
    // Walk the new order, simulating the old list, and emit inserts/moves where they differ.
    const sim = a.filter((x) => inB.has(x.id)).map((x) => x.id);
    b.forEach((x, i) => {
      const after = i ? b[i - 1].id : null;
      if (!inA.has(x.id)) {
        ops.push({ t: 'ins', p, after, v: stripLocal(clone(x)) });
        sim.splice(i, 0, x.id);
        return;
      }
      if (sim[i] !== x.id) {
        sim.splice(sim.indexOf(x.id), 1);
        sim.splice(i, 0, x.id);
        ops.push({ t: 'mov', p, id: x.id, after });
      }
      diff(inA.get(x.id), x, [...p, '#' + x.id], ops);
    });
  }

  function resolve(doc, path) {
    let cur = doc;
    for (const seg of path) {
      if (typeof seg !== 'string' || cur == null) return undefined;
      if (seg.startsWith('#')) {
        if (!Array.isArray(cur)) return undefined;
        cur = cur.find((x) => isObj(x) && x.id === seg.slice(1));
      } else {
        if (BAD_KEYS.has(seg) || !isObj(cur) || !Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
        cur = cur[seg];
      }
    }
    return cur;
  }

  // Returns true when the op changed the document. Invalid ops are ignored.
  function apply(doc, op) {
    if (!isObj(op) || !Array.isArray(op.p) || !op.p.every((s) => typeof s === 'string')) return false;
    if (op.t === 'set' || op.t === 'unset') {
      if (!op.p.length) return false;
      const key = op.p[op.p.length - 1];
      if (BAD_KEYS.has(key) || key.startsWith('#')) return false;
      const parent = resolve(doc, op.p.slice(0, -1));
      if (!isObj(parent)) return false;
      if (op.t === 'set') parent[key] = clone(op.v);
      else delete parent[key];
      return true;
    }
    const list = resolve(doc, op.p);
    if (!Array.isArray(list)) return false;
    const indexAfter = (after) => {
      if (after == null) return 0;
      const i = list.findIndex((x) => x && x.id === after);
      return i < 0 ? list.length : i + 1; // anchor deleted meanwhile: append
    };
    if (op.t === 'ins') {
      if (!isObj(op.v) || typeof op.v.id !== 'string' || list.some((x) => x && x.id === op.v.id)) return false;
      list.splice(indexAfter(op.after), 0, clone(op.v));
      return true;
    }
    if (op.t === 'del') {
      const i = list.findIndex((x) => x && x.id === op.id);
      if (i < 0) return false;
      list.splice(i, 1);
      return true;
    }
    if (op.t === 'mov') {
      const i = list.findIndex((x) => x && x.id === op.id);
      if (i < 0 || op.after === op.id) return false;
      const [item] = list.splice(i, 1);
      list.splice(indexAfter(op.after), 0, item);
      return true;
    }
    return false;
  }

  function applyAll(doc, ops) {
    const applied = [];
    for (const op of Array.isArray(ops) ? ops : []) if (apply(doc, op)) applied.push(op);
    return applied;
  }

  root.SyncCore = { diff, apply, applyAll, clone, stripLocal };
})(typeof window !== 'undefined' ? window : globalThis);
