// docs/features/trench-index.md: the Market pulse card shows tehcscreener's daily trench index the way tehcscreener does
// (gauge with the score and band, hottest chain / launchpad / trading terminal boxes, a year chart with the bands) and the
// top launchpads; when the site doesn't answer the card works without them.
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const TRENCH = { today: { day: '2026-10-11', score: 47, band: 'active', components: { pad_volume: { percentile: 28 }, tokens_launched: { percentile: 71 }, bot_volume: { percentile: 42 }, bot_fees: { percentile: 28 } } }, history: Array.from({ length: 35 }, (_, i) => ({ day: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, score: 40 + (i % 10) })) };
const CHAINS = { chains: [{ chain: 'base', display_name: 'Base', latest: { dex_volume_usd: 1.1e9 } }, { chain: 'solana', display_name: 'Solana', latest: { dex_volume_usd: 4e9 } }, { chain: 'robinhood', display_name: 'Robinhood', latest: { dex_volume_usd: 2e8 } }] };
const BOTS = { days: ['2026-10-11'], series: [{ name: 'fomo', display_name: 'fomo', volume_usd: [85e6] }, { name: 'axiom', display_name: 'Axiom', volume_usd: [104e6] }, { name: 'gmgn', display_name: 'GMGN', volume_usd: [40e6] }] };
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
      const p = u.pathname;
      return r.fulfill({ json: p.endsWith('/trench') ? TRENCH : p.endsWith('/chains') ? CHAINS : p.endsWith('/bots') ? BOTS : PADS });
    });
    await p.addInitScript(() => { if (sessionStorage.getItem('init')) return; localStorage.clear(); localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-market': true })); localStorage.setItem('ft_tab', 'dashboard'); sessionStorage.setItem('init', 1); });
    await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(800);
    const card = await p.$eval('#marketCard', (e) => e.innerText.replace(/\s+/g, ' ').trim());
    console.log(up ? 'up:' : 'down:', card.slice(0, 400));
    assert.deepEqual(hits.sort(), ['/api/v1/bots?window=1d', '/api/v1/chains', '/api/v1/launchpads?window=1d', '/api/v1/trench']);
    if (up) {
      assert.match(card, /2026-10-11 · launchpad volume 28th pct · new launches 71st pct · bot volume 42nd pct · bot fees 28th pct/);
      assert.match(await p.$eval('#marketSummary', (e) => e.textContent), /Trenches 47$/, 'the folded summary shows the trench score');
      assert.match(card, /Top launchpads 2026-10-11: pumpfun solana \$326\.17M · ponsfamily robinhood \$30\.88M · stonkfun solana \$18\.43M/);
      // the gauge: big score, band, needle at 47 (−5.4° from straight up)
      assert.equal(await p.$eval('.trench-score', (e) => e.textContent), '47');
      assert.equal(await p.$eval('.trench-band', (e) => e.textContent), 'active');
      assert.match(await p.$eval('.trench-needle', (e) => e.getAttribute('transform')), /^rotate\(-5\.4 /);
      assert.equal(await p.$$eval('.trench-gauge .gauge-seg', (e) => e.length), 5, 'five bands on the gauge');
      // the hottest boxes
      const boxes = await p.$$eval('.trench-boxes .trench-box', (bs) => bs.map((b) => b.innerText.replace(/\s+/g, ' ').trim()));
      assert.deepEqual(boxes, ['chain stats hottest: Solana tracked: 3', 'launchpad war hottest: pumpfun tracked: 4', 'trading terminals hottest: Axiom tracked: 3 · FOMO #2']);
      // the year chart: one line over all 35 days, band labels on the right
      assert.equal(await p.$$eval('.trench-year polyline', (e) => e.length), 1);
      assert.equal(await p.$eval('.trench-year polyline', (e) => e.getAttribute('points').trim().split(' ').length), 35);
      assert.deepEqual(await p.$$eval('.trench-year .band-label', (e) => e.map((x) => x.textContent)), ['euphoric', 'hot', 'active', 'cold', 'ded']);
      assert.equal(await p.evaluate(() => trenchContext()), 'Trench index (tehcscreener, daily, 2026-10-11): 47/100, active; launchpad volume 28th percentile, new launches 71st, bot volume 42nd.');
      // read once: a refresh within 3 hours doesn't ask again
      await p.evaluate(() => refreshTrench()); assert.equal(hits.length, 4);
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
