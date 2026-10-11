// Step 1: keys live in the Worker. Old keys are dropped from the phone, Settings has no key fields and shows what the
// Worker has, and nothing the app does calls a keyed service directly.
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    const p = await b.newPage({ viewport: vp });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    const direct = [];
    p.on('request', (r) => { if (/api\.anthropic\.com|api\.helius\.xyz|helius-rpc\.com|api\.fomoapi\.io/.test(r.url())) direct.push(r.url()); });
    const seen = [];
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!worker\.test|cdnjs)/, (r) => r.fulfill({ json: {} }));
    await E2E.mockWorker(p, {
      services: { helius: true, fomo: true, claude: true, gmgn: false, chatter: false, jupiter: true },
      fomo: (r) => { seen.push(r.request().headers()); r.fulfill({ json: { handle: 'me', pnl: {} } }); },
      other: (r) => r.fulfill({ json: { status: 'ok', checkedAt: Date.now(), now: Date.now(), channels: [], calls: [], callers: {} }, headers: { 'Access-Control-Allow-Origin': '*' } }),
    });
    await p.addInitScript(() => {
      if (sessionStorage.getItem('i')) return;
      localStorage.clear();
      // what an older version kept on the phone
      localStorage.setItem('ft_settings', JSON.stringify({ username: 'me', heliusKey: 'hk-old', lookupKey: 'fapi_old', anthropicKey: 'sk-ant-old', lookupUrl: 'https://provider.example/{handle}', lookupHeader: 'x-key', feedUrl: 'https://worker.test', feedKey: 'k3y', gmgnKey: 'g' }));
      sessionStorage.setItem('i', 1);
    });
    await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(800);
    const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('ft_settings')));
    for (const k of ['heliusKey', 'lookupKey', 'anthropicKey', 'lookupUrl', 'lookupHeader']) assert.ok(!(k in saved), k + ' dropped from the phone');
    assert.equal(saved.feedUrl, 'https://worker.test');
    assert.equal(saved.gmgnKey, 'g', 'the GMGN fallback key stays (Settings → Advanced)');
    assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('ft_workerServices'))), { helius: true, fomo: true, claude: true, gmgn: false, chatter: false, jupiter: true }, 'learned from /services');
    assert.ok(seen.length > 0, 'FOMO data was loaded through the Worker');
    assert.ok(seen.every((h) => h['x-feed-key'] === 'k3y' && !h.authorization && !h['x-api-key']));
    await p.click('#tabs button[data-tab=settings]');
    for (const name of ['heliusKey', 'lookupKey', 'anthropicKey', 'lookupUrl', 'lookupHeader']) assert.equal(await p.$(`#settingsForm [name=${name}]`), null, name + ' field removed');
    const status = (await p.textContent('#workerStatus')).replace(/\s+/g, ' ');
    assert.match(status, /FOMO \(fomoapi\.io\) ✓ · Helius ✓ · Claude ✓ · GMGN: off · Chat search: off/);
    const html = await p.content();
    assert.ok(!/api-key=|x-api-key|sk-ant-old|fapi_old|hk-old/.test(html), 'no key anywhere on the page');
    assert.deepEqual(direct, [], 'no direct calls to keyed services');
    await (await p.$('#settingsForm')).screenshot({ path: E2E.OUT + `/worker-settings-${vp.name}.png` });
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errs, []);
    await p.close();
  }
  await b.close();
  console.log('WORKER E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
