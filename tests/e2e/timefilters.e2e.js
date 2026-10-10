const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
// Short time filters in the Call queue: Launched within 15m / 30m, and Called within 15m / 30m / 1h. Both remembered.
const coin = (sym, launchedMinAgo, calledMinAgo) => {
  const now = Date.now();
  return { address: sym + 'x'.repeat(40 - sym.length) + 'pump', chain: 'solana', symbol: sym, mentions: 1, posters: ['a'], channels: [], firstPoster: 'a', firstAt: now - calledMinAgo * 60000, lastAt: now - calledMinAgo * 60000, snapAt: now - 30000, snap: { ageMs: launchedMinAgo * 60000 - 30000, fdv: 200000, liq: 30000, priceUsd: 0.0002, top5Pct: 18 } };
};
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    const p = await b.newPage({ viewport: vp });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!cdnjs)/, (r) => r.abort());
    // BABY: launched 10 min ago, called 8 min ago · TEEN: launched 25 min ago, called 20 · OLDCALL: launched 50 min ago, called 45
    // LATE: launched 5 hours ago but first called 10 min ago
    const q = {};
    for (const c of [coin('BABY', 10, 8), coin('TEEN', 25, 20), coin('OLDCALL', 50, 45), coin('LATE', 300, 10)]) q[c.address] = c;
    await p.addInitScript((queue) => {
      if (sessionStorage.getItem('i')) return;
      localStorage.clear();
      localStorage.setItem('ft_tab', 'check');
      localStorage.setItem('ft_callView', JSON.stringify('all'));
      localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-calls': true }));
      localStorage.setItem('ft_callQueue', JSON.stringify(queue));
      sessionStorage.setItem('i', 1);
    }, q);
    await p.goto(E2E.BASE + '/index.html');
    await p.waitForFunction(() => !callState.busy && document.querySelector('.call-row'), null, { timeout: 8000 });
    const syms = async () => (await p.$$eval('#callsCard .call-row b', (bs) => bs.map((x) => x.textContent))).filter((t) => /^[A-Z]+$/.test(t)).sort();
    const pick = async (sel, v) => { await p.selectOption(sel, v); await p.waitForFunction(() => !callState.busy, null, { timeout: 8000 }); await p.waitForTimeout(100); };
    assert.deepEqual(await syms(), ['BABY', 'LATE', 'OLDCALL', 'TEEN'], 'default 24h, called any time');
    assert.deepEqual(await p.$$eval('#callsAge option', (os) => os.map((o) => o.textContent)), ['15m', '30m', '1h', '6h', '24h', '3d']);
    assert.deepEqual(await p.$$eval('#callsWithin option', (os) => os.map((o) => o.textContent)), ['any', '15m', '30m', '1h']);
    await pick('#callsAge', '0.25');
    assert.deepEqual(await syms(), ['BABY'], 'launched within 15 minutes');
    assert.match(await p.$eval('#callsSummary', (e) => e.textContent), /under 15m/);
    await pick('#callsAge', '0.5');
    assert.deepEqual(await syms(), ['BABY', 'TEEN'], 'launched within 30 minutes');
    await pick('#callsAge', '24');
    await pick('#callsWithin', '15');
    assert.deepEqual(await syms(), ['BABY', 'LATE'], 'first called within 15 minutes, whatever its age');
    assert.match(await p.$eval('#callsCard', (e) => e.innerText), /2 more hidden by your filters \(.*called within/);
    await pick('#callsWithin', '30');
    assert.deepEqual(await syms(), ['BABY', 'LATE', 'TEEN']);
    await pick('#callsWithin', '60');
    assert.deepEqual(await syms(), ['BABY', 'LATE', 'OLDCALL', 'TEEN']);
    // both together, and remembered after a reload
    await pick('#callsAge', '0.5'); await pick('#callsWithin', '15');
    assert.deepEqual(await syms(), ['BABY']);
    await p.reload(); await p.waitForFunction(() => !callState.busy && document.querySelector('#callsWithin'), null, { timeout: 8000 });
    assert.equal(await p.$eval('#callsAge', (e) => e.value), '0.5');
    assert.equal(await p.$eval('#callsWithin', (e) => e.value), '15');
    assert.deepEqual(await syms(), ['BABY']);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
    await (await p.$('#callsCard')).screenshot({ path: E2E.OUT + `/timefilters-${vp.name}.png` });
    assert.deepEqual(errs, []);
    await p.close();
  }
  await b.close();
  console.log('TIME FILTERS E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
