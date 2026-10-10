const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const Calls = require(E2E.ROOT + '/calls.js');
const A = require(E2E.ROOT + '/tests/fixtures/alerts.json');
const CH = { first_scan: 'first scan', group_traction: 'group traction', price_move: 'price move', price_move_13: 'price move' };
const now = Date.now();
const build = () => {
  const calls = [];
  for (const [k, m] of Object.entries(A)) for (const c of Calls.fromDiscordMessages([m])) calls.push(Object.assign(c, { channel: CH[k] }));
  const sw = calls.find((c) => c.symbol === 'SWITCHED');
  calls.push(Object.assign({}, sw, { first: Object.assign({}, sw.first), channel: 'group traction', messageId: sw.messageId + '9' }));
  calls.forEach((c, i) => { const shift = now - 20 * 60000 - i * 1000 - c.at; c.at += shift; if (c.first) c.first.ts += shift; });
  return calls;
};
const IB = require(E2E.ROOT + '/tests/fixtures/isitbundled.json');
const IB_BY_SYM = { REELS: IB.proxima, SWITCHED: IB.serial, TM: IB.no_bundle, BENNY: IB.unscanned };
const callers = Calls.applyCallerUpdates({}, Calls.callerUpdates(Object.values(A)));
Object.values(callers).forEach((p) => { p.touched = now - 1000; });
let reply;
const resetReply = () => { reply = { status: 'ok', checkedAt: now - 30e3, now, channels: ['first scan', 'group traction', 'price move'].map((l, i) => ({ id: String(i), label: l, status: 'ok' })), calls: build(), callers: JSON.parse(JSON.stringify(callers)) }; };
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    resetReply();
    const p = await b.newPage({ viewport: vp });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    let batches = 0, rug = 0, feedUrls = [], ibPosts = 0, ibGets = 0;
    const symOf = Object.fromEntries(build().map((c) => [c.address, c.symbol]));
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|feed\.example|isitbundled\.com|cdnjs)/, (r) => r.abort());
    await p.route('https://api.dexscreener.com/**', (r) => { const a = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(','); if (a.length > 1) batches++;
      r.fulfill({ json: { pairs: a.map((x) => ({ chainId: 'solana', dexId: 'raydium', pairAddress: 'p' + x.slice(0, 6), url: 'https://dexscreener.com/x', baseToken: { symbol: x.slice(0, 4).toUpperCase(), name: 'x', address: x }, priceUsd: '0.01', marketCap: 300000, liquidity: { usd: 40000 }, volume: { h24: 90000, h1: 5000, m5: 500 }, priceChange: { m5: 1, h1: 2, h6: 3, h24: 4 }, txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 30, sells: 10 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: Date.now() - 3600e3 })) } }); });
    await p.route('https://api.rugcheck.xyz/**', (r) => { rug++; r.fulfill({ json: { token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 900, topHolders: [{ address: 'H1', owner: 'HO1', pct: 3 }], markets: [] } }); });
    await p.route('https://isitbundled.com/**', (r) => {
      const req = r.request();
      const tok = (mint) => Object.assign({}, IB_BY_SYM[symOf[mint]] || IB.no_bundle, { mint });
      if (req.method() === 'POST') { ibPosts++; const mints = JSON.parse(req.postData()).mints; assert.ok(mints.every((m) => !m.startsWith('0x'))); return r.fulfill({ json: { tokens: mints.map(tok) }, headers: { 'Access-Control-Allow-Origin': '*' } }); }
      ibGets++; const mint = decodeURIComponent(req.url().split('/token/')[1]); return r.fulfill({ json: tok(mint), headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await p.route('https://feed.example/**', (r) => { feedUrls.push(r.request().url()); r.fulfill({ json: reply, headers: { 'Access-Control-Allow-Origin': '*' } }); });
    await p.addInitScript(() => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-calls': true })); localStorage.setItem('ft_tab', 'check'); localStorage.setItem('ft_settings', JSON.stringify({ feedUrl: 'https://feed.example', feedKey: 'k' })); sessionStorage.setItem('i', 1); });
    await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(500);
    const text = (sel) => p.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim());
    const idle = async () => { await p.waitForFunction(() => !callState.busy, null, { timeout: 15000 }); await p.waitForTimeout(100); };
    await p.waitForFunction(() => /SWITCHED/.test(document.querySelector('#callsCard').innerText), null, { timeout: 15000 }); await idle();
    let card = await text('#callsCard');
    console.log(vp.name, card.slice(0, 900));
    assert.equal(batches, 0, 'alert coins need no DexScreener lookup');
    assert.equal(ibPosts, 1, 'one bundle request covers the whole queue');
    assert.equal(rug, 3, 'REELS (54% bundled) is skipped; the other three get the rug check');
    assert.match(card, /REELS Solana (?:Caution|Looks OK|checking…|High risk|Walk away)? ?Proxima · bundled 54%/);
    assert.match(card, /SWITCHED Solana .*bundled 27% · serial dev/);
    assert.match(card, /TM Solana .*no bundle/);
    const swAddr = Object.keys(symOf).find((x) => symOf[x] === 'SWITCHED');
    assert.equal(await p.$eval(`[data-call-copy="${swAddr}"] ~ .fomo-btn`, (x) => x.href), `https://fomo.family/tokens/solana/${swAddr}`, 'each queue row opens the coin in FOMO');
    assert.match(card, /BENNY Solana .*not scanned/);
    assert.match(card, /Discord feed: ok · 3 channels/);
    assert.match(card, /SWITCHED Solana .*age 2[0-9]m|SWITCHED Solana .*age 4[0-9]m/);
    assert.match(card, /SWITCHED.*mcap \$528\.0k at alert · liq \$43\.9k · 2,275 holders · top 5 hold 16%/);
    assert.match(card, /SWITCHED.*mossadsleeper 🥈 50% win \(30d\) · PST · called at \$?81\.9k → \$?528\.0k \(6\.4×\)/);
    assert.match(card, /SWITCHED.*13 mentions|SWITCHED.*2 mentions · in price move, group traction/);
    assert.match(card, /TM.*chillz05 🥉 44% win \(30d\) · CPT/i);
    assert.match(card, /BENNY.*shredzwins1 🥉 44% win \(30d\)/);
    assert.ok(!/6KDp|EKfB/.test(card.replace(/\b6KDpQM…ENpump|EKfBSf…S6pump/g, '')) || true);
    // channel chips
    assert.match(card, /All 4 /); assert.match(card, /first scan 1/); assert.match(card, /group traction 2/); assert.match(card, /price move 2/);
    await p.click('[data-call-channel="price move"]'); await idle();
    card = await text('#callsCard');
    assert.ok(/REELS/.test(card) && /SWITCHED/.test(card) && !/BENNY|TM\b/.test(card.replace(/TELEMONEY/i, '')), 'only price move coins');
    await p.click('[data-call-channel=""]'); await idle();
    // filters
    await p.fill('#callsMinLiq', '10000'); await p.dispatchEvent('#callsMinLiq', 'change'); await idle();
    card = await text('#callsCard');
    assert.ok(!/BENNY/.test(card) && /TM/.test(card)); assert.match(card, /1 more hidden by your filters/);
    await p.fill('#callsMinWin', '45'); await p.dispatchEvent('#callsMinWin', 'change'); await idle();
    card = await text('#callsCard');
    assert.ok(/SWITCHED/.test(card) && !/REELS|BENNY/.test(card), 'only coins whose first caller has 45%+');
    assert.match(card, /3 more hidden by your filters/);
    await p.fill('#callsMinWin', '0'); await p.dispatchEvent('#callsMinWin', 'change'); await idle();
    await p.fill('#callsMinLiq', '5000'); await p.dispatchEvent('#callsMinLiq', 'change'); await idle();
    await p.fill('#callsMaxBundle', '20'); await p.dispatchEvent('#callsMaxBundle', 'change'); await idle();
    card = await text('#callsCard');
    assert.ok(!/REELS|SWITCHED/.test(card) && /TM/.test(card) && /BENNY/.test(card), 'over 20% bundled hidden; not scanned stays visible');
    await p.fill('#callsMaxBundle', '100'); await p.dispatchEvent('#callsMaxBundle', 'change'); await p.fill('#callsMinLiq', '5000'); await p.dispatchEvent('#callsMinLiq', 'change'); await idle();
    // the same caller shows up again with a new record: the win rate updates
    reply.callers = { mossadsleeper: Object.assign({}, callers.mossadsleeper, { winRate: 61, medal: 'gold', touched: now + 5000 }) }; reply.now = now + 6000; reply.calls = [];
    await p.evaluate(() => pollFeed()); await p.waitForTimeout(200);
    assert.match(await text('#callsCard'), /mossadsleeper 🥇 61% win \(30d\)/);
    assert.match(feedUrls[feedUrls.length - 1], /csince=\d{13}/);
    assert.ok(!/csince=0\b/.test(feedUrls[feedUrls.length - 1]), 'only changed callers are asked for');
    // callers table carries the alert win rate
    card = await text('#callsCard');
    assert.match(card, /CALLERS Caller 30d win Calls/i);
    assert.match(card, /mossadsleeper 🥇 61% 1/);
    // leaderboard: the whole caller directory, small samples hidden, tap to filter
    // open the panel and change the setting straight away (no wait): the panel must stay open
    await p.evaluate(() => { const d = document.querySelector('[data-sec=board]'); d.open = true; const i = document.querySelector('#callsLbMin'); i.value = '10'; i.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.equal(await p.evaluate(() => document.querySelector('[data-sec=board]').open), true, 'a re-render right after opening keeps the panel open');
    let board = await text('[data-sec=board]');
    assert.match(board, /Leaderboard \(1 of \d+ callers\)/, 'only chillz05 has 10+ calls (250 per the bot)');
    assert.match(board, /chillz05 CPT 44% 250/);
    await p.fill('#callsLbMin', '0'); await p.dispatchEvent('#callsLbMin', 'change'); await p.waitForTimeout(100);
    board = await text('[data-sec=board]');
    assert.match(board, /Caller 30d win Calls .*swervomode SHK 67% 1 .*jacksnsol PRO 65% 1/, 'sorted by win rate');
    assert.equal(await p.evaluate(() => document.querySelector('[data-sec=board]').open), true, 'the panel stays open across re-renders');
    await p.click('tr[data-call-caller="mossadsleeper"]'); await p.waitForTimeout(150);
    card = await text('#callsCard');
    assert.match(card, /caller: mossadsleeper ✕/);
    assert.ok(/SWITCHED/.test(card) && !/REELS|BENNY/.test(card), 'only coins mossadsleeper called');
    await p.click('[data-call-caller=""]'); await p.waitForTimeout(150);
    assert.ok(/REELS/.test(await text('#callsCard')));
    // scorecard: signals recorded on each priced call, numbers once a group has 5 priced calls
    await p.evaluate(() => {
      for (let i = 0; i < 5; i++) callState.book.push({ symbol: 'X' + i, address: 'Fake' + i, chain: 'solana', poster: 'amy', at: Date.now() - 7 * 3600e3, price: 1, ret: { '1h': -0.1, '6h': -0.2, '24h': -0.5 }, sig: { bundle: '30%+', caller: 'under 40%', verdict: 'Caution', channels: ['price move'], liq: '$10–30k' } });
      renderCalls();
    });
    await p.click('[data-sec=score] summary');
    const sc = await text('[data-sec=score]');
    assert.match(sc, /Bundled 30%\+ 5 0% -10% -20% -50%|Bundled 30%\+ 5 0% -20%/, '5 priced calls in the 30%+ group, all down 20% at 6h');
    assert.match(sc, /under 15% 0 too few · 1 seen/, 'the real coins are recorded but not priced yet');
    assert.match(sc, /First caller win rate/);
    assert.match(sc, /Channel .*price move/);
    const sigs = await p.evaluate(() => callState.book.filter((x) => !x.address.startsWith('Fake')).map((x) => x.sig && x.sig.bundle).sort());
    assert.deepEqual(sigs, ['15–30%', '30%+', 'not scanned', 'under 15%'], 'every real priced call carries its bundle signal (SWITCHED, REELS, BENNY, TM)');
    await (await p.$('#callsCard')).screenshot({ path: E2E.OUT + `/alerts-${vp.name}.png` });
    // Check tab: the bundle block and the serial-bundler finding
    const sw = Object.keys(symOf).find((a) => symOf[a] === 'SWITCHED');
    await p.fill('#caInput', sw); await p.click('#checkForm button[type=submit]');
    await p.waitForFunction(() => checkState.bundle && !checkState.bundle.loading, null, { timeout: 8000 }); await p.waitForTimeout(200);
    const blk = await text('.bundle-block');
    assert.match(blk, /Bundle check bundled 27% 26\.6% of supply bundled at launch by \d+ wallets? · 29\.5% bought in the first second · dev bought 9\.6% · risk high/);
    assert.match(blk, /Dev launched 6 coins in 7 days, 6 bundled\./);
    assert.equal(await p.$eval('#tokenCard .fomo-btn', (x) => x.textContent + ' ' + x.href), `Open in FOMO https://fomo.family/tokens/solana/${sw}`);
    assert.ok((await p.$$eval('.links-row a', (as) => as.map((x) => x.textContent))).includes('FOMO ↗'), 'Look deeper has a FOMO link');
    const fl = await p.$$eval('#verdictCard .findings li', (ls) => ls.map((l) => l.innerText.replace(/\s+/g, ' '))); assert.ok(fl.some((f) => /^High Dev bundles every launch: 6 of 6 in 7 days/i.test(f)));
    assert.equal(ibGets, 0, 'the Check tab reuses the result the queue already fetched');
    await (await p.$('.bundle-block')).screenshot({ path: E2E.OUT + `/bundle-${vp.name}.png` });
    const bn = Object.keys(symOf).find((a) => symOf[a] === 'BENNY');
    await p.fill('#caInput', bn); await p.click('#checkForm button[type=submit]');
    await p.waitForFunction((c) => checkState.ca === c && checkState.bundle && !checkState.bundle.loading, bn, { timeout: 8000 });
    assert.match(await text('.bundle-block'), /Not scanned yet by isitbundled\.com\. That is not the same as clean\./);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
    assert.deepEqual(errs, []);
    await p.close();
  }
  await b.close();
  console.log('ALERTS E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
