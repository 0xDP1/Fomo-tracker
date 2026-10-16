// docs/features/my-wallets.md: two GMGN wallets marked Mine, "All my wallets" in the box: combined tiles, GMGN stats
// summed, the merged trade table with wallet tags, Sync all, a hand-added trade picks its wallet, a wallet name, back to
// one wallet, and the choice surviving a reload.
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const pad = (s) => (s + '1'.repeat(44)).slice(0, 44);
const W1 = pad('WaxxetUno'), W2 = pad('YaxxetTwo'), AAA = pad('CoinAaa'), BBB = pad('CoinBbb');
const t0 = Math.floor(Date.now() / 1000) - 6 * 3600;
const act = (type, token, sym, min, usd, amount) => ({ event_type: type, token: { address: token, symbol: sym }, timestamp: t0 + min * 60, price_usd: 0.001, cost_usd: usd, token_amount: amount, tx_hash: `${type}-${sym}-${min}` });
const ACT = {
  [W1]: { buy: [act('buy', AAA, 'AAA', 0, 100, 1000)], sell: [act('sell', AAA, 'AAA', 30, 250, 1000)] },
  [W2]: { buy: [act('buy', BBB, 'BBB', 10, 200, 2000), act('buy', AAA, 'AAA', 50, 40, 400)], sell: [act('sell', BBB, 'BBB', 40, 150, 2000)] },
};
const STATS = { [W1]: { '7d': { realized_profit: 150, bought_cost: 100, buy: 1, sell: 1, pnl_stat: { token_num: 1, winrate: 1 } }, '30d': { realized_profit: 150 } }, [W2]: { '7d': { realized_profit: -50, bought_cost: 240, buy: 2, sell: 1, pnl_stat: { token_num: 3, winrate: 0.2 } }, '30d': { realized_profit: 60 } } };
const SOL = { [W1]: 4.5e9, [W2]: 2e9 };
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const gm = [];
  await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
  await p.route(/^https:\/\/(?!api\.mainnet-beta\.solana|lite-api\.jup|openapi\.gmgn\.ai|cdnjs)/, (r) => r.abort());
  await p.route('https://api.mainnet-beta.solana.com/**', async (r) => {
    const body = r.request().postDataJSON();
    const w = body.params && body.params[0];
    const result = body.method === 'getBalance' ? { value: SOL[w] || 0 } : body.method === 'getTokenAccountsByOwner' ? { value: w === W2 && body.params[1].programId.startsWith('Tokenkeg') ? [{ account: { data: { parsed: { info: { mint: BBB, tokenAmount: { uiAmount: 2000 } } } } } }] : [] } : null;
    r.fulfill({ json: { jsonrpc: '2.0', id: 1, result } });
  });
  await p.route('https://lite-api.jup.ag/**', (r) => r.fulfill({ json: { So11111111111111111111111111111111111111112: { usdPrice: 100 }, [BBB]: { usdPrice: 0.05 } } }));
  await p.route('https://openapi.gmgn.ai/**', (r) => {
    const u = new URL(r.request().url());
    const end = u.pathname.split('/').pop(), type = u.searchParams.get('type'), period = u.searchParams.get('period'), w = u.searchParams.get('wallet_address');
    gm.push(`${end}:${type || period}:${(w || '').slice(0, 6)}`);
    let data = { list: [] };
    if (end === 'wallet_activity') data = { activities: (ACT[w] && ACT[w][type]) || [], next: null };
    if (end === 'wallet_stats') data = (STATS[w] && STATS[w][period]) || {};
    r.fulfill({ json: { code: 0, data }, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await p.addInitScript(() => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_tab', 'dashboard'); localStorage.setItem('ft_settings', JSON.stringify({ gmgnKey: 'phone-key', refreshSec: 0 })); sessionStorage.setItem('i', 1); });
  await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(300);
  const text = (sel) => p.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim());
  const go = async (input) => { await p.fill('#userInput', input); await p.click('#userForm button[type=submit]'); };
  const synced = () => p.waitForFunction(() => state.syncInfo && !state.syncInfo.error && !document.querySelector('#syncBtn').disabled, null, { timeout: 15000 });
  // two wallets, each opened once (their first sync runs on its own)
  await go(W1); await synced();
  await go(W2); await synced();
  assert.deepEqual(await p.evaluate(() => state.trades.map((t) => t.token)), ['BBB'], 'one wallet at a time, as before');
  // mark both mine; the box offers All my wallets
  await p.evaluate(() => showTab('settings'));
  await p.check(`[data-mine="${W1}"]`); await p.check(`[data-mine="${W2}"]`);
  assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('ft_mineWallets')).sort()), [W1, W2].sort());
  assert.match(await text('#profileList'), /All my wallets \(2 marked mine\)/);
  assert.equal(await p.$eval('#userList', (d) => [...d.options].some((o) => o.value === 'All my wallets')), true);
  // All my wallets: combined tiles, merged trades with wallet tags, GMGN stats summed
  await go('All my wallets');
  await p.waitForFunction(() => state.wallet && state.wallet.wallets === 2 && state.gmgnStats && state.gmgnStats.wallet === 'all' && state.gmgnStats.st, null, { timeout: 15000 }); await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('ft_allWallets'))), true);
  assert.match(await text('#activeUser'), /^All my wallets · 2$/);
  assert.equal(await text('#lblBal'), 'SOL balance (2 wallets)');
  assert.equal(await text('#solBal'), '6.50 SOL');
  assert.equal(await text('#portUsd'), '$750.00', '6.5 SOL × $100 + 2000 BBB × $0.05');
  assert.equal(await text('#lblPrice'), 'Realized PnL, 7 days (GMGN, all)');
  assert.equal(await text('#solPrice'), '+$100.00', '150 − 50');
  assert.match(await text('#solPriceSub'), /^30d \+\$210\.00 · 40% won · 4 tokens · SOL \$100\.00$/, '(100×1 + 20×3) / 4 = 40');
  assert.match(await text('#holdings'), /Coin…1111 2,000\.00 \$100\.00/, 'the second wallet tokens in the combined holdings');
  await p.evaluate(() => showTab('analytics')); await p.waitForTimeout(200);
  const rows = await p.$$eval('#tradeTable tbody tr', (rs) => rs.map((r) => r.querySelector('.t-token').textContent.replace(/\s+/g, ' ').trim()));
  assert.deepEqual(rows.sort(), ['AAAWaxx…1111Solana', 'BBBYaxx…1111Solana'].sort(), 'each trade tagged with its wallet: ' + rows.join(' | '));
  assert.deepEqual(await p.evaluate(() => state.trades.map((t) => [t.token, t.wallet]).sort()), [['AAA', W1], ['BBB', W2]].sort());
  assert.deepEqual(await p.evaluate(() => state.open.map((o) => [o.token, o.wallet])), [['AAA', W2]], 'the open position of the second wallet');
  // Sync all: every wallet marked mine, one after the other
  gm.length = 0;
  await p.evaluate(() => showTab('dashboard'));
  await p.click('#syncBtn'); await synced();
  assert.match(await text('#syncStatus'), /^Synced from GMGN \(2 wallets\): 5 buys and sells read, 2 closed trades saved \(0 new\), 1 open position\./);
  // (the activity reads come from the app's 5-minute GMGN cache here, so no new requests are expected)
  // a name for a wallet, shown on its tag; a hand-added trade lands in the chosen wallet
  await p.evaluate(() => showTab('settings'));
  p.once('dialog', (d) => d.accept('Main'));
  await p.click(`[data-rename="${W1}"]`); await p.waitForTimeout(100);
  assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('ft_walletNames'))), { [W1]: 'Main' });
  await p.evaluate(() => { showTab('analytics'); document.querySelectorAll('#analytics details').forEach((d) => { d.open = true; }); }); await p.click('#addBtn');
  assert.equal(await p.$eval('#tradeWalletLabel', (e) => !e.classList.contains('hidden')), true, 'the wallet choice shows on All');
  assert.deepEqual(await p.$$eval('#tradeForm [name=tradeWallet] option', (os) => os.map((o) => o.textContent)), ['Main', `${W2.slice(0, 4)}…${W2.slice(-4)}`]);
  await p.selectOption('#tradeForm [name=tradeWallet]', W2);
  await p.fill('#tradeForm [name=token]', 'HAND'); await p.fill('#tradeForm [name=closedAt]', '2026-10-15T10:00'); await p.fill('#tradeForm [name=cost]', '10'); await p.fill('#tradeForm [name=proceeds]', '15');
  await p.click('#tradeForm button[type=submit]'); await p.waitForTimeout(200);
  assert.deepEqual(await p.evaluate((w) => JSON.parse(localStorage.getItem('ft_w_' + w + '_trades')).map((t) => t.token), W2), ['BBB', 'HAND'], 'saved in the second wallet\'s own store');
  assert.equal(await p.evaluate((w) => JSON.parse(localStorage.getItem('ft_w_' + w + '_trades')).some((t) => 'wallet' in t), W2), false, 'the tag is not saved');
  const rows2 = await p.$$eval('#tradeTable tbody tr', (rs) => rs.map((r) => r.querySelector('.t-token').textContent.replace(/\s+/g, ' ').trim()));
  assert.ok(rows2.includes('AAAMainSolana') && rows2.includes('HANDYaxx…1111'), rows2.join(' | '));
  // the choice survives a reload; one wallet in the box shows that wallet alone again
  await p.reload(); await p.waitForTimeout(500);
  assert.match(await text('#activeUser'), /^All my wallets · 2$/);
  assert.equal(await p.evaluate(() => state.trades.length), 3);
  await go(W1); await p.waitForFunction(() => state.settings.wallet && !JSON.parse(localStorage.getItem('ft_allWallets')), null, { timeout: 5000 }); await p.waitForTimeout(300);
  assert.deepEqual(await p.evaluate(() => state.trades.map((t) => t.token)), ['AAA']);
  assert.match(await text('#activeUser'), /^Main · Waxx…1111$/);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
  assert.deepEqual(errs, []);
  await b.close();
  console.log('MY WALLETS E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
