const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const H = 3600e3;
const M = (s) => (s.replace(/[0OIl]/g, 'x') + 'Mint1111111111111111111111111111111111111').slice(0, 44);
const coins = {
  ALPHA: { addr: M('ALPHA'), age: 0.5 * H, top: [3, 2], mcap: 300000 },
  BETA: { addr: M('BETA'), age: 10 * H, top: [25, 20], mcap: 800000 },
  ANCIENT: { addr: M('ANCIENT'), age: 96 * H, top: [3, 2], mcap: 9e6 },
  SHOTCOIN: { addr: M('SHOTCOIN'), age: 3 * H, top: [3, 2], mcap: 100000 },
  FEEDY: { addr: M('FEEDY'), age: 2 * H, top: [3, 2], mcap: 200000 },
  LINKY: { addr: M('LINKY'), age: 1.5 * H, top: [3, 2], mcap: 200000 },
};
const NOPOOL = M('NOPOOL');
const bySym = Object.fromEntries(Object.entries(coins).map(([k, v]) => [v.addr.toLowerCase(), k]));
const price = { ALPHA: '0.01' };
let feedReply = { status: 200, json: { status: 'ok', checkedAt: Date.now() - 30e3, channels: [{ id: '1', label: 'first scan', status: 'ok' }, { id: '2', label: 'price move', status: 'ok' }], calls: [{ address: coins.FEEDY.addr, chain: 'solana', poster: 'dave', at: Date.now() - 60e3, messageId: '9', channel: 'first scan' }, { address: coins.FEEDY.addr, chain: 'solana', poster: 'erin2', at: Date.now() - 30e3, messageId: '10', channel: 'price move' }] } };
let feedSeen = [];
const PASTE = `alice — Today at 2:41 PM
ape this ${coins.ALPHA.addr}
bob — Today at 2:42 PM
${coins.BETA.addr} and ${coins.ANCIENT.addr}
also ${NOPOOL}
[3:04 PM] carol: ${coins.ALPHA.addr} again`;

