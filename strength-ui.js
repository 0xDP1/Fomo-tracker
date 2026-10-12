/* global Strength, Gmgn, Stats, gmgnAvailable, gmgnGet, fetchPrices, checkState, renderCheck, state, esc */
'use strict';
// Coin strength on the Check tab: a Strength 0-100 next to the rug score, from liquidity, volume, holder spread and the
// total fees traders paid (GMGN's total fees, or the app's own 24h estimate after "Sample fees"). One GMGN read per check.

const strengthState = { ca: null, gmgnFees: null, gmgnRead: false, solUsd: null, solAsked: false };

// GMGN's coin info for its total fees (cached and shared like the other GMGN reads).
async function autoStrength() {
  const ca = checkState.ca, dex = checkState.dex;
  Object.assign(strengthState, { ca, gmgnFees: null, gmgnRead: false });
  const chain = dex && Gmgn.toGmgnChain(dex.chainId);
  if (!chain || !gmgnAvailable()) return;
  try {
    const info = await gmgnGet('token/info', { chain, address: ca });
    if (checkState.ca !== ca) return;
    Object.assign(strengthState, { gmgnFees: Strength.gmgnTotalFees(info), gmgnRead: true });
  } catch { return; } // the other GMGN blocks say why GMGN is not answering
  renderCheck();
}

function strengthNow() {
  const { dex, facts } = checkState;
  if (!dex || !facts) return null;
  const s = checkState.feeSample;
  const sampleSol24h = s && !s.loading && !s.error ? s.est24h : null;
  // The SOL price turns the own fee estimate into dollars: from the wallet sync, or asked for once.
  const solUsd = strengthState.solUsd || (state.wallet && state.wallet.solPrice) || null;
  if (sampleSol24h != null && !solUsd && !strengthState.solAsked && typeof fetchPrices === 'function') {
    strengthState.solAsked = true;
    fetchPrices([Stats.SOL_MINT]).then((p) => { strengthState.solUsd = p[Stats.SOL_MINT] || null; if (strengthState.solUsd) renderCheck(); }).catch(() => {});
  }
  const fee = Strength.feeInput({ gmgnFeesUsd: strengthState.ca === checkState.ca ? strengthState.gmgnFees : null, ageHours: facts.ageHours, vol24h: dex.vol24h, sampleSol24h, solUsd });
  return Strength.strength(Object.assign({ liq: dex.liq, mcap: dex.mcap, vol24h: dex.vol24h, vol1h: dex.vol1h, topHolderPct: facts.topHolderPct, top10Pct: facts.top10Pct, holderCount: facts.holders }, fee));
}

const STRENGTH_PARTS = [['liquidity', 'Liquidity'], ['volume', 'Volume'], ['holders', 'Holders'], ['fees', 'Total fees']];

function strengthBlock() {
  const r = strengthNow();
  if (!r) return '';
  const cls = r.score == null ? 'muted' : r.score >= 70 ? 'pos' : r.score >= 40 ? 'warn-text' : 'neg';
  const feesHint = r.parts.fees.pts == null ? (checkState.dex.chainId === 'solana' ? ' Total fees: GMGN didn\'t give them for this coin yet; "Sample fees" below gives the app\'s own estimate.' : ' Total fees: not available for this coin.') : '';
  return `<div class="strength-card">
    <div class="row between wrap"><span><b>Strength</b> <span class="muted small">how healthy the market is, not whether it's a trap</span></span><span class="strength-score ${cls}">${r.score == null ? '–' : `${r.score}/100 · ${r.label}`}</span></div>
    <ul class="strength-parts small">${STRENGTH_PARTS.map(([k, name]) => { const p = r.parts[k]; return `<li><span class="sp-name">${name}</span> <b>${p.pts == null ? '–' : `${p.pts}/${p.max}`}</b> <span class="muted">${esc(p.detail)}</span></li>`; }).join('')}</ul>
    <p class="muted small">${r.score == null ? 'Not enough data read to score yet.' : `Out of the ${r.read} part${r.read === 1 ? '' : 's'} that could be read; missing parts don't count as good.`}${feesHint} First-guess thresholds.</p>
  </div>`;
}
