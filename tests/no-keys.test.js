// Step 1 guard: API keys live in the Worker. The front end never builds a keyed request itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const frontEnd = () => fs.readdirSync(ROOT).filter((f) => /\.(js|html)$/.test(f) && f !== 'eslint.config.js');

test('the front end has no api-key=, x-api-key or Authorization values', () => {
  const files = frontEnd();
  assert.ok(files.includes('app.js') && files.includes('index.html') && files.includes('proxy.js'));
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const bad of [/api-key=/i, /x-api-key/i, /Authorization/i, /anthropic-dangerous-direct-browser-access/i]) {
      assert.ok(!bad.test(src), `${f} contains ${bad}`);
    }
  }
});

test('keyed services are only reached through the Worker', () => {
  for (const f of frontEnd()) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const host of ['api.anthropic.com', 'api.helius.xyz', 'helius-rpc.com', 'api.fomoapi.io']) {
      assert.ok(!src.includes(host), `${f} calls ${host} directly`);
    }
  }
});
