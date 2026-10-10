const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
const OLD = 'xLDMint1111111111111111111111111111111111111'.slice(0, 44);
const NEW = 'NEWMint1111111111111111111111111111111111111'.slice(0, 44);
const BAD = 'BADMint1111111111111111111111111111111111111'.slice(0, 44);
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const sc of [{ name: 'phone', vp: { width: 390, height: 844 } }, { name: 'desktop', vp: { width: 1280, height: 900 } }]) {
    const ctx = await b.newContext({ viewport: sc.vp, permissions: ['clipboard-read', 'clipboard-write'] });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    const calls = [];
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|api\.anthropic|cdnjs)/, (r) => r.abort());
    await p.route('https://api.dexscreener.com/**', (r) => { const a = decodeURIComponent(r.request().url().split('/tokens/')[1] || ''); const sym = a.startsWith('BAD') ? 'BADC' : a.startsWith('NEW') ? 'NEWC' : 'OLDC';
      r.fulfill({ json: { pairs: [{ chainId: 'solana', dexId: 'raydium', pairAddress: 'pp', url: 'https://dexscreener.com/x', baseToken: { symbol: sym, name: sym, address: a }, priceUsd: '0.01', marketCap: 400000, liquidity: { usd: 60000 }, volume: { h24: 300000, h1: 20000, m5: 3000 }, priceChange: { m5: 1, h1: 12, h6: 20, h24: 40 }, txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 120, sells: 80 }, h24: { buys: 900, sells: 700 } }, pairCreatedAt: Date.now() - 5 * 3600e3, info: { socials: [{ url: 'https://x.com/c' }] } }] } }); });
    await p.route('https://api.rugcheck.xyz/**', (r) => { const bad = r.request().url().includes('BAD');
      r.fulfill({ json: { token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 1500, topHolders: bad ? [{ address: 'W1', owner: 'W1o', pct: 22, insider: true }] : [{ address: 'W1', owner: 'W1o', pct: 3 }], insiderNetworks: bad ? [{ size: 9, tokenAmount: 2.6e14 }] : [], markets: [{ pubkey: 'm', lp: { lpLockedPct: bad ? 10 : 100 } }] } }); });
    let thesisText = 'Holders are spread wide and buyers keep stepping in on dips, so this has room if volume holds.';
    await p.route('https://api.anthropic.com/**', (r) => { const body = r.request().postDataJSON(); calls.push(body);
      r.fulfill({ json: { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ thesis: thesisText, risk_line: 'Volume could fade as fast as it came.' }) }] } }); });
    await p.addInitScript(() => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_tab', 'check'); localStorage.setItem('ft_settings', JSON.stringify({ anthropicKey: 'sk-ant-test' })); sessionStorage.setItem('i', 1); });
    await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(400);
    const text = (sel) => p.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim());
    const pos = (a) => ({ address: a, token: a.slice(0, 3), cost: 150, source: 'fomo', openedAt: new Date().toISOString() });
    // 1) first sync: records, no drafts
    await p.evaluate(async (pos) => { state.open = pos; await autoDraftTheses(); }, [pos(OLD)]);
    assert.equal(calls.length, 0);
    assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('ft_thesisSeen'))), [OLD]);
    // 2) a new position appears: exactly one draft
    await p.evaluate(async (pos) => { state.open = pos; await autoDraftTheses(); await autoDraftTheses(); }, [pos(OLD), pos(NEW)]);
    assert.equal(calls.length, 1, 'one draft for one new position, even across two syncs');
    const ev = JSON.parse(calls[0].messages[0].content.replace('Evidence (JSON):\n', ''));
    assert.equal(ev.token.symbol, 'NEWC'); assert.equal(ev.riskCheck.verdict, 'Looks OK'); assert.equal(ev.holders.topWalletPct, 3); assert.equal(ev.position.size, 150);
    assert.equal(calls[0].output_config.format.type, 'json_schema');
    let card = await text('#thesisCard');
    assert.match(card, /NEWC solana .* new position/i);
    assert.match(card, /Holders are spread wide.*\nRisk|Holders are spread wide.* Risk: Volume could fade as fast as it came\./);
    await p.click('[data-th-copy="' + NEW + '"]');
    assert.equal(await p.evaluate(() => navigator.clipboard.readText()), 'Holders are spread wide and buyers keep stepping in on dips, so this has room if volume holds.\nRisk: Volume could fade as fast as it came.');
    // 3) flagged coin from a check: the app writes the red flag
    thesisText = 'Chart looks strong and buyers are piling in.';
    await p.evaluate(() => showTab('check')); await p.fill('#caInput', BAD); await p.click('#checkForm button[type=submit]'); await p.waitForTimeout(800);
    assert.match(await text('#verdictCard .verdict'), /Walk away/);
    await p.click('#thesisBtn'); await p.waitForTimeout(500);
    card = await text('#thesisCard');
    assert.match(card, /BADC solana .* from a check/i);
    assert.match(card, /⚠ The token check rates this coin Walk away/);
    assert.match(card, /Chart looks strong and buyers are piling in\. Risk: Walk away\. LP in a wallet that can pull it\./);
    await (await p.$('#thesisCard')).screenshot({ path: E2E.OUT + `/thesis-${sc.name}.png` });
    // 4) limit 120 + regenerate replaces, dismiss removes
    await p.fill('#thesisLimit', '120'); await p.dispatchEvent('#thesisLimit', 'change');
    thesisText = 'Holders are spread wide and buyers keep stepping in on every dip with the pool deep enough for size, so this has room to run if volume holds up.';
    await p.click('[data-th-regen="' + NEW + '"]'); await p.waitForTimeout(500);
    const drafts = await p.evaluate(() => thesisState.drafts.map((d) => [d.symbol, d.text.length, d.text]));
    assert.equal(drafts.length, 2);
    assert.equal(drafts[0][0], 'NEWC');
    assert.ok(drafts[0][1] <= 120, 'trimmed to the limit: ' + drafts[0][1]);
    assert.ok(drafts[0][2].endsWith('\nRisk: Volume could fade as fast as it came.'));
    await p.click('[data-th-dismiss="' + BAD + '"]');
    assert.equal(await p.evaluate(() => thesisState.drafts.length), 1);
    // 5) no key
    await p.evaluate(() => { state.settings.anthropicKey = ''; });
    await p.click('#thesisBtn'); await p.waitForTimeout(200);
    assert.match(await text('#thesisCard'), /Thesis drafts need an Anthropic API key/);
    const hs = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(hs, false);
    console.log(sc.name, 'errors:', errs); assert.equal(errs.length, 0);
    await ctx.close();
  }
  await b.close(); console.log('THESIS E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
