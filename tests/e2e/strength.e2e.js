const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
// Coin strength: a Strength 0-100 next to the rug score on the Check tab from liquidity, volume, holder spread and
// GMGN's total fees (faked), with a line per part; a coin GMGN has no fee figure for is scored out of the parts read;
// the top holders' SOL balances (faked RPC) give the Wallets part and red / green flags; GMGN-tagged bundlers count as
// one holder; Call queue rows get a small S pill from what the queue already knows.
const pad = (s) => (s + 'X'.repeat(44)).slice(0, 44);
const COIN = pad('StrongCoin'), NOFEE = pad('NoFeeCoin'), BUNDLED = pad('BndCoin'), QUEUED = pad('QueuedCoin');
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const gm = [];
  let bal = { W1o: 12, W2o: 8, W3o: 30 };
  const bundlers = Array.from({ length: 6 }, (_, i) => ({ address: 'Bndl' + i + 'a'.repeat(39), addr_type: 0, amount_percentage: 0.14 / 6, sell_amount_percentage: 0, maker_token_tags: ['bundler'], tags: [] }));
  await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
  await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|openapi\.gmgn\.ai|api\.mainnet-beta|cdnjs)/, (r) => r.abort());
  await p.route('https://openapi.gmgn.ai/**', (r) => {
    const u = new URL(r.request().url()); const a = u.searchParams.get('address');
    gm.push(u.pathname.replace('/v1/', '') + ':' + (a || '').slice(0, 6));
    const data = u.pathname.endsWith('token/info') ? (a === COIN ? { address: a, total_fee: '3000', stat: { top_10_holder_rate: 0.15 } } : { address: a, stat: {} }) : { list: a === BUNDLED ? bundlers : [] };
    r.fulfill({ json: { code: 0, data }, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await p.route('https://api.mainnet-beta.solana.com/**', (r) => { const b = r.request().postDataJSON();
    const result = b.method === 'getMultipleAccounts' ? { value: b.params[0].map((a) => (bal[a] == null ? null : { lamports: bal[a] * 1e9 })) } : { value: 0 };
    r.fulfill({ json: { jsonrpc: '2.0', id: b.id, result }, headers: { 'Access-Control-Allow-Origin': '*' } }); });
  await p.route('https://api.dexscreener.com/**', (r) => { const a = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
    r.fulfill({ json: { pairs: a.map((x) => ({ chainId: 'solana', dexId: 'pumpswap', pairAddress: 'p' + x.slice(0, 5), url: 'https://dexscreener.com/x', baseToken: { symbol: x.slice(0, 5).toUpperCase(), name: 'x', address: x }, priceUsd: '0.0003', marketCap: 300000, fdv: 300000, liquidity: { usd: 40000 }, volume: { h24: 450000, h1: 25000, m5: 2000 }, priceChange: { m5: 1, h1: 5, h6: 10, h24: 10 }, txns: { m5: { buys: 10, sells: 5 }, h1: { buys: 120, sells: 90 }, h24: { buys: 900, sells: 700 } }, pairCreatedAt: Date.now() - 3 * 3600e3 })) } }); });
  await p.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, tokenMeta: { mutable: false }, totalHolders: 2725, knownAccounts: { POOL1: { type: 'AMM', name: 'PumpSwap' } }, topHolders: [{ address: 'POOL1', owner: 'POOL1', pct: 12 }, { address: 'W1', owner: 'W1o', pct: 2.9 }, { address: 'W2', owner: 'W2o', pct: 2.6 }, { address: 'W3', owner: 'W3o', pct: 1.4 }], markets: [{ pubkey: 'M', lp: { lpLockedPct: 0 } }], risks: [] } }));
  await p.addInitScript((d) => {
    if (sessionStorage.getItem('i')) return;
    const now = Date.now();
    localStorage.clear();
    localStorage.setItem('ft_tab', 'check');
    localStorage.setItem('ft_callView', JSON.stringify('all'));
    localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-calls': true }));
    localStorage.setItem('ft_settings', JSON.stringify({ gmgnKey: 'phone-key' }));
    localStorage.setItem('ft_callQueue', JSON.stringify({ [d.QUEUED]: { address: d.QUEUED, chain: 'solana', symbol: 'QUEUE', mentions: 1, posters: ['x'], channels: ['first scan'], firstPoster: 'x', firstAt: now - 600e3, lastAt: now - 600e3 } }));
    sessionStorage.setItem('i', 1);
  }, { QUEUED });
  await p.goto(E2E.BASE + '/index.html');
  const card = async (ca) => {
    await p.evaluate(() => { checkState.risk = null; showTab('check'); });
    await p.fill('#caInput', ca); await p.click('#checkForm button[type=submit]');
    await p.waitForFunction(() => checkState.risk && document.querySelector('.strength-card'), null, { timeout: 8000 });
    await p.waitForTimeout(400); // the GMGN read lands after the first render
    return p.$eval('.strength-card', (e) => e.innerText.replace(/\s+/g, ' ').trim());
  };
  let s = await card(COIN);
  assert.match(s, /Strength .*100\/100 · Strong/, s);
  assert.match(s, /Liquidity 20\/20 \$40\.0k, 13% of market cap/);
  assert.match(s, /Volume 20\/20 24h volume 1\.5× market cap, last hour keeping pace/);
  assert.match(s, /Holders 20\/20 largest wallet 2\.9%/);
  assert.match(s, /Total fees 20\/20 \$3\.0k paid, 0\.67% of volume · GMGN total fees/);
  assert.match(s, /Wallets 20\/20 3 top wallets read: 0 empty, 0 low, 3 funded/);
  assert.match(s, /🟢 6\.9% held by 3 wallets with 5\+ SOL/);
  assert.doesNotMatch(s, /🔴/);
  assert.ok(gm.includes('token/info:' + COIN.slice(0, 6)), 'one GMGN coin-info read: ' + gm.join(' '));
  await (await p.$('#verdictCard')).screenshot({ path: E2E.OUT + '/strength-phone.png' });
  // GMGN has no fee figure for this coin: fees not read, the score is out of the other three parts
  s = await card(NOFEE);
  assert.match(s, /Total fees – not read/);
  assert.match(s, /Out of the 4 parts that could be read/);
  assert.match(s, /"Sample fees" below gives the app's own estimate/);
  // bundled: 14% in 6 GMGN-tagged bundlers counts as the largest holder; the top wallets are near-empty
  bal = { W1o: 0.01, W2o: 0.004, W3o: 0 };
  s = await card(BUNDLED);
  await p.waitForFunction(() => /largest group/.test(document.querySelector('.strength-card').innerText), null, { timeout: 8000 });
  s = await p.$eval('.strength-card', (e) => e.innerText.replace(/\s+/g, ' ').trim());
  assert.match(s, /Holders 12\/20 largest group 14\.0% \(GMGN: 6 bundler, insider, sniper or dev wallets\), largest wallet 2\.9%/, s);
  assert.match(s, /Wallets 6\/20 3 top wallets read: 3 empty, 0 low, 0 funded/);
  assert.match(s, /🔴 6\.9% of supply in 3 near-empty wallets \(under 0\.1 SOL\)/);
  assert.doesNotMatch(s, /🟢/);
  await (await p.$('.strength-card')).screenshot({ path: E2E.OUT + '/strength-wallets-phone.png' });
  // the Call queue: an S pill from liquidity, volume and holders it already has
  await p.evaluate(() => { showTab('calls'); researchCalls(); });
  await p.waitForFunction(() => !callState.busy && document.querySelector('#callsCard .call-row .str-pill'), null, { timeout: 8000 });
  assert.match(await p.$eval('#callsCard .call-row .str-pill', (e) => e.textContent), /^S \d+$/);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
  assert.deepEqual(errs, []);
  await b.close();
  console.log('STRENGTH E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
