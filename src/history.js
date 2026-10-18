// Undo / redo for a document that is edited in place (call sheet, shot sheet, script).
// Each step stores the change as id-addressed operations in both directions (from
// sync-core), so undoing in a shared project reverses only your own change and leaves
// what collaborators did since then alone.
(function (root) {
  const { diff, applyAll, clone, stripLocal } = root.SyncCore;

  // getDoc: returns the live document; onApply: called after undo/redo changed it.
  function createHistory({ getDoc, onApply, limit = 300, mergeWithinMs = 700 }) {
    let undoStack = [];
    let redoStack = [];
    let baseline = null;   // the document as of the last recorded step
    let docId = null;
    let lastAt = 0;
    let merging = false;   // keep typing in one step until a pause
    let applying = false;

    const snap = () => {
      const d = getDoc();
      return d ? stripLocal(clone(d)) : null;
    };

    function reset() {
      undoStack = [];
      redoStack = [];
      baseline = snap();
      const d = getDoc();
      docId = d ? d.id : null;
      merging = false;
    }

    // Call after every change to the document.
    function record() {
      if (applying) return;
      const d = getDoc();
      if (!d) return;
      if (d.id !== docId || !baseline) { reset(); return; }
      const now = snap();
      const t = Date.now();
      const last = undoStack[undoStack.length - 1];
      if (merging && last && last.start && t - lastAt < mergeWithinMs) {
        last.forward = diff(last.start, now);
        last.back = diff(now, last.start);
        if (!last.forward.length) undoStack.pop();
      } else {
        const forward = diff(baseline, now);
        if (!forward.length) return;
        if (last) delete last.start; // only the newest step can still grow
        undoStack.push({ start: baseline, forward, back: diff(now, baseline) });
        if (undoStack.length > limit) undoStack.shift();
      }
      redoStack = [];
      baseline = now;
      lastAt = t;
      merging = true;
    }

    // Someone else changed the document: future steps start from here.
    function rebase() {
      baseline = snap();
      merging = false;
    }

    function step(from, to, key) {
      const entry = from.pop();
      if (!entry) return false;
      delete entry.start;
      const d = getDoc();
      if (!d) return false;
      applyAll(d, clone(entry[key]));
      to.push(entry);
      baseline = snap();
      merging = false;
      applying = true;
      try { onApply && onApply(); } finally { applying = false; }
      return true;
    }

    return {
      reset,
      record,
      rebase,
      undo: () => step(undoStack, redoStack, 'back'),
      redo: () => step(redoStack, undoStack, 'forward'),
      get canUndo() { return undoStack.length > 0; },
      get canRedo() { return redoStack.length > 0; },
    };
  }

  root.History = { createHistory };
})(typeof window !== 'undefined' ? window : globalThis);
