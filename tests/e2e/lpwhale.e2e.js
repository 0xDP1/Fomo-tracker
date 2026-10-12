const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
// The owner's case (2026-10-12): a PumpSwap coin whose LP RugCheck reports as 0% locked and whose largest wallet holds
// 2.9%. Launchpad pools hold their own liquidity, so no "LP can be pulled" warning; the largest wallet under 3% shows as
// a good sign. A dev-created Raydium pool with the same numbers is still flagged.
const MINT = ('PumpCoin' + 'X'.repeat(44)).slice(0, 44);
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  let dexId = 'pumpswap';
  await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
  await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|cdnjs)/, (r) => r.abort());
  await p.route('https://api.dexscreener.com/**', (r) => r.fulfill({ json: { pairs: [{ chainId: 'solana', dexId, pairAddress: 'pair', url: 'https://dexscreener.com/x', baseToken: { symbol: 'KYNG', name: 'Kyng', address: MINT }, priceUsd: '0.0003', marketCap: 300000, fdv: 300000, liquidity: { usd: 40000 }, volume: { h24: 250000, h1: 30000, m5: 4000 }, priceChange: { m5: 1, h1: 5, h6: 10, h24: 10 }, txns: { m5: { buys: 10, sells: 5 }, h1: { buys: 120, sells: 90 }, h24: { buys: 900, sells: 700 } }, pairCreatedAt: Date.now() - 27 * 60000 }] } }));
  await p.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, tokenMeta: { mutable: false }, totalHolders: 2725, knownAccounts: { POOL1: { type: 'AMM', name: 'PumpSwap' } }, topHolders: [{ address: 'POOL1', owner: 'POOL1', pct: 12.06 }, { address: 'W1', owner: 'W1owner', pct: 2.91 }, { address: 'W2', owner: 'W2owner', pct: 2.6 }, { address: 'W3', owner: 'W3owner', pct: 1.44 }], markets: [{ pubkey: 'MKT1', lp: { lpLockedPct: 0 } }], risks: [] } }));
  await p.addInitScript(() => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_tab', 'check'); sessionStorage.setItem('i', 1); });
  await p.goto(E2E.BASE + '/index.html');
  const check = async () => {
    await p.evaluate(() => { checkState.risk = null; showTab('check'); });
    await p.fill('#caInput', MINT); await p.click('#checkForm button[type=submit]');
    await p.waitForFunction(() => checkState.risk, null, { timeout: 8000 });
    return {
      verdict: await p.$eval('#verdictCard .verdict-title', (e) => e.textContent.trim()),
      findings: await p.$$eval('#verdictCard .findings:not(.goods) li b', (xs) => xs.map((x) => x.textContent.trim())),
      goods: await p.$$eval('#verdictCard .findings.goods li b', (xs) => xs.map((x) => x.textContent.trim())),
    };
  };
  let r = await check();
  assert.notEqual(r.verdict, 'Walk away');
  assert.ok(!r.findings.some((f) => /LP in a wallet/.test(f)), r.findings.join(' | '));
  assert.deepEqual(r.goods, ['✓ LP held by the launchpad (pumpswap)', '✓ Largest wallet 2.9%']);
  await (await p.$('#verdictCard')).screenshot({ path: E2E.OUT + '/lpwhale-phone.png' });
  // the same numbers on an ordinary Raydium pool: the LP really can be pulled
  dexId = 'raydium';
  r = await check();
  assert.equal(r.verdict, 'Walk away');
  assert.ok(r.findings.some((f) => /LP in a wallet that can pull it/.test(f)));
  assert.deepEqual(r.goods, ['✓ Largest wallet 2.9%']);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
  assert.deepEqual(errs, []);
  await b.close();
  console.log('LP AND WHALE E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
