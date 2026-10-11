const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const W = 'Fomo1111111111111111111111111111111111111111';
const tx = (sig, ts, lam, mint, amt) => ({ signature: sig, timestamp: ts, accountData: [{ account: W, nativeBalanceChange: lam }],
  tokenTransfers: [amt > 0 ? { mint, tokenAmount: amt, toUserAccount: W } : { mint, tokenAmount: -amt, fromUserAccount: W }] });
const now = Math.floor(Date.now() / 1000);
const txs = [tx('s2', now - 100, 3e9, 'MintB', -10), tx('b2', now - 2000, -1e9, 'MintB', 10), tx('s1', now - 3000, 0.4e9, 'MintA', -50), tx('b1', now - 5000, -1e9, 'MintA', 50), tx('b3', now - 50, -0.5e9, 'MintC', 7)];
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
  await E2E.mockWorker(p, { services: { helius: true, fomo: false, claude: false, gmgn: false, chatter: false, jupiter: true },
    heliusRpc: async (r) => {
    const body = r.request().postDataJSON(); let result;
    if (body.method === 'getBalance') result = { value: 4.5e9 };
    else if (body.method === 'getTokenAccountsByOwner') result = { value: body.params[1].programId.startsWith('Tokenkeg') ? [{ account: { data: { parsed: { info: { mint: 'MintC', tokenAmount: { uiAmount: 7 } } } } } }] : [] };
    else if (body.method === 'getAssetBatch') result = body.params.ids.map((id) => ({ id, content: { metadata: { symbol: { MintA: 'AAA', MintB: 'BBB', MintC: 'CCC' }[id] } } }));
    r.fulfill({ json: { jsonrpc: '2.0', id: 1, result } });
    },
    jup: (r) => r.fulfill({ json: { So11111111111111111111111111111111111111112: { usdPrice: 150 }, MintC: { usdPrice: 2 } } }),
    helius: (r) => r.fulfill({ json: r.request().url().includes('before=') ? [] : txs }),
  });
  await E2E.openFolds(p); await p.goto('file://' + E2E.ROOT + '/index.html');
  await p.click('#tabs button[data-tab=settings]'); await p.evaluate(() => { document.querySelector('details.adv').open = true; });
  await p.fill('[name=wallet]', W); await p.fill('[name=feedUrl]', E2E.WORKER); await p.fill('[name=feedKey]', 'k3y');
  await p.click('#settingsForm button[type=submit]'); await p.waitForTimeout(800);
  await p.click('#tabs button[data-tab=dashboard]'); await p.click('#syncBtn'); await p.waitForTimeout(800);
  console.log('sync:', await p.textContent('#syncStatus'));
  console.log('rows:', (await p.$$eval('#tradeTable tbody tr', (rs) => rs.map((r) => r.innerText.replace(/\s+/g, ' ')))));
  console.log('open:', (await p.textContent('#openPositions')).replace(/\s+/g, ' '));
  await p.screenshot({ path: E2E.OUT + '/m-trades.png', fullPage: true });
  await p.click('#tabs button[data-tab=dashboard]'); await p.waitForTimeout(500);
  console.log('bal:', await p.textContent('#solBal'), await p.textContent('#portUsd'), await p.textContent('#holdings'));
  await p.screenshot({ path: E2E.OUT + '/m-dash.png', fullPage: true });
  console.log('hscroll:', await p.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  // Wallet sync, symbols (getAssetBatch), balances (RPC) and prices (Jupiter) all came through the Worker.
  assert.match(await p.textContent('#syncStatus'), /Synced: 5 swap txs scanned, 5 new, 2 closed trades, 1 open positions/);
  assert.deepEqual(await p.$$eval('#tradeTable tbody tr', (rs) => rs.map((r) => /AAA|BBB/.exec(r.innerText)[0]).sort()), ['AAA', 'BBB']);
  assert.equal(await p.textContent('#solBal'), '4.50 SOL');
  assert.equal(await p.textContent('#portUsd'), '$689.00');
  console.log('errors:', errs);
  await b.close();
  if (errs.length) { console.error('page errors:', errs); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
