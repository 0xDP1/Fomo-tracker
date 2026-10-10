const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const M = (s) => (s.replace(/[0OIl]/g, 'x') + 'Mint1111111111111111111111111111111111111').slice(0, 44);
const COINS = { GOOD: M('GOOD'), BAD: M('BAD'), FRESH: M('FRESH'), NOID: M('NOID') };
const CREATOR = { [COINS.GOOD]: 'CreatorGood', [COINS.BAD]: 'CreatorBad', [COINS.FRESH]: 'CreatorFresh' };
const now = () => Math.floor(Date.now() / 1000);
const H = 3600, D = 86400;
const create = (wallet, mint, ago, i) => ({ signature: wallet + i, timestamp: now() - ago, feePayer: wallet, type: 'CREATE', tokenTransfers: [{ mint, toUserAccount: wallet, fromUserAccount: '' }], accountData: [] });
const history = {
  CreatorBad: [...[1, 2, 3, 4, 5, 6, 7].map((n) => ['Dead' + n, (n + 1) * D]), ['Live1', 9 * D], ['Newbie', 2 * H], ['CUR', 5 * D]].map(([m, a], i) => create('CreatorBad', m === 'CUR' ? COINS.BAD : m, a, i)),
  CreatorGood: [['Dead1', 9 * D], ['Live1', 8 * D], ['Live2', 7 * D], ['Live3', 6 * D], ['Quiet1', 5 * D]].map(([m, a], i) => create('CreatorGood', m, a, i)),
  CreatorFresh: [],
};
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    for (const withKey of [true, false]) {
      const p = await b.newPage({ viewport: vp });
      const errs = []; p.on('pageerror', (e) => errs.push(e.message));
      let heliusCalls = 0, batch = null;
      await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
      await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|api\.helius|api\.geckoterminal|cdnjs)/, (r) => r.abort());
      await p.route('https://api.geckoterminal.com/**', (r) => r.fulfill({ json: { data: [] } }));
      await p.route('https://api.helius.xyz/**', (r) => {
        heliusCalls++;
        const u = new URL(r.request().url()); const addr = decodeURIComponent(u.pathname.split('/')[3]);
        r.fulfill({ json: history[addr] || [] });
      });
      await p.route('https://api.dexscreener.com/**', (r) => {
        const addrs = decodeURIComponent(r.request().url().split('/tokens/')[1] || '').split(',');
        if (addrs.length > 1) batch = addrs;
        const pair = (a) => {
          const dead = a.startsWith('Dead'), quiet = a.startsWith('Quiet'), isCoin = Object.values(COINS).includes(a);
          if (dead) return null;
          return { chainId: 'solana', dexId: 'raydium', pairAddress: 'pp' + a, url: 'https://dexscreener.com/x', baseToken: { symbol: a.slice(0, 5).toUpperCase(), name: a.slice(0, 5), address: a }, priceUsd: '0.01', marketCap: 250000, liquidity: { usd: 40000 }, volume: { h24: quiet ? 100 : 90000, h1: 5000, m5: 500 }, priceChange: { m5: 1, h1: 2, h6: 3, h24: 4 }, txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 30, sells: 10 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: Date.now() - (isCoin ? 30 * D * 1000 / 86400 * 86400 / 86400 : 5 * D * 1000) };
        };
        r.fulfill({ json: { pairs: addrs.map(pair).filter(Boolean) } });
      });
      await p.route('https://api.rugcheck.xyz/**', (r) => { const a = r.request().url().split('/tokens/')[1].split('/')[0]; const c = CREATOR[a];
        r.fulfill({ json: Object.assign({ token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 900, topHolders: [{ address: 'H1', owner: 'HO1', pct: 3 }, { address: 'H2', owner: 'HO2', pct: 2 }], markets: [] }, c ? { creator: c } : {}) }); });
      await p.addInitScript((key) => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_uiOpen', JSON.stringify({ 'check-calls': true, 'check-market': true, 'check-scanner': true })); localStorage.setItem('ft_tab', 'check'); if (key) localStorage.setItem('ft_settings', JSON.stringify({ heliusKey: 'hk' })); sessionStorage.setItem('i', 1); }, withKey);
      await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(500);
      const text = (sel) => p.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim());
      const run = async (ca) => { await p.fill('#caInput', ca); await p.click('#checkForm button[type=submit]'); await p.waitForFunction((c) => checkState.ca === c && checkState.risk, ca, { timeout: 8000 }); await p.waitForTimeout(400); };
      const findings = () => p.$$eval('#verdictCard .findings li', (ls) => ls.map((l) => l.innerText.replace(/\s+/g, ' ')));
      if (!withKey) {
        await run(COINS.BAD);
        assert.match(await text('.dossier-block'), /Add a Helius API key/);
        assert.equal(heliusCalls, 0);
        await p.close(); continue;
      }
      // serial rugger
      await run(COINS.BAD);
      await p.waitForFunction(() => checkState.dossier && !checkState.dossier.loading, null, { timeout: 8000 });
      let blk = await text('.dossier-block');
      console.log(vp.name, blk);
      assert.match(blk, /7 of 8 earlier launches dead · 1 alive · 0 quiet · 1 too new to judge/);
      assert.match(blk, /Earlier launches \(9\)/, 'the coin being checked is left out');
      assert.deepEqual(batch.length, 9, 'one DexScreener call for all launches');
      assert.ok(!batch.includes(COINS.BAD));
      assert.ok((await findings()).some((f) => /^High Creator has 7 of 8 earlier launches dead/i.test(f)), (await findings()).join(' | '));
      await p.click('.dossier-block details summary');
      const rows = await text('.dossier-block details');
      assert.match(rows, /DEAD1 \d+d? ?.*Dead/i);
      assert.match(rows, /NEWBI .*Too new/);
      await (await p.$('.dossier-block')).screenshot({ path: E2E.OUT + `/dossier-${vp.name}.png` });
      // good creator: no finding
      await run(COINS.GOOD);
      await p.waitForFunction(() => checkState.dossier && !checkState.dossier.loading, null, { timeout: 8000 });
      blk = await text('.dossier-block');
      assert.match(blk, /1 of 5 earlier launches dead · 3 alive · 1 quiet/);
      assert.ok(!(await findings()).some((f) => /Creator has/.test(f)));
      // creator with no history
      await run(COINS.FRESH);
      await p.waitForFunction(() => checkState.dossier && !checkState.dossier.loading, null, { timeout: 8000 });
      blk = await text('.dossier-block');
      assert.match(blk, /No earlier launches found in its transaction history/);
      assert.match(blk, /not the same as clean/);
      // no creator reported
      await run(COINS.NOID);
      await p.waitForTimeout(300);
      assert.match(await text('.dossier-block'), /No creator history: no creator wallet reported/);
      // Check button on a launch
      await run(COINS.BAD);
      await p.waitForFunction(() => checkState.dossier && !checkState.dossier.loading, null, { timeout: 8000 });
      await p.click('.dossier-block details summary');
      await p.click('[data-dossier-ca]'); await p.waitForTimeout(400);
      assert.ok((await p.inputValue('#caInput')).length > 3);
      const hs = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth); if (hs) console.log('WIDE', await p.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && e.offsetParent).slice(0, 6).map((e) => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right) + ' ' + e.innerText.slice(0, 80) + ' <' + e.parentElement.className + '>'))); assert.equal(hs, false, 'no sideways scroll');
      assert.deepEqual(errs, []);
      await p.close();
    }
  }
  await b.close();
  console.log('DOSSIER E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
