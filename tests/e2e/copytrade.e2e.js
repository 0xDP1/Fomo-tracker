// docs/features/paper-account.md: the Paper tab, a $5,000 account, and a true copy of a wallet: it buys (the copy enters
// at the wallet's price), sells 40% (the copy sells 40%), then sells the rest (the copy closes).
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const pad = (s) => (s + '1'.repeat(44)).slice(0, 44);
const WALLET = pad('CopyMe'), COIN = pad('CopyCoin');
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const t0 = Math.floor(Date.now() / 1000) + 30;
  let stage = 0, nowPrice = '0.0012';
  const asked = [];
  await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
  await p.route(/^https:\/\/(?!api\.dexscreener|openapi\.gmgn\.ai|cdnjs)/, (r) => r.abort());
  await p.route('https://openapi.gmgn.ai/**', (r) => {
    const u = new URL(r.request().url()); const type = u.searchParams.get('type'); asked.push(type);
    const buys = [{ event_type: 'buy', token: { address: COIN, symbol: 'COPY' }, timestamp: t0, price_usd: 0.001, cost_usd: 400, tx_hash: 'b1' }];
    const sells = [{ event_type: 'sell', token: { address: COIN, symbol: 'COPY' }, timestamp: t0 + 60, price_usd: 0.002, cost_usd: 320, tx_hash: 's1' },
      { event_type: 'sell', token: { address: COIN, symbol: 'COPY' }, timestamp: t0 + 120, price_usd: 0.003, cost_usd: 720, tx_hash: 's2' }].slice(0, stage);
    r.fulfill({ json: { code: 0, data: { activities: type === 'sell' ? sells : buys } }, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await p.route('https://api.dexscreener.com/**', (r) => r.fulfill({ json: { pairs: [{ chainId: 'solana', dexId: 'pumpswap', pairAddress: 'pc', url: 'https://dexscreener.com/x', baseToken: { symbol: 'COPY', name: 'x', address: COIN }, priceUsd: nowPrice, marketCap: 1e6, liquidity: { usd: 50000 }, volume: { h24: 1 }, txns: { h24: { buys: 1, sells: 1 } }, pairCreatedAt: Date.now() - 3600e3 }] } }));
  await p.addInitScript(() => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_settings', JSON.stringify({ gmgnKey: 'g' })); sessionStorage.setItem('i', 1); });
  await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(400);
  // the Paper tab, between Calls and Analytics, opens on a $5,000 account
  assert.deepEqual(await p.$$eval('#tabs button', (bs) => bs.map((x) => x.textContent)), ['Dashboard', 'Check', 'Calls', 'Paper', 'Analytics', 'Sizing', 'Settings']);
  await p.click('#tabs button[data-tab=paper]');
  const card = () => p.$eval('#paperCard', (e) => e.innerText.replace(/\s+/g, ' '));
  assert.match(await card(), /Balance \$5,000 \+\$0 \(\+0%\) Cash \$5,000 0 open worth \$0/);
  assert.equal(await p.inputValue('#paperStart'), '5000');
  // follow with the defaults: $100 a trade, same entry as the wallet, mirror its sells
  assert.deepEqual([await p.inputValue('#paperSizeValue'), await p.inputValue('#paperSizeMode'), await p.inputValue('#paperEntry'), await p.inputValue('#paperExits')], ['100', 'fixed', 'wallet', 'mirror']);
  await p.fill('#paperWallet', WALLET); await p.fill('#paperLabel', 'whale');
  await p.click('#paperWalletForm button[type=submit]');
  await p.waitForFunction(() => !paperBusy && paperState.positions.length === 1, null, { timeout: 8000 });
  let pos = await p.evaluate(() => paperState.positions[0]);
  assert.deepEqual([pos.size, pos.entry, pos.seenPrice, pos.exits, pos.walletHeld], [100, 0.001, 0.0012, 'mirror', 400000], 'entered at the wallet\'s price, the price when seen kept');
  let text = await card();
  assert.match(text, /whale \$100 a trade · entry same as the wallet · mirrors their sells Unfollow/);
  assert.match(text, /COPY whale · \$100 · .* · mirroring · seen \+20% vs their entry/);
  assert.match(text, /Balance \$5,020 \+\$20 \(\+0%\) Cash \$4,900 1 open worth \$120/, 'valued at today\'s price, 1.2× the entry');
  // the wallet sells 40% at 2×: the copy sells 40% at the wallet's price
  stage = 1; nowPrice = '0.0021';
  await p.evaluate(() => { gmgnState.cache = {}; }); // GMGN answers are kept 5 minutes; skip ahead
  await p.click('#paperRefresh'); await p.waitForFunction(() => !paperBusy, null, { timeout: 8000 });
  pos = await p.evaluate(() => paperState.positions[0]);
  assert.deepEqual([pos.left, pos.status, pos.fills.map((f) => [f.why, f.price])], [0.6, 'open', [['wallet sold 40%', 0.002]]]);
  assert.ok(asked.includes('sell'), 'asks GMGN for the wallet\'s sells');
  assert.match(await card(), /COPY whale · \$100 · .* · 40% sold · mirroring/);
  // the wallet sells the rest at 3×: the copy closes; $80 + $180 back on $100
  stage = 2;
  await p.evaluate(() => { gmgnState.cache = {}; }); // GMGN answers are kept 5 minutes; skip ahead
  await p.click('#paperRefresh'); await p.waitForFunction(() => !paperBusy, null, { timeout: 8000 });
  pos = await p.evaluate(() => paperState.positions[0]);
  assert.deepEqual([pos.left, pos.status, pos.fills.map((f) => f.why)], [0, 'closed', ['wallet sold 40%', 'wallet sold 100%']]);
  text = await card();
  assert.match(text, /Balance \$5,160 \+\$160 \(\+3%\) Cash \$5,160 0 open worth \$0/);
  assert.match(text, /whale 1 100% \+160% \+\$160/);
  assert.match(text, /COPY whale wallet sold 40%, wallet sold 100% \+160%/);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll on a phone');
  await (await p.$('#paperCard')).screenshot({ path: E2E.OUT + '/copytrade-phone.png' });
  assert.deepEqual(errs, []);
  await b.close();
  console.log('COPY TRADE E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
