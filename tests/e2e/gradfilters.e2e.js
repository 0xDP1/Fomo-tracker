// docs/features/grad-filters.md: a graduate cut for liquidity under the default $12k passes once the owner lowers the
// minimum to $8k; the header says "custom filters"; Reset puts the defaults back.
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const pad = (s) => (s + '1'.repeat(44)).slice(0, 40) + 'pump';
const A = pad('ThinPooo'), B = pad('ThinTwoo'); // base58: no 0, O, I or l
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const pairOf = (x) => ({ chainId: 'solana', dexId: 'pumpswap', pairAddress: 'P' + x.slice(0, 6), url: 'https://dexscreener.com/x', baseToken: { symbol: x.slice(0, 7).toUpperCase(), name: 'x', address: x }, priceUsd: '0.000085', marketCap: 85000, fdv: 85000, liquidity: { usd: 9000 }, volume: { h24: 30000, h1: 30000, m5: 5000 }, priceChange: { m5: 5 }, txns: { m5: { buys: 30, sells: 10 }, h1: { buys: 120, sells: 60 }, h24: { buys: 120, sells: 60 } }, pairCreatedAt: Date.now() - 3 * 60000 });
  await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
  await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|cdnjs)/, (r) => r.abort());
  await p.route('https://api.dexscreener.com/**', (r) => { const list = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
    r.fulfill({ json: { pairs: list.filter((x) => x === A || x === B).map(pairOf) } }); });
  await p.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 900, topHolders: Array.from({ length: 10 }, (_, i) => ({ address: 'H' + i, owner: 'HO' + i, pct: 2 })), markets: [{ pubkey: 'm', marketType: 'pump_amm', lp: { lpLockedPct: 100 } }] } }));
  await p.addInitScript(() => {
    window.__ws = [];
    window.WebSocket = class { constructor(url) { this.url = url; window.__ws.push(this); setTimeout(() => this.onopen && this.onopen(), 10); } send() {} close() { setTimeout(() => this.onclose && this.onclose({}), 0); } };
    if (sessionStorage.getItem('i')) return;
    localStorage.clear(); localStorage.setItem('ft_tab', 'calls'); localStorage.setItem('ft_uiOpen', JSON.stringify({ 'calls-grad': true })); sessionStorage.setItem('i', 1);
  });
  await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(300);
  const graduate = async (mint) => {
    await p.evaluate((m) => window.__ws[0].onmessage({ data: JSON.stringify({ signature: 's' + m.slice(0, 4), mint: m, txType: 'migrate', pool: 'pump-amm' }) }), mint);
    await p.evaluate(() => { gradState.list.forEach((g) => { if (g.status === 'waiting') g.dueAt = Date.now() - 1; }); return gradTick(); });
    await p.waitForFunction(() => !gradState.busy && gradState.list.every((g) => g.status !== 'waiting'), null, { timeout: 20000 });
  };
  const result = (mint) => p.evaluate((m) => { const g = gradState.list.find((x) => x.mint === m); return [g.status, g.why || '']; }, mint);
  const summary = () => p.$eval('#gradSummary', (e) => e.textContent);
  // the Filters panel shows the defaults
  await p.click('#gradFilters > summary');
  assert.deepEqual(await p.$$eval('#gradFilters input[type=number]', (els) => els.map((e) => [e.dataset.gradF, e.value])), [['waitMin', '3'], ['liq', '12000'], ['mcapMin', '60000'], ['mcapMax', '8000000'], ['vol', '8000'], ['turnover', '0'], ['trades', '30'], ['feesSol', '1'], ['topWallet', '5'], ['top10', '60'], ['holders', '80'], ['creator', '10']]);
  assert.doesNotMatch(await summary(), /custom/);
  // defaults: $9k liquidity is cut
  await graduate(A);
  assert.deepEqual(await result(A), ['cut', 'liquidity $9k under $12k']);
  // lower the minimum to $8k: the next one passes
  await p.fill('[data-grad-f="liq"]', '8000'); await p.dispatchEvent('[data-grad-f="liq"]', 'change');
  assert.match(await summary(), /custom filters/);
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('ft_gradFilters')).liq), 8000);
  await graduate(B);
  assert.deepEqual(await result(B), ['passed', '']);
  assert.deepEqual(await result(A), ['cut', 'liquidity $9k under $12k'], 'a coin already checked keeps its result');
  // no GMGN here: the fee floor cannot be read, so it does not cut and the row says so (docs/features/grad-fees.md)
  assert.match(await p.$eval('#gradCard', (e) => e.innerText.replace(/\s+/g, ' ')), /THINTWO graduated .* · fees not read passed/);
  // a bad number is clamped; Reset puts the defaults back
  await p.fill('[data-grad-f="top10"]', '250'); await p.dispatchEvent('[data-grad-f="top10"]', 'change');
  assert.equal(await p.inputValue('[data-grad-f="top10"]'), '100');
  await p.click('#gradReset');
  assert.equal(await p.inputValue('[data-grad-f="liq"]'), '12000');
  assert.equal(await p.inputValue('[data-grad-f="top10"]'), '60');
  assert.doesNotMatch(await summary(), /custom/);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
  await (await p.$('#gradCard')).screenshot({ path: E2E.OUT + '/gradfilters-phone.png' });
  assert.deepEqual(errs, []);
  await b.close();
  console.log('GRAD FILTERS E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
