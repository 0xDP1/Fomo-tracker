/* global Flow, Check, state, checkState, renderCheck, fetchDex, $, esc */
/* global renderMarket */
'use strict';
// Flow check UI: a coin's last hour of swaps via Helius. Automatic block on Solana token checks,
// on-demand reads for Movers and open positions in Market pulse.

const FLOW_PAGES = 5;        // 100 transactions per page
const FLOW_FRESH_N = 8;      // biggest buyers checked for fresh wallets
const flowCache = {};        // address -> { loading } | { error } | { label, s, fresh, at }

const heliusTx = async (addr, before) => {
  const u = `https://api.helius.xyz/v0/addresses/${encodeURIComponent(addr)}/transactions?api-key=${encodeURIComponent(state.settings.heliusKey)}&limit=100${before ? '&before=' + encodeURIComponent(before) : ''}`;
  let r;
  try { r = await fetch(u); } catch { throw new Error('Helius request was blocked (network or CORS)'); }
  if (r.status === 401 || r.status === 403) throw new Error('Helius rejected the key');
  if (r.status === 429) throw new Error('Helius rate limit hit, try again in a minute');
  if (!r.ok) throw new Error('Helius HTTP ' + r.status);
  const j = await r.json();
  return Array.isArray(j) ? j : [];
};

async function readFlow(mint, priceUsd) {
  const nowSec = Math.floor(Date.now() / 1000);
  let trades = [], before = '', pages = 0, oldest = nowSec;
  while (pages < FLOW_PAGES) {
    const txs = await heliusTx(mint, before);
    pages++;
    if (!txs.length) break;
    for (const t of txs) { const c = Flow.classify(t, mint); if (c) trades.push(c); }
    oldest = Math.min(oldest, ...txs.map((t) => t.timestamp || nowSec));
    before = txs[txs.length - 1].signature;
    if (nowSec - oldest > 3600 || txs.length < 100) break;
  }
  const exhausted = pages >= FLOW_PAGES && nowSec - oldest <= 3600;
  const s = Flow.summarize(trades, nowSec, Number(priceUsd) || 0, { exhausted });
  const buyers = Flow.topBuyers(trades, nowSec, FLOW_FRESH_N);
  const fresh = { checked: 0, fresh: 0 };
  for (const b of buyers) {
    try { const h = await heliusTx(b); fresh.checked++; if (Flow.isFresh(h)) fresh.fresh++; } catch { /* skip */ }
  }
  return { label: Flow.label(s), s, fresh, at: Date.now() };
}

const flowMoney = (v) => (v == null ? '–' : Check.fmtMcap(v));
const flowLabelCls = (label) => (label === 'Real demand' ? 'pos' : label === 'One wallet is the volume' ? 'neg' : 'muted');

// ---- Check tab block ----
async function autoFlow() {
  const ca = checkState.ca, dex = checkState.dex;
  if (!dex || dex.chainId !== 'solana' || !state.settings.heliusKey) return;
  checkState.flow = { loading: true };
  renderCheck();
  try {
    const f = await readFlow(ca, dex.priceUsd);
    if (checkState.ca !== ca) return; // the user moved on to another coin
    checkState.flow = f;
    if (f.s.trades60 >= Flow.ONE_WALLET.minTrades) { checkState.facts.flowTopShare = f.s.top.share; checkState.risk = Check.assessRisk(checkState.facts); }
  } catch (e) {
    if (checkState.ca !== ca) return;
    checkState.flow = { error: e.message };
  }
  renderCheck();
}

function flowBlock() {
  const dex = checkState.dex;
  if (!dex) return '';
  const head = '<div class="flow-block"><div class="row between wrap"><b>Flow, last hour (Helius)</b>';
  if (dex.chainId !== 'solana') return head + '</div><p class="muted small">Not available on this chain: Helius reads Solana only.</p></div>';
  if (!state.settings.heliusKey) return head + '</div><p class="muted small">Add a Helius API key (Settings → Advanced) to see who is really buying.</p></div>';
  const f = checkState.flow;
  if (!f || f.loading) return head + '</div><p class="muted small">Reading the last hour of swaps…</p></div>';
  if (f.error) return head + `<button type="button" class="btn mini" id="flowBtn">Retry</button></div><p class="neg small">${esc(f.error)}</p></div>`;
  const s = f.s, w = s.w60;
  const row = (name, x) => `<tr><td>${name}</td><td class="num">${flowMoney(x.buyUsd)}</td><td class="num">${flowMoney(x.sellUsd)}</td><td class="num">${x.buyers}</td><td class="num">${x.sellers}</td></tr>`;
  return head + `<span class="row gap"><span class="flow-label ${flowLabelCls(f.label)}">${esc(f.label)}</span><button type="button" class="btn mini" id="flowBtn">Refresh</button></span></div>
    <p class="small">${w.buyers} buyers vs ${w.sellers} sellers in the hour · top wallet ${Math.round(s.top.share * 100)}% of volume${f.fresh.checked ? ` · fresh wallets among the ${f.fresh.checked} biggest buyers: ${f.fresh.fresh}` : ''}</p>
    <div class="table-wrap"><table class="flow-table"><thead><tr><th>Last</th><th class="num">Bought</th><th class="num">Sold</th><th class="num">Buyers</th><th class="num">Sellers</th></tr></thead><tbody>
      ${row('5 min', s.w5)}${row('30 min', s.w30)}${row('60 min', w)}</tbody></table></div>
    <p class="muted small">${s.complete ? '' : `Busy coin: covers only the last ${s.coveredMin} minutes. `}Values use the current price, so they are approximate.</p></div>`;
}

// ---- Market pulse: Movers and open positions, on demand ----
function flowInline(address) {
  const f = flowCache[address];
  if (!f) return `<button type="button" class="btn mini" data-flow-ca="${esc(address)}">Flow</button>`;
  if (f.loading) return '<span class="muted small">Reading…</span>';
  if (f.error) return `<span class="neg small" title="${esc(f.error)}">Flow failed</span>`;
  return `<span class="flow-label small ${flowLabelCls(f.label)}" title="${f.s.w60.buyers} buyers / ${f.s.w60.sellers} sellers · top wallet ${Math.round(f.s.top.share * 100)}%">${esc(f.label)}</span>`;
}

async function flowFor(address) {
  if (!state.settings.heliusKey) { flowCache[address] = { error: 'Add a Helius API key (Settings → Advanced)' }; return rerenderMarket(); }
  flowCache[address] = { loading: true };
  rerenderMarket();
  try {
    const dex = await fetchDex(address);
    if (dex.chainId !== 'solana') throw new Error('Helius reads Solana only');
    flowCache[address] = await readFlow(address, dex.priceUsd);
  } catch (e) { flowCache[address] = { error: e.message }; }
  rerenderMarket();
}
const rerenderMarket = () => { if (typeof renderMarket === 'function') renderMarket(); };

document.addEventListener('click', (e) => {
  if (e.target.closest('#flowBtn')) { autoFlow(); return; }
  const b = e.target.closest('[data-flow-ca]');
  if (b) flowFor(b.dataset.flowCa);
});
