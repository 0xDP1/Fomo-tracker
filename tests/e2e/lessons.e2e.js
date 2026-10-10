const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const L = require(E2E.ROOT + '/lessons.js');
const WAL = 'Wa11et1111111111111111111111111111111111111';
const NS1 = 'NoSnapMint1111111111111111111111111111111111';
const NS2 = 'NoSnapMint2222222222222222222222222222222222';
const MINT = 'CheckMint11111111111111111111111111111111111';
const POS = 'PosMint1111111111111111111111111111111111111';
const H = 3600000, T0 = Date.parse('2026-09-10T12:00:00Z');
const trade = (addr, pnl, i) => ({ id: 'm' + i, token: addr.slice(0, 5), address: addr, cost: 1, proceeds: 1 + pnl, openedAt: new Date(T0 + i * H).toISOString(), closedAt: new Date(T0 + i * H + H).toISOString(), notes: '', source: 'manual' });
const trades = [], db = {};
for (let i = 0; i < 5; i++) { trades.push(trade('Bund' + i, i === 0 ? 0.5 : -0.4, i)); Object.assign(db, L.addSnapshot(db, 'Bund' + i, L.snapshot({ insiderPct: 20, topHolderPct: 4 }, { verdict: 'Caution', score: 60 }, T0 + i * H))); }
for (let i = 0; i < 5; i++) { trades.push(trade('Clean' + i, i === 0 ? -0.2 : 0.3, 10 + i)); Object.assign(db, L.addSnapshot(db, 'Clean' + i, L.snapshot({ insiderPct: 2, topHolderPct: 4 }, { verdict: 'Looks OK', score: 90 }, T0 + (10 + i) * H))); }
trades.push(trade(NS1, 0.25, 20), trade(NS2, 0.25, 21));

