const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
// Check tab folding: deep blocks are one row each with their headline; a red-flag row opens by itself; taps are
// remembered; Open all / Close all; a tap inside a row you opened never acts as a profile link.
const COIN = '8vYJgiQPkpDtbWkDy1wyYDcUq3D9fUXVJUtt6aNEpump';
const now = () => Math.floor(Date.now() / 1000);
const holders = { list: [{ address: 'BundlerA', addr_type: 0, amount_percentage: 0.2, maker_token_tags: ['bundler'] }, { address: 'SniperB', addr_type: 0, amount_percentage: 0.15, maker_token_tags: ['sniper'] }, { address: 'Plain', addr_type: 0, amount_percentage: 0.01 }] };
const traders = { list: Array.from({ length: 10 }, (_, i) => ({ address: 'W' + i, addr_type: 0, start_holding_at: now() - 3600 + i, sell_amount_percentage: i < 3 ? 0.9 : 0.1, realized_profit: 100, amount_percentage: 0.01 })) };
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    const p = await b.newPage({ viewport: vp });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|openapi\.gmgn\.ai|cdnjs)/, (r) => r.abort());
    await p.route('https://openapi.gmgn.ai/**', (r) => { const u = new URL(r.request().url());
      const data = u.pathname.endsWith('token_top_holders') ? holders : u.pathname.endsWith('token_top_traders') ? traders : { list: [] };
      r.fulfill({ json: { code: 0, data }, headers: { 'Access-Control-Allow-Origin': '*' } }); });
    await p.route('https://api.dexscreener.com/**', (r) => r.fulfill({ json: { pairs: [{ chainId: 'solana', dexId: 'raydium', pairAddress: 'pp', url: 'https://dexscreener.com/x', baseToken: { symbol: 'FOLD', name: 'x', address: COIN }, priceUsd: '0.001', marketCap: 300000, liquidity: { usd: 40000 }, volume: { h24: 90000, h1: 5000, m5: 500 }, priceChange: { m5: 1 }, txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 30, sells: 10 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: Date.now() - 2 * 3600e3 }] } }));
    await p.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { creator: 'Dev', token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 900, topHolders: [{ address: 'H1', owner: 'HO1', pct: 3 }], markets: [] } }));
    await p.addInitScript(() => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_tab', 'check'); localStorage.setItem('ft_settings', JSON.stringify({ gmgnKey: 'k' })); sessionStorage.setItem('i', 1); });
    await p.goto(E2E.BASE + '/index.html');
    const check = async () => { await p.fill('#caInput', COIN); await p.click('#checkForm button[type=submit]'); await p.waitForFunction(() => checkState.holderLabels && checkState.holderLabels.s && checkState.early && checkState.early.s, null, { timeout: 8000 }); await p.waitForTimeout(300); };
    const isOpen = (k) => p.$eval(`[data-fold="${k}"]`, (d) => d.open);
    await check();
    // one row per block, headline in the row
    assert.match(await p.$eval('[data-fold="labels"] > summary', (s) => s.innerText.replace(/\s+/g, ' ')), /Holder labels \(GMGN\) 35\.0% risky/);
    assert.match(await p.$eval('[data-fold="early"] > summary', (s) => s.innerText.replace(/\s+/g, ' ')), /Early traders \(GMGN\) 3 of 10 sold/);
    assert.equal(await isOpen('labels'), true, 'a red-flag headline opens by itself');
    assert.equal(await isOpen('early'), false, 'a calm one stays folded');
    assert.equal(await p.$eval('[data-fold="labels"]', (d) => d.classList.contains('fold-bad')), true);
    // a tap is remembered across a re-render and a reload
    await p.click('[data-fold="early"] > summary');
    assert.equal(await isOpen('early'), true);
    await p.evaluate(() => renderCheck());
    assert.equal(await isOpen('early'), true, 'stays open when the card refreshes');
    // a tap inside a row you opened is not a profile link (the bug: rows were marked with data-user)
    const before = await p.evaluate(() => location.href);
    await p.click('[data-fold="early"] .early-table td');
    assert.equal(await p.evaluate(() => document.querySelector('.tab.active').id), 'check');
    assert.equal(await p.evaluate(() => location.href), before);
    assert.equal(await p.$('[data-fold][data-user]'), null, 'no data-user on fold rows');
    await p.click('[data-fold="labels"] > summary');
    await p.reload(); await check();
    assert.deepEqual([await isOpen('early'), await isOpen('labels')], [true, false], 'your choices beat the defaults after a reload');
    // Open all / Close all
    await p.click('#foldAllBtn');
    assert.deepEqual(await p.$$eval('#checkResult details[data-fold]', (ds) => ds.every((d) => d.open)), true);
    assert.equal(await p.$eval('#foldAllBtn', (x) => x.textContent), 'Close all');
    await p.click('#foldAllBtn');
    assert.deepEqual(await p.$$eval('#tokenCard details.fold:not(.fold-bad)', (ds) => ds.filter((d) => d.open).map((d) => d.dataset.fold)), []);
    // Plan & watch is one folded row with a summary
    assert.equal(await p.$eval('#planSection', (d) => d.open), false);
    assert.match(await p.$eval('#planSummary', (x) => x.textContent), /set targets and a stop/);
    await (await p.$('#tokenCard')).screenshot({ path: E2E.OUT + `/folds-${vp.name}.png` });
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
    assert.deepEqual(errs, []);
    await p.close();
  }
  await b.close();
  console.log('FOLDS E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
