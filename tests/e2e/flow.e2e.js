const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const REAL = 'Rea1Mint11111111111111111111111111111111111';
const WASH = 'WashMint11111111111111111111111111111111111';
const EVM = '0x4bc1782fafb967834e0e75947ba15113e48fc70e';
const now = () => Math.floor(Date.now() / 1000);
function swaps(mint) {
  const out = [];
  if (mint === REAL) {
    for (let i = 0; i < 25; i++) out.push({ w: 'Buyer' + i, side: 'buy', amt: 1000, ago: 2 + i * 2 });
    for (let i = 0; i < 15; i++) out.push({ w: 'Seller' + i, side: 'sell', amt: 800, ago: 3 + i * 3 });
  } else {
    for (let i = 0; i < 30; i++) out.push({ w: 'Bot', side: i % 2 ? 'buy' : 'sell', amt: 5000, ago: 1 + i });
    for (let i = 0; i < 6; i++) out.push({ w: 'Small' + i, side: 'buy', amt: 300, ago: 2 + i });
  }
  return out.sort((a, b) => a.ago - b.ago).map((s, i) => ({ signature: mint.slice(0, 4) + i, timestamp: now() - s.ago * 60, feePayer: s.w, fee: 5000,
    tokenTransfers: [s.side === 'buy' ? { fromUserAccount: 'Pool', toUserAccount: s.w, mint, tokenAmount: s.amt } : { fromUserAccount: s.w, toUserAccount: 'Pool', mint, tokenAmount: s.amt }] }));
}
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    const p = await b.newPage({ viewport: vp });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    const hel = [];
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|api\.helius|api\.geckoterminal|cdnjs)/, (r) => r.abort());
    await p.route('https://api.helius.xyz/**', (r) => {
      const u = new URL(r.request().url()); const addr = decodeURIComponent(u.pathname.split('/')[3]); hel.push(addr + (u.searchParams.get('before') ? ' before' : ''));
      if (addr === REAL || addr === WASH) {
        const all = swaps(addr); const before = u.searchParams.get('before');
        const start = before ? all.findIndex((t) => t.signature === before) + 1 : 0;
        return r.fulfill({ json: all.slice(start, start + 100) });
      }
      // wallet history: Buyer0-2 are fresh (10 txs), everyone else has 100+
      return r.fulfill({ json: new Array(/^Buyer[0-2]$/.test(addr) ? 10 : 100).fill({ signature: 'x', timestamp: now() }) });
    });
    await p.route('https://api.dexscreener.com/**', (r) => { const a = decodeURIComponent(r.request().url().split('/tokens/')[1]); const evm = a.startsWith('0x');
      r.fulfill({ json: { pairs: [{ chainId: evm ? 'base' : 'solana', dexId: 'raydium', pairAddress: 'pp', url: 'https://dexscreener.com/x', baseToken: { symbol: a.slice(0, 4).toUpperCase(), name: 'x', address: a }, priceUsd: '0.001', marketCap: 300000, liquidity: { usd: 50000 }, volume: { h24: 100000, h1: 20000, m5: 3000 }, priceChange: { m5: 1 }, txns: { m5: { buys: 5, sells: 3 }, h1: { buys: 40, sells: 30 }, h24: { buys: 400, sells: 300 } }, pairCreatedAt: Date.now() - 3600e3 }] } }); });
    await p.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 900, topHolders: [{ address: 'H', owner: 'HO', pct: 3 }], markets: [{ pubkey: 'm', lp: { lpLockedPct: 100 } }] } }));
    await p.route('https://api.geckoterminal.com/**', (r) => { const u = new URL(r.request().url()); const net = u.pathname.split('/')[4];
      if (net !== 'solana' || !u.pathname.endsWith('trending_pools')) return r.fulfill({ json: { data: [] } });
      r.fulfill({ json: { data: [{ id: 'solana_p1', attributes: { name: 'REAL / SOL', address: 'p1', market_cap_usd: '300000', reserve_in_usd: '50000', volume_usd: { m5: '30000', m30: '50000', h1: '60000' }, transactions: { m5: { buys: 50, sells: 20 } }, price_change_percentage: { m5: '3' } }, relationships: { base_token: { data: { id: 'solana_' + REAL } } } }], included: [{ id: 'solana_' + REAL, type: 'token', attributes: { address: REAL, symbol: 'REAL' } }] } }); });
    await p.addInitScript(() => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-market': true, 'check-scanner': true, 'ana-calendar': true, 'ana-timing': true, 'ana-coins': true, 'ana-costs': true, 'ana-charts': true })); localStorage.setItem('ft_tab', 'check'); localStorage.setItem('ft_settings', JSON.stringify({ heliusKey: 'hk' })); sessionStorage.setItem('i', 1); });
    await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(600);
    const text = (sel) => p.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim());
    // REAL: crowd buying
    hel.length = 0;
    await p.fill('#caInput', REAL); await p.click('#checkForm button[type=submit]');
    await p.waitForFunction(() => checkState.flow && !checkState.flow.loading, null, { timeout: 8000 });
    let fb = await text('.flow-block');
    console.log(vp.name, fb);
    assert.match(fb, /Real demand/);
    assert.match(fb, /25 buyers vs 15 sellers in the hour/);
    assert.match(fb, /60 min \$25 \$12 25 15/);
    assert.equal(hel.filter((h) => h.startsWith(REAL)).length, 1, 'one page covers this coin (40 swaps)');
    assert.equal(hel.length, 1, 'buyers are not looked up until tapped');
    assert.ok(!/fresh wallets among/.test(fb));
    assert.match(fb, /Check fresh wallets Are the 8 biggest buyers brand-new wallets\? Uses 8 Helius reads\./);
    await p.click('#freshBtn');
    await p.waitForFunction(() => checkState.flow.fresh && !checkState.flow.freshLoading, null, { timeout: 8000 });
    fb = await text('.flow-block');
    assert.match(fb, /fresh wallets among the 8 biggest buyers: 3/);
    assert.equal(await p.$('#freshBtn'), null, 'the button goes once checked');
    assert.equal(hel.length, 9, '1 page + 8 buyer histories after the tap');
    // the same coin again within 10 minutes: the saved Flow (with its fresh-wallet count), no Helius reads
    hel.length = 0;
    await p.fill('#caInput', REAL); await p.click('#checkForm button[type=submit]');
    await p.waitForFunction(() => checkState.risk && checkState.flow && !checkState.flow.loading, null, { timeout: 8000 }); await p.waitForTimeout(300);
    assert.equal(hel.length, 0, 're-check within 10 minutes reuses Flow');
    assert.match(await text('.flow-block'), /Real demand.*fresh wallets among the 8 biggest buyers: 3/);
    // Refresh reads again
    await p.click('#flowBtn');
    await p.waitForFunction(() => checkState.flow && !checkState.flow.loading, null, { timeout: 8000 }); await p.waitForTimeout(200);
    assert.equal(hel.length, 1, 'Refresh reads the coin again (buyers still on tap)');
    await (await p.$('.flow-block')).screenshot({ path: E2E.OUT + `/flow-${vp.name}.png` });
    // WASH: one wallet is the volume -> high finding
    await p.fill('#caInput', WASH); await p.click('#checkForm button[type=submit]');
    await p.waitForFunction(() => checkState.flow && !checkState.flow.loading && checkState.ca.startsWith('Wash'), null, { timeout: 8000 });
    fb = await text('.flow-block');
    assert.match(fb, /One wallet is the volume/);
    const findings = await p.$$eval('#verdictCard .findings li', (ls) => ls.map((l) => l.innerText.replace(/\s+/g, ' ')));
    assert.ok(findings.some((f) => /^High One wallet is the volume A single wallet made 9\d% of the last hour/i.test(f)), findings.join(' | '));
    // EVM coin
    await p.fill('#caInput', EVM); await p.click('#checkForm button[type=submit]'); await p.waitForTimeout(800);
    assert.match(await text('.flow-block'), /Not available on this chain/);
    // Movers: on-demand Flow button
    await p.evaluate(() => refreshMarket()); await p.waitForTimeout(400);
    await p.click(`[data-flow-ca="${REAL}"]`);
    await p.waitForFunction(() => !document.querySelector('#marketCard').innerText.includes('Reading…'), null, { timeout: 8000 });
    assert.match(await text('.mover'), /REAL Solana .*6\.0× Real demand FOMO Check/);
    // no key
    await p.evaluate(() => { state.settings.heliusKey = ''; });
    await p.fill('#caInput', REAL); await p.click('#checkForm button[type=submit]'); await p.waitForTimeout(800);
    assert.match(await text('.flow-block'), /Add a Helius API key/);
    const hs = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(hs, false);
    console.log(vp.name, 'errors:', errs); assert.equal(errs.length, 0);
    await p.close();
  }
  await b.close(); console.log('FLOW E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
