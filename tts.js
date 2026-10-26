// Natural voices for reading scripts aloud: the Kokoro voice model, run on this computer so
// scripts never leave it. The model (about 90 MB) downloads from Hugging Face the first time
// someone asks for it; the voices themselves ship with the app. Speech is made in a separate
// process (tts-worker.js), started when first needed and stopped after a few idle minutes.
const path = require('path');
const fs = require('fs');

const MODEL_FILE = path.join('onnx-community', 'Kokoro-82M-v1.0-ONNX', 'onnx', 'model_quantized.onnx');
const MODEL_BYTES = 92361116;
const IDLE_MS = 5 * 60 * 1000;

// fork(workerPath) → a child with postMessage / on('message') / on('exit') / kill
// (Electron's utilityProcess.fork).
function createVoices({ dir, fork, workerPath, idleMs = IDLE_MS }) {
  const cacheDir = path.join(dir, 'voices');
  let child = null;
  let nextId = 1;
  const pending = new Map(); // id → { resolve, reject, onProgress }
  let idleTimer = null;

  function worker() {
    if (child) return child;
    child = fork(workerPath);
    child.on('message', (msg) => {
      const job = pending.get(msg.id);
      if (!job) return;
      if (msg.progress) { if (job.onProgress) job.onProgress(msg.progress); return; }
      pending.delete(msg.id);
      if (msg.error) job.reject(new Error(msg.error)); else job.resolve(msg.result);
      idleLater();
    });
    child.on('exit', () => {
      child = null;
      for (const job of pending.values()) job.reject(new Error('The voice process stopped.'));
      pending.clear();
    });
    child.postMessage({ type: 'init', cacheDir });
    return child;
  }
  function idleLater() {
    clearTimeout(idleTimer);
    if (!pending.size) idleTimer = setTimeout(stop, idleMs);
  }
  function call(job, onProgress) {
    clearTimeout(idleTimer);
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onProgress });
      worker().postMessage({ ...job, id });
    });
  }
  function stop() {
    clearTimeout(idleTimer);
    if (child) child.kill();
  }
  const downloaded = () => {
    try { return fs.statSync(path.join(cacheDir, MODEL_FILE)).size >= MODEL_BYTES * 0.9; } catch { return false; }
  };

  return {
    status: () => ({ downloaded: downloaded(), bytes: MODEL_BYTES }),
    // Download the model if it's missing (only when asked), then load it.
    prepare: (owner, onProgress) => call({ type: 'load', owner, download: true }, onProgress),
    speak: (owner, { text, voice, speed }) => {
      if (!downloaded()) return Promise.reject(new Error('The voices aren\'t downloaded yet.'));
      return call({ type: 'speak', owner, text: String(text || '').slice(0, 1000), voice: String(voice || 'af_heart'), speed: Number(speed) || 1 });
    },
    cancel: (owner) => { if (child) child.postMessage({ type: 'cancel', owner }); },
    // Delete the downloaded model (to free the space).
    // (Windows keeps the file locked until the voice process has gone, hence the retries.)
    remove: async () => {
      stop();
      await fs.promises.rm(cacheDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      return true;
    },
    stop,
  };
}

module.exports = { createVoices, MODEL_FILE, MODEL_BYTES };
