/* global Watchlist, Gmgn, Check, gmgnAvailable, gmgnGet, checkState, renderCheck, store, esc, $ */
'use strict';
// Watchlist wallets (Settings): your own list of wallets, flagged on the Check tab when they are among a coin's GMGN
// top holders or traders, and counted on Call queue rows. Reuses the GMGN requests Check already makes.

const wlState = { list: [], at: 0 };
function wlLoad() {
  const saved = store.get('watchlist', { list: [], at: 0 });
  wlState.list = Array.isArray(saved) ? saved : saved.list || [];
  wlState.at = saved.at || 0;
  const box = $('#watchlistText');
  if (box) box.value = Watchlist.toText(wlState.list);
}
const wlList = () => wlState.list;
const wlVersion = () => wlState.at; // Call queue rows are matched again after the list changes

$('#watchlistSave').onclick = () => {
  const r = Watchlist.parse($('#watchlistText').value);
  wlState.list = r.wallets; wlState.at = Date.now();
  store.set('watchlist', { list: wlState.list, at: wlState.at });
  $('#watchlistText').value = Watchlist.toText(wlState.list);
  $('#watchlistNote').textContent = `${r.wallets.length} wallet${r.wallets.length === 1 ? '' : 's'} saved${r.skipped ? `, ${r.skipped} line${r.skipped === 1 ? '' : 's'} without a wallet address skipped` : ''}.`;
};
wlLoad();

// ---- Check tab ----
async function autoWatchlist() {
  const ca = checkState.ca, dex = checkState.dex;
  if (!wlList().length || !dex) { checkState.watchlist = null; return; }
  const chain = Gmgn.toGmgnChain(dex.chainId);
  if (!chain) { checkState.watchlist = null; return; }
  if (!gmgnAvailable()) { checkState.watchlist = { needsGmgn: true }; renderCheck(); return; }
  checkState.watchlist = { loading: true };
  renderCheck();
  try {
    // The same requests as Early traders, Holder labels and Wallet memory, so these are shared, not extra.
    const [h, t] = await Promise.all([
      gmgnGet('market/token_top_holders', { chain, address: ca, limit: '100' }),
      gmgnGet('market/token_top_traders', { chain, address: ca, limit: '100', order_by: 'profit' }),
    ]);
    if (checkState.ca !== ca) return;
    const m = Watchlist.match(wlList(), (h && h.list) || [], (t && t.list) || []);
    checkState.watchlist = { m };
    const rug = m.filter((x) => x.tag === 'rug');
    Object.assign(checkState.facts, { wlRug: rug.length, wlRugNames: rug.map((x) => x.name || x.address.slice(0, 4) + '…' + x.address.slice(-4)).join(', ') });
    checkState.risk = Check.assessRisk(checkState.facts);
  } catch (e) {
    if (checkState.ca !== ca) return;
    checkState.watchlist = e.message === 'not_configured' ? { needsGmgn: true } : { error: e.message };
  }
  renderCheck();
}

function watchlistBlock() {
  const w = checkState.watchlist;
  if (!w || !checkState.dex) return '';
  const head = '<div class="flow-block watch-block"><div class="row between wrap"><b>Your wallets in this coin</b>';
  if (w.needsGmgn) return head + '</div><p class="muted small">Matching your watchlist needs GMGN: the Discord feed Worker with a GMGN key, or a GMGN API key in Settings → Advanced.</p></div>';
  if (w.loading) return head + '</div><p class="muted small">Looking for your watchlist wallets among the top holders and traders…</p></div>';
  if (w.error) return head + `</div><p class="neg small">${esc(w.error)}</p></div>`;
  const m = w.m;
  if (!m.length) return head + `<span class="flow-label muted">none</span></div><p class="muted small">None of your ${wlList().length} watchlist wallets are among this coin's top 100 holders or top 100 traders.</p></div>`;
  const rug = m.some((x) => x.tag === 'rug');
  const short = (a) => esc(a.slice(0, 4) + '…' + a.slice(-4));
  return head + `<span class="flow-label ${rug ? 'neg' : 'pos'}">${m.length} of yours</span></div>
    <div class="table-wrap"><table class="watch-table"><thead><tr><th>Wallet</th><th>Tag</th><th>Now</th></tr></thead><tbody>
      ${m.map((x) => `<tr><td>${x.name ? `<b>${esc(x.name)}</b> ` : ''}<code>${short(x.address)}</code></td><td class="${x.tag === 'rug' ? 'neg' : ''}">${esc(x.tag || '–')}</td><td class="${x.status === 'sold' ? 'muted' : ''}">${esc(x.status)}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted small">From your watchlist (Settings), among GMGN's top 100 holders and top 100 traders by profit. Data: GMGN.</p></div>`;
}
