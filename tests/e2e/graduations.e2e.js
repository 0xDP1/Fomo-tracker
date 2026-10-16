// docs/features/graduations.md: a fake PumpPortal feed sends four graduations; 3 minutes later one is cut on the market
// check, one on fees paid (docs/features/grad-fees.md, GMGN's total fees in SOL), one on holders, and one passes with a
// 🎓 alert and Add to Call queue; the switch closes the connection.
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const pad = (s) => (s + '1'.repeat(44)).slice(0, 40) + 'pump';
const THIN = pad('ThinPooo'), WHALE = pad('WhaxeHedd'), GOOD = pad('GoodGrad'), CHEAP = pad('CheapFee'); // base58: no 0, O, I or l
const FEES_USD = { [WHALE]: 400, [GOOD]: 250, [CHEAP]: 30 }; // at $100 a SOL: 4, 2.5 and 0.3 SOL
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const pairOf = (x, sym, liq) => ({ chainId: 'solana', dexId: 'pumpswap', pairAddress: 'P' + x.slice(0, 6), url: 'https://dexscreener.com/x', baseToken: { symbol: sym, name: sym, address: x }, priceUsd: '0.000085', marketCap: 85000, fdv: 85000, liquidity: { usd: liq }, volume: { h24: 30000, h1: 30000, m5: 5000 }, priceChange: { m5: 5 }, txns: { m5: { buys: 30, sells: 10 }, h1: { buys: 120, sells: 60 }, h24: { buys: 120, sells: 60 } }, pairCreatedAt: Date.now() - 3 * 60000 });
  const pairs = { [THIN]: pairOf(THIN, 'THIN', 9000), [WHALE]: pairOf(WHALE, 'WHALE', 22000), [GOOD]: pairOf(GOOD, 'GOOD', 22000), [CHEAP]: pairOf(CHEAP, 'CHEAP', 22000) };
  const gm = [];
  await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
  await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|openapi\.gmgn\.ai|lite-api\.jup\.ag|cdnjs)/, (r) => r.abort());
  await p.route('https://lite-api.jup.ag/**', (r) => r.fulfill({ json: { So11111111111111111111111111111111111111112: { usdPrice: 100 } } }));
  await p.route('https://openapi.gmgn.ai/**', (r) => { const u = new URL(r.request().url()); gm.push(u.pathname.split('/v1/')[1] + ':' + (u.searchParams.get('address') || '').slice(0, 5));
    r.fulfill({ json: { code: 0, data: { address: u.searchParams.get('address'), total_fees: FEES_USD[u.searchParams.get('address')] } }, headers: { 'Access-Control-Allow-Origin': '*' } }); });
  await p.route('https://api.dexscreener.com/**', (r) => { const list = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
    r.fulfill({ json: { pairs: list.map((x) => pairs[x]).filter(Boolean) } }); });
  await p.route('https://api.rugcheck.xyz/**', (r) => {
    const whale = r.request().url().includes(WHALE);
    const top = whale ? [{ address: 'W', owner: 'WO', pct: 8 }] : Array.from({ length: 10 }, (_, i) => ({ address: 'H' + i, owner: 'HO' + i, pct: 2 }));
    r.fulfill({ json: { token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 900, topHolders: top, markets: [{ pubkey: 'm', marketType: 'pump_amm', lp: { lpLockedPct: 100 } }] } });
  });
  // A fake PumpPortal connection the test can talk through.
  await p.addInitScript(() => {
    window.__ws = [];
    window.WebSocket = class {
      constructor(url) { this.url = url; this.sent = []; this.closed = false; window.__ws.push(this); setTimeout(() => this.onopen && this.onopen(), 10); }
      send(d) { this.sent.push(d); }
      close() { this.closed = true; setTimeout(() => this.onclose && this.onclose({}), 0); }
    };
    if (sessionStorage.getItem('i')) return;
    localStorage.clear();
    localStorage.setItem('ft_tab', 'calls');
    localStorage.setItem('ft_uiOpen', JSON.stringify({ 'calls-grad': true }));
    localStorage.setItem('ft_settings', JSON.stringify({ gmgnKey: 'phone-key' })); // GMGN on this device: the fee floor can be read
    sessionStorage.setItem('i', 1);
  });
  await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(300);
  const card = () => p.$eval('#gradCard', (e) => e.innerText.replace(/\s+/g, ' '));
  // one connection, subscribed to graduations
  assert.deepEqual(await p.evaluate(() => window.__ws.map((w) => [w.url, w.sent])), [['wss://pumpportal.fun/api/data', ['{"method":"subscribeMigration"}']]]);
  assert.match(await card(), /Listen for pump\.fun graduations ● live .*Waiting for the next graduation/);
  // four graduations arrive (plus the subscribe reply, which is ignored)
  await p.evaluate((mints) => { const w = window.__ws[0]; w.onmessage({ data: '{"message":"Subscribed to \'migration\' events."}' }); for (const m of mints) w.onmessage({ data: JSON.stringify({ signature: 'sig' + m.slice(0, 4), mint: m, txType: 'migrate', pool: 'pump-amm' }) }); }, [THIN, WHALE, GOOD, CHEAP]);
  let text = await card();
  assert.equal((text.match(/checks in 3 min/g) || []).length, 4, text);
  // 3 minutes later: the checks
  await p.evaluate(() => { gradState.list.forEach((g) => { g.dueAt = Date.now() - 1; }); return gradTick(); });
  await p.waitForFunction(() => !gradState.busy && gradState.list.every((g) => g.status !== 'waiting'), null, { timeout: 20000 });
  const st = await p.evaluate(() => Object.fromEntries(gradState.list.map((g) => [g.symbol, [g.status, g.stage || '', g.why || '']])));
  assert.deepEqual(st.THIN, ['cut', 'Market', 'liquidity $9k under $12k']);
  assert.deepEqual(st.WHALE, ['cut', 'Holders', 'top wallet holds 8.0%, over 5%']);
  assert.deepEqual(st.CHEAP, ['cut', 'Fees', 'fees 0.3 SOL, under 1']);
  assert.equal(st.GOOD[0], 'passed', JSON.stringify(st));
  assert.deepEqual(gm.sort(), [`token/info:${CHEAP.slice(0, 5)}`, `token/info:${GOOD.slice(0, 5)}`, `token/info:${WHALE.slice(0, 5)}`], 'one GMGN read per coin past the market check, none for the cut one: ' + gm.join(' '));
  text = await card();
  assert.match(text, /🎓 GOOD graduated \d+m ago · mcap \$85\.0k · liq \$22\.0k · fees 2\.5 SOL passed/);
  assert.match(text, /THIN graduated .* Market: liquidity \$9k under \$12k/);
  assert.match(text, /CHEAP graduated .* · fees 0\.3 SOL Fees: fees 0\.3 SOL, under 1/);
  assert.match(text, /WHALE graduated .* · fees 4 SOL Holders: top wallet holds 8\.0%, over 5%/);
  assert.match(await p.$eval('#gradSummary', (e) => e.textContent), /● live · 1 passed of 4/);
  // the 🎓 alert
  const alert = await p.$eval('#callAlert', (e) => e.innerText.replace(/\s+/g, ' ').trim());
  assert.match(alert, /^🎓 GOOD graduated and passed the checks · \$85\.0k mcap · \$22\.0k liq/);
  // Add to Call queue
  await p.click(`[data-grad-add="${GOOD}"]`); await p.waitForTimeout(200);
  assert.deepEqual(await p.evaluate((a) => { const e = callState.queue[a]; return e && [e.firstPoster, e.channels]; }, GOOD), ['pump.fun', ['graduations']]);
  await (await p.$('#gradCard')).screenshot({ path: E2E.OUT + '/graduations-phone.png' });
  // the switch closes the connection and stays off
  await p.uncheck('#gradOn'); await p.waitForTimeout(50);
  assert.equal(await p.evaluate(() => window.__ws[0].closed), true);
  assert.match(await p.$eval('#gradSummary', (e) => e.textContent), /^off$/);
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('ft_gradOn'))), false);
  await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => window.__ws.length), 1, 'no reconnect after switching off');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
  assert.deepEqual(errs, []);
  await b.close();
  console.log('GRADUATIONS E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
