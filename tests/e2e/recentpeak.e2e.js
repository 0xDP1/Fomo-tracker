// Bug (2026-10-12): Recent calls' peak only came from the once-a-minute reads while the app was open, so a pump while
// the phone was locked never showed. The peak now comes from GeckoTerminal's candle highs since the call.
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const pad = (s) => (s + '1'.repeat(44)).slice(0, 44);
const A = pad('Pumped');
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const gecko = [];
  await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
  await p.route(/^https:\/\/(?!api\.dexscreener|api\.geckoterminal|cdnjs)/, (r) => r.abort());
  await p.route('https://api.dexscreener.com/**', (r) => { const list = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
    r.fulfill({ json: { pairs: list.filter((x) => x === A).map((x) => ({ chainId: 'solana', dexId: 'pumpswap', pairAddress: 'PoolPumped', url: 'https://dexscreener.com/x', baseToken: { symbol: 'PUMPED', name: 'x', address: x }, priceUsd: '0.00012', marketCap: 120000, fdv: 120000, liquidity: { usd: 30000 }, volume: { h24: 90000 }, priceChange: {}, txns: { h1: { buys: 30, sells: 10 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: Date.now() - 3 * 3600e3 })) } }); });
  await p.route('https://api.geckoterminal.com/**', (r) => {
    gecko.push(new URL(r.request().url()).pathname);
    const now = Math.floor(Date.now() / 1000);
    // ran to $0.0003 (3× the $100k call) 20 minutes ago while the app was closed, back to $0.00012 now
    r.fulfill({ json: { data: { attributes: { ohlcv_list: [[now - 300, 0.00012, 0.00013, 0.00012, 0.00012, 1], [now - 1200, 0.0001, 0.0003, 0.0001, 0.00025, 1], [now - 3600, 0.0001, 0.0001, 0.0001, 0.0001, 1]] } } } });
  });
  await p.addInitScript((d) => {
    if (sessionStorage.getItem('i')) return;
    const now = Date.now();
    localStorage.clear();
    localStorage.setItem('ft_tab', 'calls');
    localStorage.setItem('ft_callView', JSON.stringify('all'));
    localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-calls': true }));
    localStorage.setItem('ft_callQueue', JSON.stringify({ [d.A]: { address: d.A, chain: 'solana', symbol: 'PUMPED', mentions: 1, posters: ['alice'], channels: ['Man Cave'], firstPoster: 'alice', firstAt: now - 40 * 60000, lastAt: now - 40 * 60000, callMcap: 100000 } }));
    sessionStorage.setItem('i', 1);
  }, { A });
  await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html');
  await p.waitForFunction(() => !callState.busy && Object.values(callState.queue).every((e) => e.dexAt), null, { timeout: 8000 });
  await p.evaluate(() => recentTick()); await p.waitForTimeout(300);
  const row = await p.$eval('.recent-call', (r) => r.innerText.replace(/\s+/g, ' ').trim());
  console.log('row:', row, '| gecko:', gecko.join(' '));
  assert.match(row, /Called at \$100\.0k → now \$120\.0k \+20% · peak 3\.0×/, 'the pump while away shows as the peak');
  assert.ok(gecko.some((x) => x === '/api/v2/networks/solana/pools/PoolPumped/ohlcv/minute'), 'candles read for the coin\'s pool');
  const alert = await p.$eval('#callAlert', (e) => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
  assert.match(alert, /PUMPED reached 2× since the call while you were away \(3\.0×\)/, alert);
  // read again within 10 minutes: no new candle request for the same coin
  const before = gecko.length;
  await p.evaluate(() => recentTick()); await p.waitForTimeout(200);
  assert.equal(gecko.length, before, 'candles for a coin are read at most every 10 minutes');
  assert.deepEqual(errs, []);
  await b.close();
  console.log('Recent peak E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
