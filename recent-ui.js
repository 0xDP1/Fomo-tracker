/* global getJson, Recent, Calls, Check, callState, callerOf, CALL_H, CALL_AGES, dexPairs, renderCalls, runCheck, store, ago, esc, $ */
'use strict';
// Recent calls (Calls tab): the last 50 calls always listed whatever the filters, with the market cap at the call, now
// and the peak since; an alert when one first reaches 2× and 4× (banner, vibration, phone notification if allowed);
// and the win rate of those calls (reached 1.5×) overall, per group or channel and per source.
// Prices are read every minute while the app is open, 50 coins in two DexScreener requests.

const RECENT_TICK_MS = 60000;
// Candle highs since each call (GeckoTerminal, free): the true peak, including pumps while the app was closed.
const RECENT_GECKO = 'https://api.geckoterminal.com/api/v2/networks/';
const RECENT_GECKO_NET = { solana: 'solana', base: 'base', bsc: 'bsc', ethereum: 'eth' };
const recentState = { track: store.get('callTrack', {}), alerts: [], busy: false };

async function recentTick() {
  if (recentState.busy) return;
  recentState.busy = true;
  try {
    const now = Date.now();
    const addrs = Recent.recentAddresses(callState.queue).filter((a) => !callState.queue[a].noPool);
    const pairs = addrs.length ? await dexPairs(addrs) : {};
    const mcaps = {};
    for (const a of addrs) { const p = pairs[a]; if (p) mcaps[a] = p.marketCap || p.fdv || null; }
    const r = Recent.update(recentState.track, callState.queue, mcaps, now);
    let track = r.track;
    const alerts = r.alerts.slice();
    // Up to 10 calls a minute, each at most every 10 minutes: the highest candle since the call.
    const due = Recent.candlesDue(track, now).filter((a) => pairs[a] && pairs[a].pairAddress && RECENT_GECKO_NET[pairs[a].chainId]);
    const highs = {};
    for (const a of due) {
      const p = pairs[a];
      try {
        const j = await getJson(`${RECENT_GECKO}${RECENT_GECKO_NET[p.chainId]}/pools/${p.pairAddress}/ohlcv/minute?aggregate=5&limit=1000&currency=usd`, { timeout: 15000 });
        const hi = Recent.highSince(j && j.data && j.data.attributes && j.data.attributes.ohlcv_list, Math.floor(track[a].at / 1000));
        const m = Recent.mcapAtPrice(hi, { mcap: p.marketCap || p.fdv, price: Number(p.priceUsd) });
        if (m) highs[a] = m;
      } catch { /* no candles this time: the reads still count */ }
    }
    track = Recent.markCandles(track, due, now);
    const h = Recent.addHighs(track, highs, now);
    recentState.track = h.track;
    store.set('callTrack', recentState.track);
    // One alert per call: a read alert wins over an "away" one for the same call.
    for (const al of alerts.concat(h.alerts.filter((x) => !alerts.some((y) => y.address === x.address)))) showCallAlert(al);
    if (typeof renderCalls === 'function') renderCalls();
  } finally {
    recentState.busy = false;
  }
}

function showCallAlert(al) {
  const xs = al.x >= 10 ? Math.round(al.x) : al.x.toFixed(1);
  const text = al.away ? `${al.symbol || al.address.slice(0, 6)} reached ${al.level}× since the call while you were away (${xs}×)` : `${al.symbol || al.address.slice(0, 6)} is up ${al.level}× since the call (${xs}×)`;
  recentState.alerts = recentState.alerts.concat({ address: al.address, text, at: Date.now() }).slice(-3);
  renderCallAlert();
  try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch { /* not supported */ }
  try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('Call alert', { body: text, tag: 'call-' + al.address + '-' + al.level }); } catch { /* not supported here (iPhone needs the app open) */ }
}

function renderCallAlert() {
  let el = $('#callAlert');
  if (!el) { el = document.createElement('div'); el.id = 'callAlert'; el.className = 'call-alert'; document.body.appendChild(el); }
  const live = recentState.alerts.filter((a) => Date.now() - a.at < 60000);
  el.hidden = !live.length;
  el.innerHTML = live.map((a) => `<div class="call-alert-row"><span>🚀 ${esc(a.text)}</span><span class="row gap"><button type="button" class="btn mini" data-alert-check="${esc(a.address)}">Check</button><button type="button" class="btn mini" data-alert-close="${esc(a.address)}">✕</button></span></div>`).join('');
}
setInterval(() => { if (recentState.alerts.length) renderCallAlert(); }, 10000);

// Why a recent call is not in the queue list right now (empty when it is shown).
function callHiddenReason(e, now) {
  if (!e.dexAt) return 'not looked up yet';
  if (e.noPool) return 'no trading pool found';
  if (!Calls.isFresh(e, now, callState.maxAgeH * CALL_H)) return `launched over ${(CALL_AGES.find(([, h]) => h === callState.maxAgeH) || [callState.maxAgeH + 'h'])[0]} ago`;
  if (callState.channel && !(e.channels || []).includes(callState.channel)) return 'other channel chip selected';
  if (callState.source && !Calls.sourcesOf(e).includes(callState.source)) return 'other source chip selected';
  if (callState.calledWithin && now - (e.firstAt || 0) > callState.calledWithin * 60000) return `called over ${callState.calledWithin} min ago`;
  if (callState.callerFilter) return 'caller filter';
  if (e.liq != null && e.liq < callState.minLiq) return `liquidity under $${callState.minLiq.toLocaleString('en-US')}`;
  if (callState.maxBundle < 100 && e.bundle && e.bundle.bundledPct != null && e.bundle.bundledPct > callState.maxBundle) return `over ${callState.maxBundle}% bundled`;
  if (callState.minWin > 0) { const w = (callerOf(e.firstPoster) || {}).winRate; if (w == null || w < callState.minWin) return 'caller win % filter'; }
  if (callState.view !== 'all' && Calls.callScore(e, callerOf(e.firstPoster), now).score < callState.minScore) return `score under ${callState.minScore} (Best view)`;
  return '';
}

