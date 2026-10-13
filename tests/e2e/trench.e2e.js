// docs/features/trench-index.md: the Market pulse card shows tehcscreener's daily trench index, a 30-day sparkline and
// the top launchpads; when the site doesn't answer the card works without them.
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const TRENCH = { today: { day: '2026-10-11', score: 47, band: 'active', components: { pad_volume: { percentile: 28 }, tokens_launched: { percentile: 71 }, bot_volume: { percentile: 42 }, bot_fees: { percentile: 28 } } }, history: Array.from({ length: 35 }, (_, i) => ({ day: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, score: 40 + (i % 10) })) };
const PADS = { pads: [{ chain: 'solana', pad: 'pumpfun', display_name: 'pumpfun', tokens_launched: 42857, volume_usd: 326171463 }, { chain: 'solana', pad: 'stonkfun', display_name: 'stonkfun', tokens_launched: 522, volume_usd: 18430673 }, { chain: 'robinhood', pad: 'ponsfamily.com', display_name: 'ponsfamily', tokens_launched: 1725, volume_usd: 30880810 }, { chain: 'bnb', pad: 'four', display_name: 'four.meme', tokens_launched: 9, volume_usd: 1000 }] };
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const up of [true, false]) {
    const p = await b.newPage({ viewport: { width: 390, height: 844 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    const hits = [];
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!tehcscreener|cdnjs)/, (r) => r.abort());
    await p.route('https://tehcscreener.com/**', (r) => {
      const u = new URL(r.request().url()); hits.push(u.pathname + u.search);
      if (!up) return r.fulfill({ status: 503, json: { detail: 'down' } });
      return r.fulfill({ json: u.pathname.endsWith('/trench') ? TRENCH : PADS });
    });
    await p.addInitScript(() => { if (sessionStorage.getItem('init')) return; localStorage.clear(); localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-market': true })); localStorage.setItem('ft_tab', 'calls'); sessionStorage.setItem('init', 1); });
    await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(800);
    const card = await p.$eval('#marketCard', (e) => e.innerText.replace(/\s+/g, ' ').trim());
    console.log(up ? 'up:' : 'down:', card.slice(0, 400));
    assert.deepEqual(hits.sort(), ['/api/v1/launchpads?window=1d', '/api/v1/trench']);
    if (up) {
      assert.match(card, /Trenches 47 · active 2026-10-11 · launchpad volume 28th pct · new launches 71st pct · bot volume 42nd pct · bot fees 28th pct/);
      assert.match(card, /Top launchpads 2026-10-11: pumpfun solana \$326\.17M · ponsfamily robinhood \$30\.88M · stonkfun solana \$18\.43M/);
      assert.equal(await p.$$eval('.trench-spark rect', (r) => r.length), 30, '30 days on the sparkline');
      assert.equal(await p.evaluate(() => trenchContext()), 'Trench index (tehcscreener, daily, 2026-10-11): 47/100, active; launchpad volume 28th percentile, new launches 71st, bot volume 42nd.');
      // read once: a refresh within 3 hours doesn't ask again
      await p.evaluate(() => refreshTrench()); assert.equal(hits.length, 2);
    } else {
      assert.doesNotMatch(card, /Trenches/);
      assert.equal(await p.evaluate(() => trenchContext()), null);
    }
    assert.deepEqual(errs, []);
    await p.close();
  }
  await b.close();
  console.log('Trench index E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
