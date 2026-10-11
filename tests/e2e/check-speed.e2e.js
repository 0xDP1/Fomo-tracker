const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
// A source that never answers must not hold up the Check result: TrenchBot hangs, the card still shows within
// seconds with RugCheck's data, and the source line says TrenchBot timed out. (Bug: getJson had no timeout and
// the result waited for TrenchBot, which stopped answering in October 2026.)
const COIN = '8vYJgiQPkpDtbWkDy1wyYDcUq3D9fUXVJUtt6aNEpump';
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
  await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|trench\.bot|cdnjs)/, (r) => r.abort());
  await p.route('https://trench.bot/**', () => {}); // never answers
  await p.route('https://api.dexscreener.com/**', (r) => r.fulfill({ json: { pairs: [{ chainId: 'solana', dexId: 'raydium', pairAddress: 'pp', url: 'https://dexscreener.com/x', baseToken: { symbol: 'SLOW', name: 'x', address: COIN }, priceUsd: '0.001', marketCap: 300000, liquidity: { usd: 40000 }, volume: { h24: 90000, h1: 5000, m5: 500 }, priceChange: { m5: 1 }, txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 30, sells: 10 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: Date.now() - 2 * 3600e3 }] } }));
  await p.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { creator: 'Dev', token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 900, topHolders: [{ address: 'H1', owner: 'HO1', pct: 3 }], markets: [] } }));
  await p.addInitScript(() => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_tab', 'check'); sessionStorage.setItem('i', 1); });
  await p.goto(E2E.BASE + '/index.html');
  const t0 = Date.now();
  await p.fill('#caInput', COIN);
  await p.click('#checkForm button[type=submit]');
  await p.waitForSelector('#checkResult:not([hidden])', { timeout: 10000 });
  const took = Date.now() - t0;
  assert.ok(took < 10000, `result took ${took} ms`);
  assert.match(await p.$eval('#tokenCard', (el) => el.innerText), /SLOW/);
  assert.equal(await p.evaluate(() => checkState.sources.security), 'RugCheck', 'RugCheck data is used');
  assert.match(await p.evaluate(() => checkState.sources.bundleNote || ''), /TrenchBot timed out/);
  assert.deepEqual(errs, []);
  await b.close();
  console.log(`check-speed ok (${took} ms)`);
})().catch((e) => { console.error(e); process.exit(1); });
