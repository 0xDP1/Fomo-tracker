/* global Trader, Follow, followState, FOLLOW_MAX, refreshFollowFeed, renderFollow, store, state, fomoGet, parseFomoTrade, lookupConfig, FOMO_BASE, unwrap, listIn, $, esc, usd, cls, pct, dur, fmtDT, short */
'use strict';
// Find a trader (Dashboard): handle, fomo.family link or profile screenshot -> wallets per chain + scorecard + Follow.

const findState = { busy: false, handle: '' };

const findStatus = (html) => { $('#findStatus').innerHTML = html; };
const signedUsd = (n) => (n == null ? '–' : `<span class="${cls(n)}">${n > 0 ? '+' : n < 0 ? '-' : ''}${usd(Math.abs(n))}</span>`);
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
  const wallets = Trader.parseWallets(profile);
  const links = Trader.explorerLinks(wallets);
  const sc = Trader.scorecard(profile, trades);
  const meta = [p.name && p.name.toLowerCase() !== handle ? esc(p.name) : '', p.followers != null ? `${p.followers.toLocaleString()} followers` : '', p.ageDays != null ? `${Math.round(p.ageDays)} days on FOMO` : ''].filter(Boolean).join(' · ');
  const byAddr = new Map();
  for (const l of links) { if (!byAddr.has(l.address)) byAddr.set(l.address, []); byAddr.get(l.address).push(l); }
  const walletRows = [...byAddr.entries()].map(([addr, ls]) => `<div class="recent-item find-wallet">
      <span><b>${Trader.isSol(addr) ? 'Solana' : 'EVM'}</b> <span class="muted small mono" title="${esc(addr)}">${esc(short(addr))}</span></span>
      <span class="find-links"><button type="button" class="btn mini" data-copy="${esc(addr)}">Copy</button>${ls.map((l) => `<a class="btn mini" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.chain)}</a>`).join('')}</span>
    </div>`).join('');
  const tiles = [
    ['Win rate', pct(sc.winRate), `${sc.closed} closed in sample`],
    ['Realized PnL', signedUsd(sc.realizedPnl), 'on closed trades in sample'],
    ['Avg size', sc.avgSize != null ? usd(sc.avgSize) : '–', `${sc.closed + sc.open} positions`],
    ['Avg hold', sc.avgHoldSec != null ? dur(sc.avgHoldSec * 1000) : '–', ''],
    ['Total trades', sc.totalTrades != null ? sc.totalTrades.toLocaleString() : '–', p.volumeUsd != null ? usd(p.volumeUsd) + ' volume' : ''],
    ['Last active', sc.lastActive ? fmtDT(sc.lastActive) : '–', `${sc.open} open now`],
  ];
  const notes = [];
  if (p.isPrivate) notes.push('This profile is private, so FOMO may hide some of its trades.');
  if (info.tradesError) notes.push(`Couldn't load their trades: ${esc(info.tradesError.message)}`);
  else if (!trades.length) notes.push('FOMO returned no trades for this trader.');
  else notes.push(`Scorecard covers their latest ${trades.length} positions from FOMO, not their full history.`);
  if (info.stale) notes.push('FOMO data may be delayed.');
  $('#findResult').innerHTML = `
    <div class="row between find-head"><span><b>@${esc(handle)}</b>${meta ? ` <span class="muted small">${meta}</span>` : ''}</span><span id="findFollow">${followButton(handle)}</span></div>
    <h4 class="find-sub">Wallets</h4>
    ${walletRows || '<p class="muted small">FOMO didn\'t return a wallet for this trader.</p>'}
    <h4 class="find-sub">Scorecard</h4>
    <div class="tiles mini find-tiles">${tiles.map(([l, v, sub]) => `<div class="tile"><label>${l}</label><div class="big">${v}</div><div class="muted small">${sub}</div></div>`).join('')}</div>
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
$('#findCard').addEventListener('click', async (e) => {
  const c = e.target.closest('[data-copy]');
  if (c) {
    try { await navigator.clipboard.writeText(c.dataset.copy); c.textContent = 'Copied'; }
    catch { c.textContent = 'Copy failed'; }
    setTimeout(() => { c.textContent = 'Copy'; }, 1500);
    return;
  }
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
