/* global Scanner, Check, store, state, getJson, gatherFacts, runCheck, marketState, DEX_API, $, esc, fmtDT */
'use strict';
// Scanner card (Check tab): new launches -> cuts -> Claude judge -> at most one pick, scored later as a paper trade.

const SCAN_GECKO = 'https://api.geckoterminal.com/api/v2/networks/';
const SCAN_NETS = ['solana', 'base', 'bsc'];
const SCAN_AUTO_MS = 15 * 60000;
const SCAN_PAPER_MS = 10 * 60000;
const SCAN_TRADE_MAX = 60;   // tokens sent to the trade cut
const SCAN_CHAIN_MAX = 8;    // holder checks per scan
const SCAN_JUDGE_MAX = 5;    // Claude calls per scan
const scanState = { busy: false, progress: '', last: store.get('scanLast', null), book: store.get('scanPaper', []), auto: store.get('scanAuto', false) };

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const scanMoney = (v) => (v == null ? '–' : Check.fmtMcap(v));
const pctRet = (r) => (typeof r !== 'number' ? (r === 'missed' ? 'missed' : '…') : `<span class="${r > 0 ? 'pos' : r < 0 ? 'neg' : ''}">${r > 0 ? '+' : ''}${(r * 100).toFixed(0)}%</span>`);
function scanProgress(text) { scanState.progress = text; renderScanner(); }

async function dexPairs(addresses) {
  const out = {};
  for (let i = 0; i < addresses.length; i += 30) {
    const chunk = addresses.slice(i, i + 30);
    try { const j = await getJson(DEX_API + chunk.join(',')); for (const a of chunk) out[a] = Scanner.bestPair(j, a); }
    catch { for (const a of chunk) out[a] = undefined; }
  }
  return out;
}

async function judgeCoin(c) {
  const key = state.settings.anthropicKey;
  const { dex, facts, risk } = c.got;
  const evidence = {
    token: { symbol: c.symbol, chain: c.chain, ageHours: +((Date.now() - c.createdAt) / 3600000).toFixed(2), marketCapUsd: dex.mcap, liquidityUsd: dex.liq, volumeUsd: { m5: dex.vol5m, h1: dex.vol1h, h24: dex.vol24h }, txns: { m5: { buys: dex.buys5m, sells: dex.sells5m }, h1: { buys: dex.buys1h, sells: dex.sells1h }, h24: { buys: dex.buys24h, sells: dex.sells24h } }, priceChangePct: { m5: dex.change5m, h1: dex.change1h, h6: dex.change6h, h24: dex.change24h }, hasSocialLinks: (dex.socials || []).length > 0 },
    holders: { topWalletPct: facts.topHolderPct, top10Pct: facts.top10Pct, holders: facts.holders, bundledStillHeldPct: facts.insiderPct, bundledAtLaunchPct: facts.bundleLaunchPct, creatorPct: facts.creatorPct, lpLockedPct: facts.lpLockedPct },
    riskCheck: { verdict: risk.verdict, score: risk.score, findings: risk.findings.map((f) => `${f.sev}: ${f.title}`), notChecked: risk.unknown },
    traderTicket: state.sizeRec ? { size: state.sizeRec, unit: state.unit || 'SOL' } : null,
    marketMood: typeof marketState !== 'undefined' && marketState.data && marketState.data.totals ? marketState.data.totals.mood : null,
  };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    body: JSON.stringify({
      model: 'claude-opus-5-5', max_tokens: 4000, fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: Scanner.JUDGE_SCHEMA } },
      system: 'You judge one newly launched memecoin for a short-term trader, using only the evidence given. Score each number from 0 to 1. concentration_is_exit_risk: how likely the holder concentration lets a few wallets dump on buyers. momentum_already_spent: how much of the move has already happened. liquidity_fits_ticket: whether the pool can absorb the trader\'s ticket in and out without heavy slippage. dev_still_loaded: how much supply the creator or launch bundles still hold. crowd: how likely buying comes from many independent wallets rather than a few. shape: building (buys broadening and volume rising), steady, fading (volume and buys dropping), or one_buyer (one wallet or bundle driving the buys). worth_trading_at_all: whether a disciplined trader should take a small position now. confidence: how well the evidence supports your scores; lower it when data is missing. reason: one plain-English sentence naming the deciding factor. Never invent data.',
      messages: [{ role: 'user', content: 'Evidence (JSON):\n' + JSON.stringify(evidence) }],
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
  if (j.stop_reason === 'refusal') throw new Error('Claude declined to judge this coin');
  if (j.stop_reason === 'max_tokens') throw new Error('the judge ran out of room');
  const parsed = Scanner.parseJudge((j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''));
  if (!parsed) throw new Error('the judge reply was not readable');
  return parsed;
}

