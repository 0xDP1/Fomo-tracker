const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const MINT = 'CoinMint11111111111111111111111111111111111';
const T0 = Math.floor(Date.now() / 1000) - 5 * 86400;
const fund = (from, to, ts, i) => ({ signature: `${to}-f${i}`, timestamp: ts, type: 'TRANSFER', feePayer: from, fee: 5000, nativeTransfers: [{ fromUserAccount: from, toUserAccount: to, amount: 2e9 }], tokenTransfers: [], accountData: [] });
const buy = (who, ts, i) => ({ signature: `${who}-b${i}`, timestamp: ts, type: 'SWAP', feePayer: who, fee: 5000, nativeTransfers: [], tokenTransfers: [{ fromUserAccount: 'PoolVault', toUserAccount: who, mint: MINT, tokenAmount: 100 }], accountData: [] });
const other = (who, ts, i) => ({ signature: `${who}-o${i}`, timestamp: ts, type: 'SWAP', feePayer: who, fee: 5000, nativeTransfers: [], tokenTransfers: [{ fromUserAccount: 'P', toUserAccount: who, mint: 'OtherCoin', tokenAmount: 1 }], accountData: [] });
const histories = {
  OpA: [fund('Mastermind', 'OpA', T0, 0), buy('OpA', T0 + 600, 0)],
  OpB: [fund('Mastermind', 'OpB', T0 + 3600, 0), buy('OpB', T0 + 4000, 0)],
  OpC: [fund('Mastermind', 'OpC', T0 + 7200, 0), buy('OpC', T0 + 7500, 0)],
  Gift: [fund('Someone', 'Gift', T0, 0), { signature: 'Gift-g', timestamp: T0 + 9000, type: 'TRANSFER', feePayer: 'OpA', fee: 5000, nativeTransfers: [], tokenTransfers: [{ fromUserAccount: 'OpA', toUserAccount: 'Gift', mint: MINT, tokenAmount: 50 }], accountData: [] }],
  Oldie: [fund('5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9', 'Oldie', T0 - 90 * 86400, 0)].concat(Array.from({ length: 148 }, (_, i) => other('Oldie', T0 - 80 * 86400 + i * 3600, i)), [buy('Oldie', T0 + 100, 0)]),
  Busy: Array.from({ length: 260 }, (_, i) => other('Busy', T0 - i * 600, i)).concat([buy('Busy', T0 + 50, 0)]),
};
const holders = [['OpA', 4], ['OpB', 4], ['OpC', 3], ['Gift', 1], ['Oldie', 6], ['Busy', 2]];
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    const p = await b.newPage({ viewport: vp });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    const hel = [];
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|api\.helius|api\.mainnet-beta|cdnjs)/, (r) => r.abort());
    await p.route('https://api.mainnet-beta.solana.com/**', (r) => r.fulfill({ json: { jsonrpc: '2.0', id: 1, result: { value: 3e9 } } }));
    await p.route('https://api.dexscreener.com/**', (r) => r.fulfill({ json: { pairs: [{ chainId: 'solana', dexId: 'raydium', pairAddress: 'pp', url: 'https://dexscreener.com/x', baseToken: { symbol: 'OPS', name: 'Ops', address: MINT }, priceUsd: '0.0005', marketCap: 500000, liquidity: { usd: 100000 }, volume: { h24: 100000, h1: 9000, m5: 900 }, priceChange: { m5: 1 }, txns: { m5: { buys: 5, sells: 3 }, h1: { buys: 40, sells: 30 }, h24: { buys: 400, sells: 300 } }, pairCreatedAt: Date.now() - 5 * 86400e3 }] } }));
    await p.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 900, topHolders: [{ address: 'PoolAcct', owner: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', pct: 20 }].concat(holders.map(([a, pct]) => ({ address: a + 'Ata', owner: a, pct }))), markets: [{ pubkey: 'm', lp: { lpLockedPct: 100 } }] } }));
    await p.route('https://api.helius.xyz/**', (r) => {
      const u = new URL(r.request().url()); const addr = decodeURIComponent(u.pathname.split('/')[3]); const before = u.searchParams.get('before'); hel.push(addr + (before ? '+' : ''));
      const all = (histories[addr] || []).slice().sort((x, y) => y.timestamp - x.timestamp);
      const start = before ? all.findIndex((t) => t.signature === before) + 1 : 0;
      r.fulfill({ json: all.slice(start, start + 100) });
    });
    await p.addInitScript(() => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_tab', 'check'); localStorage.setItem('ft_settings', JSON.stringify({ heliusKey: 'hk' })); sessionStorage.setItem('i', 1); });
    await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(400);
    await p.fill('#caInput', MINT); await p.click('#checkForm button[type=submit]'); await p.waitForTimeout(900);
    hel.length = 0;
    await p.click('#deepBtn');
    await p.waitForFunction(() => checkState.holderDeep && checkState.operators, null, { timeout: 10000 });
    await p.waitForTimeout(200);
    const text = (sel) => p.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim());
    const op = await text('.op-block');
    console.log(vp.name, op);
    assert.match(op, /1 operator found\. Biggest: 4 linked wallets with 12\.0% of supply · selling into the pool would drop the price about 7\d%/);
    assert.match(op, /Operator 1: OpA…OpA, OpB…OpB, OpC…OpC, Gift…Gift \(12\.0%\)/);
    assert.match(op, /Received by transfer instead of bought: 1\.0% of supply · virgin wallets \(never traded another token\): 12\.0% · out of 20\.0% analyzed/);
    const rows = await p.$$eval('.deep-table tbody tr', (rs) => rs.map((r) => r.innerText.replace(/\s+/g, ' ')));
    assert.equal(rows.filter((r) => /Op 1/.test(r)).length, 4);
    assert.ok(rows.some((r) => /Gift.*Got by transfer/.test(r)));
    const findings = await p.$$eval('#verdictCard .findings li', (ls) => ls.map((l) => l.innerText.replace(/\s+/g, ' ')));
    assert.ok(findings.some((f) => /^Critical One operator controls 4 wallets 4 linked wallets hold 12% of supply together\. If they sold into the pool the price would drop about 7\d%/i.test(f)), findings.join(' | '));
    assert.equal(hel.filter((h) => h.endsWith('+')).length, 2, 'only the two busy wallets get a second page');
    assert.equal(hel.length, 8);
    const snap = await p.evaluate((m) => { const l = JSON.parse(localStorage.getItem('ft_holderSnaps'))[m]; return l[l.length - 1]; }, MINT);
    assert.equal(snap.operatorWallets, 4); assert.ok(snap.operatorDrop > 0.7);
    await (await p.$('#holderDeep')).screenshot({ path: E2E.OUT + `/operator-${vp.name}.png` });
    const hs = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(hs, false);
    console.log(vp.name, 'errors:', errs); assert.equal(errs.length, 0);
    await p.close();
  }
  await b.close(); console.log('OPERATOR E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
