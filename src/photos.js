// Pictures in a production (storyboard frames, continuity photos): JPEGs kept by id on this
// computer, or on the server for a shared production. cloudId: the shared document they
// belong to (or the production), or null on this computer.
(function () {
  const { api, el } = window.Common;
  const urls = new Map(); // photo id → Promise<object URL | null>

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  // Pictures are made at most 1600 px on the long side and saved as JPEG.
  async function shrink(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t read that picture.'))), 'image/jpeg', 0.82));
  }

  // An object URL for a photo (null if it can't be found).
  function url(cloudId, id) {
    if (!urls.has(id)) {
      urls.set(id, (async () => {
        const blob = cloudId
          ? await window.Cloud.photo(cloudId, id)
          : await api.loadPhoto(id).then((bytes) => (bytes ? new Blob([bytes], { type: 'image/jpeg' }) : null));
        return blob ? URL.createObjectURL(blob) : null;
      })().catch(() => null));
    }
    return urls.get(id);
  }

  // Saves a picture file; resolves to its new id.
  async function add(cloudId, file) {
    const blob = await shrink(file);
    let id;
    if (cloudId) id = await window.Cloud.uploadPhoto(cloudId, blob);
    else { id = uid(); await api.savePhoto(id, new Uint8Array(await blob.arrayBuffer())); }
    urls.set(id, Promise.resolve(URL.createObjectURL(blob)));
    return id;
  }

  async function remove(cloudId, id) {
    try { if (cloudId) await window.Cloud.deletePhoto(cloudId, id); else await api.deletePhoto(id); } catch { /* already gone */ }
  }

  // An <img> that fills in once the photo has loaded.
  function img(cloudId, id, attrs = {}) {
    const node = el('img', { alt: '', ...attrs });
    url(cloudId, id).then((u) => { if (u) node.src = u; else node.classList.add('missing'); });
    return node;
  }

  function lightbox(cloudId, id, caption) {
    const o = el('div', { class: 'lightbox', onclick: () => o.remove() }, img(cloudId, id, { class: 'lb-img' }), caption ? el('div', { class: 'lb-caption' }, caption) : null);
    const onKey = (e) => { if (e.key === 'Escape') { o.remove(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
    document.body.append(o);
  }

  // Image files from a paste or a drop.
  const imageFiles = (dt) => [...((dt && dt.files) || [])].filter((f) => f.type.startsWith('image/'));

  // Picks image files with the system file picker.
  function pick({ multiple = false } = {}) {
    return new Promise((resolve) => {
      const input = el('input', { type: 'file', accept: 'image/*', multiple, hidden: true, onchange: () => { resolve([...input.files]); input.remove(); } });
      document.body.append(input);
      input.click();
    });
  }

  window.Photos = { uid, shrink, url, add, remove, img, lightbox, imageFiles, pick };
})();
