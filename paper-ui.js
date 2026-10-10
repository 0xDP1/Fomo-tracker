/* global Paper, Calls, Gmgn, gmgnAvailable, gmgnGet, dexPairs, callState, callerOf, state, store, esc, fomoLink, ago, runCheck, $ */
'use strict';
// Paper trades (Calls tab): fake-money trades opened when a wallet you follow buys (GMGN wallet activity) or when Claude
// Haiku says enter on a Best-list coin, all closed by the same rules (half at 2×, rest at 3×, stop -40%, 24 hours).
// Runs only while the app is open; a level crossed while it was closed is filled at the next price and marked late.

const PAPER_TICK_MS = 60000;
const PAPER_AI_MODEL = 'claude-haiku-5-5';
const PAPER_AI_PER_TICK = 3;
const PAPER_KEEP = 300;
const paperState = Object.assign(Paper.empty(), store.get('paper', {}));
let paperBusy = false, paperNote = '';
const paperSave = () => { paperState.positions = paperState.positions.slice(-PAPER_KEEP); store.set('paper', paperState); };
const PAPER_CHAINS = [['sol', 'Solana'], ['bsc', 'BNB'], ['base', 'Base'], ['eth', 'Ethereum']];
const shortAddr = (a) => (a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : a);
const sourceName = (s) => { if (s === 'ai') return 'AI picks'; const w = paperState.wallets.find((x) => 'wallet:' + x.address === s); return w ? (w.label || shortAddr(w.address)) : shortAddr(s.replace(/^wallet:/, '')); };

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

// AI picks: Best-list coins (score at or above your minimum) are decided once each by Claude Haiku.
async function paperAi(now) {
  if (!paperState.ai.on || !state.settings.anthropicKey) return;
  const coins = Object.values(callState.queue)
    .filter((e) => Calls.isFresh(e, now, callState.maxAgeH * 3600000) && !paperState.decided[e.address] && e.price > 0)
    .map((e) => ({ e, cs: Calls.callScore(e, callerOf(e.firstPoster), now) }))
    .filter((x) => x.cs.score >= paperState.ai.minScore)
    .sort((a, b) => b.cs.score - a.cs.score).slice(0, PAPER_AI_PER_TICK);
  for (const { e, cs } of coins) {
    const prompt = Paper.aiPrompt({ symbol: e.symbol, chain: e.chainId || e.chain, score: cs.score, reasons: cs.reasons, flags: cs.flags, ageMin: e.launchedAt ? (now - e.launchedAt) / 60000 : null, mcap: e.mcap, liq: e.liq, verdict: e.verdict, top: e.top });
    let dec;
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': state.settings.anthropicKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: PAPER_AI_MODEL, max_tokens: 1000, system: Paper.AI_SYSTEM, output_config: { effort: 'low', format: { type: 'json_schema', schema: Paper.AI_SCHEMA } }, messages: [{ role: 'user', content: prompt }] }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j.error && j.error.message) || 'Anthropic HTTP ' + r.status);
      if (j.stop_reason === 'refusal') throw new Error('Claude declined');
      dec = Paper.readDecision((j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''));
      if (!dec) throw new Error('unreadable answer');
    } catch (err) { paperNote = 'AI picks: ' + err.message; return; }
    paperState.decided[e.address] = { at: now, enter: dec.enter, reason: dec.reason, score: cs.score };
    if (dec.enter) Object.assign(paperState, Paper.open(paperState, { address: e.address, chain: e.chainId || e.chain, symbol: e.symbol, source: 'ai', reason: `score ${cs.score}: ${dec.reason}`, price: e.price, at: now }));
  }
}

// Price every open position (one DexScreener request per 30 coins) and apply the exit rules.
async function paperPrices(now) {
  const open = paperState.positions.filter((p) => p.status === 'open');
  if (!open.length) return;
  const pairs = await dexPairs([...new Set(open.map((p) => p.address))]);
  paperState.positions = paperState.positions.map((p) => {
    if (p.status !== 'open') return p;
    const pr = pairs[p.address];
    if (pr === undefined) return p; // DexScreener did not answer: try next time
    return Paper.step(p, pr === null ? 0 : Number(pr.priceUsd), now);
  });
}

