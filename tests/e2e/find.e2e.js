const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const EVM = '0x4bc1782fafb967834e0e75947ba15113e48fc70e';
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    const ctx = await b.newContext({ viewport: vp, });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    let claudeBody = null;
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!api\.fomoapi\.io|api\.anthropic\.com)/, (r) => r.fulfill({ json: {} }));
    await p.route('https://api.anthropic.com/**', (r) => { claudeBody = r.request().postDataJSON(); r.fulfill({ json: { content: [{ type: 'text', text: '{"handle": "@Alice"}' }], stop_reason: 'end_turn' } }); });
    await p.route('https://api.fomoapi.io/**', (r) => {
      const u = new URL(r.request().url());
      if (u.pathname === '/v2/users/alice') return r.fulfill({ json: { handle: 'alice', displayName: 'Alice Trades', followers: 1234, accountAgeDays: 120, private: false, wallets: [{ chain: 'solana', address: SOL }, { chain: 'base', address: EVM }], numTrades: 654, averageHoldTimeSeconds: 5400, totalVolume: 250000 } });
      if (u.pathname === '/v2/users/alice/trades') {
        const pnl = [60, -10, -10, -10, 150, -10];
        const trades = pnl.map((x, i) => ({ tradeId: 'a' + i, token: { symbol: 'T' + i, address: SOL }, chain: i === 4 ? 'base' : 'solana', status: 'closed', createdAt: `2026-10-0${1 + (i % 2)}T10:00:00Z`, closedAt: `2026-10-0${1 + (i % 2)}T10:${10 + i}:00Z`, costBasisUsd: 100, realizedPnlUsd: x }));
        trades.push({ tradeId: 'o1', token: { symbol: 'PEPE', address: EVM }, chain: 'solana', status: 'open', createdAt: '2026-10-03T08:00:00Z', costBasisUsd: 30 });
        return r.fulfill({ json: { trades } });
      }
      if (u.pathname.startsWith('/v2/users/ghost')) return r.fulfill({ status: 404, json: {} });
      return r.fulfill({ json: {} });
    });
    await p.addInitScript(() => { if (!sessionStorage.getItem('init')) { localStorage.clear(); localStorage.setItem('ft_settings', JSON.stringify({ lookupKey: 'fapi_TEST', anthropicKey: 'sk-ant-test' })); sessionStorage.setItem('init', 1); } });
    await p.goto(E2E.BASE + '/index.html');
    // unknown handle
    await p.fill('#findInput', 'ghost'); await p.click('#findForm button[type=submit]'); await p.waitForTimeout(300);
    assert.match(await p.textContent('#findStatus'), /No FOMO user called @ghost/);
    // screenshot -> Claude -> handle -> lookup
    await p.setInputFiles('#findShot', E2E.FIX + '/shot.png'); await p.waitForTimeout(800);
    assert.equal(claudeBody.messages[0].content[0].type, 'image');
    assert.equal(await p.inputValue('#findInput'), '@alice');
    const res = (await p.$eval('#findResult', (e) => e.innerText)).replace(/\s+/g, ' ');
    console.log(vp.name, res.slice(0, 400));
    assert.match(res, /@alice Alice Trades · 1,234 followers/);
    assert.match(res, /33% win rate · 2W \/ 4L/);
    assert.match(res, /Scalper · active · lottery hunter · mostly Solana/);
    assert.match(res, /HOLD STYLE Scalper median hold 13m/i);
    assert.match(res, /ACTIVITY Active 5\.5 trades a day/i);
    assert.match(res, /WIN PROFILE Lottery hunter avg win \+105% · avg loss -10%/i);
    assert.match(res, /SIZE AND CHAIN \$90\.00 avg position · mostly Solana/i);
    assert.match(res, /latest 6 closed trades/);
    assert.ok(!/Wallet|Solscan|Copy/i.test(res), 'no wallets shown');
    assert.equal(await p.$$eval('#findResult a', (as) => as.length), 0);
    // Follow -> appears in Following, button flips
    await p.click('[data-find-follow="alice"]'); await p.waitForTimeout(300);
    assert.equal(await p.textContent('[data-find-follow="alice"]'), 'Following');
    assert.ok((await p.textContent('#followChips')).includes('@alice'));
    await (await p.$('#findCard')).screenshot({ path: E2E.OUT + `/find-${vp.name}.png` });
    // fomo.family link input
    await p.fill('#findInput', 'https://fomo.family/@alice'); await p.click('#findForm button[type=submit]'); await p.waitForTimeout(300);
    assert.equal(await p.inputValue('#findInput'), '@alice');
    console.log(vp.name, 'errors:', errs); assert.equal(errs.length, 0);
    const hs = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(hs, false, 'horizontal scroll');
    await ctx.close();
  }
  await b.close(); console.log('FIND E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
