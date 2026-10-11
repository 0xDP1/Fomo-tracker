// GMGN rate limit (bug): a Check asks GMGN for early traders, holder labels and the creator's launches at the same
// moment, and a followed wallet is polled in the background. GMGN refuses a second request within a second; the app
// must pace its requests so every Check block still fills in.
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const COIN = '8vYJgiQPkpDtbWkDy1wyYDcUq3D9fUXVJUtt6aNEpump';
const now = () => Math.floor(Date.now() / 1000);
const traders = () => ({ list: Array.from({ length: 12 }, (_, i) => ({ address: `Wallet${i}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.slice(0, 44), addr_type: 0, start_holding_at: now() - 7200 + i * 60, sell_amount_percentage: 0.1, realized_profit: 0, amount_percentage: 0.01, maker_token_tags: [] })) });
const created = () => ({ inner_count: 1, open_count: 0, tokens: [{ token_address: COIN, symbol: 'SELF', create_timestamp: now() - 3600, market_cap: 500000 }] });
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const seen = []; let last = 0;
  await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
  await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|openapi\.gmgn\.ai|cdnjs)/, (r) => r.abort());
  await p.route('https://openapi.gmgn.ai/**', (r) => {
    const t = Date.now(), path = new URL(r.request().url()).pathname;
    const refused = t - last < 900; last = t;
    seen.push({ path, refused });
    const h = { 'Access-Control-Allow-Origin': '*' };
    if (refused) return r.fulfill({ status: 429, json: { code: 429, message: 'rate limited' }, headers: h });
    const data = path === '/v1/market/token_top_traders' ? traders() : path === '/v1/user/created_tokens' ? created() : path === '/v1/market/token_top_holders' ? require('../fixtures/gmgn-holders.json') : path === '/v1/user/wallet_activity' ? { activities: [] } : null;
    r.fulfill({ json: data ? { code: 0, data } : { code: 404, message: 'nope' }, headers: h });
  });
  await p.route('https://api.dexscreener.com/**', (r) => { const a = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
    r.fulfill({ json: { pairs: a.map((x) => ({ chainId: 'solana', dexId: 'raydium', pairAddress: 'p' + x.slice(0, 5), url: 'https://dexscreener.com/x', baseToken: { symbol: 'SW', name: 'SW', address: x }, priceUsd: '0.001', marketCap: 500000, liquidity: { usd: 40000 }, volume: { h24: 90000, h1: 5000, m5: 500 }, priceChange: { m5: 1, h1: 2, h6: 3, h24: 4 }, txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 30, sells: 10 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: Date.now() - 2 * 3600e3 })) } }); });
  await p.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { creator: 'CreatorWallet', token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 900, topHolders: [{ address: 'H1', owner: 'HO1', pct: 3 }], markets: [] } }));
  await p.addInitScript(() => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_tab', 'check');
    localStorage.setItem('ft_settings', JSON.stringify({ gmgnKey: 'phone-gmgn-key' }));
    localStorage.setItem('ft_paper', JSON.stringify({ wallets: [{ address: 'FollowedWa11et11111111111111111111111111111', chain: 'sol', label: 'w', since: Date.now() }] }));
    sessionStorage.setItem('i', 1); });
  await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(300);
  await p.evaluate(() => showTab('check')); await p.fill('#caInput', COIN); await p.click('#checkForm button[type=submit]');
  await p.waitForFunction(() => checkState.risk, null, { timeout: 8000 });
  const text = (sel) => p.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim());
  const filled = () => p.evaluate(() => !!(checkState.early && checkState.early.s && checkState.holderLabels && checkState.holderLabels.s && checkState.dossier && !checkState.dossier.loading && !checkState.dossier.error));
  for (let i = 0; i < 40 && !(await filled()); i++) await p.waitForTimeout(250);
  console.log('gmgn requests:', seen.map((s) => s.path.replace('/v1/', '') + (s.refused ? ' (429)' : '')).join(', '));
  assert.doesNotMatch(await text('[data-fold="early"]'), /rate limit/i, 'Early traders not refused');
  assert.doesNotMatch(await text('[data-fold="labels"]'), /rate limit/i, 'Holder labels not refused');
  assert.doesNotMatch(await text('[data-fold="dossier"]'), /rate limit/i, 'Creator history not refused');
  assert.ok(await filled(), 'all three GMGN blocks filled in');
  assert.equal(seen.filter((s) => s.refused).length, 0, 'the app never asked GMGN twice within a second');
  await p.waitForTimeout(3500); // the background wallet check runs about 3 s after start
  assert.ok(seen.some((s) => s.path === '/v1/user/wallet_activity'), 'the followed wallet was still checked');
  assert.equal(seen.filter((s) => s.refused).length, 0, 'background requests are paced too');
  assert.deepEqual(errs, []);
  await b.close();
  console.log('GMGN pacing E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
