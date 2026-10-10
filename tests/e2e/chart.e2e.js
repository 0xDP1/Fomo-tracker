const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
// GMGN chart card: nothing loads until opened, right address per coin and interval, no reload on Check re-renders.
const SOL = '8vYJgiQPkpDtbWkDy1wyYDcUq3D9fUXVJUtt6aNEpump';
const MON = '0xb0fea7be600c85e2f4fe90821f304bc1578d4444';
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const vp of [{ width: 390, height: 844, name: 'phone' }, { width: 1280, height: 900, name: 'desktop' }]) {
    const p = await b.newPage({ viewport: vp });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    const charts = [];
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!api\.dexscreener|www\.gmgn\.cc|cdnjs)/, (r) => r.abort());
    await p.route('https://www.gmgn.cc/**', (r) => { charts.push(r.request().url()); r.fulfill({ contentType: 'text/html', body: '<html><body style="background:#111;color:#eee">chart</body></html>' }); });
    await p.route('https://api.dexscreener.com/**', (r) => { const a = decodeURIComponent(r.request().url().split('/tokens/')[1] || '');
      r.fulfill({ json: { pairs: [{ chainId: a.startsWith('0x') ? 'monad' : 'solana', dexId: 'raydium', pairAddress: 'pp', url: 'https://dexscreener.com/x', baseToken: { symbol: 'SW', name: 'SW', address: a }, priceUsd: '0.001', marketCap: 500000, liquidity: { usd: 40000 }, volume: { h24: 90000, h1: 5000, m5: 500 }, priceChange: { m5: 1, h1: 2, h6: 3, h24: 4 }, txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 30, sells: 10 }, h24: { buys: 300, sells: 200 } }, pairCreatedAt: Date.now() - 3600e3 }] } }); });
    await p.addInitScript(() => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_tab', 'check'); sessionStorage.setItem('i', 1); });
    await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(400);
    const check = async (ca) => { await p.evaluate(() => showTab('check')); await p.fill('#caInput', ca); await p.click('#checkForm button[type=submit]'); await p.waitForFunction((c) => checkState.ca === c && checkState.dex, ca, { timeout: 8000 }); await p.waitForTimeout(300); };
    await check(SOL);
    assert.equal(await p.$eval('#chartCard', (c) => c.hidden), false);
    assert.equal(await p.$('#chartCard iframe'), null, 'nothing loads until the chart is opened');
    assert.equal(charts.length, 0);
    assert.equal(await p.$eval('#chartCard a', (a) => a.href), `https://gmgn.ai/sol/token/${SOL}`);
    await p.click('#chartCard summary'); await p.waitForTimeout(400);
    assert.equal(await p.$eval('#chartCard iframe', (f) => f.src), `https://www.gmgn.cc/kline/sol/${SOL}?theme=dark&interval=1`);
    await p.click('[data-chart-iv="5"]'); await p.waitForTimeout(300);
    assert.equal(await p.$eval('#chartCard iframe', (f) => f.src), `https://www.gmgn.cc/kline/sol/${SOL}?theme=dark&interval=5`);
    // the Check tab re-renders (watch refresh): the chart is not rebuilt
    await p.evaluate(() => { document.querySelector('#chartCard iframe').dataset.mark = 'same'; renderCheck(); renderChart(); });
    assert.equal(await p.$eval('#chartCard iframe', (f) => f.dataset.mark), 'same', 'no reload on re-render');
    await (await p.$('#chartCard')).screenshot({ path: E2E.OUT + `/chart-${vp.name}.png` });
    // remembered across a reload, with the interval
    await p.reload(); await p.waitForTimeout(400); await check(SOL);
    assert.equal(await p.$eval('#chartCard iframe', (f) => f.src), `https://www.gmgn.cc/kline/sol/${SOL}?theme=dark&interval=5`, 'stays open with the last interval');
    // a chain GMGN doesn't cover: no chart card
    await check(MON);
    assert.equal(await p.$eval('#chartCard', (c) => c.hidden), true);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
    assert.deepEqual(errs, []);
    await p.close();
  }
  await b.close();
  console.log('CHART E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
