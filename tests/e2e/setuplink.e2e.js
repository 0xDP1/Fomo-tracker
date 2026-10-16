// docs/features/my-wallets.md (Setup link): opening ?mine=<a>,<b>&names=… links both wallets, marks them mine, names
// them, opens All my wallets, cleans the URL, and a bad entry is skipped with a note.
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const pad = (s) => (s + '1'.repeat(44)).slice(0, 44);
const W1 = pad('WaxxetUno'), W2 = pad('YaxxetTwo');
const SOL = { [W1]: 4.5e9, [W2]: 2e9 };
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
  await p.route(/^https:\/\/(?!api\.mainnet-beta\.solana|lite-api\.jup|openapi\.gmgn\.ai|cdnjs)/, (r) => r.abort());
  await p.route('https://api.mainnet-beta.solana.com/**', async (r) => {
    const body = r.request().postDataJSON();
    const w = body.params && body.params[0];
    const result = body.method === 'getBalance' ? { value: SOL[w] || 0 } : body.method === 'getTokenAccountsByOwner' ? { value: [] } : null;
    r.fulfill({ json: { jsonrpc: '2.0', id: 1, result } });
  });
  await p.route('https://lite-api.jup.ag/**', (r) => r.fulfill({ json: { So11111111111111111111111111111111111111112: { usdPrice: 100 } } }));
  await p.route('https://openapi.gmgn.ai/**', (r) => {
    const u = new URL(r.request().url());
    const end = u.pathname.split('/').pop();
    const data = end === 'wallet_activity' ? { activities: [], next: null } : end === 'wallet_stats' ? { realized_profit: 10, bought_cost: 100, buy: 1, sell: 1, pnl_stat: { token_num: 1, winrate: 1 } } : { list: [] };
    r.fulfill({ json: { code: 0, data }, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await p.addInitScript(() => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_settings', JSON.stringify({ gmgnKey: 'phone-key', refreshSec: 0 })); sessionStorage.setItem('i', 1); });
  await E2E.openFolds(p);
  await p.goto(E2E.BASE + `/index.html?mine=${W1},not-a-wallet,${W2}&names=Main,x,Second`);
  await p.waitForFunction(() => state.wallet && state.wallet.wallets === 2, null, { timeout: 15000 }); await p.waitForTimeout(300);
  const text = (sel) => p.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim());
  assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('ft_mineWallets'))), [W1, W2]);
  assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('ft_walletNames'))), { [W1]: 'Main', [W2]: 'Second' });
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('ft_allWallets'))), true);
  assert.match(await text('#activeUser'), /^All my wallets · 2$/);
  assert.equal(await text('#solBal'), '6.50 SOL');
  assert.equal(await text('#userStatus'), '2 wallets linked and marked mine; 1 entry skipped (not a Solana address).');
  assert.equal(await p.evaluate(() => location.search), '', 'the list is cleaned out of the URL');
  await p.evaluate(() => showTab('settings'));
  assert.equal(await p.$eval(`[data-mine="${W1}"]`, (e) => e.checked), true);
  assert.equal(await p.$eval(`[data-mine="${W2}"]`, (e) => e.checked), true);
  assert.match(await text('#profileList'), /Main/);
  // the same link again adds nothing twice
  await p.goto(E2E.BASE + `/index.html?mine=${W1}&names=Main`); await p.waitForTimeout(500);
  assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('ft_mineWallets'))), [W1, W2]);
  assert.equal(await p.evaluate(() => Object.keys(state.profiles).length), 2, 'no duplicate linked entries');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
  assert.deepEqual(errs, []);
  await b.close();
  console.log('SETUP LINK E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
