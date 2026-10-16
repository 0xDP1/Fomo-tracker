// docs/features/calls-panes.md: the Calls tab shows one section at a time from a sticky row of chips (Queue, Digest,
// Graduations, Wallet, Scanner), each chip carrying its section's status; the choice is remembered; Add to Call queue
// from a graduation lands on the Queue pane.
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const pad = (s) => (s + '1'.repeat(44)).slice(0, 40) + 'pump';
const GOOD = pad('GoodGrad');
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    const p = await b.newPage({ viewport: vp });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|cdnjs)/, (r) => r.abort());
    await p.route('https://api.dexscreener.com/**', (r) => { const list = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
      r.fulfill({ json: { pairs: list.filter((x) => x === GOOD).map((x) => ({ chainId: 'solana', dexId: 'pumpswap', pairAddress: 'P' + x.slice(0, 6), url: 'https://dexscreener.com/x', baseToken: { symbol: 'GOOD', name: 'GOOD', address: x }, priceUsd: '0.000085', marketCap: 85000, fdv: 85000, liquidity: { usd: 22000 }, volume: { h24: 30000, h1: 30000, m5: 5000 }, priceChange: { m5: 5 }, txns: { m5: { buys: 30, sells: 10 }, h1: { buys: 120, sells: 60 }, h24: { buys: 120, sells: 60 } }, pairCreatedAt: Date.now() - 3 * 60000 })) } }); });
    await p.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 900, topHolders: Array.from({ length: 10 }, (_, i) => ({ address: 'H' + i, owner: 'HO' + i, pct: 2 })), markets: [{ pubkey: 'm', marketType: 'pump_amm', lp: { lpLockedPct: 100 } }] } }));
    await p.addInitScript(() => {
      window.__ws = [];
      window.WebSocket = class { constructor(url) { this.url = url; window.__ws.push(this); setTimeout(() => this.onopen && this.onopen(), 10); } send() {} close() { setTimeout(() => this.onclose && this.onclose({}), 0); } };
      if (sessionStorage.getItem('i')) return;
      localStorage.clear(); localStorage.setItem('ft_tab', 'calls'); sessionStorage.setItem('i', 1);
    });
    await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(400);
    const visible = () => p.$$eval('details.pane-section', (ds) => ds.filter((d) => getComputedStyle(d).display !== 'none').map((d) => d.dataset.pane));
    const chips = () => p.$$eval('#callsPanes button', (bs) => bs.map((b) => [b.dataset.pane, b.classList.contains('active'), b.querySelector('.pane-sub').textContent]));
    // opens on Queue; the other four are hidden; the chips carry each section's status line
    assert.deepEqual(await visible(), ['queue']);
    let c = await chips();
    assert.deepEqual(c.map((x) => [x[0], x[1]]), [['queue', true], ['digest', false], ['grad', false], ['wallet', false], ['scanner', false]]);
    assert.equal(c[0][2], 'contract addresses from Discord');
    assert.match(c[2][2], /● live · 0 passed of 0/);
    assert.equal(await p.$eval('#callsSection > summary', (e) => getComputedStyle(e).display), 'none', 'the fold line is the chip now');
    // each chip shows only its pane; the tab title and the chips stay put
    for (const pane of ['digest', 'grad', 'wallet', 'scanner', 'queue']) {
      await p.click(`#callsPanes [data-pane="${pane}"]`);
      assert.deepEqual(await visible(), [pane]);
      assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('ft_callsPane'))), pane);
    }
    assert.equal(await p.$eval('#callsPanes', (e) => getComputedStyle(e).position), 'sticky');
    // remembered across a reload
    await p.click('#callsPanes [data-pane="wallet"]'); await p.reload(); await p.waitForTimeout(400);
    assert.deepEqual(await visible(), ['wallet']);
    assert.ok(await p.isVisible('#wrWallet'));
    // a graduation that passes: Add to Call queue lands on the Queue pane with the note
    await p.click('#callsPanes [data-pane="grad"]');
    await p.evaluate((m) => window.__ws[0].onmessage({ data: JSON.stringify({ signature: 's1', mint: m, txType: 'migrate', pool: 'pump-amm' }) }), GOOD);
    await p.evaluate(() => { gradState.list.forEach((g) => { g.dueAt = Date.now() - 1; }); return gradTick(); });
    await p.waitForFunction(() => !gradState.busy && gradState.list.every((g) => g.status !== 'waiting'), null, { timeout: 20000 });
    assert.match((await chips())[2][2], /1 passed of 1/);
    await p.click(`[data-grad-add="${GOOD}"]`); await p.waitForTimeout(200);
    assert.deepEqual(await visible(), ['queue']);
    assert.match(await p.$eval('#callsCard', (e) => e.innerText), /Added 1 coin\./);
    assert.ok(await p.evaluate((a) => !!callState.queue[a], GOOD), 'the coin is in the queue');
    // the chip row scrolls sideways on a phone instead of widening the page
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways page scroll');
    if (vp.name === 'phone') assert.equal(await p.$eval('#callsPanes', (e) => e.scrollWidth > e.clientWidth), true, 'five chips scroll inside the row on a phone');
    await p.evaluate(() => window.scrollTo(0, 0));
    await (await p.$('#calls')).screenshot({ path: E2E.OUT + `/panes-${vp.name}.png` });
    assert.deepEqual(errs, []);
    await p.close();
  }
  await b.close();
  console.log('PANES E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
