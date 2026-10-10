const E2E = require('./helpers');
// Reproduces the fomoapi.io credit bugs against the running app. Fails on the old code, passes after the fix.
const { chromium } = require('playwright');
const results = [];
const check = (name, ok, detail) => { results.push([ok ? 'PASS' : 'FAIL', name, detail]); };
const trade = (i, closed = true) => ({ tradeId: 't' + i, token: { symbol: 'T' + i, address: 'Mint' + i }, chain: 'solana', status: closed ? 'closed' : 'open', createdAt: `2026-10-0${1 + (i % 7)}T10:00:00Z`, closedAt: closed ? `2026-10-0${1 + (i % 7)}T12:00:00Z` : null, costBasisUsd: 100, realizedPnlUsd: closed ? 10 : 0 });
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  let mode = 'page1', calls = [];
  await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
  await p.route(/^https:\/\/(?!api\.fomoapi\.io|cdnjs)/, (r) => r.abort());
  await p.route('https://api.fomoapi.io/**', (r) => {
    const u = new URL(r.request().url()); calls.push(u.pathname + u.search);
    if (mode === '402') return r.fulfill({ status: 402, json: { error: 'credits_exhausted' } });
    const hdr = { 'x-credits-remaining': '123000', 'access-control-expose-headers': 'x-credits-remaining' };
    if (u.pathname.endsWith('/balances')) return r.fulfill({ headers: hdr, json: { holdings: [], totalValueUsd: 1000 } });
    if (u.pathname.endsWith('/trades') || u.pathname.endsWith('/positions')) {
      // the API ignores every paging parameter and always returns the newest page
      const rows = mode === 'page1' ? [1, 2, 3].map((i) => trade(i)) : [3, 4, 5].map((i) => trade(i));
      return r.fulfill({ headers: hdr, json: { trades: rows.concat([trade(9, false)]), closedCount: 50, activeCount: 1, count: 4 } });
    }
    return r.fulfill({ headers: hdr, json: { handle: 'me', pnl: {} } });
  });
  await p.addInitScript(() => { if (sessionStorage.getItem('i')) return; localStorage.clear();
    localStorage.setItem('ft_settings', JSON.stringify({ username: 'me', wallet: '', lookupKey: 'fapi_test', refreshSec: 60 })); sessionStorage.setItem('i', 1); });
  await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(1500);

  // A) sync twice while the API's newest page moves on: history should keep all 5 closed trades
  calls = []; await p.evaluate(() => syncTrades()); const firstSyncCalls = calls.length;
  mode = 'page2'; calls = []; await p.evaluate(() => syncTrades()); const secondSyncCalls = calls.length;
  const ids = await p.evaluate(() => state.trades.filter((t) => t.source === 'fomo').map((t) => t.id).sort());
  check('history kept across syncs', ids.length === 5, ids.join(','));
  check('second sync skips the paging probe', secondSyncCalls <= 2, `first sync ${firstSyncCalls} calls, second ${secondSyncCalls}`);

  // B) an auto-refresh 1 minute later should not call fomoapi.io again (10-minute cadence)
  calls = []; await p.evaluate(() => refreshBalance()); await p.waitForTimeout(200);
  check('auto-refresh within 10 min makes no calls', calls.length === 0, `${calls.length} calls`);

  // C) credits used up: one failure, then a pause with a clear message
  mode = '402'; calls = [];
  await p.evaluate(async () => { state.fomo.at = 0; await refreshBalance(); await refreshBalance(); });
  await p.waitForTimeout(200);
  const msg = await p.textContent('#lastUpdated');
  check('402 pauses further calls', calls.length <= 2, `${calls.length} calls after 402`);
  check('402 explains credits', /credits are used up/.test(msg), msg.slice(0, 120));

  // D) report shows the running version
  const ver = await p.evaluate(() => APP_VERSION);
  check('usage counter recorded', await p.evaluate(() => { const u = JSON.parse(localStorage.getItem('ft_fomoUsage') || 'null'); return !!(u && u.calls > 0); }), '');
  await p.click('#tabs button[data-tab=settings]');
  check('settings shows credit use', /fomoapi\.io this month/.test(await p.$eval('#settings', (e) => e.innerText)), '');
  mode = 'page1'; await p.evaluate(() => { localStorage.removeItem('ft_fomoPause'); if (window.fomoPause !== undefined) window.fomoPause = 0; });
  console.log('page errors:', errs);
  for (const r of results) console.log(r.join(' | '));
  console.log('running version', ver);
  await b.close();
  process.exit(results.some((r) => r[0] === 'FAIL') || errs.length ? 1 : 0);
})();
