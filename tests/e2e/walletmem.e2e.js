const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
// Wallet memory: learns who took profit on Call queue coins that rugged or ran (GMGN top traders), then flags those
// wallets on a new coin in the Check tab (block + finding) and in the Call queue score.
const pad = (s) => (s + '1'.repeat(44)).slice(0, 44);
const NEW = pad('NewCoin'), QUEUED = pad('QueuedCoin');
const RUGS = [pad('RugOne'), pad('RugTwo')], RUNS = [pad('RunOne'), pad('RunTwo')];
const W = { i1: pad('InsiderOne'), i2: pad('InsiderTwo'), s1: pad('SmartOne'), s2: pad('SmartTwo'), bot: pad('SniperBot'), late: pad('LateGuy') };
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    const p = await b.newPage({ viewport: vp });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    const gm = [];
    const calledAt = Date.now() - 30 * 3600e3, sec = Math.floor(calledAt / 1000);
    const trader = (address, profit, startSec) => ({ address, addr_type: 0, realized_profit: profit, start_holding_at: startSec });
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|openapi\.gmgn\.ai|cdnjs)/, (r) => r.abort());
    await p.route('https://openapi.gmgn.ai/**', (r) => {
      const u = new URL(r.request().url()); const a = u.searchParams.get('address');
      gm.push(u.pathname.split('/').pop() + ':' + a.slice(0, 8));
      let list = [];
      if (u.pathname.endsWith('token_top_traders')) {
        if (RUGS.includes(a)) list = [trader(W.i1, 5000, sec - 600), trader(W.i2, 2500, sec - 300), trader(W.bot, 900, sec - 30), trader(W.late, 4000, sec + 3600)];
        else if (RUNS.includes(a)) list = [trader(W.s1, 8000, sec - 120), trader(W.s2, 1500, sec), trader(W.bot, 700, sec - 20)];
        else if (a === NEW) list = [trader(W.s1, 200, Math.floor(Date.now() / 1000) - 900)];
      } else if (u.pathname.endsWith('token_top_holders')) {
        if (a === NEW || a === QUEUED) list = [{ address: 'PoolX', addr_type: 2, amount_percentage: 0.2 }, { address: W.i1, addr_type: 0, amount_percentage: 0.05 }, { address: W.i2, addr_type: 0, amount_percentage: 0.04 }, { address: W.bot, addr_type: 0, amount_percentage: 0.01 }];
      }
      r.fulfill({ json: { code: 0, data: { list } }, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await p.route('https://api.dexscreener.com/**', (r) => { const a = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
      r.fulfill({ json: { pairs: a.map((x) => ({ chainId: 'solana', dexId: 'raydium', pairAddress: 'p' + x.slice(0, 5), url: 'https://dexscreener.com/x', baseToken: { symbol: x.slice(0, 4).toUpperCase(), name: 'x', address: x }, priceUsd: '0.001', marketCap: 300000, liquidity: { usd: 40000 }, volume: { h24: 90000, h1: 5000, m5: 500 }, priceChange: { m5: 1 }, txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 30, sells: 10 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: Date.now() - 2 * 3600e3 })) } }); });
    await p.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 900, topHolders: [{ address: 'H1', owner: 'HO1', pct: 3 }], markets: [] } }));
    await p.addInitScript((d) => {
      if (sessionStorage.getItem('i')) return;
      const book = [
        ...d.RUGS.map((address, i) => ({ symbol: 'RUG' + i, address, chain: 'solana', poster: 'x', at: d.calledAt, price: 1, ret: { '1h': -0.9 } })),
        ...d.RUNS.map((address, i) => ({ symbol: 'RUN' + i, address, chain: 'solana', poster: 'x', at: d.calledAt, price: 1, ret: { '1h': 0.5, '6h': 2.4, '24h': 1.1 } })),
        { symbol: 'MEH', address: 'MehCoin', chain: 'solana', poster: 'x', at: d.calledAt, price: 1, ret: { '1h': 0.1, '6h': 0.2, '24h': -0.3 } },
      ];
      const now = Date.now();
      const q = { [d.QUEUED]: { address: d.QUEUED, chain: 'solana', symbol: 'QUEUED', mentions: 1, posters: ['x'], channels: [], firstPoster: 'x', firstAt: now - 600e3, lastAt: now - 600e3, snapAt: now - 60e3, snap: { ageMs: 3600e3, fdv: 200000, liq: 30000, priceUsd: 0.0002, top5Pct: 18 }, callMcap: 190000 } };
      localStorage.clear();
      localStorage.setItem('ft_tab', 'check');
      localStorage.setItem('ft_callView', JSON.stringify('all'));
      localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-calls': true }));
      localStorage.setItem('ft_settings', JSON.stringify({ gmgnKey: 'phone-key' }));
      localStorage.setItem('ft_callBook', JSON.stringify(book));
      localStorage.setItem('ft_callQueue', JSON.stringify(q));
      sessionStorage.setItem('i', 1);
    }, { RUGS, RUNS, QUEUED, calledAt });
    await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html');
    // learning happens at the end of each queue refresh, 3 coins at a time
    for (let i = 0; i < 3; i++) { await p.waitForFunction(() => !callState.busy, null, { timeout: 8000 }); await p.evaluate(() => researchCalls()); }
    await p.waitForFunction(() => !callState.busy, null, { timeout: 8000 });
    const mem = await p.evaluate(() => wmState.mem);
    assert.deepEqual(Object.keys(mem.coins).sort(), [...RUGS, ...RUNS].sort(), 'learned the two rugs and two runners only');
    assert.deepEqual(mem.wallets[W.i1], { rug: 2, run: 0, usd: 10000, last: mem.wallets[W.i1].last });
    assert.equal(mem.wallets[W.late], undefined, 'a wallet that bought well after the call is not remembered');
    assert.equal(gm.filter((x) => x.startsWith('token_top_traders:RugOne')).length, 1, 'each finished coin is asked about once');
    const card = await p.$eval('#callsCard', (e) => e.innerText.replace(/\s+/g, ' '));
    assert.match(card, /Wallet memory: learned from 2 rugs and 2 runners · 5 wallets \(2 rug, 2 runner, 1 bot; a wallet needs 2 coins to be graded\)/);
    assert.match(await p.$eval('#callsCard .call-row', (e) => e.innerText.replace(/\s+/g, ' ')), /QUEUED .*2 rug wallets in/, 'the queue row is flagged');
    // Check tab: a new coin with two known rug wallets
    gm.length = 0;
    await p.evaluate(() => showTab('check')); await p.fill('#caInput', NEW); await p.click('#checkForm button[type=submit]');
    await p.waitForFunction(() => checkState.walletMem && !checkState.walletMem.loading, null, { timeout: 8000 }); await p.waitForTimeout(500);
    const block = await p.$eval('[data-fold="wallets"]', (e) => e.innerText.replace(/\s+/g, ' ').trim());
    assert.match(block, /Wallet memory 2 rug wallets/);
    assert.match(block, /2 rug wallets \(profited on 4 earlier rugs between them\) · 1 runner wallet · 1 bot among this coin's top holders and traders/);
    assert.match(block, /Learned from 2 rugs and 2 runners in your Call queue/);
    const findings = await p.$$eval('#verdictCard .findings li', (ls) => ls.map((l) => l.innerText.replace(/\s+/g, ' ')));
    assert.ok(findings.some((f) => /^High 2 wallets that profited on earlier rugs are in/i.test(f)), findings.join(' | '));
    assert.deepEqual(gm.filter((x) => x.endsWith(':NewCoin1')).sort(), ['token_top_holders:NewCoin1', 'token_top_traders:NewCoin1'], 'the Check tab blocks share their GMGN requests');
    await (await p.$('.wm-block')).screenshot({ path: E2E.OUT + `/walletmem-${vp.name}.png` });
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
    assert.deepEqual(errs, []);
    await p.close();
  }
  await b.close();
  console.log('WALLET MEMORY E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
