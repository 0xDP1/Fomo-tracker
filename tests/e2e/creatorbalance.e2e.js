// Creator share from RugCheck's creatorBalance (docs/features/creator-balance.md): a creator outside the top holders
// still gets the Check tab's creator finding.
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const MINT = 'So1anaMintXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX1234';
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
  await p.route('https://api.dexscreener.com/**', (r) => r.fulfill({ json: { pairs: [{ chainId: 'solana', dexId: 'raydium', pairAddress: 'pair', url: 'https://dexscreener.com/x', baseToken: { symbol: 'DEVBAG', name: 'Dev bag' }, priceUsd: '0.0001', marketCap: 400000, fdv: 400000, liquidity: { usd: 40000 }, volume: { h24: 250000, h1: 30000, m5: 4000 }, priceChange: { m5: 1, h1: 2, h6: 3, h24: 4 }, txns: { m5: { buys: 5, sells: 5 }, h1: { buys: 100, sells: 90 }, h24: { buys: 900, sells: 800 } }, pairCreatedAt: Date.now() - 50 * 3600e3, info: { socials: [] } }] } }));
  // The creator holds 6% but is not in topHolders.
  await p.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, tokenMeta: { mutable: false }, totalHolders: 900, creator: 'DEVwallet', creatorBalance: 6e13,
    topHolders: [{ address: 'A1', owner: 'W1', pct: 3 }, { address: 'A2', owner: 'W2', pct: 2 }], markets: [{ pubkey: 'MKT1', lp: { lpLockedPct: 100 } }] } }));
  await p.route('https://trench.bot/**', (r) => r.fulfill({ status: 404, json: {} }));
  await p.route(/^https:\/\/(?!cdnjs|api\.dexscreener|api\.rugcheck|trench\.bot)/, (r) => r.abort());
  await p.addInitScript(() => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_tab', 'check'); sessionStorage.setItem('i', 1); });
  await E2E.openFolds(p); await p.goto('file://' + E2E.ROOT + '/index.html'); await p.waitForTimeout(400);
  await p.evaluate(() => showTab('check')); await p.fill('#caInput', MINT); await p.click('#checkForm button'); await p.waitForTimeout(900);
  const findings = await p.$$eval('#verdictCard .findings li', (xs) => xs.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
  console.log('findings:', findings);
  assert.ok(findings.some((x) => /^MEDIUM Creator holds 6%/i.test(x)), 'creator outside the top holders shows the creator finding');
  await b.close();
  if (errs.length) { console.error('page errors:', errs); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
