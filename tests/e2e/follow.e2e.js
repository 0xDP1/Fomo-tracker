const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    const p = await b.newPage({ viewport: vp });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    const hits = [];
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!api\.fomoapi\.io)/, (r) => r.fulfill({ json: {} }));
    await p.route('https://api.fomoapi.io/**', (r) => {
      const u = new URL(r.request().url()); hits.push(u.pathname + ' ' + r.request().headers()['authorization']);
      if (u.pathname === '/v2/users/alice/trades') return r.fulfill({ json: { trades: [
        { tradeId: 'a1', token: { symbol: 'BONK', address: MINT }, chain: 'solana', status: 'closed', createdAt: '2026-10-01T10:00:00Z', closedAt: '2026-10-01T12:00:00Z', costBasisUsd: 100, realizedPnlUsd: 60 } ] } });
      if (u.pathname === '/v2/users/bob/trades') return r.fulfill({ json: { trades: [
        { tradeId: 'b1', token: { symbol: 'WIF', address: '0x4bc1782fafb967834e0e75947ba15113e48fc70e' }, chain: 'base', status: 'open', createdAt: '2026-10-01T11:00:00Z', costBasisUsd: 20 } ] } });
      if (u.pathname.startsWith('/v2/users/ghost')) return r.fulfill({ status: 404, json: {} });
      return r.fulfill({ json: {} });
    });
    await p.addInitScript(() => { if (!sessionStorage.getItem('init')) { localStorage.clear(); localStorage.setItem('ft_settings', JSON.stringify({ lookupKey: 'fapi_TEST' })); sessionStorage.setItem('init', 1); } });
    await p.goto(E2E.BASE + '/index.html');
    // no follows yet
    assert.match(await p.textContent('#followStatus'), /Add a FOMO handle/);
    for (const h of ['@Alice', 'https://fomo.family/@bob', 'ghost']) { await p.fill('#followInput', h); await p.click('#followForm button'); await p.waitForTimeout(300); }
    const rows = await p.$$eval('.follow-item', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
    console.log(vp.name, rows);
    assert.equal(rows.length, 3);
    assert.match(rows[0], /SELL @alice BONK.*\$160\.00 \+\$60\.00/);
    assert.match(rows[1], /BUY @bob WIF.*Base/);
    assert.match(rows[2], /BUY @alice BONK/);
    assert.match(await p.textContent('#followStatus'), /@ghost: not found on FOMO/);
    assert.ok(hits.every((h) => h.endsWith('Bearer fapi_TEST')));
    await p.screenshot({ path: E2E.OUT + `/follow-${vp.name}.png`, fullPage: false, clip: await p.$eval('#followCard', (e) => { e.scrollIntoView(); const r = e.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top), width: innerWidth, height: Math.min(r.height, innerHeight) }; }) });
    // persistence across reload
    await p.reload(); await p.waitForTimeout(300);
    assert.equal((await p.$$('.follow-item')).length, 3);
    // Check tap lands on the Check tab with the right CA
    await p.click('.follow-item:first-child [data-follow-ca]');
    await p.waitForTimeout(200);
    assert.ok(await p.$eval('#check', (e) => e.classList.contains('active')));
    assert.equal(await p.inputValue('#caInput'), MINT);
    // unfollow removes their rows
    await p.click('#tabs button[data-tab=dashboard]');
    await p.click('[data-unfollow="alice"]');
    assert.equal((await p.$$('.follow-item')).length, 1);
    console.log(vp.name, 'errors:', errs);
    assert.equal(errs.length, 0);
    await p.close();
  }
  await b.close();
  console.log('E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