(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const sc of [{ name: 'phone', vp: { width: 390, height: 844 } }, { name: 'desktop', vp: { width: 1280, height: 900 } }]) {
    const p = await b.newPage({ viewport: sc.vp });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    let shotBody = null, rugCalls = 0;
    feedSeen = [];
    feedReply = { status: 200, json: { status: 'ok', checkedAt: Date.now() - 90e3, channels: [{ id: '1', label: 'first scan', status: 'ok' }, { id: '2', label: 'price move', status: 'ok' }], calls: [{ address: coins.FEEDY.addr, chain: 'solana', poster: 'dave', at: Date.now() - 60e3, messageId: '9', channel: 'first scan' }, { address: coins.FEEDY.addr, chain: 'solana', poster: 'erin2', at: Date.now() - 30e3, messageId: '10', channel: 'price move' }] } };
    await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|api\.anthropic|feed\.example)/, (r) => r.abort());
    await p.route('https://api.dexscreener.com/**', (r) => {
      const addrs = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
      r.fulfill({ json: { pairs: addrs.map((a) => bySym[a.toLowerCase()]).filter(Boolean).map((s) => { const c = coins[s]; return { chainId: 'solana', dexId: 'raydium', pairAddress: 'pair' + s, url: 'https://dexscreener.com/x', baseToken: { symbol: s, name: s, address: c.addr }, priceUsd: price[s] || '1', marketCap: c.mcap, liquidity: { usd: 40000 }, volume: { h24: 100000, h1: 20000, m5: 3000 }, priceChange: { m5: 2, h1: 10, h6: 20, h24: 40 }, txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 30, sells: 10 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: Date.now() - c.age }; }) } });
    });
    await p.route('https://api.rugcheck.xyz/**', (r) => { rugCalls++; const s = bySym[r.request().url().split('/tokens/')[1].split('/')[0].toLowerCase()]; const c = coins[s];
      r.fulfill({ json: { token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 900, topHolders: c.top.map((pct, i) => ({ address: 'H' + i + s, owner: 'O' + i + s, pct })), markets: [] } }); });
    await p.route('https://api.anthropic.com/**', (r) => { shotBody = r.request().postDataJSON();
      r.fulfill({ json: { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ calls: [{ address: coins.SHOTCOIN.addr, poster: 'erin' }, { address: 'not-an-address', poster: 'x' }] }) }] } }); });
    await p.route('https://feed.example/**', (r) => { feedSeen.push({ url: r.request().url(), key: r.request().headers()['x-feed-key'] }); r.fulfill({ status: feedReply.status, json: feedReply.json, headers: { 'Access-Control-Allow-Origin': '*' } }); });
    await p.addInitScript(() => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_callView', JSON.stringify('all')); localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-calls': true })); localStorage.setItem('ft_tab', 'calls'); localStorage.setItem('ft_settings', JSON.stringify({ anthropicKey: 'sk-ant-test' })); sessionStorage.setItem('i', 1); });
    await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(400);
    const text = (sel) => p.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim());
    const idle = () => p.waitForFunction(() => !callState.busy, null, { timeout: 15000 });
    let card = await text('#callsCard');
    assert.match(card, /Discord feed: off/);
    // 1) paste
    await p.fill('#callsText', PASTE);
    await p.click('#callsForm button[type=submit]');
    await p.waitForTimeout(100); await idle();
    card = await text('#callsCard');
    console.log(sc.name, card.slice(0, 600));
    assert.equal(await p.inputValue('#callsText'), '', 'box cleared after adding');
    assert.match(card, /ALPHA Solana .*age 30m · mcap \$300\.0k · liq \$40\.0k alice \+1 2 mentions/);
    assert.match(card, /BETA Solana .*bob 1 mention/);
    assert.ok(card.indexOf('ALPHA') < card.indexOf('BETA'), 'safer coin first');
    assert.ok(!/ANCIENT/.test(card), 'old coin hidden at 24h');
    assert.match(card, /2 older or not trading coins hidden/);
    assert.equal(rugCalls, 2, 'only fresh coins get the rug check');
    assert.match(await text('#callsSummary'), /2 new coins under 24h/);
    // 2) age filter
    await p.selectOption('#callsAge', '1'); await p.waitForTimeout(100); await idle();
    card = await text('#callsCard');
    assert.match(card, /ALPHA/); assert.ok(!/BETA Solana/.test(card));
    await p.selectOption('#callsAge', '24'); await p.waitForTimeout(100); await idle();
    // 3) screenshot
    await p.setInputFiles('#callsShot', E2E.FIX + '/shot.png');
    await p.waitForFunction(() => /SHOTCOIN/.test(document.querySelector('#callsCard').innerText), null, { timeout: 15000 }); await idle();
    assert.equal(shotBody.messages[0].content[0].type, 'image');
    assert.equal(shotBody.output_config.format.type, 'json_schema');
    card = await text('#callsCard');
    assert.match(card, /SHOTCOIN Solana .*erin/);
    assert.match(card, /Added 1 coin\./, 'the misread address is dropped');
    // 4) callers: one hour later ALPHA is up 50%
    price.ALPHA = '0.015';
    await p.evaluate(async () => { callState.book = callState.book.map((x) => Object.assign({}, x, { at: x.at - 3600e3 - 60e3 })); await priceCallBook(); renderCalls(); });
    card = await text('#callsCard');
    assert.match(card, /Callers/i);
    if (sc.name === 'desktop') assert.match(card, /alice – 1 \+50% 1\/1/);
    else assert.match(card, /alice – 1 – –/);
    price.ALPHA = '0.01';
    // 5) feed
    await p.click('[data-tab=settings]');
    await p.click('#settingsForm details.adv summary');
    await p.fill('input[name=feedUrl]', 'https://feed.example/');
    await p.fill('input[name=feedKey]', 'k3y');
    await p.click('#settingsForm button[type=submit]');
    await p.click('[data-tab=check]');
    await p.waitForFunction(() => /FEEDY/.test(document.querySelector('#callsCard').innerText), null, { timeout: 15000 }); await idle();
    assert.equal(feedSeen[0].url, 'https://feed.example/calls?since=0&csince=0');
    assert.equal(feedSeen[0].key, 'k3y');
    card = await text('#callsCard');
    assert.match(card, /Discord feed: ok · 2 channels · read Discord 2m ago/);
    assert.match(card, /FEEDY Solana .*dave \+1 2 mentions · in first scan, price move/);
    assert.match(card, new RegExp('FEEDY.*' + coins.FEEDY.addr.slice(0, 6) + '…' + coins.FEEDY.addr.slice(-6) + ' Copy'));
    await p.evaluate(() => showTab('calls'));
    await p.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await p.click(`[data-call-copy="${coins.FEEDY.addr}"]`);
    assert.equal(await p.evaluate(() => navigator.clipboard.readText()), coins.FEEDY.addr, 'Copy puts the full address on the clipboard');
    assert.equal(await p.innerText(`[data-call-copy="${coins.FEEDY.addr}"]`), 'Copied');
    feedReply = { status: 200, json: { status: 'no_access', checkedAt: Date.now(), channels: [{ id: '1', label: 'first scan', status: 'ok' }, { id: '2', label: 'price move', status: 'no_access' }], calls: [] } };
    await p.evaluate(() => pollFeed());
    assert.match(await text('#callsCard'), /Discord feed: price move: your Discord account can't read that channel\./);
    feedReply = { status: 200, json: { status: 'token_invalid', checkedAt: Date.now(), calls: [] } };
    await p.evaluate(() => pollFeed());
    assert.match(feedSeen[feedSeen.length - 1].url, /since=\d{13}&csince=/);
    assert.ok(!/since=0&/.test(feedSeen[feedSeen.length - 1].url));
    assert.match(await text('#callsCard'), /Discord token expired or was rejected — paste a new DISCORD_TOKEN in Cloudflare\./);
    feedReply = { status: 401, json: { error: 'unauthorized' } };
    await p.evaluate(() => pollFeed());
    assert.match(await text('#callsCard'), /the feed key doesn't match FEED_KEY/);
    const backup = await p.evaluate(() => { const { heliusKey, lookupKey, anthropicKey, feedKey, ...safe } = state.settings; return safe; });
    assert.ok(!('feedKey' in backup));
    // pause: nothing is requested while the feed is paused, and it resumes when switched back
    feedReply = { status: 200, json: { status: 'ok', checkedAt: Date.now(), channels: [], calls: [] } };
    const n0 = feedSeen.length;
    await p.check('#callsPause'); await p.waitForTimeout(100);
    await p.evaluate(() => pollFeed()); await p.waitForTimeout(150);
    assert.equal(feedSeen.length, n0, 'no request while paused');
    assert.match(await text('#callsCard'), /Discord feed: paused\. Nothing is read from Discord/);
    await p.uncheck('#callsPause'); await p.waitForTimeout(300);
    assert.ok(feedSeen.length > n0, 'turning the pause off asks again straight away');
    assert.equal(await p.evaluate(() => store.get('callPaused', null)), false);
    // 6) Check button
    await p.click('[data-call-ca]'); await p.waitForTimeout(300);
    assert.ok(Object.values(coins).some((c) => c.addr === null) || (await p.inputValue('#caInput')).length > 30);
    assert.equal(await p.evaluate(() => $('.tab.active').id), 'check', 'Check on a queue row opens the Check tab');
    await p.evaluate(() => showTab('calls'));
    await (await p.$('#callsCard')).screenshot({ path: E2E.OUT + `/calls-${sc.name}.png` });
    const hs = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(hs, false, 'no sideways scroll');
    // 7) share link
    feedReply = { status: 200, json: { status: 'ok', checkedAt: Date.now(), calls: [] } };
    await p.evaluate(() => { localStorage.setItem('ft_callQueue', '{}'); localStorage.setItem('ft_settings', JSON.stringify({})); });
    await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html?calls=' + encodeURIComponent(`frank — Today at 1:00 PM\n${coins.LINKY.addr}`));
    await p.waitForFunction(() => /LINKY/.test(document.querySelector('#callsCard').innerText), null, { timeout: 15000 });
    assert.match(await text('#callsCard'), /LINKY Solana .*frank/);
    assert.equal(await p.evaluate(() => location.search), '', 'param removed so a reload does not add it twice');
    assert.equal(await p.evaluate(() => document.querySelector('#calls').classList.contains('active')), true, 'a ?calls= link opens the Calls tab');
    assert.deepEqual(errs, []);
    await p.close();
  }
  await b.close();
  console.log('calls OK');
})().catch((e) => { console.error(e); process.exit(1); });
