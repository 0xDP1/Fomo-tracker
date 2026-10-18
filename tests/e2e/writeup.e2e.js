const E2E = require('./helpers');
const { chromium } = require('playwright');
const assert = require('assert');
// AI write-up styles (docs/features/writeup-styles.md): Verdict · Holder read · Bull case chips, each style's own
// prompt and evidence, the text kept per style, Copy, and the choice remembered.
const COIN = 'WriteupMint111111111111111111111111111111111'.slice(0, 44);
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  for (const sc of [{ name: 'phone', vp: { width: 390, height: 844 } }, { name: 'desktop', vp: { width: 1280, height: 900 } }]) {
    const ctx = await b.newContext({ viewport: sc.vp, permissions: ['clipboard-read', 'clipboard-write'] });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    const calls = [];
    await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
    await p.route(/^https:\/\/(?!api\.dexscreener|api\.rugcheck|api\.anthropic|cdnjs)/, (r) => r.abort());
    await p.route('https://api.dexscreener.com/**', (r) => r.fulfill({ json: { pairs: [{ chainId: 'solana', dexId: 'raydium', pairAddress: 'pp', url: 'https://dexscreener.com/x', baseToken: { symbol: 'WRIT', name: 'Write Coin', address: COIN }, priceUsd: '0.01', marketCap: 296000, liquidity: { usd: 60000 }, volume: { h24: 300000, h1: 20000, m5: 3000 }, priceChange: { m5: 1, h1: 12, h6: 20, h24: 40 }, txns: { m5: { buys: 5, sells: 2 }, h1: { buys: 120, sells: 80 }, h24: { buys: 900, sells: 700 } }, pairCreatedAt: Date.now() - 5 * 3600e3, info: { socials: [{ url: 'https://x.com/writecoin' }] } }] } }));
    await p.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, totalHolders: 1480, topHolders: [{ address: 'W1', owner: 'W1o', pct: 3 }, { address: 'W2', owner: 'W2o', pct: 2 }], insiderNetworks: [], markets: [{ pubkey: 'm', lp: { lpLockedPct: 100 } }] } }));
    await p.route('https://api.anthropic.com/**', (r) => { const body = r.request().postDataJSON(); calls.push(body);
      const style = /Nfa/.test(body.system) ? 'holders' : /Watch:/.test(body.system) ? 'bull' : 'verdict';
      const edited = /EDIT MODE/.test(body.system);
      const text = edited ? '$WRIT no snipers per the bundle check. 1.48k holders. Nfa' : { verdict: 'Caution. Thin pool for the size. I would wait for a base.', holders: '$WRIT (CA ' + COIN + ') no snipers or insiders per the bundle check.\nTop 10 hold 5%, 1.48k holders, average bag $200. Nfa', bull: 'Write Coin is the coin of people who write.\n\nThe catalyst is the writing meta.\n\nWatch: thin liquidity.' }[style];
      r.fulfill({ json: { stop_reason: 'end_turn', content: [{ type: 'text', text }] } }); });
    await p.addInitScript(() => { if (sessionStorage.getItem('i')) return; localStorage.clear(); localStorage.setItem('ft_tab', 'check'); localStorage.setItem('ft_settings', JSON.stringify({ anthropicKey: 'sk-ant-test' })); sessionStorage.setItem('i', 1); });
    await E2E.openFolds(p); await p.goto(E2E.BASE + '/index.html'); await p.waitForTimeout(400);
    const text = (sel) => p.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim());
    await p.evaluate(() => showTab('check')); await p.fill('#caInput', COIN); await p.click('#checkForm button[type=submit]');
    await p.waitForFunction(() => checkState.risk, null, { timeout: 8000 }); await p.waitForTimeout(300);
    // the chips, default Verdict
    let card = await text('#aiCard');
    assert.match(card, /AI write-up Ask Claude Verdict Holder read Bull case Tap Ask Claude for a short read on this token and your plan\./i);
    assert.equal(await p.$('#aiEdit'), null, 'v118: no Edit row before a write');
    assert.equal(await p.$eval('[data-ai-style="verdict"]', (e) => e.className), 'on');
    // Verdict: the original prompt and evidence
    await p.click('#aiBtn'); await p.waitForFunction(() => checkState.ai && checkState.ai.text, null, { timeout: 8000 });
    assert.equal(calls.length, 1); assert.match(calls[0].system, /^You are a blunt memecoin risk desk/);
    const ev0 = JSON.parse(calls[0].messages[0].content.replace('Evidence (JSON):\n', ''));
    assert.equal(ev0.token.symbol, 'WRIT'); assert.ok('ruleVerdict' in ev0);
    assert.match(await text('#aiCard'), /Copy Write again .* Caution\. Thin pool for the size\./);
    // Holder read: its own prompt and evidence, no verdict evidence
    await p.click('[data-ai-style="holders"]');
    card = await text('#aiCard');
    assert.match(card, /Tap Ask Claude for the compact holder read call accounts post/, 'a style not written yet shows its hint');
    await p.click('#aiBtn'); await p.waitForFunction(() => checkState.ai && checkState.ai.text, null, { timeout: 8000 });
    assert.equal(calls.length, 2); assert.match(calls[1].system, /End with "Nfa"/);
    const ev1 = JSON.parse(calls[1].messages[0].content.replace('Evidence (JSON):\n', ''));
    assert.equal(ev1.token.address, COIN); assert.equal(ev1.token.holders, 1480); assert.equal(ev1.token.avgBagUsd, 200);
    assert.equal(ev1.exchangeFunded, null, 'Analyze top wallets was not run, so nothing is guessed'); assert.equal(ev1.operators, null);
    assert.ok(!('ruleVerdict' in ev1) && !('plan' in ev1));
    assert.match(await text('#aiCard'), /\$WRIT \(CA Writeup.* no snipers or insiders per the bundle check\. Top 10 hold 5%, 1\.48k holders, average bag \$200\. Nfa/);
    await (await p.$('#aiCard')).screenshot({ path: E2E.OUT + `/writeup-holders-${sc.name}.png` });
    // Copy
    await p.click('#aiCopy');
    assert.match(await p.evaluate(() => navigator.clipboard.readText()), /^\$WRIT \(CA .*Nfa$/s);
    // v118: Edit: Apply sends the current text and the instruction under the style's rules; Undo brings the old text back
    assert.equal(await p.$eval('#aiEdit', (e) => e.placeholder), 'Tell Claude how to change it: shorter, mention the dev, lowercase…');
    await p.click('#aiApply'); assert.equal(calls.length, 2, 'an empty box sends nothing');
    await p.fill('#aiEdit', 'shorter, drop the top 10 line'); await p.click('#aiApply');
    await p.waitForFunction(() => checkState.ai && checkState.ai.text && checkState.ai.prev, null, { timeout: 8000 });
    assert.equal(calls.length, 3); assert.match(calls[2].system, /End with "Nfa".*EDIT MODE/s);
    assert.match(calls[2].messages[0].content, /^<draft>\n\$WRIT \(CA .*Nfa\n<\/draft>\n<instruction>\nshorter, drop the top 10 line\n<\/instruction>\nEvidence \(JSON\):/s);
    assert.ok(JSON.parse(calls[2].messages[0].content.split('Evidence (JSON):\n')[1]).token.holders === 1480, 'the same evidence rides along');
    card = await text('#aiCard');
    assert.match(card, /\$WRIT no snipers per the bundle check\. 1\.48k holders\. Nfa/); assert.match(card, /Apply Undo/);
    assert.equal(await p.$eval('#aiEdit', (e) => e.value), '', 'the box is cleared');
    assert.equal(await p.$eval('#aiEdit', (e) => e.placeholder), 'shorter, drop the top 10 line', 'the last instruction is the placeholder');
    await p.click('#aiCopy');
    assert.match(await p.evaluate(() => navigator.clipboard.readText()), /^\$WRIT no snipers per the bundle check\. 1\.48k holders\. Nfa$/, 'Copy copies the edited text');
    await p.click('#aiUndo');
    assert.match(await text('#aiCard'), /\$WRIT \(CA Writeup.*average bag \$200\. Nfa/); assert.equal(await p.$('#aiUndo'), null, 'one step');
    assert.equal(calls.length, 3);
    await (await p.$('#aiCard')).screenshot({ path: E2E.OUT + `/writeup-edit-${sc.name}.png` });
    // Bull case: the story block and the Watch line rule
    await p.click('[data-ai-style="bull"]'); await p.click('#aiBtn'); await p.waitForFunction(() => checkState.ai && checkState.ai.text, null, { timeout: 8000 });
    assert.equal(calls.length, 4); assert.match(calls[3].system, /starting "Watch:"/); assert.match(calls[3].system, /No stats/);
    const ev2 = JSON.parse(calls[3].messages[0].content.replace('Evidence (JSON):\n', ''));
    assert.equal(ev2.story.ticker, 'WRIT'); assert.equal(ev2.story.name, 'Write Coin'); assert.deepEqual(ev2.story.links, ['https://x.com/writecoin']); assert.equal(ev2.story.chat, null);
    assert.ok(ev2.riskCheck && ev2.riskCheck.verdict); assert.ok(!('token' in ev2), 'no numbers for the bull case');
    assert.match(await text('#aiCard'), /Write Coin is the coin of people who write\. The catalyst is the writing meta\. Watch: thin liquidity\./);
    await (await p.$('#aiCard')).screenshot({ path: E2E.OUT + `/writeup-bull-${sc.name}.png` });
    // back to a style already written: kept, no new call
    await p.click('[data-ai-style="holders"]');
    assert.match(await text('#aiCard'), /Nfa/); assert.equal(calls.length, 4);
    await p.click('[data-ai-style="verdict"]');
    assert.match(await text('#aiCard'), /Caution\. Thin pool/); assert.equal(calls.length, 4);
    // the choice survives a reload
    await p.click('[data-ai-style="bull"]');
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('ft_aiStyle'))), 'bull');
    await p.reload(); await p.waitForTimeout(400);
    await p.evaluate(() => showTab('check')); await p.fill('#caInput', COIN); await p.click('#checkForm button[type=submit]');
    await p.waitForFunction(() => checkState.risk, null, { timeout: 8000 }); await p.waitForTimeout(200);
    assert.equal(await p.$eval('[data-ai-style="bull"]', (e) => e.className), 'on');
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
    assert.deepEqual(errs, []);
    await ctx.close();
  }
  await b.close();
  console.log('WRITEUP E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
