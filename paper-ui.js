/* global Paper, Calls, Gmgn, WalletMem, wmState, Bundle, Chatter, chatterAvailable, fetchChatter, gatherFacts, gmgnAvailable, gmgnGet, dexPairs, callState, callerOf, state, store, esc, fomoLink, ago, runCheck, $ */
'use strict';
// Paper trades (Calls tab): fake-money trades opened when a wallet you follow buys (GMGN wallet activity), closed by fixed
// rules (half at 2×, rest at 3×, stop -40%, 24 hours), and an AI trader (Claude Sonnet) that sees everything the app knows
// about a coin, sets its own size, target and stop, and checks in on its positions every 10 minutes.
// Runs only while the app is open; a level crossed while it was closed is filled at the next price and marked late.

const PAPER_TICK_MS = 60000;
const PAPER_AI_MODEL = 'claude-sonnet-5-5'; // weighs many, often conflicting signals; the daily cap keeps the cost down
const PAPER_AI_PER_TICK = 2;
const PAPER_MANAGE_PER_TICK = 3;
const PAPER_KEEP = 300;
const paperState = Object.assign(Paper.empty(), store.get('paper', {}));
paperState.ai = Object.assign({ on: false, minScore: 60, chatter: false, cap: Paper.AI_RULES.cap, used: null }, paperState.ai);
let paperBusy = false, paperNote = '';
const paperSave = () => { paperState.positions = paperState.positions.slice(-PAPER_KEEP); store.set('paper', paperState); };
const PAPER_CHAINS = [['sol', 'Solana'], ['bsc', 'BNB'], ['base', 'Base'], ['eth', 'Ethereum']];
const shortAddr = (a) => (a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : a);
const SOURCE_NAMES = { ai: 'AI picks (old)', 'ai-trader': 'AI trader', 'ai-fixed': 'Same entries, fixed exits' };
const SOURCE_SHORT = { 'ai-trader': 'AI', 'ai-fixed': 'Fixed', ai: 'AI (old)' };
const sourceShort = (s) => SOURCE_SHORT[s] || sourceName(s);
const sourceName = (s) => { if (SOURCE_NAMES[s]) return SOURCE_NAMES[s]; const w = paperState.wallets.find((x) => 'wallet:' + x.address === s); return w ? (w.label || shortAddr(w.address)) : shortAddr(s.replace(/^wallet:/, '')); };

// Followed wallets: their new buys since you started following open a position at today's price (you would buy after them).
async function paperWallets(now) {
  if (!paperState.wallets.length || !gmgnAvailable()) return;
  for (const w of paperState.wallets) {
    let d;
    try { d = await gmgnGet('user/wallet_activity', { chain: w.chain, wallet_address: w.address, type: 'buy', limit: '20' }); } catch (e) { paperNote = 'Wallet check: ' + e.message; return; }
    const buys = Paper.walletBuys(d, Math.floor(w.since / 1000)).filter((b) => !paperState.seen[w.address + '|' + b.tx + '|' + b.address]);
    if (!buys.length) continue;
    const pairs = await dexPairs([...new Set(buys.map((b) => b.address))]);
    for (const b of buys) {
      paperState.seen[w.address + '|' + b.tx + '|' + b.address] = 1;
      const pr = pairs[b.address];
      const price = pr ? Number(pr.priceUsd) : null;
      Object.assign(paperState, Paper.open(paperState, { address: b.address, chain: (pr && pr.chainId) || w.chain, symbol: b.symbol || (pr && pr.baseToken && pr.baseToken.symbol) || '', source: 'wallet:' + w.address, reason: `bought $${Math.round(b.usd || 0)} ${ago(b.at)} ago`, price, refPrice: b.price, at: now }));
    }
  }
}

