// docs/features/feed-digest.md: the Feed digest section on the Calls tab: window chips, Summarize reads the Worker's
// /digest, coins by how many chats named them with Check and Add, by chat, Claude Haiku's read (faked), the fold line,
// the digest kept across a reload, and the no-key case.
const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const pad = (s) => (s + '1'.repeat(44)).slice(0, 44);
const HOT = pad('HotCoinA'), WARM = pad('WarmCoinB');
const t0 = Date.now() - 3 * 3600e3;
const m = (i, author, text, card) => ({ id: String(i), ts: t0 + i * 60000, author, text, card: !!card, cardTitle: card || '', replyTo: '' });
const MSGS = [
  m(1, '[SS] Arachnaught', `aping $HOT ${HOT} dev is based`), m(2, '[PRO] Rick', '', 'HOT [300K/12%]'), m(3, '[CPT] kai', `${HOT} looks bundled to me`),
  m(4, '[WG] mo', `$WARM ${WARM} dogs meta`), m(5, '[SS] zed', '$HOT KOL just bought'), m(6, '[WG] mo', 'dogs are back'), m(7, '[CPT] kai', 'quiet day'),
];
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const mode of ['key', 'nokey']) {
    const p = await b.newPage({ viewport: { width: 390, height: 844 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    const reads = [], ai = [];
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|feed\.example|api\.anthropic|cdnjs)/, (r) => r.abort());
    await p.route('https://feed.example/**', (r) => {
      const u = new URL(r.request().url());
      const H = { 'Access-Control-Allow-Origin': '*' };
      if (u.pathname === '/digest') {
        assert.equal(r.request().headers()['x-feed-key'], 'k3y');
        reads.push(u.searchParams.get('hours'));
        return r.fulfill({ json: { hours: Number(u.searchParams.get('hours')), since: t0, reachedAt: t0 + 60000, capped: false, messages: MSGS, at: Date.now() }, headers: H });
      }
      if (u.pathname.startsWith('/gmgn/')) return r.fulfill({ status: 503, json: { error: 'not_configured' }, headers: H });
      r.fulfill({ json: { status: 'ok', checkedAt: Date.now(), now: Date.now(), channels: [], calls: [], callers: {} }, headers: H });
    });
    await p.route('https://api.anthropic.com/**', (r) => {
      ai.push(r.request().postDataJSON());
      r.fulfill({ json: { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ mood: 'mixed', summary: 'SS and CPT argued about HOT, WG is on dogs.', narratives: ['dog coins', 'KOL buys'], groups: [{ code: 'SS', take: 'Bullish on HOT' }, { code: 'CPT', take: 'Thinks HOT is bundled' }, { code: 'WG', take: 'Dogs meta' }], coins: [{ name: '$HOT', why: 'two chats, one bullish one wary' }], redFlags: ['HOT bundled (CPT)'] }) }] }, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await p.route('https://api.dexscreener.com/**', (r) => { const a = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
      r.fulfill({ json: { pairs: a.map((x) => ({ chainId: 'solana', dexId: 'raydium', pairAddress: 'p' + x.slice(0, 5), url: 'https://dexscreener.com/x', baseToken: { symbol: x === HOT ? 'HOT' : 'WARM', name: 'x', address: x }, priceUsd: '0.001', marketCap: 300000, liquidity: { usd: 40000 }, volume: { h24: 90000, h1: 5000, m5: 500 }, priceChange: { m5: 1 }, txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 30, sells: 10 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: Date.now() - 2 * 3600e3 })) } }); });
    await p.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 900, topHolders: [{ address: 'H1', owner: 'HO1', pct: 3 }], markets: [] } }));
    await p.addInitScript((st) => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_tab', 'calls'); localStorage.setItem('ft_uiOpen', JSON.stringify({ 'calls-digest': true })); localStorage.setItem('ft_settings', JSON.stringify(st)); sessionStorage.setItem('i', 1); }, { feedUrl: 'https://feed.example', feedKey: 'k3y', anthropicKey: mode === 'nokey' ? '' : 'sk-test' });
    await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(400);
    const text = () => p.$eval('#digestCard', (e) => e.innerText.replace(/\s+/g, ' ').trim());
    assert.equal(reads.length + ai.length, 0, 'nothing runs until tapped');
    assert.match(await text(), /^Last 5 h 10 h 15 h 30 h Summarize Reads the whole on chain feed/);
    assert.equal(await p.$eval('[data-digest-hours="10"]', (e) => e.classList.contains('primary')), true, '10 h is the default window');
    await p.click('[data-digest-hours="15"]');
    await p.click('#digestRun');
    await p.waitForFunction(() => !digestState.loading && digestState.d, null, { timeout: 8000 });
    assert.deepEqual(reads, ['15']);
    const card = await text();
    console.log(mode, card.slice(0, 500));
    assert.match(card, /Digest of the last 15 h/);
    assert.match(card, /Coins by how many chats named them \(2 in all\)/);
    assert.match(card, /\$HOT HotC…1111 SS CPT 3 [\d.]+[mh] ago FOMOGMGNCheck Add/, 'HOT: two chats (SS, CPT), three mentions; the bot card is a scan (people and first columns hide on a phone)');
    assert.match(card, /\$WARM Warm…1111 WG 1 [\d.]+[mh] ago/);
    assert.match(card, /By chat SS 2 people · 2 msgs · \$HOT ×2/);
    assert.match(card, /CPT 1 person · 2 msgs · \$HOT ×1/);
    assert.match(card, /PRO 1 scan, no talk/);
    assert.match(card, /6 messages and 1 scans from 4 chats/);
    if (mode === 'nokey') {
      assert.equal(ai.length, 0, 'no AI call without a key');
      assert.match(card, /Add an Anthropic API key \(Settings\) for Claude's read\. The tables below are free\./);
      assert.equal(await p.textContent('#digestSummary'), await p.evaluate(() => `last 15 h · 6 msgs · run ${ago(digestState.at)} ago`));
    } else {
      assert.equal(ai.length, 1);
      assert.equal(ai[0].model, 'claude-haiku-5-5');
      assert.match(ai[0].messages[0].content, /^The last 15 hours of the feed: 6 chat lines and 1 bot scans from 4 chats and 4 people/);
      assert.match(ai[0].messages[0].content, /\$HOT: 2 chats \(SS, CPT\), 3 mentions/);
      assert.match(ai[0].messages[0].content, /<chat>\n\[SS\] Arachnaught: aping \$HOT/);
      assert.match(card, /mixed .*SS and CPT argued about HOT, WG is on dogs\. Narratives: dog coins · KOL buys/);
      assert.match(card, /Coins the chats are on: \$HOT two chats, one bullish one wary/);
      assert.match(card, /Red flags mentioned: HOT bundled \(CPT\)/);
      assert.match(card, /SS 2 people · 2 msgs · \$HOT ×2 Bullish on HOT/);
      assert.match(await p.textContent('#digestSummary'), /^last 15 h · mixed · 6 msgs · run/);
      // kept across a reload, no new read
      await p.reload(); await p.waitForTimeout(400);
      assert.match(await text(), /Digest of the last 15 h mixed run .*Coins the chats are on/);
      assert.deepEqual(reads, ['15']);
      // Add puts the coin in the Call queue; Check opens the Check tab on it
      await p.click(`[data-digest-add="${HOT}"]`); await p.waitForTimeout(200);
      assert.deepEqual(await p.evaluate((a) => { const e = callState.queue[a]; return e && [e.firstPoster, e.channels, e.symbol]; }, HOT), ['digest', ['on chain feed'], 'HOT']);
      await p.click(`[data-digest-check="${WARM}"]`);
      await p.waitForFunction((a) => checkState.ca === a && checkState.risk, WARM, { timeout: 8000 });
      assert.equal(await p.$eval('#check', (e) => e.classList.contains('active')), true);
    }
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
    if (mode === 'key') { await p.evaluate(() => showTab('calls')); await (await p.$('#digestCard')).screenshot({ path: E2E.OUT + '/digest-phone.png' }); }
    assert.deepEqual(errs, []);
    await p.close();
  }
  await b.close();
  console.log('DIGEST E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
