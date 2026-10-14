// Key file: the API keys locked with a password (AES-256-GCM, the key from PBKDF2-SHA256), so moving to another device
// doesn't mean typing them again, and the file is unreadable without the password (docs/features/key-file.md).
// Pure helpers, no DOM, no network; crypto.subtle works in browsers and Node.
(function (root) {
  'use strict';
  const FIELDS = ['feedKey', 'anthropicKey', 'heliusKey', 'lookupKey', 'gmgnKey'];
  const ITERATIONS = 600000;
  const BAD_FILE = 'not a Fomo Tracker key file';
  const subtle = () => root.crypto.subtle;
  const b64 = (bytes) => { let s = ''; for (const x of new Uint8Array(bytes)) s += String.fromCharCode(x); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(String(s)), (c) => c.charCodeAt(0));

  // The non-empty API keys from the settings.
  const pick = (settings) => Object.fromEntries(FIELDS.filter((k) => settings && settings[k]).map((k) => [k, String(settings[k])]));
  const checkPassword = (a, b) => (String(a || '').length < 8 ? 'Use at least 8 characters.' : a !== b ? 'The two passwords don\'t match.' : null);

  async function keyFrom(password, salt, iterations) {
    const base = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  // keys -> the file's JSON object, with a new random salt and IV each time.
  async function lock(keys, password, opts = {}) {
    const iterations = opts.iterations || ITERATIONS;
    const salt = root.crypto.getRandomValues(new Uint8Array(16)), iv = root.crypto.getRandomValues(new Uint8Array(12));
    const data = await subtle().encrypt({ name: 'AES-GCM', iv }, await keyFrom(password, salt, iterations), new TextEncoder().encode(JSON.stringify(keys)));
    return { app: 'fomo-tracker', kind: 'keys', v: 1, kdf: 'PBKDF2-SHA256', iterations, salt: b64(salt), iv: b64(iv), data: b64(data) };
  }
  // The file's JSON object + password -> the keys (known fields only). Throws on a wrong password or a damaged file.
  async function unlock(file, password) {
    if (!file || file.app !== 'fomo-tracker' || file.kind !== 'keys' || !file.salt || !file.iv || !file.data) throw new Error(BAD_FILE);
    let out;
    try {
      const plain = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(file.iv) }, await keyFrom(password, unb64(file.salt), Number(file.iterations) || ITERATIONS), unb64(file.data));
      out = JSON.parse(new TextDecoder().decode(plain));
    } catch { throw new Error('wrong password or damaged file'); }
    return Object.fromEntries(FIELDS.filter((k) => out && typeof out[k] === 'string' && out[k]).map((k) => [k, out[k]]));
  }

  const api = { FIELDS, ITERATIONS, pick, checkPassword, lock, unlock };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KeyFile = api;
})(typeof window !== 'undefined' ? window : globalThis);
