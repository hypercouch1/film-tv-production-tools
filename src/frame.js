// The split-screen divider (frame.html). Dragging it resizes the two panes; the mouse stays
// with the divider while the button is held, even over the panes.
(function () {
  const divider = document.getElementById('divider');
  let grab = null; // where on the divider it was grabbed, while dragging
  let pending = null;
  window.api.split.onLayout((l) => {
    divider.style.display = l.split ? 'block' : 'none';
    if (l.split) { divider.style.left = l.x + 'px'; divider.style.width = l.width + 'px'; }
  });
  // About one resize per frame while dragging. (A timer, not requestAnimationFrame: this
  // page is mostly covered by the panes, so the browser may not draw it.)
  const send = (x) => {
    if (pending === null) setTimeout(() => { window.api.split.resize(pending); pending = null; }, 16);
    pending = x;
  };
  const stop = () => {
    grab = null;
    divider.classList.remove('dragging');
    document.body.classList.remove('dragging');
  };
  divider.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    grab = e.clientX - divider.offsetLeft;
    divider.classList.add('dragging');
    document.body.classList.add('dragging');
  });
  window.addEventListener('mousemove', (e) => {
    if (grab === null) return;
    if (!(e.buttons & 1)) { stop(); return; }
    send(e.clientX - grab);
  });
  window.addEventListener('mouseup', stop);
  window.addEventListener('blur', stop);
  divider.addEventListener('dblclick', () => window.api.split.resize(null));
})();
