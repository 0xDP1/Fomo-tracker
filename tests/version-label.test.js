const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the Settings version label is filled from APP_VERSION, not typed into the page', () => {
  const html = read('index.html');
  const m = html.match(/<span[^>]*id="appVersion"[^>]*>([^<]*)<\/span>/);
  assert.ok(m, 'label exists');
  assert.ok(!/\d/.test(m[1]), `index.html hard-codes a version: "${m[1]}"`);
  assert.match(read('app.js'), /appVersion[^\n]*APP_VERSION/, 'app.js sets the label from APP_VERSION');
});

test('version.json, APP_VERSION and the script versions agree', () => {
  const v = JSON.parse(read('version.json')).version;
  assert.equal(Number(read('app.js').match(/const APP_VERSION = (\d+)/)[1]), v);
  const stamps = new Set([...read('index.html').matchAll(/\?v=(\d+)/g)].map((x) => Number(x[1])));
  assert.deepEqual([...stamps], [v], 'every asset uses the current version');
});
