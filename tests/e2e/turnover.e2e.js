// docs/features/turnover.md: volume ÷ market cap on Call queue rows with its colour, the "Hide volume < mcap" chip and
// the Min turnover filter (remembered), the ratio under the Check tab's Volume tile and the finding, the Graduations field.
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const pad = (s) => (s + '1'.repeat(44)).slice(0, 44);
const HIGH = pad('HighTurnA'), LOW = pad('LowTurnB');
const VOL = { [HIGH]: 250000, [LOW]: 60000 }; // both at a $100k market cap: 2.5x and 0.6x
const SYM = { [HIGH]: 'HIGH', [LOW]: 'LOW' };
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
  await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|cdnjs)/, (r) => r.abort());
  await p.route('https://api.dexscreener.com/**', (r) => { const a = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
    r.fulfill({ json: { pairs: a.filter((x) => VOL[x]).map((x) => ({ chainId: 'solana', dexId: 'pumpswap', pairAddress: 'p' + x.slice(0, 5), url: 'https://dexscreener.com/x', baseToken: { symbol: SYM[x], name: 'x', address: x }, priceUsd: '0.0001', marketCap: 100000, fdv: 100000, liquidity: { usd: 30000 }, volume: { h24: VOL[x], h1: 5000, m5: 500 }, priceChange: { m5: 1 }, txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 30, sells: 10 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: Date.now() - 3 * 3600e3 })) } }); });
  await p.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 900, topHolders: [{ address: 'H1', owner: 'HO1', pct: 2 }], markets: [] } }));
  await p.addInitScript((d) => {
    if (sessionStorage.getItem('i')) return;
    const t = Date.now();
    const e = (address, symbol) => ({ address, chain: 'solana', symbol, mentions: 1, posters: ['alice'], channels: ['Man Cave'], sources: ['telegram'], firstPoster: 'alice', firstAt: t - 600000, lastAt: t - 600000 });
    localStorage.clear();
    localStorage.setItem('ft_tab', 'calls'); localStorage.setItem('ft_callsPane', JSON.stringify('queue'));
    localStorage.setItem('ft_callView', JSON.stringify('all'));
    localStorage.setItem('ft_callMinLiq', JSON.stringify(0));
    localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-calls': true }));
    localStorage.setItem('ft_foldOpen', JSON.stringify({ all: true }));
    localStorage.setItem('ft_callQueue', JSON.stringify({ [d.HIGH]: e(d.HIGH, 'HIGH'), [d.LOW]: e(d.LOW, 'LOW') }));
    sessionStorage.setItem('i', 1);
  }, { HIGH, LOW });
  await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html');
  await p.waitForFunction(() => !callState.busy && Object.values(callState.queue).every((e) => e.dexAt), null, { timeout: 10000 });
  await p.evaluate(() => renderCalls());
  const row = (a) => p.$eval(`.call-row:has([data-call-ca="${a}"])`, (r) => r.innerText.replace(/\s+/g, ' '));
  const rows = () => p.$$eval('.call-row', (rs) => rs.map((r) => r.querySelector('b').textContent));
  assert.match(await row(HIGH), /vol \$250\.0k 2\.5× mcap/);
  assert.match(await row(LOW), /vol \$60\.0k 0\.6× mcap/);
  assert.equal(await p.$eval(`.call-row:has([data-call-ca="${HIGH}"]) .pos`, (e) => e.textContent), '2.5× mcap', 'green at 2x and up');
  assert.equal(await p.$eval(`.call-row:has([data-call-ca="${LOW}"]) .neg`, (e) => e.textContent), '0.6× mcap', 'red under 1x');
  assert.deepEqual((await rows()).sort(), ['HIGH', 'LOW']);
  // the chip hides the low-turnover coin and is remembered
  await p.check('#callsHideLow'); await p.waitForTimeout(150);
  assert.deepEqual(await rows(), ['HIGH']);
  assert.equal(await p.inputValue('#callsMinTurn'), '1');
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('ft_callMinTurn'))), 1);
  assert.match(await p.$eval('#callsCard', (c) => c.innerText), /1 more hidden by your filters/);
  await p.fill('#callsMinTurn', '3'); await p.dispatchEvent('#callsMinTurn', 'change'); await p.waitForTimeout(150);
  assert.deepEqual(await rows(), [], '3x hides both');
  await p.uncheck('#callsHideLow'); await p.waitForTimeout(150);
  assert.deepEqual((await rows()).sort(), ['HIGH', 'LOW'], 'off again');
  assert.equal(await p.inputValue('#callsMinTurn'), '0');
  // Check tab: the ratio under the Volume tile and the finding
  await p.evaluate((a) => { runCheck(a); }, LOW);
  await p.waitForFunction((c) => checkState.ca === c && checkState.risk, LOW, { timeout: 8000 }); await p.waitForTimeout(300);
  assert.match(await p.$eval('#tokenCard', (c) => c.innerText.replace(/\s+/g, ' ')), /Volume 24h \$60\.0k 300B \/ 200S · 0\.6× mcap/);
  let findings = await p.$$eval('#verdictCard .findings li', (ls) => ls.map((l) => l.innerText.replace(/\s+/g, ' ')));
  assert.ok(findings.some((f) => /^Medium Volume below market cap \(0\.6× in 24h\)/i.test(f)), findings.join(' | '));
  await p.evaluate((a) => { runCheck(a); }, HIGH);
  await p.waitForFunction((c) => checkState.ca === c && checkState.risk, HIGH, { timeout: 8000 }); await p.waitForTimeout(300);
  findings = await p.$$eval('#verdictCard .findings li', (ls) => ls.map((l) => l.innerText.replace(/\s+/g, ' ')));
  assert.ok(!findings.some((f) => /Volume below market cap/.test(f)));
  assert.ok(findings.some((f) => /Turnover 2\.5× market cap/.test(f)), findings.join(' | '));
  // Graduations: the field, off by default
  await p.evaluate(() => { showTab('calls'); showPane('grad'); }); await p.waitForTimeout(150);
  assert.equal(await p.inputValue('[data-grad-f="turnover"]'), '0');
  assert.equal(await p.$eval('[data-grad-f="turnover"]', (i) => i.closest('label').textContent.replace(/\s+/g, ' ').trim()), 'Volume at least × mcap');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
  assert.deepEqual(errs, []);
  await b.close();
  console.log('TURNOVER E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
