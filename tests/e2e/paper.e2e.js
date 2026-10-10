const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
// Paper trades: follow a wallet (its GMGN buys open positions), AI picks on Best-list coins (Claude faked), the exit
// rules on price updates, results per source, reset. Nothing real is ever bought.
const pad = (s) => (s + '1'.repeat(44)).slice(0, 44);
const WALLET = pad('SmartWa'), WCOIN = pad('WalletCoin'), RUGCOIN = pad('RugCoin'), AICOIN = pad('StrongCoin'), SKIPCOIN = pad('MehCoin');
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    const p = await b.newPage({ viewport: vp });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    const price = { [WCOIN]: '0.001', [RUGCOIN]: '0.5', [AICOIN]: '0.0002', [SKIPCOIN]: '0.0002' };
    const ai = [], gm = [];
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!api\.dexscreener|openapi\.gmgn\.ai|api\.anthropic|cdnjs)/, (r) => r.abort());
    await p.route('https://openapi.gmgn.ai/**', (r) => {
      const u = new URL(r.request().url());
      gm.push(u.pathname + ':' + u.searchParams.get('type'));
      const t = Math.floor(Date.now() / 1000) + 30;
      const data = u.pathname.endsWith('wallet_activity') ? { activities: [
        { event_type: 'buy', token: { address: WCOIN, symbol: 'WCOIN' }, timestamp: t, price_usd: 0.0009, cost_usd: 400, tx_hash: 'tx1' },
        { event_type: 'buy', token: { address: RUGCOIN, symbol: 'RUGGY' }, timestamp: t, price_usd: 0.5, cost_usd: 300, tx_hash: 'tx2' },
        { event_type: 'transferIn', token: { address: pad('Airdrop') }, timestamp: t, cost_usd: 999, tx_hash: 'tx3' },
      ], next: null } : { list: [] };
      r.fulfill({ json: { code: 0, data }, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await p.route('https://api.dexscreener.com/**', (r) => { const a = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
      r.fulfill({ json: { pairs: a.filter((x) => price[x] !== null).map((x) => ({ chainId: 'solana', dexId: 'raydium', pairAddress: 'p' + x.slice(0, 6), url: 'https://dexscreener.com/x', baseToken: { symbol: x.slice(0, 4).toUpperCase(), name: 'x', address: x }, priceUsd: price[x] || '0.001', marketCap: 200000, liquidity: { usd: 30000 }, volume: { h24: 90000 }, txns: { h24: { buys: 1, sells: 1 } }, pairCreatedAt: Date.now() - 3600e3 })) } }); });
    await p.route('https://api.anthropic.com/**', (r) => {
      const body = JSON.parse(r.request().postData());
      ai.push(body);
      const enter = /STRONG/.test(body.messages[0].content);
      r.fulfill({ json: { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ enter, reason: enter ? 'three callers and a clean launch' : 'too weak' }) }] }, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await p.addInitScript((d) => {
      if (sessionStorage.getItem('i')) return;
      const now = Date.now(), snap = { ageMs: 20 * 60000, fdv: 200000, liq: 30000, priceUsd: 0.0002, top5Pct: 15 };
      const coin = (address, sym, posters, chans, poster) => ({ address, chain: 'solana', symbol: sym, mentions: posters.length, posters, channels: chans, firstPoster: poster, firstAt: now - 10 * 60000, lastAt: now - 60000, snapAt: now - 30000, snap, callMcap: 190000 });
      const q = { [d.AICOIN]: coin(d.AICOIN, 'STRONG', ['alice', 'b', 'c'], ['first scan', 'group traction'], 'alice'), [d.SKIPCOIN]: coin(d.SKIPCOIN, 'MEH', ['bob', 'c'], ['first scan'], 'bob') };
      localStorage.clear();
      localStorage.setItem('ft_tab', 'calls');
      localStorage.setItem('ft_uiOpen', JSON.stringify({ 'calls-paper': true }));
      localStorage.setItem('ft_settings', JSON.stringify({ gmgnKey: 'g', anthropicKey: 'sk-test' }));
      localStorage.setItem('ft_callQueue', JSON.stringify(q));
      localStorage.setItem('ft_callCallers', JSON.stringify({ alice: { winRate: 62, medal: 'gold' }, bob: { winRate: 50, medal: 'silver' } }));
      sessionStorage.setItem('i', 1);
    }, { AICOIN, SKIPCOIN });
    await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(500);
    const card = () => p.$eval('#paperCard', (e) => e.innerText.replace(/\s+/g, ' '));
    const update = async () => { await p.click('#paperRefresh'); await p.waitForFunction(() => !paperBusy, null, { timeout: 8000 }); await p.waitForTimeout(100); };
    assert.match(await card(), /Fake money: \$100 a trade.*No paper trades yet/);
    // follow a wallet: its two real buys open positions, the airdrop does not
    await p.fill('#paperWallet', WALLET); await p.selectOption('#paperChain', 'sol'); await p.fill('#paperLabel', 'smart one');
    await p.click('#paperWalletForm button[type=submit]');
    await p.waitForFunction(() => !paperBusy && paperState.positions.length >= 2, null, { timeout: 8000 });
    assert.ok(gm.includes('/v1/user/wallet_activity:buy'), 'asks GMGN for the wallet\'s buys');
    let pos = await p.evaluate(() => paperState.positions.map((x) => [x.symbol, x.source.slice(0, 7), x.entry]));
    assert.deepEqual(pos, [['WCOIN', 'wallet:', 0.001], ['RUGGY', 'wallet:', 0.5]], 'opened at the price now, not the wallet\'s');
    // AI picks: the strong coin is entered, the weak one skipped, each decided once
    await p.check('#paperAiOn');
    await p.waitForFunction(() => !paperBusy && paperState.decided && Object.keys(paperState.decided).length === 2, null, { timeout: 8000 });
    assert.equal(ai.length, 2);
    assert.equal(ai[0].model, 'claude-haiku-5-5');
    assert.match(ai[0].messages[0].content, /Call score \d+\/100/);
    assert.ok(await p.evaluate(() => paperState.positions.some((x) => x.source === 'ai' && x.symbol === 'STRONG')));
    assert.ok(!(await p.evaluate(() => paperState.positions.some((x) => x.symbol === 'MEH'))), 'a skip opens nothing');
    // prices move: half at 2×, the rest at 3×; the rugged pool closes at nothing; the AI coin drops through the stop
    price[WCOIN] = '0.0021'; price[RUGCOIN] = null; price[AICOIN] = '0.0001';
    await update();
    price[WCOIN] = '0.0032';
    await update();
    assert.equal(ai.length, 2, 'no coin is decided twice');
    const text = await card();
    assert.match(text, /Results Source Trades Win % Avg P&L smart one 2 50% \+3\d% \+\$65 AI picks 1 0% -50% -\$50/i, 'WCOIN: half at 2.1x ($105) + half at 3.2x ($160) = +$165; RUGGY -$100');
    assert.match(text, /Closed Coin Source Exit Result/i);
    assert.match(text, /WCOIN smart one 2×, 3× \+16\d%/);
    assert.match(text, /RUGGY smart one pool gone -100%/);
    assert.match(text, /STRONG AI picks stop -50%/);
    assert.match(await p.$eval('#paperSummary', (e) => e.textContent), /0 open · \+\$\d+/);
    await (await p.$('#paperCard')).screenshot({ path: E2E.OUT + `/paper-${vp.name}.png` });
    // reset keeps the wallet, clears trades
    p.once('dialog', (d) => d.accept());
    await p.click('#paperReset');
    assert.match(await card(), /smart one ✕.*No paper trades yet/);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
    assert.deepEqual(errs, []);
    await p.close();
  }
  await b.close();
  console.log('PAPER E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
