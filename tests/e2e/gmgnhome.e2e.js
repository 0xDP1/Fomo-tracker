// docs/features/gmgn-home.md: the box at the top takes a GMGN wallet link, the wallet is remembered under its short
// address, Sync trades reads GMGN's wallet activity (through the device's GMGN key here) into closed trades and open
// positions in USD, the third Home tile shows GMGN's realized PnL, the Check tab opens in GMGN, no FOMO button without a FOMO key.
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const pad = (s) => (s + '1'.repeat(44)).slice(0, 44);
const W = pad('GmgnWaxxet'), AAA = pad('CoinAaa'), BBB = pad('CoinBbb');
const t0 = Math.floor(Date.now() / 1000) - 6 * 3600;
const act = (type, token, sym, min, usd, amount) => ({ event_type: type, token: { address: token, symbol: sym }, timestamp: t0 + min * 60, price_usd: 0.001, cost_usd: usd, token_amount: amount, tx_hash: `${type}-${sym}-${min}` });
const BUYS = [act('buy', AAA, 'AAA', 0, 100, 1000), act('buy', BBB, 'BBB', 50, 80, 800)];
const SELLS = [act('sell', AAA, 'AAA', 30, 250, 1000)];
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const gm = [];
  await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
  await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|api\.mainnet-beta\.solana|lite-api\.jup|openapi\.gmgn\.ai|cdnjs)/, (r) => r.abort());
  await p.route('https://api.mainnet-beta.solana.com/**', async (r) => {
    const body = r.request().postDataJSON();
    const result = body.method === 'getBalance' ? { value: 4.5e9 } : body.method === 'getTokenAccountsByOwner' ? { value: [] } : null;
    r.fulfill({ json: { jsonrpc: '2.0', id: 1, result } });
  });
  await p.route('https://lite-api.jup.ag/**', (r) => r.fulfill({ json: { So11111111111111111111111111111111111111112: { usdPrice: 150 } } }));
  await p.route('https://openapi.gmgn.ai/**', (r) => {
    const u = new URL(r.request().url());
    const end = u.pathname.split('/').pop(), type = u.searchParams.get('type'), period = u.searchParams.get('period');
    gm.push(`${end}:${type || period}:${u.searchParams.get('cursor') || ''}:${(u.searchParams.get('wallet_address') || '').slice(0, 6)}`);
    let data = { list: [] };
    if (end === 'wallet_activity') data = { activities: u.searchParams.get('wallet_address') === W ? (type === 'buy' ? BUYS : SELLS) : [], next: null };
    if (end === 'wallet_stats') data = period === '7d' ? { realized_profit: 840, unrealized_profit: 20, bought_cost: 4200, buy: 31, sell: 29, pnl_stat: { token_num: 12, winrate: 0.58 } } : { realized_profit: 3100, bought_cost: 15000 };
    r.fulfill({ json: { code: 0, data }, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await p.route('https://api.dexscreener.com/**', (r) => { const a = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
    r.fulfill({ json: { pairs: a.map((x) => ({ chainId: 'solana', dexId: 'raydium', pairAddress: 'p' + x.slice(0, 5), url: 'https://dexscreener.com/x', baseToken: { symbol: x === AAA ? 'AAA' : 'BBB', name: 'x', address: x }, priceUsd: '0.001', marketCap: 300000, liquidity: { usd: 40000 }, volume: { h24: 90000, h1: 5000, m5: 500 }, priceChange: { m5: 1 }, txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 30, sells: 10 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: Date.now() - 2 * 3600e3 })) } }); });
  await p.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 900, topHolders: [{ address: 'H1', owner: 'HO1', pct: 3 }], markets: [] } }));
  await p.addInitScript(() => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_tab', 'dashboard'); localStorage.setItem('ft_settings', JSON.stringify({ gmgnKey: 'phone-key', refreshSec: 0 })); sessionStorage.setItem('i', 1); });
  await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(300);
  const text = (sel) => p.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim());
  assert.equal(await p.getAttribute('#userInput', 'placeholder'), 'GMGN wallet address or link');
  assert.match(await text('#walletMissing'), /Paste your GMGN wallet address/);
  // a GMGN wallet link in the box: the wallet is set, remembered under its short address, no FOMO handle
  await p.fill('#userInput', `https://gmgn.ai/sol/address/${W}?tab=activity`); await p.click('#userForm button[type=submit]');
  await p.waitForFunction(() => state.settings.wallet && state.wallet && state.wallet.sol === 4.5, null, { timeout: 10000 });
  assert.deepEqual(await p.evaluate(() => [state.settings.wallet, state.settings.username, Object.entries(state.profiles)]), [W, '', [[`${W.slice(0, 4)}…${W.slice(-4)}`, W]]]);
  assert.match(await text('#activeUser'), new RegExp(`^${W.slice(0, 4)}…${W.slice(-4)}$`));
  assert.match(await text('#profileList'), new RegExp(`^${W.slice(0, 4)}…${W.slice(-4)} `), 'listed without an @');
  // the first sync runs on its own: trades from GMGN's buys and sells, in USD
  await p.waitForFunction(() => state.trades.length === 1 && state.syncInfo && !state.syncInfo.error, null, { timeout: 10000 });
  const sync = await text('#syncStatus');
  assert.match(sync, /^Synced from GMGN: 3 buys and sells read, 1 closed trade saved \(1 new\), 1 open position\. Amounts are in USD at GMGN's prices\./, sync);
  assert.ok(gm.includes(`wallet_activity:buy::${W.slice(0, 6)}`) && gm.includes(`wallet_activity:sell::${W.slice(0, 6)}`), gm.join(' '));
  assert.deepEqual(await p.evaluate(() => state.trades.map((t) => [t.token, t.cost, t.proceeds, t.source, t.chain])), [['AAA', 100, 250, 'gmgn', 'Solana']]);
  assert.deepEqual(await p.evaluate(() => [state.unit, state.open.map((o) => [o.token, o.cost, o.source])]), ['USD', [['BBB', 80, 'gmgn']]]);
  assert.match(await text('#tradeTable tbody'), /AAA/);
  // the third tile: GMGN's realized PnL over 7 days, with 30 days and the win rate under it
  await p.waitForFunction(() => state.gmgnStats && state.gmgnStats.st, null, { timeout: 10000 }); await p.waitForTimeout(200);
  assert.equal(await text('#lblPrice'), 'Realized PnL, 7 days (GMGN)');
  assert.equal(await text('#solPrice'), '+$840.00');
  assert.match(await text('#solPriceSub'), /^30d \+\$3,100\.00 · 58% won · 12 tokens · SOL \$150\.00$/);
  assert.ok(gm.includes(`wallet_stats:7d::${W.slice(0, 6)}`) && gm.includes(`wallet_stats:30d::${W.slice(0, 6)}`), gm.join(' '));
  // Sync trades again: nothing doubled
  await p.click('#syncBtn'); await p.waitForFunction(() => !document.querySelector('#syncBtn').disabled, null, { timeout: 10000 });
  assert.match(await text('#syncStatus'), /1 closed trade saved \(0 new\)/);
  // the Check tab: Open in GMGN, and no FOMO button without a FOMO key
  await p.evaluate((a) => runCheck(a), AAA);
  await p.waitForFunction(() => checkState.risk, null, { timeout: 8000 }); await p.waitForTimeout(200);
  const links = await p.$$eval('#tokenCard a.btn', (as) => as.map((a) => [a.textContent.trim(), a.href]));
  assert.ok(links.some(([t, h]) => t === 'Open in GMGN' && /gmgn\.ai/.test(h)), JSON.stringify(links));
  assert.ok(!links.some(([t]) => /FOMO/.test(t)), 'no FOMO button: ' + JSON.stringify(links));
  await p.evaluate(() => showTab('dashboard'));
  await p.screenshot({ path: E2E.OUT + '/gmgnhome-phone.png', fullPage: false });
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
  assert.deepEqual(errs, []);
  await b.close();
  console.log('GMGN HOME E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
