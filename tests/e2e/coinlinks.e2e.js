// FOMO and GMGN buttons on Calls-tab coins (docs/features/coin-links.md): Call queue and Recent calls rows link to the
// coin's fomo.family and gmgn.ai pages; a chain GMGN doesn't trade gets no GMGN button.
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const pad = (s) => (s + '1'.repeat(44)).slice(0, 44);
const SOL = pad('SoCoin');
const MON = '0x' + 'ab'.repeat(20);
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
  await p.route(/^https:\/\/(?!api\.dexscreener|cdnjs)/, (r) => r.abort());
  await p.route('https://api.dexscreener.com/**', (r) => { const list = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
    r.fulfill({ json: { pairs: list.filter((x) => x === SOL || x.toLowerCase() === MON).map((x) => ({ chainId: x === SOL ? 'solana' : 'monad', dexId: 'pumpswap', pairAddress: 'p' + x.slice(0, 5), url: 'https://dexscreener.com/x', baseToken: { symbol: x === SOL ? 'SOCOIN' : 'MONCO', name: 'x', address: x }, priceUsd: '0.001', marketCap: 150000, fdv: 150000, liquidity: { usd: 30000 }, volume: { h24: 90000 }, priceChange: {}, txns: { h1: { buys: 30, sells: 10 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: Date.now() - 3 * 3600e3 })) } }); });
  await p.addInitScript((d) => {
    if (sessionStorage.getItem('i')) return;
    const now = Date.now();
    const e = (address, chain, symbol, ago) => ({ address, chain, symbol, mentions: 1, posters: ['alice'], channels: ['Man Cave'], firstPoster: 'alice', firstAt: now - ago, lastAt: now - ago, callMcap: 100000 });
    localStorage.clear();
    localStorage.setItem('ft_tab', 'calls');
    localStorage.setItem('ft_settings', JSON.stringify({ lookupKey: 'fapi_test' })); // a FOMO key: the FOMO buttons show next to GMGN (docs/features/gmgn-home.md)
    localStorage.setItem('ft_callView', JSON.stringify('all'));
    localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-calls': true }));
    localStorage.setItem('ft_callQueue', JSON.stringify({ [d.SOL]: e(d.SOL, 'solana', 'SOCOIN', 20 * 60000), [d.MON]: e(d.MON, 'monad', 'MONCO', 10 * 60000) }));
    sessionStorage.setItem('i', 1);
  }, { SOL, MON });
  await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html');
  await p.waitForFunction(() => !callState.busy && Object.values(callState.queue).every((e) => e.dexAt), null, { timeout: 8000 });
  await p.evaluate(() => recentTick()); await p.waitForTimeout(200);
  const links = (sel) => p.$$eval(sel, (rows) => rows.map((r) => ({ text: r.innerText.replace(/\s+/g, ' '), links: [...r.querySelectorAll('a.btn')].map((a) => [a.textContent.trim(), a.getAttribute('href'), a.target]) })));
  const queue = await links('#callsCard .call-row');
  const recent = await links('.recent-call');
  console.log(JSON.stringify({ queue, recent }, null, 1).slice(0, 1500));
  for (const [where, rows] of [['queue', queue], ['recent', recent]]) {
    const sol = rows.find((r) => /SOCOIN/.test(r.text)), mon = rows.find((r) => /MONCO/.test(r.text));
    assert.ok(sol && mon, where + ': both coins listed');
    const solLinks = Object.fromEntries(sol.links.map(([t, h, tg]) => [t, [h, tg]]));
    assert.deepEqual(solLinks.GMGN, [`https://gmgn.ai/sol/token/${SOL}`, '_blank'], where + ': GMGN link');
    assert.ok(solLinks.FOMO && /fomo\.family/.test(solLinks.FOMO[0]) && solLinks.FOMO[1] === '_blank', where + ': FOMO link ' + JSON.stringify(solLinks));
    assert.ok(mon.links.some(([t]) => t === 'FOMO'), where + ': FOMO trades Monad');
    assert.ok(!mon.links.some(([t]) => t === 'GMGN'), where + ': GMGN does not trade Monad, so no button');
  }
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
  await (await p.$('[data-sec="recent"]')).screenshot({ path: E2E.OUT + '/coin-links.png' });
  assert.deepEqual(errs, []);
  await b.close();
  console.log('Coin links E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
