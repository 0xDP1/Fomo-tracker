const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const WAL = 'Wa11et1111111111111111111111111111111111111';
const H = 3600e3, L = Date.parse('2026-09-01T00:00:00Z');
const t = (i, addr, ageMs, pnl) => ({ id: 'm' + i, token: addr.slice(0, 4), address: addr, cost: 1, proceeds: 1 + pnl, openedAt: new Date(L + ageMs).toISOString(), closedAt: new Date(L + ageMs + H).toISOString(), notes: '', source: 'manual' });
const trades = [t(1, 'NewA', 10 * 60e3, -0.4), t(2, 'NewB', 20 * 60e3, -0.5), t(3, 'NewA', 40 * 60e3, 0.2), t(4, 'Mid', 3 * H, 0.3), t(5, 'Old', 9 * 24 * H, 0.6), t(6, 'Gone', 2 * H, 0.1)];
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    const p = await b.newPage({ viewport: vp });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    const dex = [];
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!api\.dexscreener|cdnjs)/, (r) => r.abort());
    await p.route('https://api.dexscreener.com/**', (r) => { const url = r.request().url(); const addrs = decodeURIComponent(url.split('/tokens/')[1] || '').split(','); if (url.includes('/latest/dex/tokens/') && addrs.length > 1) dex.push(addrs.length);
      r.fulfill({ json: { pairs: addrs.filter((a) => a !== 'Gone').flatMap((a) => [{ baseToken: { address: a }, pairCreatedAt: L }, { baseToken: { address: a }, pairCreatedAt: L + 50 * H }]) } }); });
    await p.addInitScript(([WAL, trades]) => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-market': true, 'check-scanner': true, 'ana-calendar': true, 'ana-timing': true, 'ana-coins': true, 'ana-costs': true, 'ana-charts': true }));
      localStorage.setItem('ft_settings', JSON.stringify({ wallet: WAL })); localStorage.setItem(`ft_w_${WAL}_trades`, JSON.stringify(trades)); localStorage.setItem(`ft_w_${WAL}_unit`, '"SOL"'); sessionStorage.setItem('i', 1); }, [WAL, trades]);
    await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(400);
    await p.click('#tabs button[data-tab=analytics]');
    await p.waitForFunction(() => !ageState.busy && /Under 1 hour/.test(document.querySelector('#ageCard').innerText), null, { timeout: 8000 });
    await p.waitForTimeout(200);
    const rows = await p.$$eval('#ageCard tbody tr', (rs) => rs.map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
    console.log(vp.name, rows, await p.$eval('#ageCard p', (e) => e.innerText));
    assert.equal(rows[0], 'Under 1 hour 3 33% -0.70 SOL -23%');
    assert.equal(rows[1], '1 to 24 hours 1 100% +0.30 SOL +30%');
    assert.equal(rows[2], '1 to 7 days 0 – – –');
    assert.equal(rows[3], 'Over 7 days 1 100% +0.60 SOL +60%');
    assert.match(await p.$eval('#ageCard p', (e) => e.innerText), /1 trade without a known launch time/);
    assert.deepEqual(dex, [5], 'one request for all five coins');
    // cached: a second visit makes no requests
    await p.reload(); await p.click('#tabs button[data-tab=analytics]'); await p.waitForTimeout(500);
    assert.deepEqual(dex, [5], 'launch times are cached');
    await (await p.$('#ageCard')).screenshot({ path: E2E.OUT + `/age-${vp.name}.png` });
    const hs = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(hs, false);
    console.log(vp.name, 'errors:', errs); assert.equal(errs.length, 0);
    await p.close();
  }
  await b.close(); console.log('AGE E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