async function runScan() {
  if (scanState.busy) return;
  scanState.busy = true;
  const now = Date.now();
  const cut = [];
  const res = { at: now, pick: null, finalists: [], cut, judged: !!state.settings.anthropicKey, error: '' };
  try {
    // 0) universe
    let pools = [], failed = 0;
    for (const net of SCAN_NETS) for (const page of [1, 2]) {
      scanProgress(`Fetching new launches (${net}, page ${page})…`);
      try { pools = pools.concat(Scanner.fromGeckoNew(await getJson(`${SCAN_GECKO}${net}/new_pools?include=base_token&page=${page}`), net)); } catch { failed++; }
      await pause(250);
    }
    if (!pools.length) throw new Error(failed ? 'GeckoTerminal did not answer (network or CORS)' : 'no new launches returned');
    const byAddr = new Map();
    for (const p of pools) if (p.address && (!byAddr.has(p.address) || (p.liq || 0) > (byAddr.get(p.address).liq || 0))) byAddr.set(p.address, p);
    res.universe = byAddr.size;
    // 1) free cut
    let live = [];
    for (const p of byAddr.values()) { const why = Scanner.freeCut(p, now); if (why) cut.push({ p, stage: 'Free', why }); else live.push(p); }
    // 2) trade cut
    live.sort((a, b) => b.vol24 - a.vol24);
    for (const p of live.slice(SCAN_TRADE_MAX)) cut.push({ p, stage: 'Trade', why: 'outside the top 60 by volume this scan' });
    live = live.slice(0, SCAN_TRADE_MAX);
    scanProgress(`Checking trades for ${live.length} coins…`);
    const pairs = await dexPairs(live.map((p) => p.address));
    live = live.filter((p) => { const why = pairs[p.address] === undefined ? 'DexScreener did not answer' : Scanner.tradeCut(pairs[p.address]); if (why) cut.push({ p, stage: 'Trade', why }); else p.pair = pairs[p.address]; return !why; });
    // 3) chain cut
    for (const p of live.slice(SCAN_CHAIN_MAX)) cut.push({ p, stage: 'Chain', why: 'outside the top 8 by volume this scan' });
    live = live.slice(0, SCAN_CHAIN_MAX);
    const survivors = [];
    for (let i = 0; i < live.length; i++) {
      const p = live[i];
      scanProgress(`Checking holders ${i + 1} of ${live.length} (${p.symbol})…`);
      try {
        p.got = await gatherFacts(p.address);
        const cc = Scanner.chainCut(p.got.facts, p.got.dex.chainId);
        p.unchecked = cc.unchecked;
        if (cc.cut) cut.push({ p, stage: 'Chain', why: cc.cut }); else survivors.push(p);
      } catch (e) { cut.push({ p, stage: 'Chain', why: 'holder check failed: ' + e.message }); }
    }
    // 4) judge
    const finalists = survivors.slice(0, SCAN_JUDGE_MAX);
    for (const p of survivors.slice(SCAN_JUDGE_MAX)) cut.push({ p, stage: 'Judge', why: 'outside the top 5 finalists this scan' });
    if (res.judged && finalists.length) {
      scanProgress(`Asking Claude to judge ${finalists.length} finalist${finalists.length === 1 ? '' : 's'}…`);
      await Promise.all(finalists.map((p) => judgeCoin(p).then((j) => { p.judge = j; p.fails = Scanner.softCut(j); }).catch((e) => { p.judgeError = e.message; })));
    }
    // 5) pick
    const pk = res.judged ? Scanner.pick(finalists) : null;
    if (pk) {
      res.pick = pk.address;
      scanState.book = Scanner.addPaper(scanState.book, pk, Number(pk.pair && pk.pair.priceUsd) || pk.got.dex.priceUsd, now);
      store.set('scanPaper', scanState.book);
    }
    res.finalists = finalists.map((p) => ({ symbol: p.symbol, chain: p.chain, address: p.address, mcap: p.got.dex.mcap, liq: p.got.dex.liq, verdict: p.got.risk.verdict, judge: p.judge || null, fails: p.fails || [], judgeError: p.judgeError || '', unchecked: p.unchecked || [] }));
  } catch (e) {
    res.error = e.message;
  }
  res.cut = cut.map(({ p, stage, why }) => ({ symbol: p.symbol, chain: p.chain, stage, why }));
  scanState.last = res;
  store.set('scanLast', res);
  scanState.busy = false;
  scanState.progress = '';
  await updatePaper();
  renderScanner();
}

