# Export and import API keys (password-protected)

**Status:** approved 2026-10-14.

**Problem.** Moving the app to another device (a computer browser) means typing every key again: the Worker key, Anthropic, Helius, the FOMO API key and GMGN. The JSON backup leaves them out on purpose so they never sit readable in a file. Settings gets **Export keys**: it asks for a password twice and downloads `fomo-tracker-keys.json`, locked with that password using the browser's built-in encryption (AES-256-GCM, the key derived from the password with PBKDF2-SHA256), so the file is unreadable without it and safe to AirDrop, email or save to iCloud. **Import keys** takes the file and the password and fills the keys in; a wrong password or a damaged file says so and changes nothing. Only the keys go in the file (the JSON backup stays as it is); nothing is sent anywhere; there is no password recovery. No new dependencies. We know it works when unit tests show a lock-then-unlock round trip, a wrong password failing, no key readable in the file and only key fields included, and a browser test exports with a password on one page and imports it on a fresh page with every key back, a wrong password leaving settings untouched.

## Rules

- Logic in `keyfile.js` (`KeyFile.pick`, `lock`, `unlock`), using `crypto.subtle` (browsers and Node have it).
- Keys: `feedKey`, `anthropicKey`, `heliusKey`, `lookupKey`, `gmgnKey`; empty ones are left out.
- The file: `{ app: 'fomo-tracker', kind: 'keys', v: 1, kdf: 'PBKDF2-SHA256', iterations: 600000, salt, iv, data }` (base64); a new random salt and IV every export.
- Passwords need at least 8 characters, and the two entries must match.
- Importing only sets the keys found in the file; other settings stay.