(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    const p = await b.newPage({ viewport: vp });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    let anth = null; const dexHits = [];
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|trench\.bot|api\.anthropic|cdnjs)/, (r) => r.fulfill({ json: { jsonrpc: '2.0', id: 1, result: { value: 0 } } }));
    await p.route('https://api.dexscreener.com/**', (r) => { if (!decodeURIComponent(r.request().url().split('/tokens/')[1] || '').includes(',')) dexHits.push(r.request().url()); r.fulfill({ json: { pairs: [{ chainId: 'solana', dexId: 'raydium', pairAddress: 'pair', url: 'https://dexscreener.com/x', baseToken: { symbol: 'TKN', name: 'Token' }, priceUsd: '0.0001', marketCap: 100000, fdv: 100000, liquidity: { usd: 40000 }, volume: { h24: 250000, h1: 30000, m5: 4000 }, priceChange: { m5: 1, h1: 2, h6: 3, h24: 4 }, txns: { m5: { buys: 5, sells: 5 }, h1: { buys: 120, sells: 80 }, h24: { buys: 900, sells: 700 } }, pairCreatedAt: Date.now() - 5 * 3600e3, info: { socials: [] } }] } }); });
    await p.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, tokenMeta: { mutable: false }, totalHolders: 820, topHolders: [{ address: 'W1', owner: 'W1owner', pct: 6, insider: true }, { address: 'W2', owner: 'W2owner', pct: 4 }], insiderNetworks: [{ size: 9, tokenAmount: 2.6e14 }], markets: [{ pubkey: 'MKT1', lp: { lpLockedPct: 100 } }], risks: [] } }));
    await p.route('https://trench.bot/**', (r) => r.fulfill({ json: { bonded: true, total_bundles: 6, total_percentage_bundled: 41.2, total_holding_percentage: 27.5 } }));
    await p.route('https://api.anthropic.com/**', (r) => { anth = r.request().postDataJSON(); r.fulfill({ json: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Walk away.' }] } }); });
    await p.addInitScript(([WAL, trades, db]) => { if (sessionStorage.getItem('init')) return; localStorage.clear(); localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-market': true, 'check-scanner': true, 'ana-calendar': true, 'ana-timing': true, 'ana-coins': true, 'ana-costs': true, 'ana-charts': true }));
      localStorage.setItem('ft_settings', JSON.stringify({ wallet: WAL, anthropicKey: 'sk-ant-test' }));
      localStorage.setItem(`ft_w_${WAL}_trades`, JSON.stringify(trades)); localStorage.setItem(`ft_w_${WAL}_unit`, '"SOL"');
      localStorage.setItem('ft_holderSnaps', JSON.stringify(db)); sessionStorage.setItem('init', 1); }, [WAL, trades, db]);
    await p.goto(E2E.BASE + '/index.html');
    const text = (sel) => p.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim());
    // 1) Analytics card from seeded data
    await p.click('#tabs button[data-tab=analytics]'); await p.waitForTimeout(300);
    let card = await text('#lessonsCard');
    console.log(vp.name, 'card:', card.slice(0, 330));
    assert.match(card, /Holder data for 10 of 12 closed trades: 10 at entry, 0 checked later/);
    assert.match(card, /Size down or skip: Bundles still holding 10%\+\./);
    assert.match(card, /You won 1 of 5 \(20%\) and lost 1\.10 SOL\. Without it you win 80%\./);
    assert.match(card, /Risk check said Caution or worse/);
    assert.match(card, /Building up: .*One wallet|No lessons|Warning sign/);
    // 2) Backfill: checks the 2 trades with no snapshot, marks them later
    await p.click('#lessonsBackfill'); await p.waitForTimeout(1500);
    card = await text('#lessonsCard');
    assert.match(card, /Checked 2 of 2 trades/);
    assert.match(card, /Holder data for 12 of 12 closed trades: 10 at entry, 2 checked later/);
    assert.match(card, /You won 3 of 7 \(43%\) and lost 0\.60 SOL/);
    assert.equal(dexHits.length, 2);
    await (await p.$('#lessonsCard')).screenshot({ path: E2E.OUT + `/lessons-${vp.name}.png` });
    // 3) Check tab: matching coin gets the history warning; snapshot saved; AI told
    await p.click('#tabs button[data-tab=check]');
    await p.fill('#caInput', MINT); await p.click('#checkForm button[type=submit]'); await p.waitForTimeout(800);
    const warn = await text('#verdictCard .history-warn');
    console.log(vp.name, 'warn:', warn);
    assert.match(warn, /Your history with coins like this Bundles still holding 10%\+\. You won 3 of 7 \(43%\) and lost 0\.60 SOL\. Without it you win 80%\./);
    const saved = await p.evaluate((m) => JSON.parse(localStorage.getItem('ft_holderSnaps'))[m], MINT);
    assert.equal(saved.length, 1); assert.ok(saved[0].bundleHeldPct >= 26); assert.equal(saved[0].after, false);
    await (await p.$('#verdictCard')).screenshot({ path: E2E.OUT + `/history-${vp.name}.png` });
    await p.click('#aiBtn'); await p.waitForTimeout(400);
    const ev = JSON.parse(anth.messages[0].content.replace('Evidence (JSON):\n', ''));
    assert.equal(ev.yourHistory.costlyPatternsThisCoinHas[0].pattern, 'Bundles still holding 10%+');
    assert.match(anth.system, /yourHistory/);
    // re-check within 10 min updates the same snapshot instead of adding one
    await p.click('#checkForm button[type=submit]'); await p.waitForTimeout(800);
    assert.equal((await p.evaluate((m) => JSON.parse(localStorage.getItem('ft_holderSnaps'))[m], MINT)).length, 1);
    // 4) Background snapshot of a new open position
    await p.evaluate(async (POS) => { state.open = [{ address: POS, token: 'POS', cost: 100, openedAt: new Date().toISOString(), source: 'fomo' }]; await autoSnapshotPositions(); }, POS);
    assert.ok(await p.evaluate((m) => !!JSON.parse(localStorage.getItem('ft_holderSnaps'))[m], POS));
    const n = dexHits.length; await p.evaluate(() => autoSnapshotPositions()); await p.waitForTimeout(200);
    assert.equal(dexHits.length, n, 'no second snapshot for a position already on record');
    const hs = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(hs, false);
    console.log(vp.name, 'errors:', errs); assert.equal(errs.length, 0);
    await p.close();
  }
  await b.close(); console.log('LESSONS E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
