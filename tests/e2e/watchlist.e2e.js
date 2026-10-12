// Watchlist wallets (docs/features/watchlist.md): paste a list in Settings; listed wallets among a coin's GMGN top
// holders and traders show on the Check tab (block + finding for a rug-tagged one) and as a tag on Call queue rows.
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const pad = (s) => (s + '1'.repeat(44)).slice(0, 44);
const COIN = pad('WatchCoin'), QUEUED = pad('QueuedCoin');
const W = { smart: pad('SmartGuy'), dev: pad('DevWxyzab'), away: pad('NotHere') };
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    const p = await b.newPage({ viewport: vp });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|openapi\.gmgn\.ai|cdnjs)/, (r) => r.abort());
    await p.route('https://openapi.gmgn.ai/**', (r) => {
      const u = new URL(r.request().url()); const a = u.searchParams.get('address');
      let list = [];
      if (u.pathname.endsWith('token_top_holders') && (a === COIN || a === QUEUED)) list = [{ address: 'PoolX', addr_type: 2, amount_percentage: 0.2 }, { address: W.smart, addr_type: 0, amount_percentage: 0.034 }];
      if (u.pathname.endsWith('token_top_traders') && a === COIN) list = [{ address: W.smart, addr_type: 0, sell_amount_percentage: 0.25, amount_percentage: 0.034 }, { address: W.dev, addr_type: 0, sell_amount_percentage: 1, amount_percentage: 0 }];
      r.fulfill({ json: { code: 0, data: { list } }, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await p.route('https://api.dexscreener.com/**', (r) => { const a = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
      r.fulfill({ json: { pairs: a.map((x) => ({ chainId: 'solana', dexId: 'raydium', pairAddress: 'p' + x.slice(0, 5), url: 'https://dexscreener.com/x', baseToken: { symbol: x.slice(0, 5).toUpperCase(), name: 'x', address: x }, priceUsd: '0.001', marketCap: 300000, liquidity: { usd: 40000 }, volume: { h24: 90000, h1: 5000, m5: 500 }, priceChange: { m5: 1 }, txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 30, sells: 10 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: Date.now() - 2 * 3600e3 })) } }); });
    await p.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 900, topHolders: [{ address: 'H1', owner: 'HO1', pct: 3 }], markets: [] } }));
    await p.addInitScript((d) => {
      if (sessionStorage.getItem('i')) return;
      const now = Date.now();
      const q = { [d.QUEUED]: { address: d.QUEUED, chain: 'solana', symbol: 'QUEUED', mentions: 1, posters: ['x'], channels: [], firstPoster: 'x', firstAt: now - 600e3, lastAt: now - 600e3, snapAt: now - 60e3, snap: { ageMs: 3600e3, fdv: 200000, liq: 30000, priceUsd: 0.0002, top5Pct: 18 }, callMcap: 190000 } };
      localStorage.clear();
      localStorage.setItem('ft_tab', 'settings');
      localStorage.setItem('ft_callView', JSON.stringify('all'));
      localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-calls': true }));
      localStorage.setItem('ft_settings', JSON.stringify({ gmgnKey: 'phone-key' }));
      localStorage.setItem('ft_callQueue', JSON.stringify(q));
      sessionStorage.setItem('i', 1);
    }, { QUEUED });
    await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(300);
    // 1) Settings: paste a messy list
    await p.evaluate(() => showTab('settings'));
    await p.fill('#watchlistText', `${W.smart}  Ansem smart\n${W.dev} dev #rug, ${W.away} someone\nnot a wallet`);
    await p.click('#watchlistSave');
    assert.equal(await p.textContent('#watchlistNote'), '3 wallets saved, 1 line without a wallet address skipped.');
    assert.equal(await p.inputValue('#watchlistText'), `${W.smart} Ansem #smart\n${W.dev} dev #rug\n${W.away} someone`);
    const backup = await p.evaluate(() => store.get('watchlist'));
    assert.equal(backup.list.length, 3, 'saved on the device');
    // 2) Check tab: two of the listed wallets are in this coin
    await p.evaluate(() => showTab('check')); await p.fill('#caInput', COIN); await p.click('#checkForm button[type=submit]');
    await p.waitForFunction(() => checkState.watchlist && !checkState.watchlist.loading, null, { timeout: 10000 }); await p.waitForTimeout(300);
    const block = await p.$eval('[data-fold="watchlist"]', (e) => e.innerText.replace(/\s+/g, ' ').trim());
    console.log(vp.name, 'block:', block);
    assert.match(block, /Your wallets in this coin 2 of yours/);
    assert.match(block, /Ansem Smar…1111 smart holds 3\.4%, sold 25%/);
    assert.match(block, /dev DevW…1111 rug sold/);
    assert.ok(!/someone/.test(block), 'a listed wallet that is not in the coin is not shown');
    assert.equal(await p.$eval('[data-fold="watchlist"]', (e) => e.classList.contains('fold-bad')), true, 'a rug-tagged wallet opens the row as a red flag');
    const findings = await p.$$eval('#verdictCard .findings li', (ls) => ls.map((l) => l.innerText.replace(/\s+/g, ' ')));
    assert.ok(findings.some((f) => /^High 1 of your rug-tagged wallets is in From your watchlist: dev\./i.test(f)), findings.join(' | '));
    await (await p.$('[data-fold="watchlist"]')).screenshot({ path: E2E.OUT + `/watchlist-${vp.name}.png` });
    // 3) Call queue: the queued coin's top holders include a listed wallet
    await p.waitForFunction(() => strengthState.gmgnRead, null, { timeout: 8000 }); // background scans wait for the Check's paced GMGN reads
    await p.evaluate(() => showTab('calls'));
    await p.evaluate(() => researchCalls());
    await p.waitForFunction(() => !callState.busy && callState.queue[Object.keys(callState.queue)[0]].wl, null, { timeout: 10000 });
    await p.evaluate(() => renderCalls());
    assert.match(await p.$eval('#callsCard .call-row', (e) => e.innerText.replace(/\s+/g, ' ')), /QUEUED .*👁 1 of yours/, 'the queue row shows the tag');
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
    assert.deepEqual(errs, []);
    await p.close();
  }
  await b.close();
  console.log('Watchlist E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