// ---- AI trader ----
async function aiCall(system, schema, prompt) {
  const now = Date.now();
  if (!Paper.canSpend(paperState.ai.used, now, paperState.ai.cap)) throw new Error(`daily cap of ${paperState.ai.cap} AI calls reached`);
  paperState.ai.used = Paper.spend(paperState.ai.used, now);
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': state.settings.anthropicKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    body: JSON.stringify({ model: PAPER_AI_MODEL, max_tokens: 4000, fallbacks: 'default', system, output_config: { effort: 'medium', format: { type: 'json_schema', schema } }, messages: [{ role: 'user', content: prompt }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('Anthropic rejected the API key');
  if (!r.ok) throw new Error((j.error && j.error.message) || 'Anthropic HTTP ' + r.status);
  if (j.stop_reason === 'refusal') throw new Error('Claude declined');
  return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

// GMGN holder labels, early traders and wallet memory for a coin (shared, cached requests); null parts when unavailable.
async function gmgnEvidence(chain, address) {
  const c = Gmgn.toGmgnChain(chain);
  if (!c || !gmgnAvailable()) return {};
  const out = {};
  try {
    const [h, t] = await Promise.all([
      gmgnGet('market/token_top_holders', { chain: c, address, limit: '100' }).catch(() => null),
      gmgnGet('market/token_top_traders', { chain: c, address, limit: '100', order_by: 'profit' }).catch(() => null),
    ]);
    const lab = h ? Gmgn.holderLabels(h.list || []) : null;
    if (lab) out.labels = { riskPct: lab.riskPct, riskN: lab.riskN, smartN: lab.smart.n, smartPct: lab.smart.heldPct, smartSold: lab.smart.soldHalf, kolN: lab.kol.n };
    const early = t ? Gmgn.earlyTraders(t.list || []) : null;
    if (early) out.early = early;
    if (typeof WalletMem !== 'undefined' && typeof wmState !== 'undefined') {
      const m = WalletMem.match(wmState.mem, [].concat((h && h.list) || [], (t && t.list) || []).map((x) => x.address));
      out.memory = { rug: m.rug.length, runner: m.runner.length, bot: m.bot.length, learned: Object.keys(wmState.mem.coins).length };
    }
  } catch { /* GMGN parts are optional */ }
  return out;
}

async function coinEvidence(e, cs, now) {
  const got = await gatherFacts(e.address); // DexScreener, RugCheck or GoPlus, TrenchBot: the Check tab's own checks
  const d = got.dex, f = got.facts;
  const prof = callerOf(e.firstPoster) || {};
  const x = {
    token: { symbol: d.symbol, chain: d.chainId, ageMin: d.createdAt ? (now - d.createdAt) / 60000 : null, mcap: d.mcap, liq: d.liq, vol24: d.vol24h, ch5m: d.change5m, ch1h: d.change1h, buys1h: d.buys1h, sells1h: d.sells1h },
    call: { score: cs.score, reasons: cs.reasons, flags: cs.flags, callers: (e.posters || []).length, channels: e.channels, firstCaller: e.firstPoster, winRate: prof.winRate, sinceCall: e.callMcap && d.mcap ? d.mcap / e.callMcap : null },
    risk: { verdict: got.risk.verdict, score: got.risk.score, findings: got.risk.findings, unknown: got.risk.unknown },
    holders: { topPct: f.topHolderPct, top10Pct: f.top10Pct, count: f.holders, creatorPct: f.creatorPct, insiderPct: f.insiderPct },
  };
  if (e.bundle && typeof Bundle !== 'undefined') x.bundle = Bundle.label(e.bundle) + (e.bundle.serial ? ', dev bundles every launch' : '');
  Object.assign(x, await gmgnEvidence(d.chainId, e.address));
  if (paperState.ai.chatter && typeof chatterAvailable === 'function' && chatterAvailable()) {
    try { x.chatter = Chatter.prepare((await fetchChatter(e.address, d.symbol)).messages || []).lines; } catch { /* chat is optional */ }
  }
  return { lines: Paper.evidence(x), dex: d };
}

// New coins on the Best list (score at or above your minimum), each decided once.
async function paperAiTrader(now) {
  if (!paperState.ai.on || !state.settings.anthropicKey) return;
  const coins = Object.values(callState.queue)
    .filter((e) => Calls.isFresh(e, now, callState.maxAgeH * 3600000) && !paperState.decided[e.address])
    .map((e) => ({ e, cs: Calls.callScore(e, callerOf(e.firstPoster), now) }))
    .filter((x) => x.cs.score >= paperState.ai.minScore)
    .sort((a, b) => b.cs.score - a.cs.score).slice(0, PAPER_AI_PER_TICK);
  for (const { e, cs } of coins) {
    let ev, plan;
    try {
      ev = await coinEvidence(e, cs, now);
      plan = Paper.readPlan(await aiCall(Paper.TRADER_SYSTEM, Paper.PLAN_SCHEMA, Paper.traderPrompt(ev.lines)));
      if (!plan) throw new Error('unreadable answer');
    } catch (err) { paperNote = 'AI trader: ' + err.message; return; }
    paperState.decided[e.address] = { at: now, enter: plan.enter, reason: plan.thesis, score: cs.score, symbol: e.symbol };
    const price = Number(ev.dex.priceUsd) || e.price;
    if (plan.enter) Object.assign(paperState, Paper.openAi(paperState, { address: e.address, chain: ev.dex.chainId, symbol: ev.dex.symbol || e.symbol, price, at: now, plan, evidence: ev.lines }));
  }
}

// Check in on open AI positions every 10 minutes with fresh evidence.
async function paperAiManage(now, pairs) {
  if (!paperState.ai.on || !state.settings.anthropicKey) return;
  const due = paperState.positions.filter((p) => p.source === 'ai-trader' && p.status === 'open' && now - p.managedAt >= Paper.AI_RULES.manageMs).slice(0, PAPER_MANAGE_PER_TICK);
  for (const p of due) {
    const pr = pairs[p.address];
    if (!pr) continue;
    const x = {
      token: { symbol: p.symbol, chain: p.chain, ageMin: pr.pairCreatedAt ? (now - pr.pairCreatedAt) / 60000 : null, mcap: pr.marketCap || pr.fdv, liq: pr.liquidity && pr.liquidity.usd, vol24: pr.volume && pr.volume.h24, ch5m: pr.priceChange && pr.priceChange.m5, ch1h: pr.priceChange && pr.priceChange.h1, buys1h: pr.txns && pr.txns.h1 && pr.txns.h1.buys, sells1h: pr.txns && pr.txns.h1 && pr.txns.h1.sells },
      position: { entryMcap: null, agoMin: Math.round((now - p.openedAt) / 60000), x: Number(pr.priceUsd) / p.entry, left: p.left, tp: p.plan.takeProfitX, stop: p.plan.stopPct },
    };
    Object.assign(x, await gmgnEvidence(p.chain, p.address));
    let dec;
    try { dec = Paper.readManage(await aiCall(Paper.MANAGE_SYSTEM, Paper.MANAGE_SCHEMA, Paper.managePrompt(Paper.evidence(x).concat(`Your thesis at entry: ${p.reason}`)))); if (!dec) throw new Error('unreadable answer'); }
    catch (err) { paperNote = 'AI trader: ' + err.message; return; }
    paperState.positions = paperState.positions.map((q) => (q.id === p.id ? Paper.applyManage(q, dec, Number(pr.priceUsd), now) : q));
  }
}

// Price every open position (one DexScreener request per 30 coins) and apply the exit rules.
async function paperPrices(now) {
  const open = paperState.positions.filter((p) => p.status === 'open');
  if (!open.length) return {};
  const pairs = await dexPairs([...new Set(open.map((p) => p.address))]);
  paperState.positions = paperState.positions.map((p) => {
    if (p.status !== 'open') return p;
    const pr = pairs[p.address];
    if (pr === undefined) return p; // DexScreener did not answer: try next time
    const px = pr === null ? 0 : Number(pr.priceUsd);
    return p.source === 'ai-trader' ? Paper.stepAi(p, px, now) : Paper.step(p, px, now);
  });
  return pairs;
}

async function paperTick() {
  if (paperBusy) return;
  paperBusy = true;
  paperNote = '';
  try {
    const now = Date.now();
    await paperWallets(now);
    await paperAiTrader(now);
    const pairs = await paperPrices(now);
    await paperAiManage(now, pairs || {});
    paperSave();
  } finally { paperBusy = false; renderPaper(); }
}

function aiPositionHtml(p, v, pct) {
  return `<details class="paper-ai-pos"><summary><b>${esc(p.symbol || shortAddr(p.address))}</b> <span class="muted small">AI trader · $${p.size} · ${ago(p.openedAt)} ago · target ${p.plan.takeProfitX}× stop -${p.plan.stopPct}%</span> <span class="small ${v.ret >= 0 ? 'pos' : 'neg'}">${pct(v.ret)}</span></summary>
    <p class="small">${esc(p.reason)}</p>
    <ul class="small paper-log">${p.log.map((l) => `<li><span class="muted">${new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> <b>${esc(l.what)}</b> ${esc(l.why || '')}</li>`).join('')}</ul>
    <details class="adv"><summary>What it saw</summary><ul class="muted small">${(p.evidence || []).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></details>
    <div class="row gap">${fomoLink(p.chain, p.address)}<button type="button" class="btn mini" data-paper-check="${esc(p.address)}">Check</button></div></details>`;
}

function renderPaper() {
  const card = $('#paperCard');
  if (!card) return;
  const sum = $('#paperSummary');
  const res = Paper.results(paperState.positions);
  const open = paperState.positions.filter((p) => p.status === 'open');
  const closed = paperState.positions.filter((p) => p.status !== 'open').slice(-15).reverse();
  const usdS = (v) => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(0)}`;
  const pct = (v) => (v == null ? '–' : `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`);
  if (sum) sum.textContent = paperState.positions.length ? `${open.length} open · ${usdS(res.reduce((a, r) => a + r.usd, 0))}` : 'fake-money trades';
  const gmgnOk = gmgnAvailable();
  card.innerHTML = `
    <p class="muted small">Fake money only. Copied wallets trade $${Paper.RULES.size} with fixed exits (half at 2×, the rest at 3×, stop at −40%, close after 24 hours); the AI trader sets its own. Prices are only checked while the app is open; a level crossed while it was closed fills at the next price and is marked <b>late</b>.</p>
    <h4 class="sub-head">Copy a wallet</h4>
    ${gmgnOk ? '' : '<p class="small neg">Needs GMGN: the Worker\'s GMGN key or your GMGN key in Settings → Advanced.</p>'}
    <form id="paperWalletForm" class="row gap wrap"><input id="paperWallet" placeholder="Wallet address" spellcheck="false" autocomplete="off" autocapitalize="off" /><select id="paperChain">${PAPER_CHAINS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><input id="paperLabel" placeholder="Name (optional)" maxlength="20" /><button class="btn mini primary" type="submit">Follow</button></form>
    ${paperState.wallets.length ? `<div class="tag-chips">${paperState.wallets.map((w) => `<button type="button" data-paper-unfollow="${esc(w.address)}">${esc(w.label || shortAddr(w.address))} ✕</button>`).join('')}</div><p class="muted small">New buys are picked up within about 5 minutes; the paper trade opens at the price then, not the wallet's.</p>` : ''}
    <h4 class="sub-head">AI trader</h4>
    <div class="row gap wrap small paper-ai"><label><input type="checkbox" id="paperAiOn" ${paperState.ai.on ? 'checked' : ''} ${state.settings.anthropicKey ? '' : 'disabled'} /> Let Claude Sonnet trade Best-list coins</label><label>score ≥ <input type="number" id="paperAiMin" min="0" max="100" step="5" value="${paperState.ai.minScore}" /></label><label><input type="checkbox" id="paperAiChat" ${paperState.ai.chatter ? 'checked' : ''} /> read the chat too</label><label>max AI calls a day <input type="number" id="paperAiCap" min="1" max="1000" step="10" value="${paperState.ai.cap}" /></label></div>
    ${state.settings.anthropicKey ? `<p class="muted small">It runs the full check on each coin (rug check, holder labels, early traders, wallet memory, bundles, callers${paperState.ai.chatter ? ', chat' : ''}), decides once whether to enter, picks the size ($50 to $200), target and stop, and checks in every 10 minutes to hold, trim or exit. Rails: hard stop −50%, closed after 24 hours. About 1–2¢ per decision; ${paperState.ai.used && paperState.ai.used.day === new Date().toISOString().slice(0, 10) ? paperState.ai.used.n : 0} of ${paperState.ai.cap} calls used today.</p>` : '<p class="muted small">Needs an Anthropic API key (Settings).</p>'}
    ${paperNote ? `<p class="small neg">${esc(paperNote)}</p>` : ''}
    ${res.length ? `<h4 class="sub-head">Results</h4><div class="table-wrap"><table class="paper-res"><thead><tr><th>Source</th><th class="num">Trades</th><th class="num">Win %</th><th class="num">Avg</th><th class="num">P&amp;L</th></tr></thead><tbody>
      ${res.map((r) => `<tr><td>${esc(sourceName(r.source))}${r.open ? ` <span class="muted small">${r.open} open</span>` : ''}</td><td class="num">${r.trades}</td><td class="num">${r.winRate == null ? '–' : Math.round(r.winRate * 100) + '%'}</td><td class="num">${pct(r.avgRet)}</td><td class="num ${r.usd >= 0 ? 'pos' : 'neg'}">${usdS(r.usd)}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted small">No paper trades yet.</p>'}
    ${open.length ? `<h4 class="sub-head">Open</h4>${open.map((p) => { const v = Paper.pnl(p); if (p.source === 'ai-trader') return aiPositionHtml(p, v, pct); return `<div class="recent-item"><span><b>${esc(p.symbol || shortAddr(p.address))}</b> <span class="muted small">${esc(sourceName(p.source))} · ${ago(p.openedAt)} ago${p.fills.length ? ' · half sold' : ''}</span><br><span class="small ${v.ret >= 0 ? 'pos' : 'neg'}">${pct(v.ret)}</span> <span class="muted small">${esc(p.reason)}</span></span><span class="row gap">${fomoLink(p.chain, p.address)}<button type="button" class="btn mini" data-paper-check="${esc(p.address)}">Check</button></span></div>`; }).join('')}` : ''}
    ${closed.length ? `<h4 class="sub-head">Closed</h4><div class="table-wrap"><table class="paper-closed"><thead><tr><th>Coin</th><th>Source</th><th>Exit</th><th class="num">Result</th></tr></thead><tbody>${closed.map((p) => { const v = Paper.pnl(p); return `<tr><td>${esc(p.symbol || shortAddr(p.address))}</td><td>${esc(sourceShort(p.source))}</td><td>${esc(p.fills.map((f) => f.why).join(', '))}${p.late ? ' <span class="warn-text">late</span>' : ''}</td><td class="num ${v.ret >= 0 ? 'pos' : 'neg'}">${pct(v.ret)}</td></tr>`; }).join('')}</tbody></table></div>` : ''}
    <div class="row gap wrap"><button type="button" class="btn mini" id="paperRefresh">${paperBusy ? 'Updating…' : 'Update now'}</button>${paperState.positions.length ? '<button type="button" class="btn mini danger" id="paperReset">Reset paper trades</button>' : ''}</div>`;
}

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'paperWalletForm') return;
  e.preventDefault();
  const address = $('#paperWallet').value.trim();
  if (!/^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(address)) { paperNote = 'That is not a wallet address.'; return renderPaper(); }
  if (!paperState.wallets.some((w) => w.address === address)) paperState.wallets.push({ address, chain: $('#paperChain').value, label: $('#paperLabel').value.trim().slice(0, 20), since: Date.now() });
  paperSave(); renderPaper(); paperTick();
});
document.addEventListener('click', (e) => {
  const un = e.target.closest('[data-paper-unfollow]');
  if (un) { paperState.wallets = paperState.wallets.filter((w) => w.address !== un.dataset.paperUnfollow); paperSave(); return renderPaper(); }
  if (e.target.closest('#paperRefresh')) return paperTick();
  if (e.target.closest('#paperReset')) { if (!confirm('Delete all paper trades? Followed wallets and settings stay.')) return; Object.assign(paperState, { positions: [], decided: {}, seen: {} }); paperState.wallets.forEach((w) => { w.since = Date.now(); }); paperSave(); return renderPaper(); }
  const ck = e.target.closest('[data-paper-check]');
  if (ck) runCheck(ck.dataset.paperCheck);
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'paperAiOn') { paperState.ai.on = e.target.checked; paperSave(); renderPaper(); if (paperState.ai.on) paperTick(); }
  if (e.target.id === 'paperAiMin') { paperState.ai.minScore = Math.min(100, Math.max(0, Number(e.target.value) || 0)); paperSave(); }
  if (e.target.id === 'paperAiChat') { paperState.ai.chatter = e.target.checked; paperSave(); renderPaper(); }
  if (e.target.id === 'paperAiCap') { paperState.ai.cap = Math.min(1000, Math.max(1, Math.round(Number(e.target.value) || Paper.AI_RULES.cap))); paperSave(); renderPaper(); }
});

renderPaper();
setInterval(() => { if (document.visibilityState === 'visible') paperTick(); }, PAPER_TICK_MS);
setTimeout(() => { if (paperState.positions.some((p) => p.status === 'open') || paperState.wallets.length || paperState.ai.on) paperTick(); }, 3000);