const recentRecords = () => Recent.recentAddresses(callState.queue).map((a) => Object.assign({ address: a }, recentState.track[a])).filter((r) => r.at);
const pctX = (x) => (x == null ? '–' : `${x >= 1 ? '+' : ''}${Math.round((x - 1) * 100)}%`);
const SOURCE_LABEL = { telegram: 'Telegram', discord: 'Discord' };

// The stat line at the top of the queue.
function recentStatsHtml() {
  const recs = recentRecords();
  const s = Recent.stats(recs);
  if (!s.n) return recs.length ? '<p class="muted small calls-stats">Last calls: win rate shows once their prices have been read (every minute while the app is open).</p>' : '';
  const groups = Recent.statsBy(recs, (r) => r.channels).slice(0, 4).map((g) => `${esc(g.group)} ${Math.round(g.winRate * 100)}% <span class="muted">(${g.n})</span>`);
  const sources = Recent.statsBy(recs, (r) => (r.sources || []).map((x) => SOURCE_LABEL[x])).map((g) => `${g.group} ${Math.round(g.winRate * 100)}% <span class="muted">(${g.n})</span>`);
  return `<div class="calls-stats small"><b>Last ${recs.length} calls: ${Math.round(s.winRate * 100)}% won</b> <span class="muted">(reached ${Recent.WIN_X}×, of ${s.n} priced)</span> · ${s.hit2} hit 2× · best ${pctX(s.best.x)}${s.best.symbol ? ` (${esc(s.best.symbol)})` : ''} · median peak ${pctX(s.medianPeak)}
    ${groups.length ? `<br>By group: ${groups.join(' · ')}` : ''}${sources.length > 1 ? `<br>By source: ${sources.join(' · ')}` : ''}</div>`;
}

// The Recent calls section: newest first, whatever the filters.
function recentListHtml() {
  const now = Date.now();
  const recs = recentRecords();
  if (!recs.length) return '';
  const usdK = (v) => (v == null ? '–' : Check.fmtMcap(v));
  const notif = typeof Notification === 'undefined' ? '' : Notification.permission === 'granted' ? '<span class="muted small">Phone alerts on.</span>' : Notification.permission === 'denied' ? '<span class="muted small">Phone alerts blocked in this browser\'s settings.</span>' : '<button type="button" class="btn mini" id="callAlertsOn">Turn on phone alerts</button>';
  return `<details class="adv calls-sec" data-sec="recent" ${callState.open.recent === false ? '' : 'open'}><summary>Recent calls (last ${recs.length})</summary>
    <p class="muted small">Every call, newest first, whatever your filters. Alerts at 2× and 4× from the market cap at the call while the app is open. ${notif}</p>
    ${recs.map((r) => {
      const e = callState.queue[r.address] || {};
      const xn = Recent.xNow(r), xp = Recent.xPeak(r);
      const why = callHiddenReason(e, now);
      return `<div class="recent-item recent-call"><span><b>${esc(r.symbol || r.address.slice(0, 6))}</b> <span class="muted small">called ${ago(r.at)} ago${(r.channels || []).length ? ' in ' + r.channels.map(esc).join(', ') : ''}${r.poster ? ' · ' + esc(r.poster) : ''}</span><br>
        <span class="small">${usdK(r.base)} → ${usdK(r.last)} <b class="${xn == null ? '' : xn >= 1 ? 'pos' : 'neg'}">${pctX(xn)}</b> · peak ${xp == null ? '–' : xp.toFixed(1) + '×'}</span>${why ? ` <span class="tag">hidden: ${esc(why)}</span>` : ''}</span>
        <button type="button" class="btn mini" data-call-ca="${esc(r.address)}">Check</button></div>`;
    }).join('')}
    <p class="muted small">Prices are read every minute while the app is open; the peak also comes from GeckoTerminal's 5-minute candles since the call (10 coins a minute, each every 10 minutes), so pumps while the app was closed count. A win is reaching ${Recent.WIN_X}× the market cap at the call.</p></details>`;
}

document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-alert-check]');
  if (c) { runCheck(c.dataset.alertCheck); return; }
  const x = e.target.closest('[data-alert-close]');
  if (x) { recentState.alerts = recentState.alerts.filter((a) => a.address !== x.dataset.alertClose); renderCallAlert(); return; }
  if (e.target.closest('#callAlertsOn') && typeof Notification !== 'undefined') Notification.requestPermission().then(() => renderCalls());
});

setTimeout(recentTick, 5000);
setInterval(() => { if (document.visibilityState === 'visible') recentTick(); }, RECENT_TICK_MS);
