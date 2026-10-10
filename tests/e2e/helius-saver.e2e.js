const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
// Helius saver: once Helius says the plan is out of credits, the app stops calling it and says so plainly.
// A plain rate limit does not stop it.
const A = 'AaaaCoin1111111111111111111111111111111pump';
const B = 'BbbbCoin1111111111111111111111111111111pump';
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    for (const mode of ['credits', 'ratelimit']) {
      const p = await b.newPage({ viewport: vp });
      const errs = []; p.on('pageerror', (e) => errs.push(e.message));
      const hel = [];
      await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
      await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|api\.helius|cdnjs)/, (r) => r.abort());
      await p.route('https://api.helius.xyz/**', (r) => {
        hel.push(decodeURIComponent(new URL(r.request().url()).pathname.split('/')[3]));
        r.fulfill(mode === 'credits'
          ? { status: 429, json: { jsonrpc: '2.0', error: { code: -32429, message: 'max usage reached' } } }
          : { status: 429, body: 'Too many requests' });
      });
      await p.route('https://api.dexscreener.com/**', (r) => { const a = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',')[0];
        r.fulfill({ json: { pairs: [{ chainId: 'solana', dexId: 'raydium', pairAddress: 'pp' + a.slice(0, 4), url: 'https://dexscreener.com/x', baseToken: { symbol: a.slice(0, 4).toUpperCase(), name: 'x', address: a }, priceUsd: '0.001', marketCap: 300000, liquidity: { usd: 50000 }, volume: { h24: 100000, h1: 20000, m5: 3000 }, priceChange: { m5: 1 }, txns: { m5: { buys: 5, sells: 3 }, h1: { buys: 40, sells: 30 }, h24: { buys: 400, sells: 300 } }, pairCreatedAt: Date.now() - 3600e3 }] } }); });
      await p.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { creator: 'CreatorWallet', token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 900, topHolders: [{ address: 'H1', owner: 'HolderOne111111111111111111111111111111111', pct: 3 }, { address: 'H2', owner: 'HolderTwo111111111111111111111111111111111', pct: 2 }], markets: [{ pubkey: 'm', lp: { lpLockedPct: 100 } }] } }));
      await p.addInitScript(() => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_tab', 'check'); localStorage.setItem('ft_settings', JSON.stringify({ heliusKey: 'hk' })); sessionStorage.setItem('i', 1); });
      await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(500);
      const text = (sel) => p.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim());
      const check = async (ca) => {
        await p.evaluate(() => showTab('check')); await p.fill('#caInput', ca); await p.click('#checkForm button[type=submit]');
        await p.waitForFunction((c) => checkState.ca === c && checkState.risk && checkState.flow && !checkState.flow.loading, ca, { timeout: 8000 });
        await p.waitForTimeout(500);
      };
      await check(A);
      const first = hel.length;
      assert.ok(first >= 1 && first <= 2, `Flow and Creator history each ask once at most (${hel.join(' ')})`);
      if (mode === 'ratelimit') {
        assert.match(await text('[data-fold="flow"]'), /Helius rate limit hit, try again in a minute/);
        await check(B);
        assert.ok(hel.length > first, 'a rate limit does not stop later checks');
        assert.deepEqual(errs, []);
        await p.close(); continue;
      }
      assert.match(await text('[data-fold="flow"]'), /Helius credits used up\. Helius checks are paused until you reload the app/);
      // another coin: no Helius calls at all
      await check(B);
      assert.equal(hel.length, first, 'no Helius calls after it ran out');
      assert.match(await text('[data-fold="flow"]'), /Helius credits used up/);
      // Refresh, fee sample and Analyze top wallets: still none
      await p.click('#flowBtn'); await p.waitForTimeout(300);
      await p.$eval('#feeBtn', (x) => x.click()); await p.waitForTimeout(300);
      assert.match(await text('.fees'), /Helius credits used up/);
      await p.click('#deepBtn'); await p.waitForTimeout(300);
      assert.match(await text('#holderDeep'), /Helius credits used up/);
      assert.equal(hel.length, first, 'still no Helius calls');
      await (await p.$('.flow-block')).screenshot({ path: E2E.OUT + `/helius-out-${vp.name}.png` });
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
      assert.deepEqual(errs, []);
      await p.close();
    }
  }
  await b.close();
  console.log('HELIUS SAVER E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