async function updatePaper() {
  const now = Date.now();
  const due = Scanner.due(scanState.book, now);
  const prices = {};
  if (due.length) {
    const pairs = await dexPairs(due);
    for (const a of due) if (pairs[a]) prices[a] = Number(pairs[a].priceUsd);
  }
  scanState.book = Scanner.applyPrices(scanState.book, prices, now);
  store.set('scanPaper', scanState.book);
  renderScanner();
}

const SCORE_LABELS = [['concentration_is_exit_risk', 'Exit risk'], ['momentum_already_spent', 'Spent'], ['liquidity_fits_ticket', 'Liquidity fit'], ['dev_still_loaded', 'Dev loaded'], ['crowd', 'Crowd'], ['worth_trading_at_all', 'Worth it'], ['confidence', 'Confidence']];

function renderScanner() {
  const card = $('#scannerCard');
  if (!card) return;
  const s = scanState.last;
  const sum = $('#scannerSummary');
  if (sum) {
    const pk = s && s.finalists.find((f) => f.address === s.pick);
    sum.textContent = scanState.busy ? 'scanning…' : pk ? `Pick: ${pk.symbol} · ${fmtDT(new Date(s.at).toISOString())}` : s ? `No pick · ${fmtDT(new Date(s.at).toISOString())}` : 'new launches, judged by Claude';
  }
  const head = `<div class="row between wrap"><span class="muted small">New launches → cuts → Claude judge</span><span class="row gap wrap">
      <label class="scan-auto small"><input type="checkbox" id="scanAuto" ${scanState.auto ? 'checked' : ''}/> Auto every 15 min</label>
      <button type="button" class="btn ${scanState.busy ? '' : 'primary'} mini" id="scanBtn" ${scanState.busy ? 'disabled' : ''}>${scanState.busy ? 'Scanning…' : 'Scan now'}</button></span></div>`;
  let body = '';
  if (scanState.busy) body += `<p class="muted small">${esc(scanState.progress)}</p>`;
  if (!s) body += '<p class="muted small">Scans new launches on Solana, Base and BNB through liquidity, volume, trade, holder and authority cuts, then asks Claude to judge the finalists and picks at most one. No trades are placed.</p>';
  else {
    if (s.error) body += `<p class="neg small">${esc(s.error)}</p>`;
    const pickRow = s.finalists.find((f) => f.address === s.pick);
    body += pickRow
      ? `<div class="scan-pick"><div class="row between wrap"><span><b>Pick: ${esc(pickRow.symbol)}</b> <span class="tag">${esc(pickRow.chain)}</span> <span class="muted small">mcap ${scanMoney(pickRow.mcap)} · liq ${scanMoney(pickRow.liq)}</span></span><button type="button" class="btn mini" data-scan-ca="${esc(pickRow.address)}">Check</button></div><div class="small">${esc(pickRow.judge.reason)}</div></div>`
      : `<p class="small"><b>No pick this scan.</b> <span class="muted">${!s.judged ? 'The judge needs an Anthropic API key (Settings), so finalists are listed without scores.' : s.finalists.length ? 'No finalist cleared every judge gate.' : 'Nothing survived the cuts.'}</span></p>`;
    if (s.finalists.length) body += `<h4 class="sub-head">Finalists</h4>` + s.finalists.map((f) => `<div class="recent-item scan-fin">
        <span><span><b>${esc(f.symbol)}</b> <span class="tag">${esc(f.chain)}</span></span><span class="muted small">mcap ${scanMoney(f.mcap)} · ${esc(f.verdict)}${f.unchecked.length ? ' · not checked: ' + esc(f.unchecked.join(', ')) : ''}</span>
          ${f.judge ? `<span class="scan-scores small">${SCORE_LABELS.map(([k, l]) => `${l} ${f.judge[k].toFixed(2)}`).join(' · ')} · ${esc(f.judge.shape.replace('_', ' '))}</span><span class="small">${f.fails.length ? '<span class="neg">Failed: ' + esc(f.fails.join('; ')) + '</span>' : esc(f.judge.reason)}</span>` : f.judgeError ? `<span class="neg small">Judge failed: ${esc(f.judgeError)}</span>` : ''}</span>
        <button type="button" class="btn mini" data-scan-ca="${esc(f.address)}">Check</button></div>`).join('');
    const stages = ['Free', 'Trade', 'Chain', 'Judge'];
    const counts = stages.map((st) => [st, s.cut.filter((c) => c.stage === st).length]).filter(([, n]) => n);
    if (s.cut.length) body += `<details class="adv scan-cut"><summary>Cut ${s.cut.length} of ${s.universe || s.cut.length} coins: ${counts.map(([st, n]) => `${st.toLowerCase()} ${n}`).join(' · ')}</summary>
        ${s.cut.slice(0, 80).map((c) => `<div class="small"><b>${esc(c.symbol)}</b> <span class="muted">${esc(c.chain)} · ${esc(c.stage)} cut:</span> ${esc(c.why)}</div>`).join('')}</details>`;
    body += `<p class="muted small">Last scan ${esc(fmtDT(new Date(s.at).toISOString()))}.</p>`;
  }
  const sc = Scanner.scorecard(scanState.book);
  if (sc.picks) {
    body += `<h4 class="sub-head">Paper trades (${sc.picks} pick${sc.picks === 1 ? '' : 's'})</h4>
      <div class="table-wrap"><table class="scan-score"><thead><tr><th>After</th><th class="num">Priced</th><th class="num">Up</th><th class="num">Avg return</th></tr></thead><tbody>
      ${['1h', '6h', '24h'].map((k) => `<tr><td>${k}</td><td class="num">${sc[k].n}</td><td class="num">${sc[k].n ? Math.round((100 * sc[k].up) / sc[k].n) + '%' : '–'}</td><td class="num">${sc[k].avg == null ? '–' : pctRet(sc[k].avg)}</td></tr>`).join('')}
      </tbody></table></div>
      ${scanState.book.slice(-5).reverse().map((x) => `<div class="recent-item small"><span><b>${esc(x.symbol)}</b> <span class="muted">${esc(fmtDT(new Date(x.at).toISOString()))}</span></span><span>1h ${pctRet(x.ret['1h'])} · 6h ${pctRet(x.ret['6h'])} · 24h ${pctRet(x.ret['24h'])}</span></div>`).join('')}
      <p class="muted small">Prices are read when the app is open near each mark; a mark the app missed is shown as missed, not filled in late.</p>`;
  }
  body += '<p class="muted small">Thresholds come from @savipww\'s published guide and are unvalidated, so trust the paper scorecard before the picks. The guide\'s X-account questions are skipped (no X data here). Volume and holder data can change in minutes.</p>';
  card.innerHTML = head + body;
}

$('#scannerCard').addEventListener('click', (e) => {
  if (e.target.closest('#scanBtn')) return runScan();
  const b = e.target.closest('[data-scan-ca]');
  if (b) { runCheck(b.dataset.scanCa); setTimeout(() => window.scrollTo({ top: $('#checkForm').offsetTop - 70, behavior: 'smooth' }), 50); }
});
$('#scannerCard').addEventListener('change', (e) => {
  if (e.target.id === 'scanAuto') { scanState.auto = e.target.checked; store.set('scanAuto', scanState.auto); if (scanState.auto) runScan(); }
});
renderScanner();
updatePaper();
setInterval(() => { if (scanState.auto && document.visibilityState === 'visible') runScan(); }, SCAN_AUTO_MS);
setInterval(() => { if (document.visibilityState === 'visible') updatePaper(); }, SCAN_PAPER_MS);
