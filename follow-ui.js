/* global Follow, FomoBudget, store, fomoGet, parseFomoTrade, lookupConfig, FOMO_BASE, unwrap, listIn, showTab, runCheck, $, esc, usd, cls, fmtDT */
'use strict';
// Followed traders panel (Dashboard). Pulls each followed handle's recent trades from fomoapi.io and shows one feed.

const FOLLOW_MS = FomoBudget.FOLLOW_MS; // fomoapi.io bills per call: refresh at most every 10 minutes
const FOLLOW_MAX = 10;         // cap on followed handles, to stay inside the API rate limit
const followState = { list: store.get('follows', []), feed: store.get('followFeed', null), busy: false };

const followReady = () => { const cfg = lookupConfig(); return !!(cfg && cfg.key && cfg.url.startsWith(FOMO_BASE)); };
const followPnl = (n) => (n > 0 ? '+' : n < 0 ? '-' : '') + usd(Math.abs(n));

async function fetchFollowed(handle) {
  let j;
  try { j = await fomoGet('/trades', { limit: 100 }, handle); }
  catch (e) { if (e.status !== 404) throw e; j = await fomoGet('/positions', { limit: 100 }, handle); }
  const body = unwrap(j);
  const rows = listIn(body, 'trades', 'positions', 'items', 'data', 'results');
  return { events: Follow.toEvents(handle, rows.map(parseFomoTrade)), stale: !!(body && body.stale) };
}

async function refreshFollowFeed() {
  if (followState.busy || !followState.list.length || !followReady()) return renderFollow();
  followState.busy = true;
  renderFollow();
  const lists = [], errors = {}, stale = [];
  // One handle at a time: gentler on the rate limit than firing them all at once.
  for (const h of followState.list) {
    try { const r = await fetchFollowed(h); lists.push(r.events); if (r.stale) stale.push(h); }
    catch (e) { errors[h] = e.status === 404 ? 'not found on FOMO' : e.message; }
  }
  followState.feed = { at: Date.now(), events: Follow.mergeFeed(lists), errors, stale };
  store.set('followFeed', followState.feed);
  followState.busy = false;
  renderFollow();
}

function renderFollow() {
  const card = $('#followCard');
  if (!card) return;
  $('#followChips').innerHTML = followState.list.map((h) => `<span class="chip">@${esc(h)}<button type="button" class="icon-btn" data-unfollow="${esc(h)}" title="Unfollow" aria-label="Unfollow ${esc(h)}">✕</button></span>`).join('');
  const f = followState.feed;
  let status = '';
  if (!followReady()) status = 'Add your FOMO API (fomoapi.io) key in Settings to follow traders.';
  else if (!followState.list.length) status = 'Add a FOMO handle to see their buys and sells here.';
  else if (followState.busy) status = 'Loading…';
  else if (f) status = `Updated ${fmtDT(new Date(f.at).toISOString())}`;
  const notes = f ? Object.entries(f.errors || {}).map(([h, m]) => `@${esc(h)}: ${esc(m)}`).concat((f.stale || []).map((h) => `@${esc(h)}: FOMO data may be delayed`)) : [];
  $('#followStatus').innerHTML = esc(status) + (notes.length ? `<br><span class="neg">${notes.join('<br>')}</span>` : '');
  const events = f ? f.events.filter((e) => followState.list.includes(e.handle)) : [];
  $('#followFeed').innerHTML = events.length
    ? events.map((e) => `<div class="recent-item follow-item">
        <span><span class="tag ${e.side}">${e.side === 'buy' ? 'BUY' : 'SELL'}</span> @${esc(e.handle)} <b>${esc(e.token)}</b>
          <span class="muted small">${e.chain ? esc(e.chain) + ' · ' : ''}${fmtDT(e.at)}</span></span>
        <span class="follow-right">${usd(e.usd)}${e.pnl != null ? ` <span class="${cls(e.pnl)}">${followPnl(e.pnl)}</span>` : ''}
          ${e.address ? `<button type="button" class="btn mini" data-follow-ca="${esc(e.address)}">Check</button>` : ''}</span>
      </div>`).join('')
    : (f && followState.list.length && followReady() && !followState.busy ? '<p class="muted small">No recent trades from the traders you follow.</p>' : '');
}

$('#followForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#followInput');
  const h = Follow.normHandle(input.value);
  if (!h) { $('#followStatus').textContent = 'That doesn\'t look like a FOMO handle.'; return; }
  if (followState.list.includes(h)) { input.value = ''; return; }
  if (followState.list.length >= FOLLOW_MAX) { $('#followStatus').textContent = `You can follow up to ${FOLLOW_MAX} traders.`; return; }
  followState.list.push(h);
  store.set('follows', followState.list);
  input.value = '';
  refreshFollowFeed();
});
$('#followRefresh').addEventListener('click', refreshFollowFeed);
$('#followCard').addEventListener('click', (e) => {
  const un = e.target.closest('[data-unfollow]');
  if (un) {
    followState.list = followState.list.filter((h) => h !== un.dataset.unfollow);
    store.set('follows', followState.list);
    return renderFollow();
  }
  const b = e.target.closest('[data-follow-ca]');
  if (b) { showTab('check'); runCheck(b.dataset.followCa); window.scrollTo({ top: 0, behavior: 'smooth' }); }
});

renderFollow();
// Automatic refresh only while the Dashboard is on screen and the feed is older than FOLLOW_MS.
// Adding a handle or tapping Refresh still updates straight away.
function followAutoRefresh() {
  const onDash = $('#dashboard') && $('#dashboard').classList.contains('active');
  if (document.visibilityState === 'visible' && onDash && FomoBudget.due(followState.feed && followState.feed.at, Date.now(), FOLLOW_MS)) refreshFollowFeed();
}
followAutoRefresh();
setInterval(followAutoRefresh, 60000);
