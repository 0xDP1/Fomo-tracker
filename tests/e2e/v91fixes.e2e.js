// docs/BUGS.md bugs 20-24: checking two coins quickly keeps the second (20); typing in the Calls filters, the Paper
// wallet form and the Check plan form survives the periodic re-render (21); queue coins skipped on purpose say so
// instead of "checking…" (22); switching wallets never writes the old wallet's balance into the new one's history
// (23); a finished sync doesn't yank you back to the Dashboard (24).
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const pad = (s) => (s + '1'.repeat(44)).slice(0, 44);
const COIN_A = pad('HeavyCoinA'), COIN_B = pad('FastCoinB'), COIN_SKIP = pad('SkippedCoin');
const WAL_A = pad('WaxxetA'), WAL_B = pad('WaxxetB');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const pair = (x, sym) => ({ chainId: 'solana', dexId: 'pumpswap', pairAddress: 'p' + x.slice(0, 5), url: 'https://dexscreener.com/x', baseToken: { symbol: sym, name: sym, address: x }, priceUsd: '0.0003', marketCap: 300000, fdv: 300000, liquidity: { usd: 40000 }, volume: { h24: 90000, h1: 5000, m5: 500 }, priceChange: { m5: 1, h1: 2, h6: 3, h24: 4 }, txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 30, sells: 10 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: Date.now() - 3600e3 });
  const SYM = { [COIN_A]: 'AAA', [COIN_B]: 'BBB', [COIN_SKIP]: 'SKIP' };
  const open = async (tab, settings, seed) => {
    const p = await b.newPage({ viewport: { width: 390, height: 844 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|mainnet\.helius-rpc|api\.helius\.xyz|lite-api\.jup|cdnjs)/, (r) => r.abort());
    await p.route('https://api.dexscreener.com/**', async (r) => { const a = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
      if (a.includes(COIN_A)) await sleep(1500); // the slow coin answers after the fast one
      r.fulfill({ json: { pairs: a.filter((x) => SYM[x]).map((x) => pair(x, SYM[x])) } }); });
    await p.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { creator: 'Dev1', token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 900, topHolders: [{ address: 'H1', owner: 'HO1', pct: 2 }], markets: [] } }));
    await p.route('https://mainnet.helius-rpc.com/**', async (r) => { const body = r.request().postDataJSON(); const w = body.params && body.params[0];
      if (w === WAL_A) await sleep(1500); // the old wallet's balance arrives after the switch
      r.fulfill({ json: { jsonrpc: '2.0', id: 1, result: body.method === 'getBalance' ? { value: w === WAL_A ? 9e9 : 2e9 } : { value: [] } } }); });
    await p.route('https://lite-api.jup.ag/price/**', (r) => r.fulfill({ json: { So11111111111111111111111111111111111111112: { usdPrice: 100 } } }));
    await p.route('https://api.helius.xyz/**', async (r) => { await sleep(1500); r.fulfill({ json: [] }); }); // a slow trade sync
    await p.addInitScript(({ tab, settings, seed }) => {
      if (sessionStorage.getItem('i')) return;
      localStorage.clear();
      localStorage.setItem('ft_tab', tab);
      localStorage.setItem('ft_settings', JSON.stringify(settings));
      localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-calls': true }));
      for (const [k, v] of Object.entries(seed || {})) localStorage.setItem(k, JSON.stringify(v));
      sessionStorage.setItem('i', 1);
    }, { tab, settings, seed });
    await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(400);
    return { p, errs };
  };

  // ---- bug 20: the second coin wins ----
  {
    const { p, errs } = await open('check', {});
    await p.evaluate((a) => { runCheck(a); }, COIN_A); // not awaited: the slow check stays in flight
    await p.waitForTimeout(200);
    await p.evaluate((a) => { runCheck(a); }, COIN_B);
    await p.waitForFunction(() => checkState.risk, null, { timeout: 8000 });
    await p.waitForTimeout(2500); // A's answer arrives now
    assert.deepEqual(await p.evaluate(() => [checkState.ca, checkState.dex.symbol, document.querySelector('#tokenCard .tok-sym').textContent]), [COIN_B, 'BBB', 'BBB'], 'the coin on screen is the one asked for last');
    const saved = JSON.parse(await p.evaluate(() => localStorage.getItem('ft_checks')));
    assert.equal((saved[COIN_B] || {}).symbol, 'BBB', 'saved under its own address');
    // ---- bug 21c: the plan form keeps what you type across a re-render ----
    await p.focus('#planForm [name=target]'); await p.fill('#planForm [name=target]', '9.9M');
    await p.evaluate(() => renderCheck());
    assert.equal(await p.inputValue('#planForm [name=target]'), '9.9M', 'plan form not wiped');
    assert.equal(await p.evaluate(() => document.activeElement && document.activeElement.name), 'target', 'focus kept');
    assert.deepEqual(errs, []);
    await p.close();
  }

  // ---- bug 21a + 22: Calls filters survive the feed re-render; skipped coins say so ----
  {
    const t = Date.now();
    const row = (a, extra) => Object.assign({ address: a, chain: 'solana', symbol: SYM[a], mentions: 1, posters: ['alice'], channels: ['Man Cave'], sources: ['telegram'], firstPoster: 'alice', firstAt: t - 600000, lastAt: t - 600000 }, extra);
    const { p, errs } = await open('calls', {}, { ft_callView: 'all', ft_callMinLiq: 0, ft_callQueue: { [COIN_SKIP]: row(COIN_SKIP, { snapAt: t - 600000, snap: { ageMs: 3600e3, fdv: 300000, liq: 40000, priceUsd: 0.0003, holders: 500, top5Pct: 60 } }) } });
    await p.waitForFunction(() => !callState.busy && Object.values(callState.queue).every((e) => e.dexAt), null, { timeout: 10000 });
    await p.evaluate(() => renderCalls());
    const rowText = await p.$eval(`.call-row [data-call-ca="${COIN_SKIP}"]`, (b) => b.closest('.call-row').innerText.replace(/\s+/g, ' '));
    assert.match(rowText, /not checked/i, 'a coin skipped on purpose does not say checking…: ' + rowText);
    assert.ok(!/checking…/.test(rowText));
    await p.focus('#callsMinLiq'); await p.fill('#callsMinLiq', '777');
    await p.evaluate(() => renderCalls()); // what pollFeed, refreshLive and recentTick do every 15-60 s
    assert.equal(await p.inputValue('#callsMinLiq'), '777', 'filter not wiped');
    assert.equal(await p.evaluate(() => document.activeElement && document.activeElement.id), 'callsMinLiq', 'focus kept');
    assert.deepEqual(errs, []);
    await p.close();
  }

  // ---- bug 21b: the Paper wallet form survives the minute tick ----
  {
    const { p, errs } = await open('paper', { gmgnKey: 'gk' });
    await p.focus('#paperWallet'); await p.fill('#paperWallet', 'half-typed');
    await p.evaluate(() => renderPaper());
    assert.equal(await p.inputValue('#paperWallet'), 'half-typed', 'wallet form not wiped');
    assert.deepEqual(errs, []);
    await p.close();
  }

  // ---- bug 23 + 24: switching wallets ----
  {
    const { p, errs } = await open('dashboard', { wallet: WAL_A, heliusKey: 'hk' });
    await p.evaluate((w) => setWallet(w, ''), WAL_B); // the switch, while A's balance is still loading
    await p.waitForTimeout(300);
    await p.evaluate(() => showTab('check')); // the user moves on while the trade sync runs
    await p.waitForTimeout(2500); // A's balance and the sync both land now
    const hist = JSON.parse(await p.evaluate((w) => localStorage.getItem(`ft_w_${w}_history`) || '[]', WAL_B));
    assert.ok(hist.length >= 1, 'B has its own balance point');
    assert.ok(hist.every((h) => h.sol === 2), 'only B\'s balance in B\'s history: ' + JSON.stringify(hist));
    assert.equal(await p.evaluate(() => state.wallet && state.wallet.sol), 2, 'the tiles show B');
    assert.equal(await p.evaluate(() => document.querySelector('.tab.active').id), 'check', 'not yanked back to the Dashboard');
    assert.deepEqual(errs, []);
    await p.close();
  }
  await b.close();
  console.log('V91 FIXES E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
