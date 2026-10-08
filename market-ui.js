/* global Market, Check, store, getJson, fetchDex, openPositions, runCheck, $, esc, fmtDT */
'use strict';
// Market pulse card (top of the Check tab): meme volume over 5m / 30m / 1h, mood, movers, and pace on your positions.

const GECKO = 'https://api.geckoterminal.com/api/v2/networks/';
const MARKET_NETS = ['solana', 'base', 'bsc'];
const MARKET_MS = 2 * 60000;
const marketState = { busy: false, data: null, history: store.get('marketHistory', []) };

const money = (v) => (v == null ? '–' : Check.fmtMcap(v));
const paceText = (p) => (p == null ? '' : p.toFixed(1) + '× the hour\'s pace');
const MOOD_ICON = { 'Heating up': '▲', Steady: '●', Cooling: '▼' };
const MOOD_CLS = { 'Heating up': 'pos', Steady: '', Cooling: 'neg' };

async function fetchMarketPools() {
  const urls = MARKET_NETS.flatMap((net) => [
    [net, `${GECKO}${net}/trending_pools?include=base_token&page=1`],
    [net, `${GECKO}${net}/pools?sort=h24_volume_usd_desc&include=base_token&page=1`],
  ]);
  const res = await Promise.allSettled(urls.map(([, u]) => getJson(u)));
  const pools = res.flatMap((r, i) => (r.status === 'fulfilled' ? Market.fromGecko(r.value, urls[i][0]) : []));
  if (res.some((r) => r.status === 'fulfilled')) return { pools, source: 'GeckoTerminal', failed: res.filter((r) => r.status === 'rejected').length };
  // Fallback: DexScreener's most boosted tokens on the same chains (no 30-minute window).
  const boosts = await getJson('https://api.dexscreener.com/token-boosts/top/v1');
  const want = { solana: 1, base: 1, bsc: 1 };
  const addrs = [...new Set((Array.isArray(boosts) ? boosts : []).filter((b) => want[b.chainId]).map((b) => b.tokenAddress))].slice(0, 30);
  if (!addrs.length) throw new Error('no market data');
  const j = await getJson('https://api.dexscreener.com/latest/dex/tokens/' + addrs.join(','));
  return { pools: Market.fromDex(j), source: 'DexScreener', failed: 0 };
}

async function refreshMarket() {
  if (marketState.busy) return;
  marketState.busy = true;
  renderMarket();
  try {
    const { pools, source, failed } = await fetchMarketPools();
    const t = Market.totals(pools);
    const mv = Market.movers(pools);
    const positions = typeof openPositions === 'function' ? openPositions().slice(0, 8) : [];
    const pos = await Promise.all(positions.map((p) => fetchDex(p.address).then((d) => Object.assign({ token: p.token || d.symbol, address: p.address }, Market.positionPace(d))).catch(() => null)));
    marketState.data = { at: Date.now(), totals: t, movers: mv, positions: pos.filter(Boolean), source, failed };
    if (t.vol.h1 > 0) {
      marketState.history = Market.pushReading(marketState.history, { h1: t.vol.h1, m5: t.vol.m5, m30: t.vol.m30, mood: t.mood }, Date.now());
      store.set('marketHistory', marketState.history);
    }
  } catch (e) {
    marketState.data = Object.assign({}, marketState.data, { error: e.message === 'blocked' ? 'Market data was blocked (network or CORS).' : 'Market data unavailable: ' + e.message, at: Date.now() });
  } finally {
    marketState.busy = false;
    renderMarket();
  }
}

// Single-series trend of the last hour's meme volume across your readings. Hover a point for its value.
function marketSpark(history) {
  if (history.length < 2) return '<p class="muted small">The trend line appears after a few readings (one every 2 minutes while the app is open).</p>';
  const W = 300, Hh = 48, pad = 4;
  const xs = history.map((r) => r.t), ys = history.map((r) => r.h1);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const X = (t) => pad + ((t - x0) / Math.max(1, x1 - x0)) * (W - 2 * pad);
  const Y = (v) => Hh - pad - ((v - y0) / Math.max(1, y1 - y0)) * (Hh - 2 * pad);
  const pts = history.map((r) => `${X(r.t).toFixed(1)},${Y(r.h1).toFixed(1)}`).join(' ');
  const last = history[history.length - 1];
  const step = (W - 2 * pad) / Math.max(1, history.length - 1);
  const hits = history.map((r) => `<rect x="${(X(r.t) - step / 2).toFixed(1)}" y="0" width="${Math.max(6, step).toFixed(1)}" height="${Hh}" fill="transparent"><title>${esc(fmtDT(new Date(r.t).toISOString()))}: ${esc(money(r.h1))} in the hour${r.mood ? ' · ' + esc(r.mood) : ''}</title></rect>`).join('');
  return `<div class="spark-wrap"><svg class="spark" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" role="img" aria-label="Meme volume in the last hour, across your readings">
      <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      <circle cx="${X(last.t).toFixed(1)}" cy="${Y(last.h1).toFixed(1)}" r="4" fill="var(--accent)" stroke="var(--panel)" stroke-width="2"/>${hits}</svg>
    <div class="muted small spark-cap"><span>${esc(fmtDT(new Date(x0).toISOString()))}</span><span>low ${esc(money(y0))} · high ${esc(money(y1))}</span><span>now</span></div></div>`;
}

