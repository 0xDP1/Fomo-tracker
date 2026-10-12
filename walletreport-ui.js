/* global WalletReport, gmgnAvailable, gmgnGet, dexPairs, feeCostPct, paperState, paperSave, renderPaper, paperTick, state, esc, $ */
'use strict';
// Wallet report (Calls tab): paste a wallet, see its trading pace, holds, win rate and returns from GMGN, the costs a
// copier would pay, and Claude's style and copy verdict. "Paper-copy this wallet" hands it to Paper trades.

const WR_MODEL = 'claude-sonnet-5-5';
const wrState = { busy: false, wallet: null, s: null, pairs: null, mcaps: null, ai: null, error: '' };

async function wrAsk(s, pairs, mcaps) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': state.settings.anthropicKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    body: JSON.stringify({ model: WR_MODEL, max_tokens: 2000, fallbacks: 'default', system: WalletReport.SYSTEM, output_config: { effort: 'medium', format: { type: 'json_schema', schema: WalletReport.SCHEMA } }, messages: [{ role: 'user', content: WalletReport.prompt(wrState.wallet, s, pairs, mcaps) }] }),
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
  Object.assign(wrState, { wallet, s: null, pairs: null, mcaps: null, ai: null, error: '' });
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
    Object.assign(wrState, { pairs, mcaps, s: st });
    renderWalletReport();
    if (!st.closed) wrState.ai = { error: 'No closed trades in GMGN\'s recent activity, so there is nothing to judge yet.' };
    else if (!state.settings.anthropicKey) wrState.ai = { error: 'Add an Anthropic API key in Settings for the style and copy verdict.' };
    else {
      wrState.ai = { loading: true }; renderWalletReport();
      try { wrState.ai = await wrAsk(st, pairs, mcaps); } catch (e) { wrState.ai = { error: e.message }; }
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
  const { s, ai } = wrState;
  const usd = (v) => (v == null ? '–' : `${v < 0 ? '−' : ''}$${Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(1) + 'k' : Math.round(Math.abs(v))}`);
  const following = wrState.wallet && typeof paperState !== 'undefined' && paperState.wallets.some((w) => w.address === wrState.wallet);
  let body = '';
  if (wrState.error) body = `<p class="neg small">${esc(wrState.error)}</p>`;
  else if (wrState.busy && !s) body = '<p class="muted small">Reading the wallet\'s recent buys and sells from GMGN…</p>';
  else if (s && !s.tokens) body = '<p class="muted small">GMGN shows no recent buys for this wallet.</p>';
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
      <div class="wr-verdict">${verdict}</div>
      <div class="row gap wrap"><button type="button" class="btn mini${following ? '' : ' primary'}" id="wrCopyBtn" ${following ? 'disabled' : ''}>${following ? 'Paper-copying this wallet' : 'Paper-copy this wallet'}</button>
      <span class="muted small">Adds it to Paper trades → Copy a wallet: real results with your delay, after a few days.</span></div>
      <p class="muted small">From GMGN's latest ${s.tokens} tokens for this wallet (${Math.round(s.spanHours)} hours). A busy wallet's history is short. Costs use your round-trip cost from Fee drag (${s.costPct}%). Data: GMGN, DexScreener; verdict: Claude.</p>`;
  }
  el.innerHTML = `<form id="wrForm" class="row gap wrap"><input id="wrWallet" placeholder="Solana wallet or GMGN wallet link" spellcheck="false" autocomplete="off" autocapitalize="off" value="${esc(wrState.wallet || '')}" /><button class="btn primary" type="submit" ${wrState.busy ? 'disabled' : ''}>Analyze</button></form>${body}`;
  const sum = $('#walletReportSummary');
  if (sum) sum.textContent = ai && ai.label ? `${ai.label} · ${ai.style}` : '';
}

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'wrForm') return;
  e.preventDefault();
  runWalletReport($('#wrWallet').value);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#wrCopyBtn') || !wrState.wallet || typeof paperState === 'undefined') return;
  if (!paperState.wallets.some((w) => w.address === wrState.wallet)) {
    paperState.wallets.push({ address: wrState.wallet, chain: 'sol', label: (wrState.wallet.slice(0, 4) + '…' + wrState.wallet.slice(-4)), since: Date.now() });
    paperSave(); renderPaper(); paperTick();
  }
  renderWalletReport();
});
renderWalletReport();
