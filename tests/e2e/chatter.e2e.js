const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
// "What people are saying": nothing runs until tapped; the Worker's chatter search, messages sorted by group code,
// a Claude Haiku summary (faked here), no AI call when nobody talked, counts only without a key, and the queue's Chatter button.
const pad = (s) => (s + '1'.repeat(44)).slice(0, 44);
const LOUD = pad('LoudCoin'), QUIET = pad('QuietCoin');
const t0 = Date.now() - 3600e3;
const m = (i, author, content, card) => ({ id: String(i), ts: t0 + i * 60000, author, text: content, card: !!card, cardTitle: card ? 'LOUD [300K]' : '', replyTo: '' });
const loudMsgs = [m(1, '[PRO] Rick', '', true), m(2, '[SS] Arachnaught', 'dev is based, aping this'), m(3, '[SS] Arachnaught', 'holding'), m(4, '[CPT] kai', 'looks bundled to me'), m(5, '[PRO] Rick', '', true), m(6, '[SS] zed', 'KOL just bought')];
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    for (const mode of ['key', 'nokey', 'oldworker']) {
      const p = await b.newPage({ viewport: vp });
      const errs = []; p.on('pageerror', (e) => errs.push(e.message));
      const chat = [], ai = [];
      await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
      await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|feed\.example|api\.anthropic|cdnjs)/, (r) => r.abort());
      await p.route('https://feed.example/**', (r) => {
        const u = new URL(r.request().url());
        const H = { 'Access-Control-Allow-Origin': '*' };
        if (u.pathname === '/calls') return r.fulfill({ json: { status: 'ok', checkedAt: Date.now(), now: Date.now(), channels: [], calls: [{ address: LOUD, chain: 'solana', poster: 'a', at: Date.now() - 600e3, messageId: '9' }], callers: {} }, headers: H });
        if (u.pathname === '/gmgn/market/token_top_holders' || u.pathname.startsWith('/gmgn/')) return r.fulfill({ status: 503, json: { error: 'not_configured' }, headers: H });
        if (u.pathname === '/chatter') {
          chat.push(u.searchParams.get('ca').slice(0, 8) + ':' + u.searchParams.get('sym'));
          assert.equal(r.request().headers()['x-feed-key'], 'k3y');
          if (mode === 'oldworker') return r.fulfill({ status: 503, json: { error: 'not_configured' }, headers: H });
          const ca = u.searchParams.get('ca');
          return r.fulfill({ json: { ca, total: 4, hours: 24, messages: ca === LOUD ? loudMsgs : [m(1, '[PRO] Rick', '', true)], at: Date.now() }, headers: H });
        }
        r.fulfill({ status: 404, json: {}, headers: H });
      });
      await p.route('https://api.anthropic.com/**', (r) => {
        const body = JSON.parse(r.request().postData());
        ai.push(body);
        r.fulfill({ json: { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ mood: 'mixed', summary: 'SS is excited about the dev, CPT thinks it is bundled.', groups: [{ code: 'SS', take: 'Bullish on the dev and a KOL buy' }, { code: 'CPT', take: 'Worried it is bundled' }], claims: ['dev based', 'KOL bought'], redFlags: ['bundled'] }) }] }, headers: { 'Access-Control-Allow-Origin': '*' } });
      });
      await p.route('https://api.dexscreener.com/**', (r) => { const a = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
        r.fulfill({ json: { pairs: a.map((x) => ({ chainId: 'solana', dexId: 'raydium', pairAddress: 'p' + x.slice(0, 5), url: 'https://dexscreener.com/x', baseToken: { symbol: x === LOUD ? 'LOUD' : 'QUIET', name: 'x', address: x }, priceUsd: '0.001', marketCap: 300000, liquidity: { usd: 40000 }, volume: { h24: 90000, h1: 5000, m5: 500 }, priceChange: { m5: 1 }, txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 30, sells: 10 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: Date.now() - 2 * 3600e3 })) } }); });
      await p.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 900, topHolders: [{ address: 'H1', owner: 'HO1', pct: 3 }], markets: [] } }));
      const settings = { feedUrl: 'https://feed.example', feedKey: 'k3y', anthropicKey: mode === 'nokey' ? '' : 'sk-test' };
      await p.addInitScript((st) => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_tab', 'check'); localStorage.setItem('ft_callView', JSON.stringify('all')); localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-calls': true })); localStorage.setItem('ft_settings', JSON.stringify(st)); sessionStorage.setItem('i', 1); }, settings);
      await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(500);
      const text = (sel) => p.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim());
      const done = () => p.waitForFunction(() => { const c = chatState[checkState.ca]; return c && !c.loading; }, null, { timeout: 8000 });
      await p.evaluate(() => showTab('check')); await p.fill('#caInput', LOUD); await p.click('#checkForm button[type=submit]');
      await p.waitForFunction(() => checkState.risk, null, { timeout: 8000 }); await p.waitForTimeout(300);
      assert.equal(chat.length + ai.length, 0, 'nothing runs until tapped');
      assert.match(await text('[data-fold="chatter"]'), /What people are saying Read the chat .*About 0\.2¢ a tap/);
      await p.click('#chatBtn'); await done();
      assert.deepEqual(chat, ['LoudCoin:LOUD'], 'searched by address and ticker');
      let block = await text('[data-fold="chatter"]');
      if (mode === 'oldworker') {
        assert.match(block, /Add CHATTER_CHANNEL \(the on chain feed channel ID\) to the Worker in Cloudflare/);
        assert.equal(ai.length, 0);
        assert.deepEqual(errs, []); await p.close(); continue;
      }
      assert.match(block, /\[SS\] 2 people · 3 msgs/);
      assert.match(block, /\[CPT\] 1 person · 1 msg/);
      assert.match(block, /\[PRO\] 2 scans, no talk/);
      assert.match(block, /4 messages and 2 scans from on chain feed, last 24 hours/);
      assert.match(block, /Most active: \[SS\] Arachnaught \(2\)/);
      if (mode === 'nokey') {
        assert.equal(ai.length, 0, 'no key: no AI call');
        assert.match(block, /Add an Anthropic API key \(Settings\) to get the summary/);
        assert.deepEqual(errs, []); await p.close(); continue;
      }
      assert.equal(ai.length, 1);
      assert.equal(ai[0].model, 'claude-haiku-5-5');
      assert.equal(ai[0].output_config.format.type, 'json_schema');
      assert.match(ai[0].messages[0].content, /<chat>\n\[SS\] Arachnaught: dev is based, aping this\n\[SS\] Arachnaught: holding\n\[CPT\] kai: looks bundled to me\n\[SS\] zed: KOL just bought\n<\/chat>/);
      assert.ok(!/Rick/.test(ai[0].messages[0].content), 'bot cards are not sent to the AI');
      assert.match(block, /What people are saying mixed Refresh SS is excited about the dev, CPT thinks it is bundled\./);
      assert.match(block, /\[SS\] 2 people · 3 msgs Bullish on the dev and a KOL buy/);
      assert.match(block, /Claims: dev based · KOL bought/);
      assert.match(block, /Red flags mentioned: bundled/);
      await (await p.$('.chat-block')).screenshot({ path: E2E.OUT + `/chatter-${vp.name}.png` });
      // the same coin again: reused, no new calls; Refresh forces one
      await p.evaluate(() => showTab('check')); await p.fill('#caInput', LOUD); await p.click('#checkForm button[type=submit]'); await p.waitForFunction(() => checkState.risk, null, { timeout: 8000 }); await p.waitForTimeout(300);
      assert.match(await text('[data-fold="chatter"]'), /mixed/);
      assert.equal(chat.length, 1);
      await p.click('#chatBtn'); await done();
      assert.equal(chat.length, 2, 'Refresh searches again');
      // a coin nobody talked about: no AI call
      await p.evaluate(() => showTab('check')); await p.fill('#caInput', QUIET); await p.click('#checkForm button[type=submit]'); await p.waitForFunction(() => checkState.risk, null, { timeout: 8000 });
      await p.click('#chatBtn'); await done();
      assert.match(await text('[data-fold="chatter"]'), /Nobody talked about it in on chain feed in the last 24 hours; it was scanned 1 time in 1 group\./);
      assert.equal(ai.length, 2, 'only the two LOUD reads called the AI');
      // the queue row's Chatter button runs the check and the chatter together
      await p.evaluate(() => { delete chatState[Object.keys(chatState).find((k) => k.startsWith('Loud'))]; });
      await p.evaluate(() => showTab('calls'));
      await p.waitForSelector('[data-call-chat]', { timeout: 8000 });
      await p.click('[data-call-chat]');
      await p.waitForFunction(() => checkState.ca && checkState.ca.startsWith('Loud') && chatState[checkState.ca] && !chatState[checkState.ca].loading, null, { timeout: 8000 });
      assert.match(await text('[data-fold="chatter"]'), /mixed/);
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
      assert.deepEqual(errs, []);
      await p.close();
    }
  }
  await b.close();
  console.log('CHATTER E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
