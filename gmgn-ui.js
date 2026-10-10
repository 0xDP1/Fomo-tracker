/* global Gmgn, Check, state, checkState, renderCheck, esc */
'use strict';
// GMGN data through the Discord feed Worker (which keeps the GMGN API key as a secret): an Early traders block on the
// Check tab, and gmgnGet() for the Dev dossier. Needs the Discord feed URL and key in Settings; silent without them.

const GMGN_UI_TTL = 5 * 60000;
const gmgnState = { off: false, cache: {} };

const gmgnAvailable = () => !!(state.settings.feedUrl && state.settings.feedKey) && !gmgnState.off;

async function gmgnGet(endpoint, params) {
  const qs = new URLSearchParams(params).toString();
  const key = endpoint + '?' + qs;
  const c = gmgnState.cache[key];
  if (c && Date.now() - c.at < GMGN_UI_TTL) return c.data;
  let r;
  try { r = await fetch(state.settings.feedUrl.replace(/\/+$/, '') + '/gmgn/' + endpoint + '?' + qs, { headers: { 'x-feed-key': state.settings.feedKey }, cache: 'no-store' }); } catch { throw new Error('can\'t reach the Worker'); }
  const j = await r.json().catch(() => ({}));
  // No GMGN key on the Worker (or an older Worker without /gmgn): stop asking for this visit.
  if ((r.status === 503 && j.error === 'not_configured') || r.status === 404) { gmgnState.off = true; throw new Error('not_configured'); }
  if (r.status === 429) throw new Error('GMGN rate limit hit, try again in a minute');
  if (r.status === 401) throw new Error('the Worker rejected the feed key');
  if (!r.ok) throw new Error('GMGN: ' + (j.error || 'HTTP ' + r.status));
  gmgnState.cache[key] = { at: Date.now(), data: j.data };
  return j.data;
}

async function autoEarly() {
  const ca = checkState.ca, dex = checkState.dex;
  const chain = dex && Gmgn.toGmgnChain(dex.chainId);
  if (!chain || !gmgnAvailable()) return;
  checkState.early = { loading: true };
  renderCheck();
  try {
    const d = await gmgnGet('market/token_top_traders', { chain, address: ca, limit: '100', order_by: 'profit' });
    if (checkState.ca !== ca) return; // the user moved on to another coin
    const s = Gmgn.earlyTraders((d && d.list) || []);
    checkState.early = { s };
    if (s) { Object.assign(checkState.facts, { gmEarlySold: s.soldHalf, gmEarlyN: s.n }); checkState.risk = Check.assessRisk(checkState.facts); }
  } catch (e) {
    if (checkState.ca !== ca) return;
    checkState.early = e.message === 'not_configured' ? null : { error: e.message };
  }
  renderCheck();
}

function earlyBlock() {
  const e = checkState.early;
  if (!e || !checkState.dex) return '';
  const head = '<div class="flow-block early-block"><div class="row between wrap"><b>Early traders (GMGN)</b>';
  if (e.loading) return head + '</div><p class="muted small">Asking GMGN who got in first…</p></div>';
  if (e.error) return head + `<button type="button" class="btn mini" id="earlyBtn">Retry</button></div><p class="neg small">${esc(e.error)}</p></div>`;
  const s = e.s;
  if (!s) return head + '</div><p class="muted small">GMGN has no trader history for this coin yet.</p></div>';
  const usdK = (v) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`);
  const bad = s.n >= 5 && s.soldHalf / s.n >= 0.8;
  return head + `<span class="flow-label ${bad ? 'neg' : s.soldHalf / s.n >= 0.5 ? 'warn-text' : 'pos'}">${s.soldHalf} of ${s.n} sold</span></div>
    <p class="small">Of the first ${s.n} wallets in, <b>${s.soldHalf}</b> have sold half or more (${s.exited} fully out), taking ${usdK(s.realized)} in profit. Together they still hold ${s.heldPct.toFixed(1)}% of supply.</p>
    <div class="table-wrap"><table class="early-table"><thead><tr><th>Wallet</th><th class="num">In</th><th class="num">Sold</th><th class="num">Profit taken</th><th class="num hide-m">Holds</th></tr></thead><tbody>
      ${s.rows.slice(0, 10).map((r) => `<tr><td><code>${esc(r.address.slice(0, 4) + '…' + r.address.slice(-4))}</code>${r.tags.length ? ' <span class="muted small">' + esc(r.tags.slice(0, 2).join(', ')) + '</span>' : ''}</td><td class="num">${new Date(r.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td><td class="num ${r.soldPct >= 0.99 ? 'neg' : r.soldPct >= 0.5 ? 'warn-text' : ''}">${Math.round(r.soldPct * 100)}%</td><td class="num">${usdK(r.realized)}</td><td class="num hide-m">${r.heldPct.toFixed(2)}%</td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted small">The earliest wallets among GMGN's top 100 traders by profit. If most of them have sold, buying now means buying what they are selling. Data: GMGN.</p></div>`;
}

document.addEventListener('click', (e) => { if (e.target.closest('#earlyBtn')) { gmgnState.cache = {}; autoEarly(); } });
