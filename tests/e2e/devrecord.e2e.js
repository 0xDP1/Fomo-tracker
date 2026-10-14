// docs/features/dev-record.md: Deep dev check on demand on the Check tab and on a Call queue row; the light creator
// history gives the dev verdict on its own; a queue result shows on the Check tab from memory, without new requests.
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const pad = (s) => (s + '1'.repeat(44)).slice(0, 44);
const COIN_P = pad('ProvenCoin'), COIN_N = pad('NeverCoin');
const CREATOR = { [COIN_P]: 'ProvenDevWallet', [COIN_N]: 'NeverDevWallet' };
const now = () => Math.floor(Date.now() / 1000);
const DAY = 86400;
const created = (wallet) => (wallet === 'ProvenDevWallet' ? { inner_count: 2, open_count: 2, tokens: [
  { token_address: COIN_P, symbol: 'SELF', create_timestamp: now() - 3600, market_cap: 300000 },
  { token_address: 'BigMint', symbol: 'BIG', create_timestamp: now() - 9 * DAY, market_cap: 40000, token_ath_mc: 2100000, holder_count: 5400, total_volume: 8.5e6, global_fee: 310 },
  { token_address: 'RunMint', symbol: 'RUN', create_timestamp: now() - 5 * DAY, market_cap: 3000, token_ath_mc: 150000 },
  { token_address: 'FlopMint', symbol: 'FLOP', create_timestamp: now() - 2 * DAY, market_cap: 2500, token_ath_mc: 9000 },
] } : { inner_count: 6, open_count: 0, tokens: [
  { token_address: COIN_N, symbol: 'SELF', create_timestamp: now() - 3600, market_cap: 300000 },
  ...[12000, 8000, 30000, 6000, 45000].map((ath, i) => ({ token_address: `NeverMint${i}`, symbol: `NV${i}`, create_timestamp: now() - (i + 2) * DAY, market_cap: 2000, token_ath_mc: ath })),
] });
const info = { RunMint: { holder_count: 900, total_volume: 1.2e6, global_fee: 30 } };
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const gm = [];
  const setup = async (p, tab, queue) => {
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|openapi\.gmgn\.ai|cdnjs)/, (r) => r.abort());
    await p.route('https://openapi.gmgn.ai/**', (r) => {
      const u = new URL(r.request().url());
      gm.push(u.pathname + ':' + (u.searchParams.get('wallet_address') || u.searchParams.get('address')));
      const data = u.pathname === '/v1/user/created_tokens' ? created(u.searchParams.get('wallet_address')) : u.pathname === '/v1/token/info' ? info[u.searchParams.get('address')] : null;
      r.fulfill({ json: data ? { code: 0, data } : { code: 404, message: 'nope' }, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await p.route('https://api.dexscreener.com/**', (r) => { const a = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
      r.fulfill({ json: { pairs: a.filter((x) => CREATOR[x]).map((x) => ({ chainId: 'solana', dexId: 'pumpswap', pairAddress: 'p' + x.slice(0, 5), url: 'https://dexscreener.com/x', baseToken: { symbol: x.slice(0, 5).toUpperCase(), name: 'x', address: x }, priceUsd: '0.0003', marketCap: 300000, fdv: 300000, liquidity: { usd: 40000 }, volume: { h24: 90000, h1: 5000, m5: 500 }, priceChange: { m5: 1, h1: 2, h6: 3, h24: 4 }, txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 30, sells: 10 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: Date.now() - 3600e3 })) } }); });
    // 20% of supply held by insider (bundle) wallets: a bundled launch
    await p.route('https://api.rugcheck.xyz/**', (r) => { const a = r.request().url().split('/tokens/')[1].split('/')[0];
      r.fulfill({ json: { creator: CREATOR[a], token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 900, topHolders: [{ address: 'H1', owner: 'HO1', pct: 20, insider: true }, { address: 'H2', owner: 'HO2', pct: 2 }], markets: [] } }); });
    await p.addInitScript(({ tab, queue }) => {
      if (sessionStorage.getItem('i')) return;
      localStorage.clear();
      localStorage.setItem('ft_tab', tab);
      localStorage.setItem('ft_settings', JSON.stringify({ gmgnKey: 'gk' }));
      localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-calls': true }));
      localStorage.setItem('ft_foldOpen', JSON.stringify({ all: true }));
      if (queue) {
        const t = Date.now();
        localStorage.setItem('ft_callView', JSON.stringify('all'));
        localStorage.setItem('ft_callMinLiq', JSON.stringify(0));
        localStorage.setItem('ft_callQueue', JSON.stringify(Object.fromEntries(queue.map((a, i) => [a, { address: a, chain: 'solana', symbol: '', mentions: 1, posters: ['alice'], channels: ['Man Cave'], sources: ['telegram'], firstPoster: 'alice', firstAt: t - (10 + i) * 60000, lastAt: t - 600000 }]))));
      }
      sessionStorage.setItem('i', 1);
    }, { tab, queue });
    await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(300);
  };
  const text = (p, sel) => p.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim());
  const run = async (p, ca) => { await p.evaluate(() => showTab('check')); await p.fill('#caInput', ca); await p.click('#checkForm button[type=submit]'); await p.waitForFunction((c) => checkState.ca === c && checkState.risk && checkState.dossier && !checkState.dossier.loading, ca, { timeout: 8000 }); await p.waitForTimeout(300); };
  const findings = (p) => p.$$eval('#verdictCard .findings li', (ls) => ls.map((l) => l.innerText.replace(/\s+/g, ' ')));
  const infoCalls = () => gm.filter((x) => x.startsWith('/v1/token/info') && !x.endsWith(':' + COIN_P) && !x.endsWith(':' + COIN_N)).length; // Strength reads the coin's own

  // ---- Check tab ----
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    gm.length = 0;
    const p = await b.newPage({ viewport: vp });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await setup(p, 'check');
    await run(p, COIN_P);
    let blk = await text(p, '[data-fold="devrec"]');
    assert.match(blk, /Deep dev check/);
    assert.match(blk, /runs only when you ask/);
    assert.equal(infoCalls(), 0, 'nothing deep before the button');
    assert.match(await text(p, '[data-fold="dossier"]'), /Best peak \$2\.10M \(BIG\) · 2 past \$100k · 1 past \$1M · Proven dev/, 'the light history shows peaks');
    await p.click('#devDeepBtn');
    await p.waitForFunction(() => checkState.devDeep && checkState.devDeep.rec, null, { timeout: 8000 });
    blk = await text(p, '[data-fold="devrec"]');
    console.log(vp.name, blk);
    assert.match(blk, /Dev track record Proven dev/);
    assert.match(blk, /3 earlier launches · best peak \$2\.10M \(BIG\) · median peak \$150\.0k · 2 past \$100k · 1 past \$1M/);
    assert.match(blk, /Most holders 5,400 \(BIG\) · volume \$9\.70M across 2 coins · global fees 340 SOL across 2 coins/);
    assert.match(blk, /Bundle: Team launch\. Bundled \(20% still held\)/);
    assert.equal(infoCalls(), 2, 'token info only for the top coins missing figures (RUN, FLOP)');
    const rows = await p.$$eval('.devrec-table tbody tr', (rs) => rs.map((r) => [...r.cells].slice(0, 3).map((c) => c.innerText.trim())));
    assert.deepEqual(rows, [['BIG', '$2.10M', '5,400'], ['RUN', '$150.0k', '900'], ['FLOP', '$9.0k', '—']]);
    assert.ok(!(await findings(p)).some((f) => /never got anywhere|earlier launches dead/.test(f)));
    await (await p.$('.devrec-block')).screenshot({ path: E2E.OUT + `/devrec-${vp.name}.png` });
    // the same coin again: shown from memory, no new GMGN requests
    const before = gm.length;
    await run(p, COIN_P);
    assert.match(await text(p, '[data-fold="devrec"]'), /Proven dev.*best peak \$2\.10M/);
    assert.equal(gm.length, before, 'remembered for an hour');
    // a dev whose coins never get anywhere, bundled: the light history alone raises the extraction finding
    await run(p, COIN_N);
    const fs = await findings(p);
    assert.ok(fs.some((f) => /^High Bundled launch from a dev whose coins never get anywhere/i.test(f)), fs.join(' | '));
    assert.match(await text(p, '[data-fold="dossier"]'), /Best peak \$45\.0k \(NV4\) · 0 past \$100k · 0 past \$1M · Never gets anywhere/);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
    assert.deepEqual(errs, []);
    await p.close();
  }

  // ---- Call queue ----
  gm.length = 0;
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await setup(p, 'calls', [COIN_P, COIN_N]);
  await p.waitForFunction(() => !callState.busy && Object.values(callState.queue).every((e) => e.dexAt), null, { timeout: 10000 });
  await p.evaluate(() => renderCalls());
  const row = (a) => p.$eval(`.call-row [data-call-ca="${a}"]`, (b) => b.closest('.call-row').innerText.replace(/\s+/g, ' '));
  assert.match(await row(COIN_N), /Dev check/);
  const minusBefore = await p.evaluate((a) => Calls.callScore(callState.queue[a], null, Date.now()).parts.minus, COIN_N);
  await p.click(`[data-call-dev="${COIN_N}"]`);
  await p.waitForFunction((a) => callState.queue[a].deep, COIN_N, { timeout: 10000 });
  const line = await p.$eval(`.call-dev[data-call-ca="${COIN_N}"]`, (e) => e.innerText.replace(/\s+/g, ' ').trim());
  assert.match(line, /^Dev: best \$45\.0k NV4 · 0 over \$100k · Never gets anywhere · Extraction pattern$/);
  assert.match(await row(COIN_N), /dev's coins never get anywhere/, 'the score flag');
  assert.equal((await p.evaluate((a) => Calls.callScore(callState.queue[a], null, Date.now()).parts.minus, COIN_N)) - minusBefore, 15, '15 points off');
  assert.equal(JSON.parse(await p.evaluate(() => localStorage.getItem('ft_callQueue')))[COIN_N].deep.verdict, 'never', 'saved with the queue');
  // tapping the line opens the full record on the Check tab, from memory
  const before = gm.length;
  await p.click(`.call-dev[data-call-ca="${COIN_N}"]`);
  await p.waitForFunction((c) => checkState.ca === c && checkState.devDeep && checkState.devDeep.rec, COIN_N, { timeout: 8000 });
  assert.match(await text(p, '[data-fold="devrec"]'), /Never gets anywhere.*5 earlier launches · best peak \$45\.0k/);
  assert.equal(gm.filter((x, i) => i >= before && x.startsWith('/v1/user/created_tokens')).length, 0, 'no new created-coins request');
  assert.deepEqual(errs, []);
  await b.close();
  console.log('DEV RECORD E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
