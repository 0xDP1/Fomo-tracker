const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const H = 3600e3;
const M = (s) => (s.replace(/[0OIl]/g, 'x') + 'Mint1111111111111111111111111111111111111').slice(0, 44);
const BASEY = '0x00000000000000000000000000000000000ba5e1';
const coins = {
  GOOD:   { net: 'solana', addr: M('GOOD'), age: 5 * H, liq: 50000, vol: 200000, mcap: 500000, trades: [120, 80], h1: [30, 10], top: [3, 2] },
  OKAY:   { net: 'solana', addr: M('OKAY'), age: 6 * H, liq: 40000, vol: 150000, mcap: 400000, trades: [100, 60], h1: [10, 8], top: [4, 3] },
  NEWBIE: { net: 'solana', addr: M('NEWBIE'), age: 5 * 60e3, liq: 50000, vol: 200000, mcap: 500000 },
  THIN:   { net: 'solana', addr: M('THIN'), age: 5 * H, liq: 5000, vol: 200000, mcap: 500000 },
  QUIET:  { net: 'solana', addr: M('QUIET'), age: 5 * H, liq: 50000, vol: 90000, mcap: 500000, trades: [25, 15], h1: [1, 1] },
  WHALE:  { net: 'solana', addr: M('WHALE'), age: 5 * H, liq: 50000, vol: 120000, mcap: 500000, trades: [100, 90], h1: [5, 5], top: [12, 3] },
  BASEY:  { net: 'base', addr: BASEY, age: 5 * H, liq: 50000, vol: 110000, mcap: 500000, trades: [100, 90], h1: [5, 5], honeypot: true },
  USDC:   { net: 'solana', addr: M('USDC'), age: 5 * H, liq: 9e6, vol: 9e6, mcap: 9e9 },
};
const bySym = Object.fromEntries(Object.entries(coins).map(([k, v]) => [v.addr.toLowerCase(), k]));
let goodPrice = '0.01';
const judgeReply = { GOOD: { concentration_is_exit_risk: 0.2, momentum_already_spent: 0.3, liquidity_fits_ticket: 0.8, dev_still_loaded: 0.2, crowd: 0.75, shape: 'building', worth_trading_at_all: 0.8, confidence: 0.7, reason: 'Broad buying with thin holder concentration.' },
  OKAY: { concentration_is_exit_risk: 0.3, momentum_already_spent: 0.4, liquidity_fits_ticket: 0.7, dev_still_loaded: 0.3, crowd: 0.4, shape: 'steady', worth_trading_at_all: 0.65, confidence: 0.6, reason: 'Few independent buyers.' } };
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const sc of [{ name: 'phone', vp: { width: 390, height: 844 }, key: true }, { name: 'desktop', vp: { width: 1280, height: 900 }, key: true }, { name: 'nokey', vp: { width: 390, height: 844 }, key: false }]) {
    const p = await b.newPage({ viewport: sc.vp });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    let claudeCalls = 0, schemaSeen = null;
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!api\.geckoterminal|api\.dexscreener|api\.rugcheck|api\.gopluslabs|api\.anthropic|cdnjs)/, (r) => r.abort());
    await p.route('https://api.geckoterminal.com/**', (r) => {
      const u = new URL(r.request().url()); const net = u.pathname.split('/')[4];
      if (!u.pathname.endsWith('new_pools') || u.searchParams.get('page') !== '1') return r.fulfill({ json: { data: [] } });
      const list = Object.entries(coins).filter(([, c]) => c.net === net);
      r.fulfill({ json: { data: list.map(([s, c]) => ({ id: `${net}_${s}`, attributes: { name: `${s} / SOL`, address: 'pool' + s, pool_created_at: new Date(Date.now() - c.age).toISOString(), reserve_in_usd: String(c.liq), market_cap_usd: String(c.mcap), volume_usd: { h24: String(c.vol) } }, relationships: { base_token: { data: { id: `${net}_${c.addr}` } } } })), included: list.map(([s, c]) => ({ id: `${net}_${c.addr}`, type: 'token', attributes: { address: c.addr, symbol: s } })) } });
    });
    await p.route('https://api.dexscreener.com/**', (r) => {
      const addrs = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
      r.fulfill({ json: { pairs: addrs.map((a) => bySym[a.toLowerCase()]).filter(Boolean).filter((s) => coins[s].trades).map((s) => { const c = coins[s]; return { chainId: c.net, dexId: 'raydium', pairAddress: 'pair' + s, url: 'https://dexscreener.com/x', baseToken: { symbol: s, name: s, address: c.addr }, priceUsd: s === 'GOOD' ? goodPrice : '1', marketCap: c.mcap, liquidity: { usd: c.liq }, volume: { h24: c.vol, h1: 20000, m5: 3000 }, priceChange: { m5: 2, h1: 10, h6: 20, h24: 40 }, txns: { m5: { buys: 5, sells: 2 }, h1: { buys: c.h1[0], sells: c.h1[1] }, h24: { buys: c.trades[0], sells: c.trades[1] } }, pairCreatedAt: Date.now() - c.age }; }) } });
    });
    await p.route('https://api.rugcheck.xyz/**', (r) => { const s = bySym[r.request().url().split('/tokens/')[1].split('/')[0].toLowerCase()]; const c = coins[s];
      r.fulfill({ json: { token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 900, topHolders: c.top.map((pct, i) => ({ address: 'H' + i + s, owner: 'O' + i + s, pct })), markets: [] } }); });
    await p.route('https://api.gopluslabs.io/**', (r) => r.fulfill({ json: { result: { [BASEY]: { is_honeypot: '1', buy_tax: '0', sell_tax: '0', holder_count: '500', holders: [] } } } }));
    await p.route('https://api.anthropic.com/**', (r) => { claudeCalls++; const body = r.request().postDataJSON(); schemaSeen = body.output_config;
      const sym = JSON.parse(body.messages[0].content.replace('Evidence (JSON):\n', '')).token.symbol;
      r.fulfill({ json: { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(judgeReply[sym]) }] } }); });
    await p.addInitScript((key) => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-market': true, 'check-scanner': true, 'ana-calendar': true, 'ana-timing': true, 'ana-coins': true, 'ana-costs': true, 'ana-charts': true })); localStorage.setItem('ft_tab', 'check'); if (key) localStorage.setItem('ft_settings', JSON.stringify({ anthropicKey: 'sk-ant-test' })); sessionStorage.setItem('i', 1); }, sc.key);
    goodPrice = '0.01';
    await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(500);
    await p.click('#scanBtn'); await p.waitForFunction(() => !scanState.busy, null, { timeout: 15000 });
    const text = (sel) => p.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim());
    let card = await text('#scannerCard');
    console.log(sc.name, card.slice(0, 700));
    await p.click('.scan-cut summary');
    const cutText = await text('.scan-cut');
    assert.match(cutText, /Cut 5 of 7 coins: free 2 · trade 1 · chain 2/);
    assert.match(cutText, /NEWBIE Solana · Free cut: too new \(under 15 min\)/);
    assert.match(cutText, /THIN Solana · Free cut: liquidity \$5k under \$12k/);
    assert.match(cutText, /QUIET Solana · Trade cut: 40 trades in 24h, under 150/);
    assert.match(cutText, /WHALE Solana · Chain cut: top wallet holds 12\.0%, over 5%/);
    assert.match(cutText, /BASEY Base · Chain cut: honeypot/);
    assert.ok(!/USDC/.test(card + cutText), 'stablecoin pools are dropped before the cuts');
    if (sc.key) {
      assert.equal(claudeCalls, 2);
      assert.equal(schemaSeen.format.type, 'json_schema'); assert.equal(schemaSeen.effort, 'low');
      assert.match(card, /Pick: GOOD Solana mcap \$500\.0k · liq \$50\.0k FOMO Check Broad buying with thin holder concentration\./);
      assert.match(card, /OKAY Solana .*Failed: not enough of a real crowd \(0\.40\)/);
      assert.match(card, /Paper trades \(1 pick\)/i);
      assert.equal(await p.$eval('.scan-pick .fomo-btn', (x) => x.href), `https://fomo.family/tokens/solana/${coins.GOOD.addr}`, 'the pick opens in FOMO');
      assert.equal(await p.$eval('.scan-pick .fomo-btn', (x) => x.target), '_blank');
      await (await p.$('#scannerCard')).screenshot({ path: E2E.OUT + `/scanner-${sc.name}.png` });
      // one hour later the paper trade is priced at +50%
      goodPrice = '0.015';
      await p.evaluate(async () => { scanState.book = scanState.book.map((x) => Object.assign({}, x, { at: x.at - 3600e3 - 60e3 })); await updatePaper(); });
      card = await text('#scannerCard');
      assert.match(card, /1h 1 100% \+50%/);
      assert.match(card, /GOOD .* 1h \+50% · 6h … · 24h …/);
      await p.click('[data-scan-ca]'); await p.waitForTimeout(300);
      assert.equal(await p.inputValue('#caInput'), coins.GOOD.addr);
    } else {
      assert.equal(claudeCalls, 0);
      assert.match(card, /No pick this scan\. The judge needs an Anthropic API key/);
      assert.match(card, /GOOD Solana/); assert.match(card, /OKAY Solana/);
    }
    const hs = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(hs, false);
    console.log(sc.name, 'errors:', errs); assert.equal(errs.length, 0);
    await p.close();
  }
  await b.close(); console.log('SCANNER E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
