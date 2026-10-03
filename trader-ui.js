/* global Trader, Follow, followState, FOLLOW_MAX, refreshFollowFeed, renderFollow, store, state, fomoGet, parseFomoTrade, lookupConfig, FOMO_BASE, unwrap, listIn, $, esc, usd, pct, dur */
'use strict';
// Find a trader (Dashboard): handle, fomo.family link or profile screenshot -> win rate + trading style + Follow.

const findState = { busy: false, handle: '' };

const findStatus = (html) => { $('#findStatus').innerHTML = html; };
const fomoReady = () => { const cfg = lookupConfig(); return !!(cfg && cfg.key && cfg.url.startsWith(FOMO_BASE)); };

async function findTrader(raw) {
  const handle = Follow.normHandle(raw);
  if (!handle) return findStatus('That doesn\'t look like a FOMO handle.');
  if (!fomoReady()) return findStatus('Add your FOMO API (fomoapi.io) key in Settings to look up traders.');
  if (findState.busy) return;
  findState.busy = true;
  findState.handle = handle;
  $('#findInput').value = '@' + handle;
  findStatus(`Looking up @${esc(handle)}…`);
  $('#findResult').innerHTML = '';
  try {
    const [profileJ, tradesJ] = await Promise.all([
      fomoGet('', {}, handle),
      fomoGet('/trades', { limit: 100 }, handle).catch((e) => ({ error: e })),
    ]);
    const profile = unwrap(profileJ) || {};
    const body = tradesJ && !tradesJ.error ? unwrap(tradesJ) : null;
    const trades = body ? listIn(body, 'trades', 'positions', 'items', 'data', 'results').map(parseFomoTrade).filter((t) => !t.fill) : [];
    renderFound(handle, profile, trades, { tradesError: tradesJ && tradesJ.error, stale: !!(body && body.stale) });
    findStatus('');
  } catch (e) {
    findStatus(`<span class="neg">${e.status === 404 ? `No FOMO user called @${esc(handle)}.` : esc(e.message)}</span>`);
  } finally {
    findState.busy = false;
  }
}

function followButton(handle) {
  const on = followState.list.includes(handle);
  return `<button type="button" class="btn ${on ? '' : 'primary'} mini" data-find-follow="${esc(handle)}" ${on ? 'disabled' : ''}>${on ? 'Following' : 'Follow'}</button>`;
}

function renderFound(handle, profile, trades, info) {
  const p = Trader.profileSummary(profile);
  const st = Trader.style(profile, trades);
  const meta = [p.name && p.name.toLowerCase() !== handle ? esc(p.name) : '', p.followers != null ? `${p.followers.toLocaleString()} followers` : ''].filter(Boolean).join(' · ');
  const perDay = st.tradesPerDay == null ? '' : st.tradesPerDay >= 10 ? Math.round(st.tradesPerDay) : st.tradesPerDay.toFixed(1);
  const traits = st.enough ? [
    ['Hold style', st.hold, st.medianHoldSec != null ? `median hold ${dur(st.medianHoldSec * 1000)}` : ''],
    ['Activity', st.activity, perDay !== '' ? `${perDay} trades a day` : ''],
    ['Win profile', st.winProfile, `avg win +${pct(st.avgWinPct, 0)} · avg loss -${pct(st.avgLossPct, 0)}`],
    ['Size and chain', st.avgSize != null ? usd(st.avgSize) : '–', st.chainLabel ? `avg position · ${esc(st.chainLabel)}` : 'avg position'],
  ] : [];
  const notes = [];
  if (p.isPrivate) notes.push('This profile is private, so FOMO may hide some of its trades.');
  if (info.tradesError) notes.push(`Couldn't load their trades: ${esc(info.tradesError.message)}`);
  else if (!trades.length) notes.push('FOMO returned no trades for this trader.');
  else notes.push(`Based on their latest ${st.closed} closed trade${st.closed === 1 ? '' : 's'} from FOMO, not their full history.`);
  if (info.stale) notes.push('FOMO data may be delayed.');
  $('#findResult').innerHTML = `
    <div class="row between find-head"><span><b>@${esc(handle)}</b>${meta ? ` <span class="muted small">${meta}</span>` : ''}</span><span id="findFollow">${followButton(handle)}</span></div>
    <div class="find-win"><span class="find-win-num ${st.winRate == null ? '' : st.winRate >= 0.5 ? 'pos' : 'neg'}">${st.winRate == null ? '–' : pct(st.winRate, 0)}</span>
      <span class="muted">win rate${st.closed ? ` · ${st.wins}W / ${st.losses}L` : ''}</span></div>
    ${st.enough
      ? `<div class="find-style">${esc(st.summary)}</div>
         <div class="find-traits">${traits.map(([l, v, sub]) => `<div class="find-trait"><label>${l}</label><b>${esc(v)}</b><span class="muted small">${sub}</span></div>`).join('')}</div>`
      : (trades.length ? `<p class="muted small">Not enough closed trades for a style read (need ${Trader.MIN_CLOSED}).</p>` : '')}
    <p class="muted small">${notes.join(' ')}</p>`;
}

// ---- screenshot -> handle (Claude reads the image with your Anthropic key) ----
function shrinkImage(file, maxEdge = 1568) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file isn\'t an image this browser can read.')); };
    img.src = url;
  });
}

async function handleFromScreenshot(file) {
  const key = state.settings.anthropicKey;
  if (!key) return findStatus('Reading a screenshot needs an Anthropic API key. Add one in Settings, or type the handle instead.');
  findStatus('Reading the screenshot…');
  try {
    const data = await shrinkImage(file);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
      body: JSON.stringify({
        model: 'claude-opus-5-5', max_tokens: 200, fallbacks: 'default', output_config: { effort: 'low' },
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
          { type: 'text', text: 'This is a screenshot from the FOMO (fomo.family) trading app. Find the profile username (the @handle). Reply with ONLY a JSON object: {"handle": "<username without @>"}, or {"handle": null} if no profile username is visible.' },
        ] }],
      }),
    });
    if (r.status === 401) throw new Error('Anthropic rejected the API key.');
    if (!r.ok) throw new Error(`Anthropic HTTP ${r.status}`);
    const j = await r.json();
    if (j.stop_reason === 'refusal') throw new Error('Claude declined to read this image.');
    const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const handle = Trader.handleFromReply(text);
    if (!handle) return findStatus('No FOMO username found in that screenshot. Try a screenshot of the profile page, or type the handle.');
    findTrader(handle);
  } catch (e) {
    findStatus(`<span class="neg">${esc(e.message)}</span>`);
  }
}

$('#findForm').addEventListener('submit', (e) => { e.preventDefault(); findTrader($('#findInput').value); });
$('#findShot').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) handleFromScreenshot(f); });
$('#findCard').addEventListener('click', (e) => {
  const f = e.target.closest('[data-find-follow]');
  if (f) {
    const h = f.dataset.findFollow;
    if (followState.list.includes(h)) return;
    if (followState.list.length >= FOLLOW_MAX) return findStatus(`You can follow up to ${FOLLOW_MAX} traders. Unfollow someone in Following first.`);
    followState.list.push(h);
    store.set('follows', followState.list);
    $('#findFollow').innerHTML = followButton(h);
    renderFollow();
    refreshFollowFeed();
  }
});
