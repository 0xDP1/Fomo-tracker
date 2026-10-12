// LP unlock date on the Check tab (docs/features/lp-unlock-date.md): RugCheck lockers on Solana, GoPlus locked_detail on EVM.
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const MINT = 'So1anaMintXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX1234';
const EVM = '0x4bc1782fafb967834e0e75947ba15113e48fc70e';
const DAY = 86400e3;
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const unlockSec = Math.floor((Date.now() + 3.5 * DAY) / 1000);
  await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
  await p.route('https://api.dexscreener.com/**', (r) => { const sol = r.request().url().includes(MINT);
    r.fulfill({ json: { pairs: [{ chainId: sol ? 'solana' : 'base', dexId: 'raydium', pairAddress: 'pair', url: 'https://dexscreener.com/x', baseToken: { symbol: sol ? 'LOCKS' : 'EVMLK', name: 'Lock test' }, priceUsd: '0.0001', marketCap: 400000, fdv: 400000, liquidity: { usd: 40000 }, volume: { h24: 250000, h1: 30000, m5: 4000 }, priceChange: { m5: 1, h1: 2, h6: 3, h24: 4 }, txns: { m5: { buys: 5, sells: 5 }, h1: { buys: 100, sells: 90 }, h24: { buys: 900, sells: 800 } }, pairCreatedAt: Date.now() - 50 * 3600e3, info: { socials: [] } }] } }); });
  await p.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, tokenMeta: { mutable: false }, totalHolders: 900, topHolders: [], markets: [{ pubkey: 'MKT1', lp: { lpLockedPct: 100 } }], totalMarketLiquidity: 40000,
    lockers: { L1: { type: 'streamflow', unlockDate: unlockSec, usdcLocked: 30000 }, L2: { type: 'raydium_locker', unlockDate: 0, usdcLocked: 10000 } } } }));
  await p.route('https://trench.bot/**', (r) => r.fulfill({ status: 404, json: {} }));
  await p.route('https://api.gopluslabs.io/**', (r) => r.fulfill({ json: { result: { [EVM.toLowerCase()]: { is_honeypot: '0', buy_tax: '0', sell_tax: '0', is_mintable: '0', is_proxy: '0', hidden_owner: '0', is_open_source: '1', holder_count: '4000', holders: [],
    lp_holders: [{ address: '0x0000000000000000000000000000000000000001', tag: 'UNCX', percent: '0.95', is_locked: 1, locked_detail: [{ amount: '1', end_time: new Date(Date.now() - 2 * DAY).toISOString(), opt_time: '2026-01-01T00:00:00+00:00' }] }] } } } }));
  await p.route(/^https:\/\/(?!cdnjs|api\.dexscreener|api\.rugcheck|trench\.bot|api\.gopluslabs)/, (r) => r.abort());
  await p.addInitScript(() => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_tab', 'check'); sessionStorage.setItem('i', 1); });
  await E2E.openFolds(p); await p.goto('file://' + E2E.ROOT + '/index.html'); await p.waitForTimeout(400);
  const findings = () => p.$$eval('#verdictCard .findings li', (xs) => xs.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
  const check = async (ca) => { await p.evaluate(() => showTab('check')); await p.fill('#caInput', ca); await p.click('#checkForm button'); await p.waitForTimeout(900); return findings(); };

  const sol = await check(MINT);
  console.log('solana:', sol);
  const soon = sol.find((x) => /LP unlocks in 3 days/.test(x));
  assert.ok(soon, 'Solana coin with a lock opening in 3.5 days shows the warning');
  assert.match(soon, /Locked liquidity opens on \d{4}-\d{2}-\d{2}/);
  assert.equal(await p.$$eval('#verdictCard .findings li.f-high', (xs) => xs.some((x) => /LP unlocks/.test(x.innerText))), true, 'shown as high');

  const evm = await check(EVM);
  console.log('evm:', evm);
  assert.ok(evm.some((x) => /LP lock has expired/.test(x)), 'EVM coin with an expired UNCX lock shows the warning');

  await b.close();
  if (errs.length) { console.error('page errors:', errs); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
