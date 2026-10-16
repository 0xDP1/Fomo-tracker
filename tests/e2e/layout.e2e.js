// v92 phone layout: every tab label fully visible at 390px, thumb-sized mini buttons, one action line per Call queue
// row with Check first, the filters in a grid with the Pause box next to its label, readable tags, no sideways scroll.
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const pad = (s) => (s + '1'.repeat(44)).slice(0, 44);
const COIN = pad('LayoutCoin');
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 375, height: 812, name: 'small' }, { width: 390, height: 844, name: 'phone' }]) {
    const p = await b.newPage({ viewport: vp });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!api\.dexscreener|cdnjs)/, (r) => r.abort());
    await p.route('https://api.dexscreener.com/**', (r) => r.fulfill({ json: { pairs: [{ chainId: 'solana', dexId: 'pumpswap', pairAddress: 'pLay', url: 'https://dexscreener.com/x', baseToken: { symbol: 'LAYOUT', name: 'x', address: COIN }, priceUsd: '0.0003', marketCap: 300000, fdv: 300000, liquidity: { usd: 40000 }, volume: { h24: 90000, h1: 5000, m5: 500 }, priceChange: { m5: 1 }, txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 30, sells: 10 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: Date.now() - 3600e3 }] } }));
    await p.addInitScript((coin) => {
      if (sessionStorage.getItem('i')) return;
      const t = Date.now();
      localStorage.clear();
      localStorage.setItem('ft_tab', 'calls');
      localStorage.setItem('ft_settings', JSON.stringify({ gmgnKey: 'gk', feedUrl: 'https://feed.example', feedKey: 'k' }));
      localStorage.setItem('ft_callView', JSON.stringify('all'));
      localStorage.setItem('ft_callMinLiq', JSON.stringify(0));
      localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-calls': true }));
      localStorage.setItem('ft_callQueue', JSON.stringify({ [coin]: { address: coin, chain: 'solana', symbol: 'LAYOUT', mentions: 1, posters: ['alice'], channels: ['Man Cave'], sources: ['telegram'], firstPoster: 'alice', firstAt: t - 600000, lastAt: t - 600000, verdict: 'Walk away', top: 'One whale who is the chart' } }));
      sessionStorage.setItem('i', 1);
    }, COIN);
    await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html');
    await p.waitForFunction(() => !callState.busy && Object.values(callState.queue).every((e) => e.dexAt), null, { timeout: 10000 });
    await p.evaluate(() => renderCalls());
    // tabs: seven labels, each drawn in full
    const tabs = await p.$$eval('#tabs button', (bs) => bs.map((x) => ({ text: x.textContent, clipped: x.scrollWidth > x.clientWidth, h: x.getBoundingClientRect().height })));
    assert.deepEqual(tabs.map((t) => t.text), ['Home', 'Check', 'Calls', 'Paper', 'Stats', 'Sizing', 'Settings']);
    assert.ok(tabs.every((t) => !t.clipped), 'no tab label is cut off: ' + JSON.stringify(tabs));
    // the queue row: one action line, Check first and primary, the verdict shown once, thumb-sized buttons
    const row = await p.$(`.call-row:has([data-call-ca="${COIN}"])`);
    const actions = await row.$$eval('.call-actions', (as) => as.map((a) => [...a.querySelectorAll('button, a')].map((x) => x.textContent.trim())));
    assert.equal(actions.length, 1, 'one action line');
    assert.deepEqual(actions[0].slice(0, 2), ['Check', 'GMGN'], 'GMGN right after Check; no FOMO button without a FOMO key (docs/features/gmgn-home.md)');
    assert.equal(await row.$eval('[data-call-ca]', (x) => x.classList.contains('primary')), true, 'Check is the primary button');
    const text = await row.evaluate((r) => r.innerText.replace(/\s+/g, ' '));
    assert.equal((text.match(/Walk away/g) || []).length, 1, 'the verdict appears once: ' + text);
    const btnH = await row.$$eval('.btn.mini', (bs) => bs.map((x) => Math.round(x.getBoundingClientRect().height)));
    assert.ok(btnH.length >= 3 && btnH.every((h) => h >= 36), 'mini buttons at least 36px tall: ' + btnH);
    assert.match(await p.$eval('.calls-legend', (e) => e.textContent), /call score/);
    // filters: a grid, and the Pause box sits next to its words
    const pause = await p.$eval('#callsPause', (c) => { const l = c.closest('label'); const a = c.getBoundingClientRect(), b = l.getBoundingClientRect(); return { gap: Math.round(b.right - a.right), labelW: Math.round(b.width) }; });
    assert.ok(pause.labelW - pause.gap < 120, 'Pause feed box is next to its label: ' + JSON.stringify(pause));
    assert.equal(await p.$eval('.calls-filters', (e) => getComputedStyle(e).display), 'grid');
    // tags readable
    assert.equal(await p.$eval('.call-row .tag', (e) => getComputedStyle(e).fontSize), '12px');
    // no sideways scroll on Calls, Paper and the Dashboard
    for (const tab of ['calls', 'paper', 'dashboard']) {
      await p.evaluate((t) => showTab(t), tab); await p.waitForTimeout(150);
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no sideways scroll on ${tab} at ${vp.name}`);
    }
    await p.evaluate(() => showTab('calls')); await p.waitForTimeout(150);
    await p.screenshot({ path: E2E.OUT + `/layout-${vp.name}.png`, fullPage: false });
    assert.deepEqual(errs, []);
    await p.close();
  }
  await b.close();
  console.log('LAYOUT E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
