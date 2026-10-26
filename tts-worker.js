// Makes speech for tts.js in its own process, so the window never stalls while a line is
// voiced. Messages from tts.js:
//   { type: 'init', cacheDir }                     where the voice model is kept
//   { id, owner, type: 'load', download }          get the model ready (download: fetch it if missing)
//   { id, owner, type: 'speak', text, voice, speed }
//   { type: 'cancel', owner }                      drop that page's jobs that haven't started
// Replies: { id, progress: { loaded, total } } while downloading, then { id, result } or { id, error }.
const Module = require('module');
// transformers.js loads the image library sharp at startup; speech never uses it, so it isn't shipped.
const load = Module._load;
Module._load = function (request, ...rest) { return request === 'sharp' ? {} : load.call(this, request, ...rest); };
const { KokoroTTS } = require('kokoro-js');
const { env } = require('@huggingface/transformers');

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const port = process.parentPort;
let tts = null;
const queue = [];
let busy = false;

async function ready(job) {
  if (tts) return tts;
  env.allowLocalModels = false;
  env.allowRemoteModels = !!job.download;
  // Download progress, summed over the model's files.
  const files = new Map();
  const progress = (p) => {
    if (p.status !== 'progress' || !p.total) return;
    files.set(p.file, p);
    let loaded = 0; let total = 0;
    for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    port.postMessage({ id: job.id, progress: { loaded, total } });
  };
  tts = await KokoroTTS.from_pretrained(MODEL, { dtype: 'q8', device: 'cpu', progress_callback: progress });
  return tts;
}

async function run(job) {
  const model = await ready(job);
  if (job.type === 'load') return true;
  const { audio, sampling_rate: rate } = await model.generate(job.text, { voice: job.voice, speed: job.speed || 1 });
  return { audio, rate };
}

async function next() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const job = queue.shift();
    try { port.postMessage({ id: job.id, result: await run(job) }); }
    catch (err) { port.postMessage({ id: job.id, error: String((err && err.message) || err) }); }
  }
  busy = false;
}

port.on('message', ({ data: msg }) => {
  if (msg.type === 'init') { env.cacheDir = msg.cacheDir; return; }
  if (msg.type === 'cancel') {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].owner === msg.owner && queue[i].type === 'speak') port.postMessage({ id: queue.splice(i, 1)[0].id, error: 'cancelled' });
    }
    return;
  }
  queue.push(msg);
  next();
});
