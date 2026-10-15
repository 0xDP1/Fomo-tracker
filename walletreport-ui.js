/* global WalletReport, WalletGates, gmgnAvailable, gmgnGet, dexPairs, feeCostPct, paperState, paperSave, renderPaper, paperTick, state, esc, $ */
'use strict';
// Wallet report (Calls tab): paste a wallet, see its trading pace, holds, win rate and returns from GMGN, the costs a
// copier would pay, the four copy gates from GMGN's wallet stats (docs/features/wallet-gates.md), and Claude's style and
// copy verdict. "Paper-copy this wallet" hands it to Paper trades.

const WR_MODEL = 'claude-sonnet-5-5';
const wrState = { busy: false, wallet: null, s: null, pairs: null, mcaps: null, gates: null, ai: null, error: '' };

// GMGN's 7-day and 30-day wallet stats and all-time profits: three paced reads. Only the 7-day one is a must.
async function wrReadGates(wallet, s, pairs, mcaps) {
  const soft = (p) => p.catch(() => null);
  let s7;
  try {
    const got = await Promise.all([gmgnGet('user/wallet_stats', { chain: 'sol', wallet_address: wallet, period: '7d' }), soft(gmgnGet('user/wallet_stats', { chain: 'sol', wallet_address: wallet, period: '30d' })), soft(gmgnGet('user/wallet_profits', { chain: 'sol', wallet_address: wallet, period: 'all' }))]);
    s7 = got[0];
    const rec = WalletGates.record(got[0], got[1], got[2]);
    const list = WalletGates.gates(rec, s, pairs, mcaps);
    return { rec, list, verdict: WalletGates.verdict(list), error: rec ? '' : 'GMGN gave no wallet stats' };
  } catch (e) {
    const list = WalletGates.gates(null, s, pairs, mcaps);
    return { rec: null, list, verdict: WalletGates.verdict(list), error: e.message || String(s7) };
  }
}

async function wrAsk(s, pairs, mcaps, gates) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': state.settings.anthropicKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    body: JSON.stringify({ model: WR_MODEL, max_tokens: 2000, fallbacks: 'default', system: WalletReport.SYSTEM, output_config: { effort: 'medium', format: { type: 'json_schema', schema: WalletReport.SCHEMA } }, messages: [{ role: 'user', content: WalletReport.prompt(wrState.wallet, s, pairs, mcaps, gates && gates.list ? WalletGates.promptLines(gates.list, gates.verdict, gates.rec) : []) }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('Anthropic rejected the API key');
  if (!r.ok) throw new Error((j.error && j.error.message) || 'Anthropic HTTP ' + r.status);
  if (j.stop_reason === 'refusal') throw new Error('Claude declined');
  const v = WalletReport.readVerdict((j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''));
  if (!v) throw new Error('Claude gave an answer the app could not read');
  return v;
}

async function runWalletReport(text) {
  const wallet = WalletReport.parseWallet(text);
  Object.assign(wrState, { wallet, s: null, pairs: null, mcaps: null, gates: null, ai: null, error: '' });
  if (!wallet) { wrState.error = 'Paste a Solana wallet address or a GMGN wallet link.'; return renderWalletReport(); }
  if (!gmgnAvailable()) { wrState.error = 'The wallet report reads trades from GMGN: set up the Discord feed Worker with a GMGN key, or add a GMGN API key in Settings → Advanced.'; return renderWalletReport(); }
  wrState.busy = true; renderWalletReport();
  try {
    const [b, s] = await Promise.all(['buy', 'sell'].map((type) => gmgnGet('user/wallet_activity', { chain: 'sol', wallet_address: wallet, type, limit: '100' })));
    if (wrState.wallet !== wallet) return;
    const rows = [].concat((b && (b.activities || b.list)) || [], (s && (s.activities || s.list)) || []);
    const pairs = WalletReport.pair(rows);
    let mcaps = {};
    if (pairs.length && typeof dexPairs === 'function') {
      try { mcaps = WalletReport.entryMcaps(pairs, await dexPairs(pairs.slice(-30).map((p) => p.address))); } catch { mcaps = {}; }
    }
    const st = WalletReport.stats(pairs, { costPct: typeof feeCostPct === 'function' ? feeCostPct() : 4 });
    Object.assign(wrState, { pairs, mcaps, s: st, gates: { loading: true } });
    renderWalletReport();
    const gates = await wrReadGates(wallet, st, pairs, mcaps);
    if (wrState.wallet !== wallet) return;
    wrState.gates = gates;
    renderWalletReport();
    if (!st.closed) wrState.ai = { error: 'No closed trades in GMGN\'s recent activity, so there is nothing to judge yet.' };
    else if (!state.settings.anthropicKey) wrState.ai = { error: 'Add an Anthropic API key in Settings for the style and copy verdict.' };
    else {
      wrState.ai = { loading: true }; renderWalletReport();
      try { wrState.ai = await wrAsk(st, pairs, mcaps, gates); } catch (e) { wrState.ai = { error: e.message }; }
    }
  } catch (e) {
    wrState.error = e.message;
  } finally {
    wrState.busy = false;
  }
  renderWalletReport();
}

