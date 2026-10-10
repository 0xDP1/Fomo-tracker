/* global Gmgn, Check, state, store, checkState, renderCheck, esc, $ */
'use strict';
// GMGN data through the Discord feed Worker (which keeps the GMGN API key as a secret): an Early traders block on the
// Check tab, and gmgnGet() for the Dev dossier. Uses the Worker when the feed is set up, and the GMGN key in Settings
// (stored only on this device) when the Worker is refused or not set up. Silent without either.

const GMGN_UI_TTL = 5 * 60000;
const GMGN_DIRECT = 'https://openapi.gmgn.ai/v1/';
const GMGN_ENDPOINTS = ['token/info', 'token/security', 'market/token_top_holders', 'market/token_top_traders', 'user/created_tokens']; // read-only, never trading
const gmgnState = { off: false, cache: {}, workerDownUntil: 0, directPausedUntil: 0 };

const gmgnViaWorker = () => !!(state.settings.feedUrl && state.settings.feedKey) && !gmgnState.off && Date.now() >= gmgnState.workerDownUntil;
const gmgnViaPhone = () => !!state.settings.gmgnKey;
const gmgnAvailable = () => gmgnViaWorker() || gmgnViaPhone();

class GmgnUnavailable extends Error {}

async function gmgnFromWorker(endpoint, qs) {
  let r;
  try { r = await fetch(state.settings.feedUrl.replace(/\/+$/, '') + '/gmgn/' + endpoint + '?' + qs, { headers: { 'x-feed-key': state.settings.feedKey }, cache: 'no-store' }); } catch { throw new GmgnUnavailable('can\'t reach the Worker'); }
  const j = await r.json().catch(() => ({}));
  // No GMGN key on the Worker (or an older Worker without /gmgn): stop asking it for this visit.
  if ((r.status === 503 && j.error === 'not_configured') || r.status === 404) { gmgnState.off = true; throw new GmgnUnavailable('not_configured'); }
  // GMGN bans Cloudflare's shared addresses when others overload it: skip the Worker for 10 minutes.
  if (r.status === 429) { gmgnState.workerDownUntil = Date.now() + 10 * 60000; throw new GmgnUnavailable('GMGN is refusing the Worker' + (j.detail ? ': ' + j.detail : '') + ', try again later'); }
  if (r.status === 401) throw new Error('the Worker rejected the feed key');
  if (!r.ok) throw new Error('GMGN: ' + (j.error || 'HTTP ' + r.status));
  return j.data;
}

// Straight from this device with the key in Settings (stored only here). GMGN allows browser calls.
async function gmgnFromPhone(endpoint, params) {
  if (Date.now() < gmgnState.directPausedUntil) throw new Error('GMGN rate limit hit, try again in a minute');
  const q = new URLSearchParams(Object.assign({}, params, { timestamp: String(Math.floor(Date.now() / 1000)), client_id: crypto.randomUUID() }));
  let r;
  try { r = await fetch(GMGN_DIRECT + endpoint + '?' + q, { headers: { 'X-APIKEY': state.settings.gmgnKey }, cache: 'no-store' }); } catch { throw new Error('GMGN did not answer (network)'); }
  const j = await r.json().catch(() => null);
  if (r.status === 429) { gmgnState.directPausedUntil = Date.now() + 60000; throw new Error('GMGN rate limit hit, try again in a minute'); }
  if (r.status === 401 || r.status === 403) throw new Error('GMGN refused the key. On mobile data this can be IPv6, which GMGN does not support: try Wi-Fi');
  if (!r.ok || !j || (j.code !== undefined && j.code !== 0)) throw new Error('GMGN: ' + ((j && (j.message || j.msg)) || 'HTTP ' + r.status));
  return j.data !== undefined ? j.data : j;
}

// The Worker first (the key stays off the phone); the phone's own key if the Worker can't get an answer.
async function gmgnGet(endpoint, params) {
  if (!GMGN_ENDPOINTS.includes(endpoint)) throw new Error('not a GMGN read endpoint');
  const qs = new URLSearchParams(params).toString();
  const key = endpoint + '?' + qs;
  const c = gmgnState.cache[key];
  if (c && Date.now() - c.at < GMGN_UI_TTL) return c.data;
  let data, lastErr = null;
  if (gmgnViaWorker()) {
    try { data = await gmgnFromWorker(endpoint, qs); } catch (e) { if (!(e instanceof GmgnUnavailable) || !gmgnViaPhone()) throw e; lastErr = e; }
  }
  if (data === undefined) {
    if (!gmgnViaPhone()) throw lastErr || new Error('not_configured');
    data = await gmgnFromPhone(endpoint, params);
  }
  gmgnState.cache[key] = { at: Date.now(), data };
  return data;
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

// ---- Price chart (GMGN embed, no key) ----
// Its own card outside the Check tab's re-render, so the chart is not reloaded every time the coin card refreshes.
const chartState = { open: store.get('chartOpen', false), iv: store.get('chartIv', '1') };

function renderChart() {
  const card = $('#chartCard');
  if (!card) return;
  const dex = checkState.dex, ca = checkState.ca;
  const url = dex && Gmgn.chartUrl(dex.chainId, ca, chartState.iv);
  if (!url) { card.hidden = true; card.innerHTML = ''; card.dataset.key = ''; return; }
  card.hidden = false;
  const key = `${url}|${chartState.open}`;
  if (card.dataset.key === key) return; // same coin, interval and state: leave the chart alone
  card.dataset.key = key;
  const page = Gmgn.gmgnPage(dex.chainId, ca);
  card.innerHTML = `<details class="chart-sec" ${chartState.open ? 'open' : ''}><summary><b>Chart</b> <span class="muted small">GMGN · loads when opened</span></summary>
    ${chartState.open ? `<div class="row gap wrap chart-ivs">${Gmgn.CHART_INTERVALS.map(([v, l]) => `<button type="button" class="btn mini ${v === chartState.iv ? 'primary' : ''}" data-chart-iv="${v}">${l}</button>`).join('')}</div>
    <iframe class="chart-frame" src="${esc(url)}" title="Price chart" loading="lazy" referrerpolicy="no-referrer" allow="fullscreen"></iframe>` : ''}
    <p class="muted small">${page ? `Chart not loading? <a href="${esc(page)}" target="_blank" rel="noopener">Open on GMGN ↗</a>` : ''}</p></details>`;
}

document.addEventListener('toggle', (e) => {
  if (!(e.target instanceof HTMLDetailsElement) || !e.target.classList.contains('chart-sec')) return;
  if (chartState.open === e.target.open) return;
  chartState.open = e.target.open; store.set('chartOpen', chartState.open); renderChart();
}, true);
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-chart-iv]');
  if (b) { chartState.iv = b.dataset.chartIv; store.set('chartIv', chartState.iv); renderChart(); }
});
