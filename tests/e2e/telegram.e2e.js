const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
// Telegram feed: the Worker (faked here) reads a private Telegram group as the owner's account and serves its calls with
// the Discord ones. A Telegram call shows in the Call queue with the group as its channel chip and a score; the feed line
// says how Telegram is doing, including a login that ended; Telegram-only setups show just the Telegram line.
const CA = ('TgFrogCoin' + '1'.repeat(44)).slice(0, 44);
const DCA = ('DcBearCoin' + '1'.repeat(44)).slice(0, 44);
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    const p = await b.newPage({ viewport: vp });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    let mode = 'ok';
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!feed\.example|cdnjs)/, (r) => r.abort());
    await p.route('https://feed.example/**', (r) => {
      const u = new URL(r.request().url());
      if (u.pathname !== '/calls') return r.fulfill({ status: 404, json: {}, headers: { 'Access-Control-Allow-Origin': '*' } });
      const now = Date.now();
      const since = Number(u.searchParams.get('since')) || 0;
      const calls = [{ address: CA, chain: 'solana', symbol: 'TGFROG', poster: 'alice', at: now - 60000, messageId: 'tg:1987654321:101', channel: 'Alpha calls', source: 'telegram', snap: { ageMs: 20 * 60000, fdv: 150000, liq: 30000, priceUsd: 0.00015, top5Pct: 16 } },
        { address: DCA, chain: 'solana', symbol: 'DCBEAR', poster: 'bob', at: now - 90000, messageId: '1300000000000000077', channel: 'first scan', snap: { ageMs: 25 * 60000, fdv: 140000, liq: 28000, priceUsd: 0.00014, top5Pct: 17 } }].filter((c) => c.at > since);
      const telegram = mode === 'ok' ? { status: 'ok', checkedAt: now, chats: [{ id: '1987654321', label: 'Alpha calls', status: 'ok' }] }
        : { status: 'session_invalid', checkedAt: now, chats: [{ id: '1987654321', label: 'Alpha calls', status: 'session_invalid', detail: 'AUTH_KEY_UNREGISTERED' }] };
      const channels = mode === 'tg-only' ? [] : [{ id: '555', label: 'first scan', status: 'ok' }];
      r.fulfill({ json: { status: mode === 'tg-only' ? 'starting' : 'ok', checkedAt: now, now, channels, telegram: mode === 'tg-only' ? Object.assign({}, telegram, { status: 'ok', chats: [{ id: '1987654321', label: 'Alpha calls', status: 'ok' }] }) : telegram, calls, callers: {} }, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await p.addInitScript(() => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_tab', 'calls'); localStorage.setItem('ft_callView', JSON.stringify('all')); localStorage.setItem('ft_settings', JSON.stringify({ feedUrl: 'https://feed.example', feedKey: 'k' })); sessionStorage.setItem('i', 1); });
    await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html');
    await p.waitForFunction(() => /TGFROG/.test(document.querySelector('#callsCard').innerText) && /DCBEAR/.test(document.querySelector('#callsCard').innerText), null, { timeout: 8000 });
    const card = () => p.$eval('#callsCard', (e) => e.innerText.replace(/\s+/g, ' '));
    const rows = () => p.$$eval('#callsCard .call-row', (rs) => rs.map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
    const row = (await rows()).find((r) => /TGFROG/.test(r));
    assert.match(row, /^\d+ TGFROG Solana Alpha calls/, 'scored like any call, tagged with its group (v75 group tags)');
    assert.match(row, /alice .*in Alpha calls/, 'the caller and the group');
    assert.doesNotMatch((await rows()).find((r) => /DCBEAR/.test(r)), /Telegram|Alpha calls/, 'Discord calls are not tagged');
    // Source chips: All, Discord, Telegram
    assert.equal(await p.$eval('.calls-source', (e) => e.innerText.replace(/\s+/g, ' ').trim()), 'All 2 Discord 1 Telegram 1');
    await p.click('[data-call-source="telegram"]');
    assert.deepEqual((await rows()).map((r) => /TGFROG/.test(r)), [true], 'only the Telegram coin');
    await p.click('[data-call-source="discord"]');
    assert.deepEqual((await rows()).map((r) => /DCBEAR/.test(r)), [true], 'only the Discord coin');
    await p.click('[data-call-source=""]');
    assert.equal((await rows()).length, 2);
    assert.match(await card(), /Discord feed: ok · read Discord just now Telegram: ok · 1 group · read just now/);
    await (await p.$('#callsCard')).screenshot({ path: E2E.OUT + `/telegram-${vp.name}.png` });

    // the login ended: the line says what to do, with Telegram's own code
    mode = 'ended';
    await p.evaluate(() => pollFeed());
    assert.match(await card(), /Telegram: Alpha calls: the Telegram login ended\. Run telegram-proxy\/login\.mjs again and replace TG_SESSION in Vercel\. \(AUTH_KEY_UNREGISTERED\)/);
    assert.match(await card(), /Discord feed: ok/, 'Discord is unaffected');

    // Telegram only: no Discord line stuck on "starting"
    mode = 'tg-only';
    await p.evaluate(() => pollFeed());
    const text = await card();
    assert.match(text, /Telegram: ok · 1 group/);
    assert.doesNotMatch(text, /Discord feed/);

    // Pause feed pauses Telegram too
    await p.evaluate(() => { callState.paused = true; renderCalls(); });
    assert.match(await card(), /Nothing is read from Discord or Telegram until you turn the pause off/);
    assert.doesNotMatch(await card(), /Telegram: ok/);

    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
    assert.deepEqual(errs, []);
    await p.close();
  }
  await b.close();
  console.log('TELEGRAM FEED E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
