// Time-based one-time codes (RFC 6238: 6 digits, 30 seconds, SHA-1), the kind authenticator
// apps (Google Authenticator, Microsoft Authenticator, 1Password, Authy…) make.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(bytes) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function unbase32(s) {
  const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

export const newSecret = () => base32(crypto.getRandomValues(new Uint8Array(20)));
export const STEP = 30;
export const stepAt = (ms) => Math.floor(ms / 1000 / STEP);

export async function codeAt(secret, step) {
  const key = await crypto.subtle.importKey('raw', unbase32(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const counter = new Uint8Array(8);
  let n = step;
  for (let i = 7; i >= 0; i--) { counter[i] = n & 255; n = Math.floor(n / 256); }
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));
  const o = mac[mac.length - 1] & 15;
  const bin = ((mac[o] & 127) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

// The time step a code is valid for (the current one, or one either side for a phone
// clock that's a little off), or null.
export async function checkCode(secret, code, now = Date.now()) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c) || !secret) return null;
  const s = stepAt(now);
  for (const step of [s, s - 1, s + 1]) if ((await codeAt(secret, step)) === c) return step;
  return null;
}

export const otpauthUri = (secret, account, issuer = 'Production Tools') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;
