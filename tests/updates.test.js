// Run: node tests/updates.test.js
const assert = require('assert');
const { compareVersions, pickAsset } = require('../updates.js');

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
console.log('  ✓ picks the right download for each platform');
console.log('updates: all checks passed');
