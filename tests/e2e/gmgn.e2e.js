const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
// GMGN through the Worker: Early traders block and finding, Dev dossier from GMGN created tokens, quiet fallback without a key.
const COIN = '8vYJgiQPkpDtbWkDy1wyYDcUq3D9fUXVJUtt6aNEpump';
const now = () => Math.floor(Date.now() / 1000);
const traders = () => ({ list: [
  { address: 'PoolAddr', addr_type: 2, exchange: 'pump_amm', start_holding_at: now() - 99999 },
  ...Array.from({ length: 14 }, (_, i) => ({ address: `Wallet${i}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.slice(0, 44), addr_type: 0, start_holding_at: now() - 7200 + i * 60, sell_amount_percentage: i < 8 ? (i < 3 ? 1 : 0.7) : 0.1, realized_profit: i < 8 ? 2500 : 0, amount_percentage: i < 8 ? 0 : 0.015, maker_token_tags: i === 0 ? ['sniper'] : [] })),
] });
const created = () => ({ inner_count: 5, open_count: 2, tokens: [
  { token_address: 'DeadMint1', symbol: 'DEAD1', create_timestamp: now() - 3 * 86400, market_cap: 2100, token_ath_mc: 40000 },
  { token_address: 'DeadMint2', symbol: 'DEAD2', create_timestamp: now() - 2 * 86400, market_cap: 3000 },
  { token_address: 'DeadMint3', symbol: 'DEAD3', create_timestamp: now() - 86400, market_cap: 1800 },
  { token_address: 'LiveMint1', symbol: 'LIVE1', create_timestamp: now() - 4 * 86400, market_cap: 95000 },
  { token_address: 'NewMint11', symbol: 'NEW1', create_timestamp: now() - 1800, market_cap: 6000 },
  { token_address: COIN, symbol: 'SELF', create_timestamp: now() - 3600, market_cap: 500000 },
] });
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    for (const mode of ['worker', 'off', 'banned', 'direct']) {
      const configured = mode !== 'off';
      const p = await b.newPage({ viewport: vp });
      const errs = []; p.on('pageerror', (e) => errs.push(e.message));
      const gm = [], direct = [];
      await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
      await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|feed\.example|openapi\.gmgn\.ai|cdnjs)/, (r) => r.abort());
      await p.route('https://openapi.gmgn.ai/**', (r) => {
        const u = new URL(r.request().url());
        direct.push({ path: u.pathname, key: r.request().headers()['x-apikey'], ts: u.searchParams.get('timestamp'), cid: u.searchParams.get('client_id') });
        const data = u.pathname === '/v1/market/token_top_traders' ? traders() : u.pathname === '/v1/user/created_tokens' ? created() : null;
        r.fulfill({ json: data ? { code: 0, data } : { code: 404, message: 'nope' }, headers: { 'Access-Control-Allow-Origin': '*' } });
      });
      await p.route('https://api.dexscreener.com/**', (r) => { const a = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
        r.fulfill({ json: { pairs: a.map((x) => ({ chainId: 'solana', dexId: 'raydium', pairAddress: 'p' + x.slice(0, 5), url: 'https://dexscreener.com/x', baseToken: { symbol: 'SW', name: 'SW', address: x }, priceUsd: '0.001', marketCap: 500000, liquidity: { usd: 40000 }, volume: { h24: 90000, h1: 5000, m5: 500 }, priceChange: { m5: 1, h1: 2, h6: 3, h24: 4 }, txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 30, sells: 10 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: Date.now() - 2 * 3600e3 })) } }); });
      await p.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { creator: 'CreatorWallet', token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 900, topHolders: [{ address: 'H1', owner: 'HO1', pct: 3 }], markets: [] } }));
      await p.route('https://feed.example/**', (r) => {
        const u = new URL(r.request().url());
        assert.equal(r.request().headers()['x-feed-key'], 'k3y');
        if (u.pathname === '/calls') return r.fulfill({ json: { status: 'ok', checkedAt: Date.now(), now: Date.now(), channels: [], calls: [], callers: {} }, headers: { 'Access-Control-Allow-Origin': '*' } });
        gm.push(u.pathname + u.search);
        if (mode === 'off') return r.fulfill({ status: 503, json: { error: 'not_configured' }, headers: { 'Access-Control-Allow-Origin': '*' } });
        if (mode === 'banned') return r.fulfill({ status: 429, json: { error: 'rate_limited', detail: 'IP is temporarily banned due to repeated rate limit violations', retryAt: Date.now() + 60000 }, headers: { 'Access-Control-Allow-Origin': '*' } });
        if (u.pathname === '/gmgn/market/token_top_traders') return r.fulfill({ json: { data: traders() }, headers: { 'Access-Control-Allow-Origin': '*' } });
        if (u.pathname === '/gmgn/user/created_tokens') return r.fulfill({ json: { data: created() }, headers: { 'Access-Control-Allow-Origin': '*' } });
        return r.fulfill({ status: 400, json: { error: 'not_allowed' }, headers: { 'Access-Control-Allow-Origin': '*' } });
      });
      const settings = mode === 'direct' ? { gmgnKey: 'phone-gmgn-key' } : mode === 'banned' ? { feedUrl: 'https://feed.example', feedKey: 'k3y', gmgnKey: 'phone-gmgn-key' } : { feedUrl: 'https://feed.example', feedKey: 'k3y' };
      await p.addInitScript((st) => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_tab', 'check'); localStorage.setItem('ft_settings', JSON.stringify(st)); sessionStorage.setItem('i', 1); }, settings);
      await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(400);
      const text = (sel) => p.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim());
      await p.fill('#caInput', COIN); await p.click('#checkForm button[type=submit]');
      await p.waitForFunction(() => checkState.risk, null, { timeout: 8000 }); await p.waitForTimeout(800);
      if (mode === 'worker') assert.equal(direct.length, 0, 'the Worker answered, so the phone never calls GMGN');
      if (mode === 'banned' || mode === 'direct') {
        assert.ok(direct.length >= 2, 'the phone called GMGN itself');
        assert.ok(direct.every((d) => d.key === 'phone-gmgn-key' && /^\d{10}$/.test(d.ts) && d.cid), 'with the key from Settings, a timestamp and a client id');
        assert.ok(direct.every((d) => ['/v1/market/token_top_traders', '/v1/user/created_tokens'].includes(d.path)), 'only read endpoints');
      }
      if (mode === 'banned') {
        const before = gm.length;
        await p.fill('#caInput', COIN); await p.click('#checkForm button[type=submit]'); await p.waitForTimeout(800);
        assert.equal(gm.length, before, 'after a ban the Worker is skipped for a while');
      }
      if (mode === 'direct') assert.equal(gm.length, 0, 'no feed set up: straight to GMGN');
      if (!configured) {
        assert.equal(await p.$('.early-block'), null, 'no GMGN key: no Early traders block');
        assert.match(await text('.dossier-block'), /Add a Helius API key/);
        assert.ok(gm.length <= 2, 'stops asking after "not configured"');
        assert.deepEqual(errs, []);
        await p.close(); continue;
      }
      const early = await text('.early-block');
      assert.match(early, /Early traders \(GMGN\) 8 of 10 sold/);
      assert.match(early, /Of the first 10 wallets in, 8 have sold half or more \(3 fully out\), taking \$20\.0k in profit\. Together they still hold 3\.0% of supply\./);
      assert.ok(!/PoolAddr|Pool…/.test(early), 'the pool is left out');
      const findings = await p.$$eval('#verdictCard .findings li', (ls) => ls.map((l) => l.innerText.replace(/\s+/g, ' ')));
      assert.ok(findings.some((f) => /^Medium 8 of the first 10 buyers have sold/i.test(f)), findings.join(' | '));
      if (mode === 'worker') assert.ok(gm.some((x) => /^\/gmgn\/market\/token_top_traders\?chain=sol&address=8vYJ\w+&limit=100&order_by=profit$/.test(x)), gm.join(' '));
      const dos = await text('.dossier-block');
      assert.match(dos, /Creator history \(GMGN\)/);
      assert.match(dos, /3 of 4 earlier launches dead · 1 alive · 0 quiet · 1 too new to judge/);
      assert.match(dos, /GMGN's list for this wallet \(7 launches: 2 reached an open market, 5 never left the bonding curve\)/);
      assert.match(dos, /Dead means market cap under \$5k now/);
      assert.ok(findings.some((f) => /^High Creator has 3 of 4 earlier launches dead/i.test(f)), 'the serial-launcher finding works from GMGN data too');
      if (mode === 'worker') assert.ok(gm.some((x) => /^\/gmgn\/user\/created_tokens\?chain=sol&wallet_address=CreatorWallet$/.test(x)));
      await (await p.$('.early-block')).screenshot({ path: E2E.OUT + `/early-${vp.name}-${mode}.png` });
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
      assert.deepEqual(errs, []);
      await p.close();
    }
  }
  await b.close();
  console.log('GMGN E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