function renderWalletReport() {
  const el = $('#walletReportCard');
  if (!el) return;
  const { s, ai, gates } = wrState;
  const usd = (v) => (v == null ? '–' : `${v < 0 ? '−' : ''}$${Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(1) + 'k' : Math.round(Math.abs(v))}`);
  const following = wrState.wallet && typeof paperState !== 'undefined' && paperState.wallets.some((w) => w.address === wrState.wallet);
  let body = '';
  if (wrState.error) body = `<p class="neg small">${esc(wrState.error)}</p>`;
  else if (wrState.busy && !s) body = '<p class="muted small">Reading the wallet\'s recent buys and sells from GMGN…</p>';
  else if (s && !s.tokens) body = '<p class="muted small">GMGN shows no recent buys for this wallet.</p>' + wrGatesHtml(gates, s);
  else if (s) {
    const verdict = !ai ? '' : ai.loading ? '<p class="muted small">Claude is reading the trades…</p>' : ai.error ? `<p class="muted small">${esc(ai.error)}</p>`
      : `<div class="row between wrap"><b>${esc(ai.style)}</b><span class="flow-label ${ai.verdict === 'copyable' ? 'pos' : ai.verdict === 'risky' ? 'warn-text' : 'neg'}">${esc(ai.label)}</span></div>
        ${ai.summary ? `<p class="small">${esc(ai.summary)}</p>` : ''}${ai.reasons.length ? `<ul class="small">${ai.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}`;
    const tiles = [
      ['Trades / day', Number(s.tradesPerDay.toFixed(1)), `${s.tokens} tokens in ${s.spanHours < 48 ? Math.round(s.spanHours) + ' h' : Math.round(s.spanHours / 24) + ' days'}`],
      ['Avg size', usd(s.avgSizeUsd), 'per token'],
      ['Median hold', s.medianHoldMin != null ? s.medianHoldMin + ' min' : '–', s.under5mPct != null ? `${s.under5mPct}% under 5 min` : ''],
      ['Win rate', s.winRate != null ? s.winRate + '%' : '–', `${s.closed} closed`],
      ['Avg return', s.avgRetPct != null ? (s.avgRetPct >= 0 ? '+' : '') + s.avgRetPct + '%' : '–', `realized ${usd(s.realizedUsd)}`],
      ['Your costs', usd(s.copyCostUsd), s.costShare != null ? `${s.costShare}% of its profit` : `${s.costPct}% per round trip`],
    ];
    const mc = Object.values(wrState.mcaps || {});
    const medMc = WalletReport.median(mc);
    body = `<div class="tiles mini wr-tiles">${tiles.map(([l, v, sub]) => `<div class="tile"><label>${l}</label><div class="big">${esc(String(v))}</div><div class="muted small">${esc(sub)}</div></div>`).join('')}</div>
      ${medMc != null ? `<p class="muted small">Median market cap at entry: ${usd(medMc)} (${mc.length} tokens DexScreener knows).</p>` : ''}
      ${wrGatesHtml(gates, s)}
      <div class="wr-verdict">${verdict}</div>
      <div class="row gap wrap"><button type="button" class="btn mini${following ? '' : ' primary'}" id="wrCopyBtn" ${following ? 'disabled' : ''}>${following ? 'Paper-copying this wallet' : 'Paper-copy this wallet'}</button>
      <span class="muted small">Adds it to Paper trades → Copy a wallet: real results with your delay, after a few days.</span></div>
      <p class="muted small">From GMGN's latest ${s.tokens} tokens for this wallet (${Math.round(s.spanHours)} hours). A busy wallet's history is short. Costs use your round-trip cost from Fee drag (${s.costPct}%). Data: GMGN, DexScreener; verdict: Claude.</p>`;
  }
  el.innerHTML = `<form id="wrForm" class="row gap wrap"><input id="wrWallet" placeholder="Solana wallet or GMGN wallet link" spellcheck="false" autocomplete="off" autocapitalize="off" value="${esc(wrState.wallet || '')}" /><button class="btn primary" type="submit" ${wrState.busy ? 'disabled' : ''}>Analyze</button></form>${body}`;
  const sum = $('#walletReportSummary');
  const rule = gates && gates.verdict && gates.verdict.level !== 'none' ? gates.verdict.label : '';
  if (sum) sum.textContent = [rule, ai && ai.label ? `${ai.label} · ${ai.style}` : ''].filter(Boolean).join(' · ');
}

// The four gates with the one fact that decided each, the verdict naming its cause, the record and who this is.
function wrGatesHtml(g, s) {
  if (!g) return '';
  if (g.loading) return '<div class="wr-gates"><div class="row between wrap"><b>Copy gates</b></div><p class="muted small">Reading the wallet\'s 7-day, 30-day and all-time record from GMGN…</p></div>';
  const v = g.verdict;
  const cls = v.level === 'good' ? 'pos' : v.level === 'bad' ? 'neg' : v.level === 'warn' ? 'warn-text' : 'muted';
  const mark = { pass: ['✓', 'pos', 'pass'], fail: ['✗', 'neg', 'fail'], none: ['○', 'muted', 'not measured'] };
  const cap = WalletGates.sizeCap(s);
  const notes = [WalletGates.recordLine(g.rec), WalletGates.identityLine(g.rec), cap != null ? `Size cap ${cap < 1000 ? '$' + cap : '$' + (cap / 1000).toFixed(1) + 'k'} (half its average buy)` : ''].filter(Boolean);
  return `<div class="wr-gates"><div class="row between wrap"><b>Copy gates</b><span class="flow-label ${cls}">${esc(v.label)}</span></div>
    <p class="small wr-gate-verdict"><b>${esc(v.text)}</b></p>
    ${g.error ? `<p class="muted small">GMGN wallet stats not read: ${esc(g.error)}.</p>` : ''}
    <ul class="wr-gate-list small">${g.list.map((x) => { const m = mark[x.state] || mark.none; return `<li><span class="wr-gate ${m[1]}" title="${m[2]}">${m[0]}</span> <b>${esc(x.label)}</b> · ${esc(x.why)}</li>`; }).join('')}</ul>
    ${notes.length ? `<p class="muted small">${esc(notes.join(' · '))}.</p>` : ''}
    <p class="muted small">Rules over GMGN's wallet stats (7 and 30 days) and all-time profits, after GMGN's wallet-analysis skill. Not measured is never a pass. Open positions riding to zero are not checked (that needs GMGN holdings and a signing key).</p></div>`;
}

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'wrForm') return;
  e.preventDefault();
  runWalletReport($('#wrWallet').value);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#wrCopyBtn') || !wrState.wallet || typeof paperState === 'undefined') return;
  if (!paperState.wallets.some((w) => w.address === wrState.wallet)) {
    // the Paper tab's defaults (docs/features/paper-account.md): $100 a trade, same entry as the wallet, mirror its sells
    paperState.wallets.push({ address: wrState.wallet, chain: 'sol', label: (wrState.wallet.slice(0, 4) + '…' + wrState.wallet.slice(-4)), since: Date.now(), sizing: { mode: 'fixed', value: 100, max: 500 }, entry: 'wallet', exits: 'mirror' });
    paperSave(); renderPaper(); paperTick();
  }
  renderWalletReport();
});
renderWalletReport();
