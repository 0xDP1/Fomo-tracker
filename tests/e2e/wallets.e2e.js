const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
// Wallet tracker: a coin's top profit-takers as wallet cards (one passing, one failing the checklist), loaded only when
// the block is opened; tracking one; then a second coin it is buying shows the conviction line on Check and in the
// Call queue, and its call score goes up by 10.
const pad = (s) => (s + '1'.repeat(44)).slice(0, 44);
const COIN_A = pad('CoinAaa'), COIN_B = pad('CoinBbb');
const GOOD = pad('GoodWallet'), BAD = pad('BadWallet'), BUNDLER = pad('BundlerWal');
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    const p = await b.newPage({ viewport: vp });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    const gm = [];
    const nowSec = Math.floor(Date.now() / 1000), H = 3600;
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|openapi\.gmgn\.ai|api\.mainnet-beta|cdnjs)/, (r) => r.abort());
    await p.route('https://api.mainnet-beta.solana.com/**', (r) => {
      const body = JSON.parse(r.request().postData() || '{}');
      const lamports = body.method === 'getBalance' && body.params[0] === GOOD ? 3.5e9 : 0.1e9;
      r.fulfill({ json: { jsonrpc: '2.0', id: 1, result: body.method === 'getBalance' ? { value: lamports } : { value: [] } } });
    });
    await p.route('https://openapi.gmgn.ai/**', (r) => {
      const u = new URL(r.request().url());
      const ep = u.pathname.replace('/v1/', ''), a = u.searchParams.get('address'), w = u.searchParams.get('wallet_address');
      gm.push(ep + ':' + (a || w || '').slice(0, 8) + (u.searchParams.get('period') ? ':' + u.searchParams.get('period') : ''));
      let data = { list: [] };
      if (ep === 'market/token_top_traders' && a === COIN_A) {
        data = { list: [
          { address: 'PoolX', addr_type: 2, exchange: 'pump_amm', realized_profit: 50000 },
          { address: BUNDLER, addr_type: 0, realized_profit: 20000, maker_token_tags: ['bundler'] },
          { address: GOOD, addr_type: 0, realized_profit: 9000, sell_amount_percentage: 1, start_holding_at: nowSec - 5 * H },
          { address: BAD, addr_type: 0, realized_profit: 4000, sell_amount_percentage: 1, start_holding_at: nowSec - 5 * H },
        ] };
      } else if (ep === 'market/token_top_holders' && a === COIN_B) {
        data = { list: [{ address: 'PoolY', addr_type: 2, amount_percentage: 0.2 }, { address: GOOD, addr_type: 0, amount_percentage: 0.03, start_holding_at: nowSec - 600, sell_amount_percentage: 0.1 }] };
      } else if (ep === 'user/wallet_stats') {
        const good = w === GOOD, d30 = u.searchParams.get('period') === '30d';
        data = good ? (d30 ? { realized_profit: '4200', winrate: 0.55, total_cost: '18000', buy_count: 140, sell_count: 120, pnl: 0.23 } : { realized_profit: '900', winrate: 0.5, total_cost: '4000', buy_count: 30, sell_count: 28, pnl: 0.22 })
          : (d30 ? { realized_profit: '-300', winrate: 0.2, total_cost: '900', buy_count: 6, sell_count: 5, pnl: -0.33 } : { realized_profit: '-100', winrate: 0.25, total_cost: '300', buy_count: 2, sell_count: 2, pnl: -0.3 });
      } else if (ep === 'user/wallet_activity') {
        const t = (type, sym, ago, usd, cost) => Object.assign({ event_type: type, token: { address: pad('Mint' + sym), symbol: sym }, timestamp: nowSec - ago, cost_usd: usd }, cost != null ? { buy_cost_usd: cost } : {});
        data = w === GOOD
          ? { activities: [t('buy', 'WIF', 2 * H, 300), t('sell', 'BONK', 5 * H, 500, 380), t('sell', 'MEW', 30 * H, 900, 400), t('buy', 'BONK', 26 * H, 380), t('buy', 'MEW', 31 * H, 400)], next: '' }
          : { activities: [t('sell', 'RUG', 50 * H, 10, 200), t('buy', 'RUG', 50 * H + 20, 200)], next: '' };
      } else if (ep === 'user/wallet_holdings') {
        data = { list: [{ token: { token_address: 'x', symbol: 'WIF' }, usd_value: w === GOOD ? '1200' : '5' }] };
      }
      r.fulfill({ json: { code: 0, data }, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await p.route('https://api.dexscreener.com/**', (r) => { const a = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
      r.fulfill({ json: { pairs: a.map((x) => ({ chainId: 'solana', dexId: 'raydium', pairAddress: 'p' + x.slice(0, 5), url: 'https://dexscreener.com/x', baseToken: { symbol: x.slice(0, 5).toUpperCase(), name: 'x', address: x }, priceUsd: '0.001', marketCap: 300000, liquidity: { usd: 40000 }, volume: { h24: 90000, h1: 5000, m5: 500 }, priceChange: { m5: 1 }, txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 30, sells: 10 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: Date.now() - 2 * 3600e3 })) } }); });
    await p.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 900, topHolders: [{ address: 'H1', owner: 'HO1', pct: 3 }], markets: [] } }));
    await p.addInitScript((d) => {
      if (sessionStorage.getItem('i')) return;
      const now = Date.now();
      const q = { [d.COIN_B]: { address: d.COIN_B, chain: 'solana', symbol: 'COINB', mentions: 1, posters: ['x'], channels: [], firstPoster: 'x', firstAt: now - 600e3, lastAt: now - 600e3, snapAt: now - 60e3, snap: { ageMs: 3600e3, fdv: 200000, liq: 30000, priceUsd: 0.0002, top5Pct: 18 }, callMcap: 190000 } };
      localStorage.clear();
      localStorage.setItem('ft_tab', 'check');
      localStorage.setItem('ft_callView', JSON.stringify('all'));
      localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-calls': true, 'check-plan': true }));
      localStorage.setItem('ft_settings', JSON.stringify({ gmgnKey: 'phone-key' }));
      localStorage.setItem('ft_callQueue', JSON.stringify(q));
      sessionStorage.setItem('i', 1);
    }, { COIN_B });
    await p.goto(E2E.BASE + '/index.html');
    await p.waitForFunction(() => !callState.busy && document.querySelector('#callsCard .call-row'), null, { timeout: 8000 });
    const rowB = () => p.$eval('#callsCard .call-row', (e) => e.innerText.replace(/\s+/g, ' ').trim());
    const scoreB = async () => Number(await p.$eval('#callsCard .call-row .score-pill', (e) => e.textContent));
    const before = await scoreB();

    // Check coin A: the block is there but closed, and nothing is read until it is opened
    await p.evaluate(() => showTab('check')); await p.fill('#caInput', COIN_A); await p.click('#checkForm button[type=submit]');
    await p.waitForSelector('[data-fold="track"]', { timeout: 8000 });
    await p.waitForTimeout(500);
    assert.equal(gm.filter((x) => x.startsWith('user/')).length, 0, 'no wallet reads before the block is opened: ' + gm.join(' '));
    assert.match(await p.$eval('[data-fold="track"] > summary', (e) => e.innerText), /Wallets worth tracking/);
    // "Open all" opens it without reading: it offers a Load button instead
    await p.click('#foldAllBtn');
    assert.ok(await p.$('[data-fold="track"][open] #wtLoadBtn'), 'Open all shows the Load button');
    await p.waitForTimeout(300);
    assert.equal(gm.filter((x) => x.startsWith('user/')).length, 0, 'Open all reads no wallets');
    await p.click('#foldAllBtn');
    await p.click('[data-fold="track"] > summary');
    await p.waitForFunction(() => wtState.worth && wtState.worth.rows && wtState.worth.rows.length && wtState.worth.rows.every((r) => r.card || r.error), null, { timeout: 20000 });
    await p.waitForTimeout(300);
    const cards = await p.$$eval('[data-fold="track"] .wcard', (cs) => cs.map((c) => ({ w: c.dataset.wallet, cls: c.className, text: c.innerText.replace(/\s+/g, ' ') })));
    assert.deepEqual(cards.map((c) => c.w), [GOOD, BAD], 'pool and bundler are left out, best profit first');
    const [good, bad] = cards;
    assert.match(good.cls, /wcard-pass/);
    assert.match(good.text, /1 day \+\$120/, '1 day from the BONK sell');
    assert.match(good.text, /3 days \+\$620/, '3 days adds the MEW sell');
    assert.match(good.text, /7 days \+\$900 50% 30 days \+\$4\.2k 55%/);
    assert.match(good.text, /3\.50 SOL · holdings \$1\.2k/);
    assert.match(good.text, /Buy WIF \$300/);
    assert.match(good.text, /Sell BONK \$500 \(\+\$120\)/);
    assert.match(good.text, /✓ Has a balance/);
    assert.match(good.text, /Track$/);
    assert.match(bad.cls, /wcard-fail/);
    assert.match(bad.text, /✗ Enough trades .*✗ Wins often .*✗ Copyable/);
    assert.match(bad.text, /Fails \d+ checks .*Track anyway$/);
    assert.match(await p.$eval('[data-fold="track"] > summary', (e) => e.innerText), /1 of 2 pass/);
    assert.equal(gm.filter((x) => x === 'user/wallet_stats:GoodWall:7d').length, 1);
    await (await p.$('.worth-block')).screenshot({ path: E2E.OUT + `/wallets-${vp.name}.png` });

    // Track the good one: it lands in the shared list (Paper trades → Copy a wallet)
    await p.click(`[data-wt-track="${GOOD}"]:not([data-wt-anyway])`);
    assert.deepEqual(await p.evaluate(() => paperState.wallets.map((w) => [w.address, w.chain, !!w.anyway])), [[GOOD, 'sol', false]]);
    assert.match(await p.$eval(`.wcard[data-wallet="${GOOD}"]`, (e) => e.innerText), /Tracked ✓/);
    assert.match(await p.$eval('#paperCard', (e) => e.innerText.replace(/\s+/g, ' ')), /Good…1111 sol/);
    assert.match(await p.$eval('#paperCard', (e) => e.innerText.replace(/\s+/g, ' ')), /30d: 55% win · \$4\.2k realized · 140 buys/);

    // A second coin it is buying: conviction line on Check, and the queue entry gets the points
    await p.fill('#caInput', COIN_B); await p.click('#checkForm button[type=submit]');
    await p.waitForFunction(() => checkState.tracked, null, { timeout: 8000 });
    assert.match(await p.$eval('.tracked-line', (e) => e.innerText.replace(/\s+/g, ' ')), /👛 1 tracked wallet in this · bought in the last hour, still holding 90%/);
    await p.evaluate(() => renderCalls());
    assert.equal(await scoreB(), before + 10, 'call score +10 for one tracked wallet buying');
    assert.match(await rowB(), /1 tracked wallet buying/);
    assert.match(await rowB(), /👛 1 tracked wallet in this · bought in the last hour/);
    // the Call queue finds it by itself too (shared top-holders read)
    await p.evaluate(() => { const q = callState.queue; for (const k of Object.keys(q)) delete q[k].tw; researchCalls(); });
    await p.waitForFunction(() => !callState.busy && Object.values(callState.queue).every((e) => e.tw), null, { timeout: 8000 });
    await p.evaluate(() => renderCalls());
    assert.equal(await scoreB(), before + 10);
    // Signal scorecard groups calls by it
    assert.equal(await p.evaluate((a) => Signals.signalsOf(callState.queue[a], null).tracked, COIN_B), 'buying');

    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
    assert.deepEqual(errs, []);
    await p.close();
  }
  await b.close();
  console.log('WALLET TRACKER E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
