const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const HOT = 'HotMint111111111111111111111111111111111111';
const POS = 'PosMint1111111111111111111111111111111111111';
const gPool = (net, id, sym, v5, v30, v1h, b5, s5, liq = 100000) => ({ id: `${net}_${id}`, type: 'pool', attributes: { name: `${sym} / SOL`, address: id, market_cap_usd: '800000', reserve_in_usd: String(liq), volume_usd: { m5: String(v5), m30: String(v30), h1: String(v1h) }, transactions: { m5: { buys: b5, sells: s5 } }, price_change_percentage: { m5: '4.2' } }, relationships: { base_token: { data: { id: `${net}_${sym === 'HOT' ? HOT : sym + 'Mint'}`, type: 'token' } } } });
const gJson = (net, pools) => ({ data: pools, included: pools.map((p) => ({ id: p.relationships.base_token.data.id, type: 'token', attributes: { address: p.relationships.base_token.data.id.replace(net + '_', ''), symbol: p.attributes.name.split(' / ')[0] } })) });
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    const p = await b.newPage({ viewport: vp });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    let gecko = 'ok'; const geckoHits = [];
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!api\.geckoterminal|api\.dexscreener|cdnjs)/, (r) => r.fulfill({ json: { jsonrpc: '2.0', id: 1, result: { value: 0 } } }));
    await p.route('https://api.geckoterminal.com/**', (r) => {
      const u = new URL(r.request().url()); geckoHits.push(u.pathname + u.search);
      if (gecko !== 'ok') return r.fulfill({ status: 500, json: {} });
      const net = u.pathname.split('/')[4];
      if (u.pathname.endsWith('trending_pools')) return r.fulfill({ json: gJson(net, net === 'solana' ? [gPool(net, 'p1', 'HOT', 30000, 50000, 60000, 50, 20), gPool(net, 'p2', 'CALM', 1000, 9000, 20000, 10, 12), gPool(net, 'p3', 'SOL', 9e6, 9e6, 9e6, 1, 1)] : [gPool(net, 'q1', 'B' + net, 4000, 20000, 30000, 20, 10)]) });
      return r.fulfill({ json: gJson(net, net === 'solana' ? [gPool(net, 'p1', 'HOT', 30000, 50000, 60000, 50, 20)] : []) });
    });
    await p.route('https://api.dexscreener.com/**', (r) => {
      const u = r.request().url();
      if (u.includes('token-boosts')) return r.fulfill({ json: [{ chainId: 'solana', tokenAddress: 'BoostMint1' }, { chainId: 'ethereum', tokenAddress: '0xnope' }] });
      if (u.includes('BoostMint1')) return r.fulfill({ json: { pairs: [{ chainId: 'solana', pairAddress: 'bp', baseToken: { symbol: 'BOOST', address: 'BoostMint1' }, liquidity: { usd: 50000 }, marketCap: 1e6, volume: { m5: 5000, h1: 30000 }, txns: { m5: { buys: 30, sells: 10 } }, priceChange: { m5: 2 } }] } });
      return r.fulfill({ json: { pairs: [{ chainId: 'solana', dexId: 'raydium', pairAddress: 'pp', url: 'https://dexscreener.com/x', baseToken: { symbol: 'POSC', name: 'Pos' }, priceUsd: '1', marketCap: 100000, liquidity: { usd: 40000 }, volume: { h24: 1, h1: 4000, m5: 1200 }, priceChange: { m5: 1 }, txns: { m5: { buys: 1, sells: 1 }, h1: { buys: 1, sells: 1 }, h24: { buys: 1, sells: 1 } }, pairCreatedAt: Date.now() - 3600e3 }] } });
    });
    const now = Date.now();
    await p.addInitScript(([now]) => { if (sessionStorage.getItem('init')) return; localStorage.clear(); localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-market': true, 'check-scanner': true, 'ana-calendar': true, 'ana-timing': true, 'ana-coins': true, 'ana-costs': true, 'ana-charts': true })); localStorage.setItem('ft_tab', 'check');
      localStorage.setItem('ft_marketHistory', JSON.stringify([{ t: now - 3 * 3600e3, h1: 90000, m5: 5000, m30: 40000, mood: 'Cooling' }, { t: now - 3600e3, h1: 110000, m5: 9000, m30: 60000, mood: 'Steady' }]));
      sessionStorage.setItem('init', 1); }, [now]);
    await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(700);
    const text = (sel) => p.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim());
    let card = await text('#marketCard');
    console.log(vp.name, card.slice(0, 520));
    assert.equal(geckoHits.length, 6);
    // solana trending: HOT + CALM (SOL dropped), top: HOT (dup); base & bsc: one pool each
    assert.match(card, /▲ Heating up/);
    assert.match(card, /LAST 5 MIN \$39\.0k 3\.3× the hour's pace/i);   // 39k*12/140k = 3.34
    assert.match(card, /LAST 30 MIN \$99\.0k 1\.4× the hour's pace/i);   // 99k*2/140k = 1.41
    assert.match(card, /BUYERS, 5 MIN 66% 100 buys \/ 52 sells/i);
    assert.match(card, /LAST HOUR \$140\.0k 4 meme pools/i);
    assert.match(card, /Solana \$80\.0k · Base \$30\.0k · BNB \$30\.0k|Solana \$80\.0k · BNB \$30\.0k · Base \$30\.0k/);
    assert.match(card, /HOT Solana mcap \$800\.0k · 5m \$30\.0k · 1h \$60\.0k · 50B \/ 20S · \+4\.2% 5m 6\.0×/);
    assert.equal(await p.$$eval('.mover', (els) => els.length), 1);
    assert.match(await p.$eval('.mover .fomo-btn', (x) => x.href), /^https:\/\/fomo\.family\/tokens\/solana\/[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'movers open in FOMO');
    assert.equal(await p.$$eval('.spark polyline', (els) => els.length), 1);
    assert.equal(await p.$$eval('.spark title', (els) => els.length), 3, 'two seeded readings plus this one');
    await (await p.$('#marketCard')).screenshot({ path: E2E.OUT + `/market-${vp.name}.png` });
    // Check tap
    await p.click('[data-market-ca]'); await p.waitForTimeout(300);
    assert.equal(await p.inputValue('#caInput'), HOT);
    // positions pace
    await p.evaluate(async (POS) => { state.open = [{ address: POS, token: 'POSC', cost: 100, source: 'fomo', openedAt: new Date().toISOString() }]; await refreshMarket(); }, POS);
    card = await text('#marketCard');
    assert.match(card, /YOUR OPEN POSITIONS POSC 3\.6× the hour's pace Waking up/i);
    // fallback to DexScreener when GeckoTerminal fails everywhere
    gecko = 'down'; await p.evaluate(() => refreshMarket());
    card = await text('#marketCard');
    assert.match(card, /LAST 30 MIN – not available from DexScreener/i);
    assert.match(card, /Source: DexScreener/);
    assert.match(card, /LAST HOUR \$30\.0k 1 meme pool Buyers/i);
    assert.equal(await p.$$eval(".mover", (els) => els.length), 0, "BOOST pace 2 is not a mover");
    const hs = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(hs, false);
    console.log(vp.name, 'errors:', errs); assert.equal(errs.length, 0);
    await p.close();
  }
  await b.close(); console.log('MARKET E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
