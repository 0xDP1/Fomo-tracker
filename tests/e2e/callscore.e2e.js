const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
// Call score: the Best view shows only coins scoring at or above the minimum, highest first, with reasons;
// All shows everything; the view and the minimum are remembered.
const coin = (sym, o) => Object.assign({ address: sym + 'x'.repeat(40 - sym.length) + 'pump', chain: 'solana', symbol: sym, mentions: 1, posters: ['anon'], channels: ['first scan'], firstPoster: 'anon', callMcap: 150000 }, o);
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    const p = await b.newPage({ viewport: vp });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!cdnjs)/, (r) => r.abort());
    await p.addInitScript((coinSrc) => {
      if (sessionStorage.getItem('i')) return;
      const coin = new Function('return ' + coinSrc)();
      const now = Date.now(), snap = (o) => Object.assign({ ageMs: 3600e3, fdv: 200000, liq: 30000, priceUsd: 0.0002, top5Pct: 18 }, o);
      const base = { firstAt: now - 30 * 60000, lastAt: now - 60000, snapAt: now - 60000 };
      const q = {};
      for (const c of [
        coin('STRONG', Object.assign({}, base, { posters: ['alice', 'b', 'c'], channels: ['first scan', 'group traction'], firstPoster: 'alice', snap: snap() })),
        coin('MID', Object.assign({}, base, { posters: ['bob', 'c'], firstPoster: 'bob', snap: snap() })),
        coin('WEAK', Object.assign({}, base, { snap: snap({ top5Pct: null }) })),
        coin('SEED', Object.assign({}, base, { firstPoster: 'sprout', snap: snap({ top5Pct: 50 }) })),
      ]) q[c.address] = c;
      localStorage.clear();
      localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-calls': true }));
      localStorage.setItem('ft_tab', 'calls');
      localStorage.setItem('ft_callQueue', JSON.stringify(q));
      localStorage.setItem('ft_callCallers', JSON.stringify({ alice: { winRate: 62, medal: 'gold' }, bob: { winRate: 50, medal: 'silver' }, sprout: { winRate: null, medal: 'new' } }));
      sessionStorage.setItem('i', 1);
    }, coin.toString());
    await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html');
    await p.waitForFunction(() => !callState.busy && document.querySelector('.call-row'), null, { timeout: 8000 });
    const rows = () => p.$$eval('#callsCard .call-row', (rs) => rs.map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
    const text = () => p.$eval('#callsCard', (e) => e.innerText.replace(/\s+/g, ' '));
    let r = await rows();
    assert.equal(r.length, 2, r.join(' | '));
    assert.match(r[0], /^91 STRONG .*🥇 62% caller · 3 callers · in group traction/);
    assert.match(r[1], /^68 MID .*🥈 50% caller · 2 callers/);
    let t = await text();
    assert.match(t, /Best 2 All scores 4/);
    assert.match(t, /2 more score under 60\. Show all/);
    assert.match(await p.$eval('#callsSummary', (e) => e.textContent), /^2 best coins/);
    await (await p.$('#callsCard')).screenshot({ path: E2E.OUT + `/callscore-${vp.name}.png` });
    // All: every coin, with its score and red flags
    await p.click('[data-call-view="all"] >> nth=0');
    r = await rows();
    assert.equal(r.length, 4);
    const seed = r.find((x) => /SEED/.test(x));
    assert.match(seed, /^\d+ SEED .*top 5 hold 50% · caller has no record/);
    assert.match(r.find((x) => /WEAK/.test(x)), /^35 WEAK/);
    // stricter minimum
    await p.click('[data-call-view="best"]');
    await p.fill('#callsMinScore', '70'); await p.dispatchEvent('#callsMinScore', 'change');
    r = await rows();
    assert.equal(r.length, 1);
    assert.match(r[0], /^91 STRONG/);
    assert.match(await text(), /3 more score under 70/);
    // remembered after a reload
    await p.click('[data-call-view="all"] >> nth=0');
    await p.reload(); await p.waitForFunction(() => document.querySelector('.call-row'), null, { timeout: 8000 });
    assert.equal((await rows()).length, 4, 'All is remembered');
    assert.equal(await p.$eval('#callsMinScore', (e) => e.value), '70', 'the minimum is remembered');
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
    assert.deepEqual(errs, []);
    await p.close();
  }
  await b.close();
  console.log('CALL SCORE E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
