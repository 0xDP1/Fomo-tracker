// docs/features/move-alerts.md: a recent call at $40k that moved +45% in 5 minutes with $12k traded shows a 🚀 alert;
// a $3k coin moving the same way stays quiet (the $10k floor).
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const pad = (s) => (s + '1'.repeat(44)).slice(0, 44);
const A = pad('Mover'), D = pad('Dead');
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const mc = { [A]: 40000, [D]: 3200 };
  await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
  await p.route(/^https:\/\/(?!api\.dexscreener|api\.geckoterminal|cdnjs)/, (r) => r.abort());
  await p.route('https://api.dexscreener.com/**', (r) => { const list = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
    r.fulfill({ json: { pairs: list.filter((x) => mc[x]).map((x) => ({ chainId: 'solana', dexId: 'pumpswap', pairAddress: 'P' + x.slice(0, 5), url: 'https://dexscreener.com/x', baseToken: { symbol: x === A ? 'MOVER' : 'DEAD', name: 'x', address: x }, priceUsd: String(mc[x] / 1e9), marketCap: mc[x], fdv: mc[x], liquidity: { usd: 20000 }, volume: { m5: 12000, h1: 30000, h24: 90000 }, priceChange: { m5: 45 }, txns: { m5: { buys: 40, sells: 10 }, h1: { buys: 90, sells: 40 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: Date.now() - 3600e3 })) } }); });
  await p.route('https://api.geckoterminal.com/**', (r) => r.fulfill({ json: { data: { attributes: { ohlcv_list: [] } } } }));
  await p.addInitScript((d) => {
    if (sessionStorage.getItem('i')) return;
    const now = Date.now();
    const e = (a, sym, mcap) => ({ address: a, chain: 'solana', symbol: sym, mentions: 1, posters: ['alice'], channels: ['Man Cave'], firstPoster: 'alice', firstAt: now - 20 * 60000, lastAt: now - 20 * 60000, callMcap: mcap });
    localStorage.clear();
    localStorage.setItem('ft_tab', 'calls');
    localStorage.setItem('ft_callView', JSON.stringify('all'));
    localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-calls': true }));
    localStorage.setItem('ft_callQueue', JSON.stringify({ [d.A]: e(d.A, 'MOVER', 30000), [d.D]: e(d.D, 'DEAD', 2500) }));
    sessionStorage.setItem('i', 1);
  }, { A, D });
  await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html');
  await p.waitForFunction(() => !callState.busy && Object.values(callState.queue).every((e) => e.dexAt), null, { timeout: 8000 });
  await p.evaluate(() => recentTick()); await p.waitForTimeout(300);
  const alert = await p.$eval('#callAlert', (e) => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
  console.log('alert:', alert);
  assert.match(alert, /MOVER moving: \+45% in 5 min, \$12\.0k traded/, alert);
  assert.doesNotMatch(alert, /DEAD/, 'a $3.2k coin never alerts');
  // the next minute: no second alert for the same move
  await p.evaluate(() => { recentState.alerts = []; return recentTick(); }); await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => recentState.alerts.length), 0, 'one move alert per coin per 30 minutes');
  assert.deepEqual(errs, []);
  await b.close();
  console.log('Move alerts E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