function renderMarket() {
  const card = $('#marketCard');
  if (!card) return;
  const d = marketState.data;
  const t = d && d.totals;
  const head = `<div class="row between wrap"><h3>Market pulse</h3><span class="row gap">${t && t.mood ? `<span class="mood ${MOOD_CLS[t.mood]}">${MOOD_ICON[t.mood]} ${esc(t.mood)}</span>` : ''}<button type="button" class="btn mini" id="marketRefresh" ${marketState.busy ? 'disabled' : ''}>${marketState.busy ? 'Loading…' : 'Refresh'}</button></span></div>`;
  if (!t) { card.innerHTML = head + `<p class="muted small">${d && d.error ? `<span class="neg">${esc(d.error)}</span>` : 'Loading meme market volume…'}</p>`; return; }
  const chains = Object.entries(t.byChain).sort((a, b) => b[1].h1 - a[1].h1).map(([c, v]) => `${esc(c)} ${money(v.h1)}`).join(' · ');
  const tiles = [
    ['Last 5 min', money(t.vol.m5), paceText(t.pace5)],
    ['Last 30 min', t.vol.m30 == null ? '–' : money(t.vol.m30), t.vol.m30 == null ? 'not available from DexScreener' : paceText(t.pace30)],
    ['Last hour', money(t.vol.h1), `${t.count} meme pool${t.count === 1 ? '' : 's'}`],
    ['Buyers, 5 min', t.buyShare == null ? '–' : Math.round(t.buyShare * 100) + '%', `${t.buys5.toLocaleString()} buys / ${t.sells5.toLocaleString()} sells`],
  ];
  const moverRows = d.movers.length ? d.movers.map((p) => `<div class="recent-item mover">
      <span><b>${esc(p.symbol)}</b> <span class="tag">${esc(p.chain)}</span>
        <span class="muted small">mcap ${money(p.mcap)} · 5m ${money(p.vol.m5)} · 1h ${money(p.vol.h1)} · ${p.buys5}B / ${p.sells5}S${p.chg5 != null ? ` · ${p.chg5 > 0 ? '+' : ''}${p.chg5.toFixed(1)}% 5m` : ''}</span></span>
      <span class="mover-right"><b>${p.pace.toFixed(1)}×</b>${p.address && p.chain === 'Solana' && typeof flowInline === 'function' ? flowInline(p.address) : ''}${p.address ? `<button type="button" class="btn mini" data-market-ca="${esc(p.address)}">Check</button>` : ''}</span></div>`).join('')
    : '<p class="muted small">No coins are spiking right now (5-minute pace 3× with buyers ahead, $20k+ liquidity, $50k+ hourly volume).</p>';
  const posRows = d.positions.length ? `<h4 class="sub-head">Your open positions</h4>${d.positions.map((p) => `<div class="recent-item"><span><b>${esc(p.token)}</b> <span class="muted small">${p.pace == null ? 'no volume in the last hour' : paceText(p.pace)}</span></span><span class="mover-right"><span class="${p.label === 'Waking up' ? 'pos' : p.label === 'Quiet' ? 'muted' : ''}">${esc(p.label || '–')}</span>${typeof flowInline === 'function' ? flowInline(p.address) : ''}</span></div>`).join('')}` : '';
  card.innerHTML = head + `
    <div class="tiles mini market-tiles">${tiles.map(([l, v, s]) => `<div class="tile"><label>${l}</label><div class="big">${v}</div><div class="muted small">${esc(s)}</div></div>`).join('')}</div>
    <p class="muted small">Last hour by chain: ${chains}</p>
    <h4 class="sub-head">Meme volume, last hour, across your readings</h4>
    ${marketSpark(marketState.history)}
    <h4 class="sub-head">Movers</h4>${moverRows}
    ${posRows}
    <p class="muted small">Volume spikes show attention, not direction; many are the top. Run Check before acting. Source: ${esc(d.source)}${d.failed ? ` (${d.failed} of 6 requests failed)` : ''}, updated ${esc(fmtDT(new Date(d.at).toISOString()))}.${d.error ? ` <span class="neg">${esc(d.error)}</span>` : ''}</p>`;
}

$('#marketCard').addEventListener('click', (e) => {
  if (e.target.closest('#marketRefresh')) return refreshMarket();
  const b = e.target.closest('[data-market-ca]');
  if (b) { runCheck(b.dataset.marketCa); setTimeout(() => window.scrollTo({ top: $('#checkForm').offsetTop - 70, behavior: 'smooth' }), 50); }
});
renderMarket();
refreshMarket();
setInterval(() => { if (document.visibilityState === 'visible') refreshMarket(); }, MARKET_MS);
