const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
// Faster feed: the app asks the Worker every 15 seconds while the Calls tab is open, every minute on other tabs, and a
// new alert coin shows in the queue straight from the feed, before the slower checks finish.
const CA = ('FreshCoin' + '1'.repeat(44)).slice(0, 44);
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.clock.install();
  let asks = 0, give = false;
  await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
  await p.route(/^https:\/\/(?!feed\.example|cdnjs)/, (r) => r.abort());
  await p.route('https://feed.example/**', (r) => {
    const u = new URL(r.request().url());
    if (u.pathname !== '/calls') return r.fulfill({ status: 404, json: {}, headers: { 'Access-Control-Allow-Origin': '*' } });
    asks++;
    const now = Date.now();
    const calls = give ? [{ address: CA, chain: 'solana', symbol: 'FRESH', poster: 'alice', at: now - 20000, messageId: '77', channel: 'first scan', snap: { ageMs: 5 * 60000, fdv: 120000, liq: 25000, priceUsd: 0.00012, top5Pct: 15 } }] : [];
    r.fulfill({ json: { status: 'ok', checkedAt: now, now, channels: [], calls, callers: {} }, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await p.addInitScript(() => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_tab', 'calls'); localStorage.setItem('ft_callView', JSON.stringify('all')); localStorage.setItem('ft_settings', JSON.stringify({ feedUrl: 'https://feed.example', feedKey: 'k' })); sessionStorage.setItem('i', 1); });
  await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html');
  await p.clock.runFor(1000); await p.waitForTimeout(150);
  assert.equal(asks, 1, 'asks once on open');
  await p.clock.runFor(15000); await p.waitForTimeout(150);
  assert.equal(asks, 2, 'again after 15 seconds on the Calls tab');
  await p.clock.runFor(15000); await p.waitForTimeout(150);
  assert.equal(asks, 3);
  // other tabs: once a minute
  await p.click('#tabs button[data-tab=check]');
  await p.clock.runFor(30000); await p.waitForTimeout(150);
  assert.equal(asks, 3, 'no 15-second asks on other tabs');
  await p.clock.runFor(30000); await p.waitForTimeout(150);
  assert.equal(asks, 4, 'a minute later it asks');
  // back to Calls: 15-second asks again, and a new coin shows at once
  give = true;
  await p.click('#tabs button[data-tab=calls]');
  await p.clock.runFor(15000); await p.waitForTimeout(150);
  assert.equal(asks, 5, 'back on the Calls tab it asks again within 15 seconds (not twice in a row)');
  await p.waitForFunction(() => /FRESH/.test(document.querySelector('#callsCard').innerText), null, { timeout: 5000 });
  assert.match(await p.$eval('#callsCard .call-row', (e) => e.innerText.replace(/\s+/g, ' ')), /FRESH Solana .*age \d+m · mcap \$120\.0k at alert/);
  // hidden app: nothing
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); });
  const before = asks;
  await p.clock.runFor(120000); await p.waitForTimeout(150);
  assert.equal(asks, before, 'never while the app is hidden');
  assert.deepEqual(errs, []);
  await b.close();
  console.log('FEED CADENCE E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
