const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
// Recent calls: the last calls listed whatever the filters (with why a coin is hidden from the queue), the market cap at
// the call, now and the peak; an alert banner when a call first reaches 2×; the win-rate stat line; and calls older than
// 3 days kept while they are among the last 50; and a DexScreener request that never answers doesn't stop the updates.
const pad = (s) => (s + '1'.repeat(44)).slice(0, 44);
const A = pad('OldLaunch'), B = pad('Runner'), C = pad('Flat');
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const mc = { [A]: 150000, [B]: 100000, [C]: 80000 };
  const launched = { [A]: Date.now() - 30 * 3600e3, [B]: Date.now() - 3 * 3600e3, [C]: Date.now() - 2 * 3600e3 };
  await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
  await p.route(/^https:\/\/(?!api\.dexscreener|cdnjs)/, (r) => r.abort());
  let hang = false;
  await p.route('https://api.dexscreener.com/**', (r) => { if (hang) return; const list = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
    r.fulfill({ json: { pairs: list.filter((x) => mc[x]).map((x) => ({ chainId: 'solana', dexId: 'pumpswap', pairAddress: 'p' + x.slice(0, 5), url: 'https://dexscreener.com/x', baseToken: { symbol: x.slice(0, 6).toUpperCase(), name: 'x', address: x }, priceUsd: String(mc[x] / 1e9), marketCap: mc[x], fdv: mc[x], liquidity: { usd: 30000 }, volume: { h24: 90000, h1: 4000, m5: 300 }, priceChange: { m5: 1 }, txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 30, sells: 10 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: launched[x] })) } }); });
  await p.addInitScript((d) => {
    if (sessionStorage.getItem('i')) return;
    const now = Date.now();
    const e = (address, symbol, ago, extra) => Object.assign({ address, chain: 'solana', symbol, mentions: 1, posters: ['alice'], channels: ['Man Cave'], sources: ['telegram'], firstPoster: 'alice', firstAt: now - ago, lastAt: now - ago }, extra);
    localStorage.clear();
    localStorage.setItem('ft_tab', 'calls');
    localStorage.setItem('ft_callView', JSON.stringify('all'));
    localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-calls': true }));
    localStorage.setItem('ft_callQueue', JSON.stringify({ [d.A]: e(d.A, 'OLDLA', 50 * 60000, { callMcap: 100000 }), [d.B]: e(d.B, 'RUNNER', 20 * 60000), [d.C]: e(d.C, 'FLAT', 10 * 60000, { channels: ['first scan'], sources: ['discord'], firstPoster: 'bob', posters: ['bob'] }) }));
    sessionStorage.setItem('i', 1);
  }, { A, B, C });
  await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html');
  await p.waitForFunction(() => !callState.busy && Object.values(callState.queue).every((e) => e.dexAt), null, { timeout: 8000 });
  await p.evaluate(() => recentTick());
  const recent = () => p.$$eval('.recent-call', (rs) => rs.map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
  let rows = await recent();
  assert.equal(rows.length, 3, 'all three calls listed');
  assert.match(rows[0], /^FLAT11 called \d+m ago in first scan · bob First seen at \$80\.0k, \d+ min after the call → now \$80\.0k \+0% · peak 1\.0×/, 'newest first');
  assert.match(rows[2], /^OLDLAU called \d+m ago in Man Cave · alice Called at \$100\.0k → now \$150\.0k \+50% · peak 1\.5× hidden: launched over 24h ago/, rows[2]);
  assert.doesNotMatch(rows[1], /hidden/, 'RUNNER is in the queue list');
  // RUNNER doubles: an alert, once
  mc[B] = 220000;
  await p.evaluate(() => recentTick());
  assert.match(await p.$eval('#callAlert', (e) => e.innerText.replace(/\s+/g, ' ')), /🚀 RUNNER is up 2× since the call \(2\.2×\)/);
  await (await p.$('#callAlert')).screenshot({ path: E2E.OUT + '/recent-alert.png' });
  await p.evaluate(() => recentTick());
  assert.equal(await p.$$eval('#callAlert .call-alert-row', (r) => r.length), 1, 'not alerted twice');
  // a DexScreener request that never answers (phone backgrounded, signal lost) must not freeze the list for good
  hang = true;
  p.evaluate(() => recentTick()).catch(() => {});
  await p.waitForTimeout(300);
  hang = false; mc[B] = 300000;
  await p.waitForFunction(() => !recentState.busy, null, { timeout: 20000 });
  await p.evaluate(() => recentTick());
  assert.match((await recent()).find((r) => /^RUNNER/.test(r)), /First seen at \$100\.0k, \d+ min after the call → now \$300\.0k \+200% · peak 3\.0×/, 'prices update again after a hung request');
  mc[B] = 220000; await p.evaluate(() => recentTick());
  // the stat line: OLDLA 1.5× and RUNNER (peak 3.0×) won, FLAT didn't
  const stats = await p.$eval('.calls-stats', (e) => e.innerText.replace(/\s+/g, ' ').trim());
  assert.match(stats, /Last 3 calls: 67% won \(reached 1\.5×, of 3 priced\) · 1 hit 2× · best \+200% \(RUNNER\) · median peak \+50%/, stats);
  await (await p.$('.calls-stats')).screenshot({ path: E2E.OUT + '/recent-stats.png' });
  // the last 50 stay past the 3-day cleanup
  await p.evaluate((a) => { callState.queue[a] = Object.assign({}, callState.queue[a], { lastAt: Date.now() - 4 * 86400e3 }); saveCalls(); }, A);
  assert.equal(await p.evaluate((a) => !!callState.queue[a], A), true, 'kept: still among the last 50');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
  assert.deepEqual(errs, []);
  await b.close();
  console.log('RECENT CALLS E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
