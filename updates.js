// Updates from GitHub Releases.
// - Checks for a newer release (shortly after launch, then every 6 hours).
// - Windows (installed copy): electron-updater downloads the new installer in the
//   background; it installs on "Restart to update" or when the app quits.
// - macOS: Apple's updater only works for signed apps, so this does it directly:
//   downloads the release's Mac .zip, checks its SHA-512 against latest-mac.yml from the
//   same release, unpacks it next to the installed app, and swaps the two after the app
//   quits. Needs the app in a folder it can write to (normally /Applications).
// - Anything else (portable .exe, app run from the disk image, no write access):
//   falls back to a download link.
const path = require('path');
const fs = require('fs');

function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

// The installer that suits this computer.
function pickAsset(assets, platform) {
  const list = Array.isArray(assets) ? assets : [];
  const find = (re) => list.find((a) => re.test(a.name));
  const asset = platform === 'darwin' ? find(/\.dmg$/i) || find(/mac.*\.zip$/i)
    : platform === 'win32' ? find(/setup.*\.exe$/i) || find(/\.exe$/i)
      : null;
  return asset ? asset.browser_download_url : null;
}

// latest-mac.yml (written by electron-builder) → { version, files: [{ url, sha512, size }] }.
// Only the simple shape electron-builder writes is understood.
function parseUpdateYml(text) {
  const out = { version: null, files: [] };
  let cur = null;
  for (const line of String(text).split(/\r?\n/)) {
    let m;
    if ((m = line.match(/^version:\s*['"]?([^'"\s]+)/))) out.version = m[1];
    else if ((m = line.match(/^\s*-\s+url:\s*['"]?(.+?)['"]?\s*$/))) out.files.push(cur = { url: m[1] });
    else if (cur && (m = line.match(/^\s+sha512:\s*['"]?([A-Za-z0-9+/=]+)/))) cur.sha512 = m[1];
    else if (cur && (m = line.match(/^\s+size:\s*(\d+)/))) cur.size = Number(m[1]);
    else if (/^\S/.test(line)) cur = null;
  }
  return out;
}

// Where the running Mac app lives, and whether it can replace itself there.
function macInstallTarget(exePath, canWrite) {
  const bundle = path.posix.resolve(exePath, '..', '..', '..');
  if (!bundle.endsWith('.app')) return { reason: 'Not running from an app bundle.' };
  if (bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/')) {
    return { reason: 'Move Production Tools to your Applications folder to get automatic updates.' };
  }
  if (!canWrite(path.posix.dirname(bundle)) || !canWrite(bundle)) {
    return { reason: "Production Tools can't update itself in this folder. Download the new version instead." };
  }
  return { bundle };
}

// Runs after the app has quit: swaps the new app into place (restoring the old one if
// anything fails), then optionally reopens it. Paths arrive as arguments, never as code.
const MAC_SWAP_SCRIPT = `
pid="$1"; new="$2"; target="$3"; backup="$4"; relaunch="$5"
i=0
while kill -0 "$pid" 2>/dev/null && [ $i -lt 300 ]; do sleep 0.2; i=$((i+1)); done
rm -rf "$backup"
if mv "$target" "$backup"; then
  if mv "$new" "$target"; then rm -rf "$backup"; else mv "$backup" "$target"; fi
fi
rm -rf "$(dirname "$new")"
xattr -dr com.apple.quarantine "$target" 2>/dev/null
[ "$relaunch" = 1 ] && open "$target"
exit 0
`;

function createUpdater({ repo, onChange }) {
  const { app, net } = require('electron'); // loaded here so the helpers above work in plain Node tests
  const { execFile, spawn } = require('child_process');
  const crypto = require('crypto');
  const { Readable } = require('stream');
  const { pipeline } = require('stream/promises');
  const run = (cmd, args) => new Promise((resolve, reject) => execFile(cmd, args, (err, stdout) => (err ? reject(err) : resolve(String(stdout).trim()))));
  const canWrite = (p) => { try { fs.accessSync(p, fs.constants.W_OK); return true; } catch { return false; } };

  const releasesUrl = `https://github.com/${repo}/releases`;
  // install: how this copy updates. auto = installs itself; state: downloading | ready | error.
  const install = { auto: false, reason: null, state: null, version: null, progress: 0, error: null };
  let info = { current: app.getVersion(), latest: null, newer: false, releasesUrl, install };
  let assets = [];
  let macTarget = null; // { bundle }
  let macStaged = null; // path of the unpacked new app
  let winUpdater = null;

  // Can this copy install updates itself?
  if (!app.isPackaged) install.reason = 'Automatic updates only work in the installed app.';
  else if (process.platform === 'win32') {
    if (process.env.PORTABLE_EXECUTABLE_FILE) install.reason = 'The portable version can’t update itself. Download the new version, or use the installer to get automatic updates.';
    else install.auto = true;
  } else if (process.platform === 'darwin') {
    macTarget = macInstallTarget(app.getPath('exe'), canWrite);
    if (macTarget.bundle) install.auto = true;
    else install.reason = macTarget.reason;
  } else install.reason = 'Automatic updates aren’t available on this system.';

  const emit = () => { info = { ...info, install: { ...install } }; if (onChange) onChange(info); };
  const setInstall = (patch) => { Object.assign(install, patch); emit(); };
  let lastPct = -1;
  const progress = (pct) => {
    pct = Math.floor(pct);
    if (pct >= lastPct + 5 || pct === 100) { lastPct = pct; setInstall({ progress: pct }); }
  };

  // ---- Windows: electron-updater ----
  function winStart(version) {
    if (!winUpdater) {
      const { autoUpdater } = require('electron-updater');
      winUpdater = autoUpdater;
      winUpdater.autoDownload = true;
      winUpdater.autoInstallOnAppQuit = true;
      winUpdater.logger = null;
      winUpdater.on('download-progress', (p) => progress(p.percent || 0));
      winUpdater.on('update-downloaded', (u) => setInstall({ state: 'ready', version: (u && u.version) || install.version, progress: 100 }));
      winUpdater.on('error', (err) => setInstall({ state: 'error', error: String((err && err.message) || err).split('\n')[0] }));
    }
    setInstall({ state: 'downloading', version, progress: 0, error: null });
    lastPct = -1;
    winUpdater.checkForUpdates().catch((err) => setInstall({ state: 'error', error: err.message }));
  }

  // ---- macOS: download, verify, unpack next to the app ----
  async function macStart(version) {
    setInstall({ state: 'downloading', version, progress: 0, error: null });
    lastPct = -1;
    const staging = path.join(path.dirname(macTarget.bundle), '.production-tools-update');
    const zipPath = path.join(app.getPath('temp'), `production-tools-${version}.zip`);
    try {
      const ymlAsset = assets.find((a) => a.name === 'latest-mac.yml');
      if (!ymlAsset) throw new Error('This release has no Mac update information.');
      const yml = parseUpdateYml(await (await net.fetch(ymlAsset.browser_download_url)).text());
      if (yml.version !== version) throw new Error('Mac update information doesn’t match the release.');
      const entry = yml.files.find((f) => /\.zip$/i.test(f.url) && f.sha512);
      const zipAsset = entry && assets.find((a) => a.name === entry.url);
      if (!zipAsset) throw new Error('This release has no Mac app archive.');

      const res = await net.fetch(zipAsset.browser_download_url);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const total = Number(res.headers.get('content-length')) || entry.size || 0;
      const hash = crypto.createHash('sha512');
      let got = 0;
      const body = Readable.fromWeb(res.body);
      body.on('data', (chunk) => { hash.update(chunk); got += chunk.length; if (total) progress((got / total) * 100); });
      await pipeline(body, fs.createWriteStream(zipPath));
      if (hash.digest('base64') !== entry.sha512) throw new Error('The download was damaged. It will be tried again later.');

      fs.rmSync(staging, { recursive: true, force: true });
      fs.mkdirSync(staging, { recursive: true });
      await run('/usr/bin/ditto', ['-x', '-k', zipPath, staging]);
      const appName = fs.readdirSync(staging).find((n) => n.endsWith('.app'));
      if (!appName) throw new Error('The Mac app archive is empty.');
      const newApp = path.join(staging, appName);
      const plist = path.join(newApp, 'Contents', 'Info.plist');
      const read = (key) => run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist]);
      const [id, ver] = await Promise.all([read('CFBundleIdentifier'), read('CFBundleShortVersionString')]);
      const ownId = await run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(macTarget.bundle, 'Contents', 'Info.plist')]);
      if (id !== ownId || ver !== version) throw new Error('The downloaded app isn’t the expected version.');
      macStaged = newApp;
      setInstall({ state: 'ready', progress: 100 });
    } catch (err) {
      fs.rmSync(staging, { recursive: true, force: true });
      setInstall({ state: 'error', error: err.message });
    } finally {
      fs.rmSync(zipPath, { force: true });
    }
  }

  function macSwap(relaunch) {
    if (!macStaged) return;
    const target = macTarget.bundle;
    const child = spawn('/bin/sh', ['-c', MAC_SWAP_SCRIPT, 'sh', String(process.pid), macStaged, target, target + '.old', relaunch ? '1' : '0'],
      { detached: true, stdio: 'ignore' });
    child.unref();
    macStaged = null;
  }
  // A downloaded update installs when the app quits, like on Windows.
  if (process.platform === 'darwin') app.on('will-quit', () => macSwap(false));

  async function check() {
    const current = app.getVersion();
    try {
      const res = await net.fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { 'User-Agent': 'Production-Tools-update-check', Accept: 'application/vnd.github+json' },
      });
      if (res.status === 404) {
        info = { ...info, current, latest: current, newer: false, error: null, checkedAt: Date.now() };
      } else if (res.ok) {
        const release = await res.json();
        const latest = String(release.tag_name || '').replace(/^v/, '');
        assets = Array.isArray(release.assets) ? release.assets : [];
        info = {
          ...info,
          current,
          latest,
          newer: !!latest && compareVersions(latest, current) > 0,
          name: release.name || `Version ${latest}`,
          url: release.html_url || releasesUrl,
          downloadUrl: pickAsset(assets, process.platform) || release.html_url || releasesUrl,
          error: null,
          checkedAt: Date.now(),
        };
      } else {
        throw new Error(`GitHub answered ${res.status}`);
      }
    } catch (err) {
      info = { ...info, current, error: err.message, checkedAt: Date.now() };
    }
    emit();
    // Start downloading a newer version, unless it's already on its way or waiting.
    if (info.newer && install.auto && !(install.version === info.latest && (install.state === 'downloading' || install.state === 'ready'))) {
      if (process.platform === 'win32') winStart(info.latest);
      else if (process.platform === 'darwin') macStart(info.latest);
    }
    return info;
  }

  // "Restart to update"
  function installNow() {
    if (install.state !== 'ready') return false;
    if (process.platform === 'win32' && winUpdater) {
      setImmediate(() => winUpdater.quitAndInstall(true, true)); // silent install, then reopen
      return true;
    }
    if (process.platform === 'darwin' && macStaged) {
      macSwap(true);
      setImmediate(() => app.quit());
      return true;
    }
    return false;
  }

  return { check, get: () => info, installNow, releasesUrl };
}

module.exports = { createUpdater, compareVersions, pickAsset, parseUpdateYml, macInstallTarget, MAC_SWAP_SCRIPT };
