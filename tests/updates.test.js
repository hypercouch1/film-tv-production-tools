// Run: node tests/updates.test.js
const assert = require('assert');
const { compareVersions, pickAsset, parseUpdateYml, macInstallTarget, MAC_SWAP_SCRIPT } = require('../updates.js');

assert.ok(compareVersions('1.2.0', '1.1.0') > 0);
assert.ok(compareVersions('v1.10.0', '1.9.3') > 0, 'numeric, not alphabetical');
assert.strictEqual(compareVersions('1.2', '1.2.0'), 0);
assert.ok(compareVersions('1.1.9', '1.2.0') < 0);
console.log('  ✓ version comparison');

const assets = [
  { name: 'Production Tools 1.2.0.exe', browser_download_url: 'https://x/portable.exe' },
  { name: 'Production Tools Setup 1.2.0.exe', browser_download_url: 'https://x/setup.exe' },
  { name: 'Production Tools-1.2.0-universal.dmg', browser_download_url: 'https://x/app.dmg' },
  { name: 'Production Tools-1.2.0-universal-mac.zip', browser_download_url: 'https://x/app.zip' },
];
assert.strictEqual(pickAsset(assets, 'win32'), 'https://x/setup.exe', 'Windows gets the installer, not the portable exe');
assert.strictEqual(pickAsset(assets, 'darwin'), 'https://x/app.dmg');
assert.strictEqual(pickAsset([], 'darwin'), null);
const current = [
  { name: 'Production-Tools-1.2.3-portable.exe', browser_download_url: 'https://x/portable.exe' },
  { name: 'Production-Tools-Setup-1.2.3.exe', browser_download_url: 'https://x/setup.exe' },
  { name: 'Production-Tools-1.2.3-universal.dmg', browser_download_url: 'https://x/app.dmg' },
];
assert.strictEqual(pickAsset(current, 'win32'), 'https://x/setup.exe', 'current file names');
assert.strictEqual(pickAsset(current, 'darwin'), 'https://x/app.dmg');
console.log('  ✓ picks the right download for each platform');

// latest-mac.yml as electron-builder writes it
const yml = parseUpdateYml(`version: 1.2.3
files:
  - url: Production-Tools-1.2.3-universal-mac.zip
    sha512: AbC+/12==
    size: 254000000
  - url: Production-Tools-1.2.3-universal.dmg
    sha512: ZZZ=
    size: 260000000
path: Production-Tools-1.2.3-universal-mac.zip
sha512: AbC+/12==
releaseDate: '2026-10-19T10:00:00.000Z'
`);
assert.strictEqual(yml.version, '1.2.3');
assert.deepStrictEqual(yml.files[0], { url: 'Production-Tools-1.2.3-universal-mac.zip', sha512: 'AbC+/12==', size: 254000000 });
assert.strictEqual(yml.files.length, 2);
console.log('  ✓ reads Mac update information');

// Where the Mac app can update itself
const exe = (app) => `${app}/Contents/MacOS/Production Tools`;
const yes = () => true;
assert.deepStrictEqual(macInstallTarget(exe('/Applications/Production Tools.app'), yes), { bundle: '/Applications/Production Tools.app' });
assert.match(macInstallTarget(exe('/Volumes/Production Tools 1.2.3/Production Tools.app'), yes).reason, /Applications folder/, 'running from the disk image');
assert.match(macInstallTarget(exe('/private/var/folders/x/AppTranslocation/ABC/d/Production Tools.app'), yes).reason, /Applications folder/, 'translocated (quarantined, not moved)');
assert.match(macInstallTarget(exe('/Applications/Production Tools.app'), (p) => p !== '/Applications').reason, /can't update itself/, 'no write access');
assert.ok(!/\$\{|`/.test(MAC_SWAP_SCRIPT) && /"\$2"/.test(MAC_SWAP_SCRIPT), 'swap script takes paths as quoted arguments');
console.log('  ✓ Mac self-update only where the app can replace itself');
console.log('updates: all checks passed');
