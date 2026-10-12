const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
// Group tags: each Call queue and Recent calls row names the Telegram group that posted the coin, in that group's
// colour (Man Cave, Rob's Thoughts, both); an entry saved before groups were kept (v75) gets its group from its channel;
// a Discord coin gets no group tag; and the 🚀 alert names the group.
const pad = (s) => (s + '1'.repeat(44)).slice(0, 44);
const MC = pad('ManCave'), RT = pad('Robs'), BOTH = pad('Both'), OLD = pad('Older'), DC = pad('Discord');
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const mc = { [MC]: 100000, [RT]: 100000, [BOTH]: 100000, [OLD]: 100000, [DC]: 100000 };
  await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
  await p.route(/^https:\/\/(?!api\.dexscreener|cdnjs)/, (r) => r.abort());
  await p.route('https://api.dexscreener.com/**', (r) => { const list = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
    r.fulfill({ json: { pairs: list.filter((x) => mc[x]).map((x) => ({ chainId: 'solana', dexId: 'pumpswap', pairAddress: 'p' + x.slice(0, 5), url: 'https://dexscreener.com/x', baseToken: { symbol: x.slice(0, 6).toUpperCase(), name: 'x', address: x }, priceUsd: String(mc[x] / 1e9), marketCap: mc[x], fdv: mc[x], liquidity: { usd: 30000 }, volume: { h24: 90000, h1: 4000, m5: 300 }, priceChange: { m5: 1 }, txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 30, sells: 10 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: Date.now() - 2 * 3600e3 })) } }); });
  await p.addInitScript((d) => {
    if (sessionStorage.getItem('i')) return;
    const now = Date.now();
    const e = (address, symbol, ago, groups, extra) => Object.assign({ address, chain: 'solana', symbol, mentions: groups.length || 1, posters: ['alice'], channels: groups.slice(), sources: ['telegram'], groups, firstPoster: 'alice', firstAt: now - ago, lastAt: now - ago, callMcap: 100000 }, extra);
    localStorage.clear();
    localStorage.setItem('ft_tab', 'calls');
    localStorage.setItem('ft_callView', JSON.stringify('all'));
    localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-calls': true }));
    localStorage.setItem('ft_tgLabels', JSON.stringify(['The Man Cave', 'Rob’s Thoughts']));
    localStorage.setItem('ft_callQueue', JSON.stringify({
      [d.MC]: e(d.MC, 'MANCAV', 50 * 60000, ['The Man Cave']),
      [d.RT]: e(d.RT, 'ROBS11', 40 * 60000, ['Rob’s Thoughts']),
      [d.BOTH]: e(d.BOTH, 'BOTH11', 30 * 60000, ['The Man Cave', 'Rob’s Thoughts']),
      [d.OLD]: e(d.OLD, 'OLDER1', 20 * 60000, [], { groups: undefined, channels: ['Rob’s Thoughts'] }), // saved before v75
      [d.DC]: e(d.DC, 'DISCOR', 10 * 60000, [], { channels: ['first scan'], sources: ['discord'] }),
    }));
    sessionStorage.setItem('i', 1);
  }, { MC, RT, BOTH, OLD, DC });
  await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html');
  await p.waitForFunction(() => !callState.busy && Object.values(callState.queue).every((e) => e.dexAt), null, { timeout: 8000 });
  await p.evaluate(() => recentTick());
  // Call queue rows: tag text and colour class per group
  const tags = (sel, sym) => p.$$eval(sel, (rows, s) => { const r = rows.find((x) => x.innerText.includes(s)); return r ? [...r.querySelectorAll('.tag.grp')].map((t) => t.textContent + '|' + [...t.classList].find((c) => /^grp-\d$/.test(c))) : null; }, sym);
  assert.deepEqual(await tags('.call-row', 'MANCAV'), ['Man Cave|grp-0']);
  assert.deepEqual(await tags('.call-row', 'ROBS11'), ['Rob’s Thoughts|grp-1']);
  assert.deepEqual(await tags('.call-row', 'BOTH11'), ['Man Cave|grp-0', 'Rob’s Thoughts|grp-1'], 'posted in both groups: both tags');
  assert.deepEqual(await tags('.call-row', 'OLDER1'), ['Rob’s Thoughts|grp-1'], 'an older entry gets its group from its channel');
  assert.deepEqual(await tags('.call-row', 'DISCOR'), [], 'a Discord coin has no group tag');
  assert.equal(await p.$$eval('.call-row .tag.src-tg', (t) => t.length), 0, 'no plain Telegram tag when the group is known');
  // Recent calls rows carry the same tags
  assert.deepEqual(await tags('.recent-call', 'BOTH11'), ['Man Cave|grp-0', 'Rob’s Thoughts|grp-1']);
  assert.deepEqual(await tags('.recent-call', 'MANCAV'), ['Man Cave|grp-0']);
  // the 🚀 alert names the group
  mc[MC] = 220000;
  await p.evaluate(() => recentTick());
  assert.match(await p.$eval('#callAlert', (e) => e.innerText.replace(/\s+/g, ' ')), /🚀 MANCAV is up 2× since the call \(2\.2×\) · Man Cave/);
  await (await p.$('#calls')).screenshot({ path: E2E.OUT + '/grouptags.png' }).catch(() => {});
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
  assert.deepEqual(errs, []);
  await b.close();
  console.log('GROUP TAGS E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
