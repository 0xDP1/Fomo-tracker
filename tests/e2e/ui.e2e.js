const E2E = require('./helpers');
// Layout checks for the UI cleanup: main controls on the first screen, nothing clipped, sections remembered.
const { chromium } = require('playwright');
const assert = require('assert');
const WAL = 'Wa11et1111111111111111111111111111111111111';
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    const p = await b.newPage({ viewport: vp });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route('https://api.mainnet-beta.solana.com/**', (r) => r.fulfill({ json: { jsonrpc: '2.0', id: 1, result: { value: 4.5e9 } } }));
    await p.route(/^https:\/\/(?!api\.mainnet-beta|cdnjs)/, (r) => r.abort());
    await p.addInitScript((WAL) => { if (sessionStorage.getItem('i')) return; localStorage.clear();
      const D = 86400e3, now = Date.now(); const trades = [];
      for (let i = 0; i < 30; i++) trades.push({ id: 'm' + i, token: ['BONK', 'POPCAT', 'WIF'][i % 3], address: 'A' + (i % 3), cost: 1, proceeds: 1 + [0.6, -0.3, 0.2][i % 3], openedAt: new Date(now - (30 - i) * D - 3600e3).toISOString(), closedAt: new Date(now - (30 - i) * D).toISOString(), notes: 'long note about the entry', tags: ['KOL call', 'Dip buy'], source: 'manual' });
      localStorage.setItem('ft_settings', JSON.stringify({ wallet: WAL, username: 'demo' })); localStorage.setItem(`ft_w_${WAL}_trades`, JSON.stringify(trades)); localStorage.setItem(`ft_w_${WAL}_unit`, '"SOL"'); sessionStorage.setItem('i', 1); }, WAL);
    await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(800);
    const top = (sel) => p.$eval(sel, (e) => e.getBoundingClientRect().top);
    // Dashboard: wallet first, no banner when nothing to warn about, 4 key tiles + folded extras, 1-reading chart hidden
    assert.ok(await top('#dashboard h2') < 200, 'Wallet header on the first screen');
    assert.equal(await p.$eval('#riskBanner', (e) => e.hidden), true);
    assert.equal(await p.$eval('#balCard', (e) => e.hidden), true, 'balance chart hidden with one reading');
    assert.equal(await p.$$eval('#dashStats .tile', (t) => t.length), 4);
    assert.equal(await p.$eval('#dashMore', (e) => e.open), false);
    await p.click('#dashMore summary');
    assert.equal(await p.$$eval('#dashMoreStats .tile', (t) => t.length), 8);
    assert.ok(await top('#findCard') > await top('#recentList'), 'Find a trader sits with Following, below performance');
    // Check: search box first, sections folded with a summary
    await p.click('#tabs button[data-tab=check]'); await p.waitForTimeout(300);
    assert.ok(await top('#caInput') < 200, 'contract box on the first screen');
    assert.equal(await p.$eval('#marketSection', (e) => e.open), false);
    assert.equal(await p.$eval('#thesisCard', (e) => e.hidden), true, 'empty thesis card hidden');
    // Trades: nothing cut off on a phone
    await p.click('#tabs button[data-tab=trades]'); await p.waitForTimeout(300);
    const rowFit = await p.$$eval('#tradeTable tbody tr', (rs) => rs.slice(0, 5).map((r) => [...r.querySelectorAll('td')].filter((td) => td.offsetParent).every((td) => td.getBoundingClientRect().right <= innerWidth + 1)));
    assert.ok(rowFit.every(Boolean), 'every visible trade cell fits the screen');
    assert.ok(await p.$eval('#tradeTable [data-edit]', (e) => e.getBoundingClientRect().right <= innerWidth), 'edit button visible');
    // Analytics: insights first, sections remembered, open tables not clipped
    await p.click('#tabs button[data-tab=analytics]'); await p.waitForTimeout(300);
    assert.ok(await top('#insightsCard') < 200);
    assert.equal(await p.$('#anaStats'), null, 'duplicate stat tiles removed');
    for (const k of ['ana-timing', 'ana-coins', 'ana-costs', 'ana-charts']) await p.click(`details[data-key="${k}"] > summary`);
    await p.waitForTimeout(400);
    const clipped = await p.$$eval('#analytics .table-wrap', (ws) => ws.filter((w) => w.offsetParent && w.scrollWidth > w.clientWidth + 1).map((w) => w.querySelector('table')?.id || w.closest('.card')?.id || '?'));
    assert.deepEqual(clipped, [], 'no clipped Analytics tables: ' + clipped.join(','));
    assert.ok(await p.$eval('#pnlBars', (c) => c.getBoundingClientRect().height > 50), 'charts draw inside an opened section');
    await p.reload(); await p.click('#tabs button[data-tab=analytics]'); await p.waitForTimeout(300);
    assert.equal(await p.$eval('details[data-key="ana-timing"]', (e) => e.open), true, 'open sections are remembered');
    await p.click('details[data-key="ana-timing"] > summary');
    await p.waitForTimeout(150);
    await p.reload(); await p.click('#tabs button[data-tab=analytics]'); await p.waitForTimeout(200);
    assert.equal(await p.$eval('details[data-key="ana-timing"]', (e) => e.open), false, 'closed sections are remembered too');
    const hs = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(hs, false);
    console.log(vp.name, 'errors:', errs); assert.equal(errs.length, 0);
    await p.close();
  }
  await b.close(); console.log('UI E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
