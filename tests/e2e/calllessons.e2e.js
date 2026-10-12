const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
// Call lessons: calls made while the app was closed get their true outcome from GeckoTerminal's 5-minute candles
// (faked); the runners-vs-rest table shows the fact that separates them; Claude's read (faked) shows on tap; and with
// 30+ runners a new call gets a "like runners" pill.
const pad = (s) => (s + '1'.repeat(44)).slice(0, 44);
const RUN = pad('RunCoin'), DEAD = pad('DeadCoin'), NEW = pad('NewCoin');
const M = 60000;
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    const p = await b.newPage({ viewport: vp });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    const gecko = [];
    let aiAsked = null;
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!api\.geckoterminal|api\.anthropic|cdnjs)/, (r) => r.abort());
    await p.route('https://api.geckoterminal.com/**', (r) => {
      const u = new URL(r.request().url());
      if (!u.pathname.includes('/ohlcv/')) return r.fulfill({ json: { data: [] }, headers: { 'Access-Control-Allow-Origin': '*' } }); // Market pulse and the scanner
      const pool = u.pathname.split('/pools/')[1].split('/')[0];
      gecko.push(pool);
      const at = Math.floor((Date.now() - 300 * M) / 1000 / 300) * 300; // candles from the call, 5 hours ago
      // RunCoin climbs to 2.5x by 30 minutes, then fades; DeadCoin bleeds to 0.2x
      const price = (i) => (pool === 'poolRun' ? (i <= 6 ? 1 + i * 0.25 : 1.6) : Math.max(0.2, 1 - i * 0.05));
      const list = Array.from({ length: 49 }, (_, i) => [at + i * 300, price(i), price(i) * 1.01, price(i) * 0.99, price(i), 1000]).reverse();
      r.fulfill({ json: { data: { attributes: { ohlcv_list: list } } }, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await p.route('https://api.anthropic.com/**', (r) => { aiAsked = JSON.parse(r.request().postData()); r.fulfill({ json: { content: [{ type: 'text', text: 'Runners had more funded top wallets.\nHolder count made no difference.' }], stop_reason: 'end_turn' }, headers: { 'Access-Control-Allow-Origin': '*' } }); });
    await p.addInitScript((d) => {
      if (sessionStorage.getItem('i')) return;
      const now = Date.now(), M = 60000;
      const call = (address, symbol, ago, extra) => Object.assign({ address, chain: 'solana', chainId: 'solana', symbol, mentions: 1, posters: ['amy'], channels: ['Alpha calls'], sources: ['telegram'], firstPoster: 'amy', firstAt: now - ago, lastAt: now - ago, dexAt: now - ago, launchedAt: now - ago - 20 * M, mcap: 100000, liq: 30000, price: 1 }, extra);
      // 30 past runners and 30 others with known outcomes: funded top wallets separate them, holder count doesn't
      const lessons = {};
      for (let i = 0; i < 60; i++) {
        const runner = i < 30;
        lessons['Past' + i] = { at: now - (10 + i) * 3600e3, symbol: 'P' + i, chain: 'solana', price: 1, sources: [], facts: { fundedN: runner ? 6 + (i % 4) : 1 + (i % 3), holders: 300 + (i % 10) }, final: true, read1h: true, read4h: true, label: runner ? 'runner' : i % 2 ? 'flat' : 'dead', fast: runner && i % 2 === 0, out: { h4: { peak: runner ? 2 + i / 10 : 1.2, close: runner ? 1.5 : i % 2 ? 0.8 : 0.1, done: true } } };
      }
      // two calls made 5 hours ago while the app was closed: snapshots taken, outcomes not read yet
      lessons[d.RUN] = { at: now - 300 * M, symbol: 'RUNC', chain: 'solana', price: 1, sources: ['telegram'], facts: { fundedN: 8, holders: 305 }, pool: 'poolRun' };
      lessons[d.DEAD] = { at: now - 300 * M, symbol: 'DEADC', chain: 'solana', price: 1, sources: ['telegram'], facts: { fundedN: 1, holders: 305 }, pool: 'poolDead' };
      localStorage.clear();
      localStorage.setItem('ft_tab', 'calls');
      localStorage.setItem('ft_callView', JSON.stringify('all'));
      localStorage.setItem('ft_settings', JSON.stringify({ anthropicKey: 'sk-test' }));
      localStorage.setItem('ft_callLessons', JSON.stringify(lessons));
      localStorage.setItem('ft_callQueue', JSON.stringify({
        [d.RUN]: call(d.RUN, 'RUNC', 300 * M, { pool: 'poolRun', verdict: 'Looks OK', score: 80 }),
        [d.DEAD]: call(d.DEAD, 'DEADC', 300 * M, { pool: 'poolDead', verdict: 'Looks OK', score: 80 }),
        [d.NEW]: call(d.NEW, 'NEWC', 2 * M, { pool: 'poolNew', verdict: 'Looks OK', score: 80, wal: { emptyPct: 0, fundedN: 9 } }),
      }));
      sessionStorage.setItem('i', 1);
    }, { RUN, DEAD, NEW });
    await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html');
    await p.waitForFunction(() => typeof lessonTick === 'function' && !callState.busy, null, { timeout: 8000 });
    await p.evaluate(() => lessonTick());
    await p.waitForFunction(() => lessonState.recs && Object.values(lessonState.recs).filter((r) => r.final).length >= 62, null, { timeout: 8000 });
    const rec = (a) => p.evaluate((x) => lessonState.recs[x], a);
    const run = await rec(RUN), dead = await rec(DEAD);
    assert.deepEqual([run.label, run.fast, dead.label], ['runner', true, 'dead'], 'outcomes from the candles of hours the app was closed');
    assert.ok(Math.abs(run.out.h4.peak - 2.525) < 0.01, 'peak 2.5x: ' + run.out.h4.peak);
    assert.deepEqual(gecko.sort(), ['poolDead', 'poolRun'], 'one candle read per due call, none for the new one');
    await p.evaluate(() => renderCalls());
    const sec = await p.$eval('[data-sec="lessons"]', (e) => e.innerText.replace(/\s+/g, ' ').trim());
    assert.match(sec, /^Call lessons \(31 runners of 62 calls\)/, sec);
    assert.match(sec, /Top wallets with 5\+ SOL 7 2 100% higher/, 'funded wallets: runners median 7, rest 2');
    assert.match(sec, /16 of them within 1 h\) against the rest \(16 dead: under 0\.3× at 4 h\).* 1 call still waiting for an outcome/, 'the new call waits');
    assert.match(sec, /Holders 305 305 0% (higher|lower)/, 'holders do not separate');
    // the new call: the pill
    const newRow = await p.$$eval('#callsCard .call-row', (rs) => rs.map((r) => r.innerText.replace(/\s+/g, ' ')).find((t) => /NEWC/.test(t)));
    assert.match(newRow, /1\/1 like runners/, newRow);
    // Claude's read, from the numbers only
    await p.click('#lessonsAiBtn');
    await p.waitForFunction(() => /funded top wallets/.test((document.querySelector('.lessons-ai') || {}).innerText || ''), null, { timeout: 8000 });
    assert.equal(aiAsked.model, 'claude-haiku-5-5');
    const ev = JSON.parse(aiAsked.messages[0].content.replace(/^Evidence \(JSON\):\n/, ''));
    assert.equal(ev.facts[0].fact, 'Top wallets with 5+ SOL');
    assert.equal(ev.best.length, 5);
    await (await p.$('[data-sec="lessons"]')).screenshot({ path: E2E.OUT + `/calllessons-${vp.name}.png` });
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
    assert.deepEqual(errs, []);
    await p.close();
  }
  await b.close();
  console.log('CALL LESSONS E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
