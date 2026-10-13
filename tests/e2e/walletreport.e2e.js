// Wallet report (docs/features/wallet-report.md): paste a wallet on the Calls tab, see its pace, holds, win rate,
// returns and the copier's costs from GMGN activity, Claude's style and copy verdict, then paper-copy it.
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const pad = (s) => (s + '1'.repeat(44)).slice(0, 44);
const WALLET = pad('GijFWa');
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    const p = await b.newPage({ viewport: vp });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    const gm = []; let claude = null;
    const t0 = Math.floor(Date.now() / 1000) - 48 * 3600;
    // 10 round trips over two days: 6 quick +20% flips held 1 minute, 4 losers at -50% held 30 minutes, $100 each.
    const rows = { buy: [], sell: [] };
    for (let i = 0; i < 10; i++) {
      const win = i < 6, t = t0 + i * 288 * 60, tok = { address: pad('Tok' + i), symbol: 'T' + i };
      rows.buy.push({ event_type: 'buy', token: tok, timestamp: t, price_usd: 1, cost_usd: 100 });
      rows.sell.push({ event_type: 'sell', token: tok, timestamp: t + (win ? 60 : 1800), price_usd: win ? 1.2 : 0.5, cost_usd: win ? 120 : 50 });
    }
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!api\.dexscreener|openapi\.gmgn\.ai|api\.anthropic|cdnjs)/, (r) => r.abort());
    await p.route('https://openapi.gmgn.ai/**', (r) => {
      const u = new URL(r.request().url());
      gm.push(`${u.pathname.split('/').pop()}:${u.searchParams.get('type')}:${u.searchParams.get('limit')}:${(u.searchParams.get('wallet_address') || '').slice(0, 6)}`);
      const data = u.pathname.endsWith('wallet_activity') ? { activities: u.searchParams.get('wallet_address') === WALLET ? rows[u.searchParams.get('type')] || [] : [], next: null } : { list: [] };
      r.fulfill({ json: { code: 0, data }, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await p.route('https://api.dexscreener.com/**', (r) => { const a = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
      r.fulfill({ json: { pairs: a.map((x) => ({ chainId: 'solana', dexId: 'raydium', pairAddress: 'p' + x.slice(0, 6), url: 'https://dexscreener.com/x', baseToken: { symbol: 'X', name: 'x', address: x }, priceUsd: '2', marketCap: 200000, liquidity: { usd: 30000 } })) } }); });
    await p.route('https://api.anthropic.com/**', (r) => {
      claude = r.request().postDataJSON();
      r.fulfill({ json: { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ style: 'Fast scalper', verdict: 'dont_copy', reasons: ['60% of trades sold within 5 minutes', 'Losers are bigger than winners'], summary: 'Quick flips you cannot match with a delay.' }) }] } });
    });
    await p.addInitScript(() => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_tab', 'calls');
      localStorage.setItem('ft_settings', JSON.stringify({ gmgnKey: 'phone-key', anthropicKey: 'sk-ant-TEST' }));
      localStorage.setItem('ft_uiOpen', JSON.stringify({ 'calls-walletreport': true })); sessionStorage.setItem('i', 1); });
    await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(300);
    await p.evaluate(() => showTab('calls'));
    await p.fill('#wrWallet', `https://gmgn.ai/sol/address/${WALLET}?tab=activity`);
    await p.click('#wrForm button[type=submit]');
    await p.waitForFunction(() => wrState.ai && !wrState.ai.loading && !wrState.busy, null, { timeout: 10000 });
    const card = await p.$eval('#walletReportCard', (e) => e.innerText.replace(/\s+/g, ' ').trim());
    console.log(vp.name, card.slice(0, 400));
    assert.ok(gm.includes(`wallet_activity:buy:100:${WALLET.slice(0, 6)}`) && gm.includes(`wallet_activity:sell:100:${WALLET.slice(0, 6)}`), 'buys and sells read from GMGN: ' + gm.join(' '));
    assert.match(card, /Trades \/ day 11 10 tokens in 44 h/);
    assert.match(card, /Median hold 1 min 60% under 5 min/);
    assert.match(card, /Win rate 60% 10 closed/);
    assert.match(card, /Avg return -8% realized −\$80/);
    assert.match(card, /Your costs \$40 4% per round trip/);
    assert.match(card, /Median market cap at entry: \$100\.0k \(10 tokens DexScreener knows\)/);
    assert.match(card, /Fast scalper Don't copy Quick flips you cannot match with a delay\./);
    assert.match(card, /60% of trades sold within 5 minutes/);
    assert.equal(claude.model, 'claude-sonnet-5-5');
    assert.match(claude.messages[0].content, /Median hold 1 min; 60% of closed tokens sold within 5 minutes/);
    assert.match(claude.messages[0].content, /T0: \+20%, held 1 min, \$100, entry mcap \$100k/);
    assert.equal(await p.textContent('#walletReportSummary'), "Don't copy · Fast scalper");
    await (await p.$('#walletReportCard')).screenshot({ path: E2E.OUT + `/walletreport-${vp.name}.png` });
    // Paper-copy hands it to Paper trades
    await p.click('#wrCopyBtn'); await p.waitForTimeout(300);
    assert.deepEqual(await p.evaluate(() => paperState.wallets.map((w) => [w.address, w.chain, w.sizing.value, w.entry, w.exits])), [[WALLET, 'sol', 100, 'wallet', 'mirror']]);
    assert.equal(await p.$eval('#wrCopyBtn', (e) => e.disabled), true);
    assert.match(await p.textContent('#wrCopyBtn'), /Paper-copying this wallet/);
    // junk input
    await p.fill('#wrWallet', 'hello'); await p.click('#wrForm button[type=submit]'); await p.waitForTimeout(100);
    assert.match(await p.textContent('#walletReportCard'), /Paste a Solana wallet address or a GMGN wallet link/);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
    assert.deepEqual(errs, []);
    await p.close();
  }
  await b.close();
  console.log('Wallet report E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
