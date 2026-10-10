const E2E = require('./helpers');
const { chromium } = require('playwright');
const MINT = 'So1anaMintXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX1234';
const EVM = '0x4bc1782fafb967834e0e75947ba15113e48fc70e';
(async () => {
  const b = await chromium.launch(E2E.launchOpts());
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  const st = { mcap: 100000, liq: 40000, c5: 2, b5: 10, s5: 5 };
  let anth = null;
  await p.route('**/chart.umd.min.js', (r) => r.fulfill({ ...E2E.chartBody(), contentType: 'application/javascript' }));
  await p.route('https://api.mainnet-beta.solana.com/**', (r) => r.fulfill({ json: { jsonrpc: '2.0', id: 1, result: { value: 0 } } }));
  await p.route('https://api.dexscreener.com/**', (r) => { const u = r.request().url(); const sol = u.includes(MINT);
    r.fulfill({ json: { pairs: [{ chainId: sol ? 'solana' : 'base', dexId: sol ? 'raydium' : 'uniswap', pairAddress: 'pair', url: 'https://dexscreener.com/x', baseToken: { symbol: sol ? 'KYNG' : 'BRETT', name: sol ? 'Kyng Coin' : 'Brett' }, priceUsd: '0.0001', marketCap: st.mcap, fdv: st.mcap, liquidity: { usd: st.liq }, volume: { h24: 250000, h1: 30000, m5: 4000 }, priceChange: { m5: st.c5, h1: 12, h6: 40, h24: 90 }, txns: { m5: { buys: st.b5, sells: st.s5 }, h1: { buys: 120, sells: 80 }, h24: { buys: 900, sells: 700 } }, pairCreatedAt: Date.now() - 5 * 3600e3, info: { socials: [] } }] } }); });
  await p.route('https://api.rugcheck.xyz/**', (r) => r.fulfill({ json: { token: { supply: 1e15, decimals: 6, mintAuthority: null, freezeAuthority: null }, tokenMeta: { mutable: false }, totalHolders: 820, knownAccounts: { POOL1: { type: 'AMM', name: 'Raydium' } }, topHolders: [{ address: 'POOL1', owner: 'POOL1', pct: 30 }, { address: 'W1', owner: 'W1owner', pct: 22, insider: true }, { address: 'VAULT2', owner: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', pct: 7 }, { address: 'Vau1t3xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx33', owner: 'V3', pct: 6.5 }, { address: 'W2', owner: 'W2owner', pct: 4 }], creator: 'W2owner', insiderNetworks: [{ size: 9, tokenAmount: 2.6e14 }], markets: [{ pubkey: 'MKT1', mintAAccount: 'Vau1t3xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx33', lp: { lpLockedPct: 12 } }], risks: [{ name: 'Low amount of LP Providers', level: 'warn', description: 'Only a few LP providers' }] } }));
  await p.route('https://trench.bot/**', (r) => r.fulfill({ json: { bonded: true, total_bundles: 6, total_percentage_bundled: 41.2, total_holding_percentage: 27.5, total_sol_spent: 80, creator_analysis: { current_holdings: 1, holding_percentage: 3.1, risk_level: 'low' } } }));
  await p.route('https://api.gopluslabs.io/**', (r) => r.fulfill({ json: { result: { [EVM.toLowerCase()]: { is_honeypot: '1', buy_tax: '0.0', sell_tax: '0.0', is_mintable: '0', is_proxy: '0', hidden_owner: '0', is_open_source: '1', holder_count: '4000', holders: [{ address: '0xa', percent: '0.03', is_contract: 0 }], lp_holders: [{ address: '0x000000000000000000000000000000000000dead', percent: '0.98', is_locked: 1 }], creator_percent: '0.01' } } } }));
  await p.route('https://api.anthropic.com/**', (r) => { anth = { headers: r.request().headers(), body: r.request().postDataJSON() }; r.fulfill({ json: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Walk away. The 26% bundle plus 88% unlocked LP means the insiders can exit on you at will.\nWhat would change my mind: LP burned and the bundle sold down below 5%.' }] } }); });
  await E2E.openFolds(p); await p.goto('file://' + E2E.ROOT + '/index.html');
  await p.evaluate(() => { localStorage.setItem('ft_settings', JSON.stringify({ anthropicKey: 'sk-ant-TEST' })); localStorage.setItem('ft_tab', 'check'); });
  await p.reload(); await p.waitForTimeout(500);
  const txt = async (s) => (await p.textContent(s)).replace(/\s+/g, ' ').trim();
  console.log('tabs:', await p.$$eval('#tabs button', (bs) => bs.map((x) => x.textContent).join(',')));
  // 1) Solana check
  await p.evaluate(() => showTab('check')); await p.fill('#caInput', 'https://dexscreener.com/solana/' + MINT); await p.click('#checkForm button'); await p.waitForTimeout(900);
  console.log('token:', (await txt('#tokenCard')).slice(0, 120));
  console.log('verdict:', (await txt('#verdictCard .verdict')), '| findings:', await p.$$eval('#verdictCard .findings li b', (xs) => xs.map((x) => x.textContent)));
  console.log('holders:', await p.$$eval('.holders-table tbody tr', (rs) => rs.map((r) => r.innerText.replace(/\s+/g, ' ').trim())));
  await p.$eval('.holders', (d) => d.scrollIntoView()); await p.screenshot({ path: E2E.OUT + '/holders.png', clip: (await (async () => { const r = await p.$eval('.holders', (d) => { const b = d.getBoundingClientRect(); return { x: 0, y: Math.max(0, b.top), width: 390, height: Math.min(600, b.height + 10) }; }); return r; })()) });
  console.log('whale finding:', await p.$eval('#verdictCard .findings', (x) => (x.textContent.match(/largest wallet holds \d+%/i) || ['none'])[0]));
  console.log('bundle detail:', await p.$eval('#verdictCard .findings li.f-critical:nth-of-type(2) .muted', (x) => x.textContent).catch(() => 'n/a'));
  console.log('sources:', (await txt('#verdictCard p.muted')).slice(0, 200));
  console.log('links:', await p.$$eval('.links-row a', (as) => as.map((a) => a.textContent.trim() + '=' + a.href).join(' | ')));
  // 2) AI
  await p.click('#aiBtn'); await p.waitForTimeout(500);
  console.log('ai:', (await txt('#aiCard')).slice(0, 90), '| model:', anth.body.model, '| hdr:', anth.headers['anthropic-dangerous-direct-browser-access'], anth.headers['x-api-key'], '| fallbacks:', anth.body.fallbacks, '| effort:', anth.body.output_config?.effort);
  // 3) plan 3x, size 100, stop 30
  await p.click('#planForm [data-x="3"]'); await p.fill('#planForm [name=size]', '100'); await p.click('#planForm button[type=submit]'); await p.waitForTimeout(300);
  console.log('plan rows:', await p.$$eval('#planCard tbody tr', (rs) => rs.map((r) => r.innerText.replace(/\s+/g, ' '))));
  await p.screenshot({ path: E2E.OUT + '/check-1.png', fullPage: true });
  // 4) watch: hold, then level 1 hit
  await p.click('#watchBtn'); await p.waitForTimeout(500);
  console.log('watch hold:', (await txt('#watchCard .risk-banner')).slice(0, 110));
  st.mcap = 150000; await p.evaluate(() => tickWatch()); await p.waitForTimeout(400);
  console.log('watch L1:', (await txt('#watchCard .risk-banner')).slice(0, 110), '| banner class:', await p.getAttribute('#watchCard .risk-banner', 'class'));
  await p.click('[data-take="0"]'); await p.waitForTimeout(300);
  console.log('celebrate:', (await txt('#planCard .celebrate')).slice(0, 100));
  console.log('discipline:', await txt('#disciplineCard'));
  // 5) distribution: high 240k then back to 170k
  st.mcap = 240000; await p.evaluate(() => tickWatch()); st.mcap = 170000; await p.evaluate(() => tickWatch()); await p.waitForTimeout(300);
  console.log('watch dist:', (await txt('#watchCard .risk-banner')).slice(0, 140));
  // 6) LP pull
  st.liq = 9000; await p.evaluate(() => tickWatch()); await p.waitForTimeout(300);
  console.log('watch pull:', (await txt('#watchCard .risk-banner')).slice(0, 120));
  await p.screenshot({ path: E2E.OUT + '/check-2.png', fullPage: true });
  // 7) persisted plan on reload
  await p.reload(); await p.waitForTimeout(400); await p.evaluate(() => showTab('check')); await p.fill('#caInput', MINT); await p.click('#checkForm button'); await p.waitForTimeout(800);
  console.log('after reload taken:', await p.$$eval('#planCard tbody tr.done', (rs) => rs.length), '| recent:', await txt('#recentChecks'));
  // 8) EVM honeypot
  await p.evaluate(() => showTab('check')); await p.fill('#caInput', EVM); await p.click('#checkForm button'); await p.waitForTimeout(800);
  console.log('evm verdict:', await txt('#verdictCard .verdict'), '|', await p.$$eval('#verdictCard .findings li b', (xs) => xs.map((x) => x.textContent)));
  console.log('hscroll:', await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), '| errors:', errs);
  await b.close();
  if (errs.length) { console.error('page errors:', errs); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
