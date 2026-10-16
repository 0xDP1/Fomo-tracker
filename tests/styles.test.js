// docs/BUGS.md bug 27: the stylesheet's tokens must hold literal values; a token pointing at itself is invalid and every
// rule using it silently falls back (transparent backgrounds, inherited colours).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('styles.css: no token references itself, and every var() used is defined', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
  const self = [...root.matchAll(/--([a-z0-9-]+):\s*var\(--([a-z0-9-]+)\)/g)].filter((m) => m[1] === m[2]).map((m) => m[1]);
  assert.deepEqual(self, [], 'tokens pointing at themselves: ' + self.join(', '));
  const defined = new Set([...root.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]));
  const used = new Set([...css.matchAll(/var\(--([a-z0-9-]+)[,)]/g)].map((m) => m[1]));
  const missing = [...used].filter((v) => !defined.has(v) && v !== 'top-h'); // --top-h is set by panes-ui.js at run time
  assert.deepEqual(missing, [], 'tokens used but never defined: ' + missing.join(', '));
});