async function paperTick() {
  if (paperBusy) return;
  paperBusy = true;
  paperNote = '';
  try {
    const now = Date.now();
    await paperWallets(now);
    await paperAi(now);
    await paperPrices(now);
    paperSave();
  } finally { paperBusy = false; renderPaper(); }
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
    <p class="muted small">Fake money: $${Paper.RULES.size} a trade, the same exits for every trade (half at 2×, the rest at 3×, stop at −40%, close after 24 hours). Prices are only checked while the app is open; a level crossed while it was closed fills at the next price and is marked <b>late</b>.</p>
    <h4 class="sub-head">Copy a wallet</h4>
    ${gmgnOk ? '' : '<p class="small neg">Needs GMGN: the Worker\'s GMGN key or your GMGN key in Settings → Advanced.</p>'}
    <form id="paperWalletForm" class="row gap wrap"><input id="paperWallet" placeholder="Wallet address" spellcheck="false" autocomplete="off" autocapitalize="off" /><select id="paperChain">${PAPER_CHAINS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><input id="paperLabel" placeholder="Name (optional)" maxlength="20" /><button class="btn mini primary" type="submit">Follow</button></form>
    ${paperState.wallets.length ? `<div class="tag-chips">${paperState.wallets.map((w) => `<button type="button" data-paper-unfollow="${esc(w.address)}">${esc(w.label || shortAddr(w.address))} ✕</button>`).join('')}</div><p class="muted small">New buys are picked up within about 5 minutes; the paper trade opens at the price then, not the wallet's.</p>` : ''}
    <h4 class="sub-head">AI picks</h4>
    <div class="row gap wrap small paper-ai"><label><input type="checkbox" id="paperAiOn" ${paperState.ai.on ? 'checked' : ''} ${state.settings.anthropicKey ? '' : 'disabled'} /> Let Claude Haiku decide on Best-list coins</label><label>score ≥ <input type="number" id="paperAiMin" min="0" max="100" step="5" value="${paperState.ai.minScore}" /></label></div>
    ${state.settings.anthropicKey ? '<p class="muted small">Each coin is decided once (about 0.05¢ each); a few per minute at most.</p>' : '<p class="muted small">Needs an Anthropic API key (Settings).</p>'}
    ${paperNote ? `<p class="small neg">${esc(paperNote)}</p>` : ''}
    ${res.length ? `<h4 class="sub-head">Results</h4><div class="table-wrap"><table class="paper-res"><thead><tr><th>Source</th><th class="num">Trades</th><th class="num">Win %</th><th class="num">Avg</th><th class="num">P&amp;L</th></tr></thead><tbody>
      ${res.map((r) => `<tr><td>${esc(sourceName(r.source))}${r.open ? ` <span class="muted small">${r.open} open</span>` : ''}</td><td class="num">${r.trades}</td><td class="num">${r.winRate == null ? '–' : Math.round(r.winRate * 100) + '%'}</td><td class="num">${pct(r.avgRet)}</td><td class="num ${r.usd >= 0 ? 'pos' : 'neg'}">${usdS(r.usd)}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted small">No paper trades yet.</p>'}
    ${open.length ? `<h4 class="sub-head">Open</h4>${open.map((p) => { const v = Paper.pnl(p); return `<div class="recent-item"><span><b>${esc(p.symbol || shortAddr(p.address))}</b> <span class="muted small">${esc(sourceName(p.source))} · ${ago(p.openedAt)} ago${p.fills.length ? ' · half sold' : ''}</span><br><span class="small ${v.ret >= 0 ? 'pos' : 'neg'}">${pct(v.ret)}</span> <span class="muted small">${esc(p.reason)}</span></span><span class="row gap">${fomoLink(p.chain, p.address)}<button type="button" class="btn mini" data-paper-check="${esc(p.address)}">Check</button></span></div>`; }).join('')}` : ''}
    ${closed.length ? `<h4 class="sub-head">Closed</h4><div class="table-wrap"><table class="paper-closed"><thead><tr><th>Coin</th><th>Source</th><th>Exit</th><th class="num">Result</th></tr></thead><tbody>${closed.map((p) => { const v = Paper.pnl(p); return `<tr><td>${esc(p.symbol || shortAddr(p.address))}</td><td>${esc(sourceName(p.source))}</td><td>${esc(p.fills.map((f) => f.why).join(', '))}${p.late ? ' <span class="warn-text">late</span>' : ''}</td><td class="num ${v.ret >= 0 ? 'pos' : 'neg'}">${pct(v.ret)}</td></tr>`; }).join('')}</tbody></table></div>` : ''}
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
});

renderPaper();
setInterval(() => { if (document.visibilityState === 'visible') paperTick(); }, PAPER_TICK_MS);
setTimeout(() => { if (paperState.positions.some((p) => p.status === 'open') || paperState.wallets.length || paperState.ai.on) paperTick(); }, 3000);
