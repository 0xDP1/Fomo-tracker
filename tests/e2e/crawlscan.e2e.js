// docs/features/crawlscan.md: CrawlScan on demand on the Check tab (score, band, five bars, headline, operators, the
// finding) and on a Call queue row (tag that opens the Check tab, shown from memory without a second scan).
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const FIX = require(E2E.ROOT + '/tests/fixtures/crawlscan.json');
const COIN = FIX.result.token;
const risky = () => { const r = JSON.parse(JSON.stringify(FIX)); Object.assign(r.result, { score: 59, band: 'RISKY', parts: { operator: 20.4, virgin: 25, transfer: 6.3, sniper: 5.4, concentration: 5.6 }, headline: '19 wallets → 16 operators, biggest holds 9.7% of float (7.0% of supply), could move price −31% if sold', reason: 'proven operator of 4 wallets, 9.7% of float' }); r.result.metrics.impact = 0.31; return r; };
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    const p = await b.newPage({ viewport: vp });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    const crawlCalls = [];
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|feed\.example|cdnjs)/, (r) => r.abort());
    await p.route('https://api.dexscreener.com/**', (r) => { const a = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
      r.fulfill({ json: { pairs: a.filter((x) => x === COIN).map((x) => ({ chainId: 'solana', dexId: 'pumpswap', pairAddress: 'pKirk', url: 'https://dexscreener.com/x', baseToken: { symbol: 'KIRK', name: 'Kirk Coin', address: x }, priceUsd: '0.0003', marketCap: 300000, fdv: 300000, liquidity: { usd: 40000 }, volume: { h24: 90000, h1: 5000, m5: 500 }, priceChange: { m5: 1, h1: 2, h6: 3, h24: 4 }, txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 30, sells: 10 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: Date.now() - 3600e3 })) } }); });
    await p.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { creator: 'Dev1', token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 900, topHolders: [{ address: 'H1', owner: 'HO1', pct: 2 }], markets: [] } }));
    await p.route('https://feed.example/**', (r) => {
      const u = new URL(r.request().url());
      if (u.pathname === '/crawl') { crawlCalls.push(u.search); const s = JSON.parse(JSON.stringify(risky().result)); return r.fulfill({ json: { data: Object.assign(summ(s), { at: Date.now() }), cached: false }, headers: { 'Access-Control-Allow-Origin': '*' } }); }
      r.fulfill({ json: { status: 'ok', checkedAt: Date.now(), now: Date.now(), channels: [], calls: [], callers: {}, alerts: { on: false } }, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    // the Worker's summary, built the same way (crawlscan.js is shared)
    const summ = (res) => require(E2E.ROOT + '/crawlscan.js').summarize(res, Date.now());
    await p.addInitScript((coin) => {
      if (sessionStorage.getItem('i')) return;
      const t = Date.now();
      localStorage.clear();
      localStorage.setItem('ft_tab', 'calls');
      localStorage.setItem('ft_settings', JSON.stringify({ feedUrl: 'https://feed.example', feedKey: 'k' }));
      localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-calls': true }));
      localStorage.setItem('ft_foldOpen', JSON.stringify({ all: true }));
      localStorage.setItem('ft_callView', JSON.stringify('all'));
      localStorage.setItem('ft_callMinLiq', JSON.stringify(0));
      localStorage.setItem('ft_callQueue', JSON.stringify({ [coin]: { address: coin, chain: 'solana', symbol: 'KIRK', mentions: 1, posters: ['alice'], channels: ['Man Cave'], sources: ['telegram'], firstPoster: 'alice', firstAt: t - 600000, lastAt: t - 600000 } }));
      sessionStorage.setItem('i', 1);
    }, COIN);
    await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html');
    await p.waitForFunction(() => !callState.busy && Object.values(callState.queue).every((e) => e.dexAt), null, { timeout: 10000 });
    await p.evaluate(() => renderCalls());
    const text = (sel) => p.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim());
    // queue row: a CrawlScan button, then a tag saved with the queue
    await p.click(`[data-call-crawl="${COIN}"]`);
    await p.waitForFunction((a) => callState.queue[a].crawl, COIN, { timeout: 8000 });
    assert.equal(crawlCalls.length, 1);
    assert.match(crawlCalls[0], new RegExp('^\\?ca=' + COIN + '$'));
    const row = await p.$eval(`.call-row:has([data-call-ca="${COIN}"])`, (r) => r.innerText.replace(/\s+/g, ' '));
    assert.match(row, /CS 59 · RISKY/, row);
    assert.deepEqual(JSON.parse(await p.evaluate(() => localStorage.getItem('ft_callQueue')))[COIN].crawl.band, 'RISKY', 'saved with the queue');
    // tapping the tag opens the Check tab, where the block shows from memory: no second scan
    await p.click(`.call-row .tag[data-call-ca="${COIN}"]`);
    await p.waitForFunction((c) => checkState.ca === c && checkState.risk && checkState.crawl && checkState.crawl.s, COIN, { timeout: 8000 });
    await p.waitForTimeout(300);
    assert.equal(crawlCalls.length, 1, 'no second scan');
    let blk = await text('[data-fold="crawl"]');
    console.log(vp.name, blk.slice(0, 400));
    assert.match(blk, /^CrawlScan CS 59 · RISKY Refresh 59 \/100 19 wallets → 16 operators, biggest holds 9\.7% of float \(7\.0% of supply\), could move price −31% if sold proven operator of 4 wallets, 9\.7% of float/);
    assert.match(blk, /operator \(dump impact\) 20\.4 \/ 35 virgin 25 \/ 25 transfer 6\.3 \/ 20 sniper 5\.4 \/ 10 concentration 5\.6 \/ 10/);
    assert.match(blk, /Operator Float (Supply )?Status 1 wallet Hp4P…LbmS 20\.1%/);
    assert.match(blk, /19 holders read · 19 operators · scanned/);
    const findings = await p.$$eval('#verdictCard .findings li', (ls) => ls.map((l) => l.innerText.replace(/\s+/g, ' ')));
    assert.ok(findings.some((f) => /^Medium CrawlScan: RISKY, 59\/100/i.test(f)), findings.join(' | '));
    const widths = await p.$$eval('.crawl-fill', (fs) => fs.map((f) => f.style.width));
    assert.deepEqual(widths, ['58%', '100%', '32%', '54%', '56%']);
    await (await p.$('.crawl-block')).screenshot({ path: E2E.OUT + `/crawlscan-${vp.name}.png` });
    // Refresh asks for a fresh scan
    await p.click('#crawlBtn');
    await p.waitForFunction(() => checkState.crawl && checkState.crawl.s && !checkState.crawl.loading, null, { timeout: 8000 });
    assert.equal(crawlCalls.length, 2); assert.match(crawlCalls[1], /fresh=1/);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
    assert.deepEqual(errs, []);
    await p.close();
  }
  // without the Worker: the block says what is needed and no button shows
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
  await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|cdnjs)/, (r) => r.abort());
  await p.route('https://api.dexscreener.com/**', (r) => r.fulfill({ json: { pairs: [{ chainId: 'solana', dexId: 'pumpswap', pairAddress: 'pKirk', url: 'https://dexscreener.com/x', baseToken: { symbol: 'KIRK', name: 'x', address: COIN }, priceUsd: '0.0003', marketCap: 300000, fdv: 300000, liquidity: { usd: 40000 }, volume: { h24: 90000, h1: 5000, m5: 500 }, priceChange: { m5: 1 }, txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 30, sells: 10 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: Date.now() - 3600e3 }] } }));
  await p.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 900, topHolders: [], markets: [] } }));
  await p.addInitScript(() => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_tab', 'check'); localStorage.setItem('ft_foldOpen', JSON.stringify({ all: true })); sessionStorage.setItem('i', 1); });
  await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(300);
  await p.evaluate((c) => runCheck(c), COIN);
  await p.waitForFunction(() => checkState.risk, null, { timeout: 8000 }); await p.waitForTimeout(200);
  assert.match(await p.$eval('[data-fold="crawl"]', (e) => e.innerText.replace(/\s+/g, ' ')), /Needs the Discord feed Worker/);
  assert.equal(await p.$('#crawlBtn'), null);
  await b.close();
  console.log('CRAWLSCAN E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
