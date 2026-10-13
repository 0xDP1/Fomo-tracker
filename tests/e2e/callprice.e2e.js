// docs/features/call-price.md: every Call queue and Recent calls coin shows the market cap at the call on its own line:
// the alert's price, else the candle at the call (Recent calls), else the first price seen, labelled with how late.
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const pad = (s) => (s + '1'.repeat(44)).slice(0, 44);
const ALRT = pad('AlertCoin'), HUMAN = pad('HumanPost'), LATE = pad('LateSeen');
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const mc = { [ALRT]: 150000, [HUMAN]: 80000, [LATE]: 1100000 };
  await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
  await p.route(/^https:\/\/(?!api\.dexscreener|cdnjs)/, (r) => r.abort());
  await p.route('https://api.dexscreener.com/**', (r) => { const list = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
    r.fulfill({ json: { pairs: list.filter((x) => mc[x]).map((x) => ({ chainId: 'solana', dexId: 'pumpswap', pairAddress: 'p' + x.slice(0, 5), url: 'https://dexscreener.com/x', baseToken: { symbol: x.slice(0, 5).toUpperCase(), name: 'x', address: x }, priceUsd: String(mc[x] / 1e9), marketCap: mc[x], fdv: mc[x], liquidity: { usd: 30000 }, volume: { h24: 90000, h1: 4000, m5: 300 }, priceChange: { m5: 1 }, txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 30, sells: 10 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: Date.now() - 2 * 3600e3 })) } }); });
  await p.addInitScript((d) => {
    if (sessionStorage.getItem('i')) return;
    const now = Date.now();
    const e = (address, symbol, ago, extra) => Object.assign({ address, chain: 'solana', symbol, mentions: 1, posters: ['alice'], channels: ['Man Cave'], sources: ['telegram'], firstPoster: 'alice', firstAt: now - ago, lastAt: now - ago }, extra);
    localStorage.clear();
    localStorage.setItem('ft_tab', 'calls');
    localStorage.setItem('ft_callView', JSON.stringify('all'));
    localStorage.setItem('ft_callMinLiq', JSON.stringify(0));
    localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-calls': true }));
    localStorage.setItem('ft_callQueue', JSON.stringify({ [d.ALRT]: e(d.ALRT, 'ALRT', 30 * 60000, { callMcap: 100000 }), [d.HUMAN]: e(d.HUMAN, 'HUMAN', 20 * 60000), [d.LATE]: e(d.LATE, 'LATE', 12 * 60000) }));
    // HUMAN's Recent calls record already has its price at the call from the candle at the call (bug 11)
    localStorage.setItem('ft_callTrack', JSON.stringify({ [d.HUMAN]: { at: now - 20 * 60000, symbol: 'HUMAN', chain: 'solana', base: 50000, baseAt: now - 20 * 60000, baseFrom: 'candles', last: null, lastAt: null, peak: 60000, peakAt: now - 15 * 60000, alerted: [], candlesAt: now } }));
    sessionStorage.setItem('i', 1);
  }, { ALRT, HUMAN, LATE });
  await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html');
  await p.waitForFunction(() => !callState.busy && Object.values(callState.queue).every((e) => e.dexAt), null, { timeout: 8000 });
  await p.evaluate(() => recentTick()); await p.waitForTimeout(200);
  await p.evaluate(() => renderCalls());
  const entry = (a) => p.$eval(`.call-row [data-call-ca="${a}"]`, (b) => { const r = b.closest('.call-row').querySelector('.call-entry'); return r ? r.innerText.replace(/\s+/g, ' ').trim() : ''; });
  const qa = await entry(ALRT), qh = await entry(HUMAN), ql = await entry(LATE);
  console.log({ qa, qh, ql });
  assert.match(qa, /^Called at \$100\.0k → now \$150\.0k \(\+50%, 1\.5×\)/, 'the alert\'s own price');
  assert.match(qh, /^Called at \$50\.0k → now \$80\.0k \(\+60%, 1\.6×\)/, 'a person\'s post: the candle at the call');
  assert.match(ql, /^First seen at \$1\.10M, 1[1-3] min after the call → now \$1\.10M \(\+0%, 1\.0×\)/, 'no price at the call: the first price seen, labelled');
  assert.equal(await p.$eval(`.call-row [data-call-ca="${ALRT}"]`, (b) => getComputedStyle(b.closest('.call-row').querySelector('.call-entry b')).fontWeight >= 600), true, 'bold');
  // Recent calls rows say the same
  const recent = await p.$$eval('.recent-call', (rs) => rs.map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
  assert.ok(recent.some((r) => /^HUMAN.* Called at \$50\.0k → now \$80\.0k \+60% · peak 1\.6×/.test(r)), recent.join('\n'));
  assert.ok(recent.some((r) => /^LATE.* First seen at \$1\.10M, 1[1-3] min after the call → now \$1\.10M \+0% · peak 1\.0×/.test(r)), recent.join('\n'));
  assert.ok(recent.some((r) => /^ALERT.* Called at \$100\.0k → now \$150\.0k \+50% · peak 1\.5×/.test(r)), recent.join('\n'));
  assert.deepEqual(errs, []);
  await b.close();
  console.log('CALL PRICE E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
