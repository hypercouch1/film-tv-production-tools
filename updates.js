// Checks GitHub Releases for a newer version of the app. It only tells people an
// update exists (with a download link); it doesn't install anything, because unsigned
// apps can't update themselves on macOS.
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

function createUpdater({ repo, onChange }) {
  const { app, net } = require('electron'); // loaded here so the helpers above work in plain Node tests
  const releasesUrl = `https://github.com/${repo}/releases`;
  let info = { current: app.getVersion(), latest: null, newer: false, releasesUrl };

  async function check() {
    const current = app.getVersion();
    try {
      const res = await net.fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { 'User-Agent': 'Production-Tools-update-check', Accept: 'application/vnd.github+json' },
      });
      if (res.status === 404) {
        info = { current, latest: current, newer: false, releasesUrl, checkedAt: Date.now() };
      } else if (res.ok) {
        const release = await res.json();
        const latest = String(release.tag_name || '').replace(/^v/, '');
        info = {
          current,
          latest,
          newer: !!latest && compareVersions(latest, current) > 0,
          name: release.name || `Version ${latest}`,
          url: release.html_url || releasesUrl,
          downloadUrl: pickAsset(release.assets, process.platform) || release.html_url || releasesUrl,
          releasesUrl,
          checkedAt: Date.now(),
        };
      } else {
        throw new Error(`GitHub answered ${res.status}`);
      }
    } catch (err) {
      info = { ...info, current, error: err.message, checkedAt: Date.now() };
    }
    if (onChange) onChange(info);
    return info;
  }

  return { check, get: () => info, releasesUrl };
}

module.exports = { createUpdater, compareVersions, pickAsset };
