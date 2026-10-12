// Bug (2026-10-12): Calls-tab coins on BNB, Ethereum or Robinhood Chain had no FOMO or GMGN button. Coins from alert
// bots use the bot's snapshot instead of a DexScreener lookup, and a 0x address only says "evm", not which chain, so
// the links had no chain to point at. The real chain now comes from one DexScreener lookup.
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const BNB = '0x' + 'b1'.repeat(20);
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
  await p.route(/^https:\/\/(?!api\.dexscreener|cdnjs)/, (r) => r.abort());
  await p.route('https://api.dexscreener.com/**', (r) => { const list = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
    r.fulfill({ json: { pairs: list.filter((x) => x.toLowerCase() === BNB).map((x) => ({ chainId: 'bsc', dexId: 'pancakeswap', pairAddress: '0xpool', url: 'https://dexscreener.com/bsc/0xpool', baseToken: { symbol: 'BNBCOIN', name: 'x', address: x }, priceUsd: '0.001', marketCap: 150000, fdv: 150000, liquidity: { usd: 30000 }, volume: { h24: 90000 }, priceChange: {}, txns: { h1: { buys: 30, sells: 10 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: Date.now() - 3 * 3600e3 })) } }); });
  await p.addInitScript((d) => {
    if (sessionStorage.getItem('i')) return;
    const now = Date.now();
    // A coin from an alert bot: its snapshot (age, market cap, liquidity) stands in for DexScreener, chain only "evm".
    const e = { address: d.BNB, chain: 'evm', symbol: 'BNBCOIN', mentions: 1, posters: ['alice'], channels: ['first scan'], firstPoster: 'alice', firstAt: now - 10 * 60000, lastAt: now - 10 * 60000, callMcap: 100000,
      snap: { ageMs: 3600e3, fdv: 150000, liq: 30000, priceUsd: 0.001, holders: 400, top5Pct: 18 }, snapAt: now - 60000 };
    localStorage.clear();
    localStorage.setItem('ft_tab', 'calls');
    localStorage.setItem('ft_callView', JSON.stringify('all'));
    localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-calls': true }));
    localStorage.setItem('ft_callQueue', JSON.stringify({ [d.BNB]: e }));
    sessionStorage.setItem('i', 1);
  }, { BNB });
  await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html');
  await p.waitForFunction(() => !callState.busy && Object.values(callState.queue).every((e) => e.dexAt), null, { timeout: 8000 });
  await p.waitForTimeout(300);
  await p.evaluate(() => recentTick()); await p.waitForTimeout(300);
  const links = (sel) => p.$$eval(sel, (rows) => rows.map((r) => [...r.querySelectorAll('a.btn')].map((a) => [a.textContent.trim(), a.getAttribute('href')])));
  const queue = await links('#callsCard .call-row');
  const recent = await links('.recent-call');
  console.log(JSON.stringify({ queue, recent }));
  for (const [where, rows] of [['queue', queue], ['recent', recent]]) {
    assert.equal(rows.length, 1, where + ': one row');
    const l = Object.fromEntries(rows[0]);
    assert.equal(l.FOMO, `https://fomo.family/tokens/bnb/${BNB}`, where + ': FOMO link for the BNB coin');
    assert.equal(l.GMGN, `https://gmgn.ai/bsc/token/${BNB}`, where + ': GMGN link for the BNB coin');
  }
  assert.match(await p.$eval('#callsCard .call-row', (e) => e.innerText), /BNB/, 'the chain tag names BNB');
  assert.equal(await p.evaluate((a) => callState.queue[a].snapUsed != null, BNB), true, 'the alert snapshot is still used for the numbers');
  assert.deepEqual(errs, []);
  await b.close();
  console.log('EVM links E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
