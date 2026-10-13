/* global fomoLink, Market, Check, store, getJson, fetchDex, openPositions, runCheck, $, esc, fmtDT */
/* global flowInline */
'use strict';
// Market pulse card (Dashboard, under the wallet): meme volume over 5m / 30m / 1h, mood, movers, and pace on your positions.

const GECKO = 'https://api.geckoterminal.com/api/v2/networks/';
const MARKET_NETS = ['solana', 'base', 'bsc'];
const MARKET_MS = 2 * 60000;
const marketState = { busy: false, data: null, history: store.get('marketHistory', []), trench: store.get('trench', null) };
// tehcscreener's daily trench index and top launchpads (docs/features/trench-index.md): free, no key, open CORS.
const TEHC_API = 'https://tehcscreener.com/api/v1/';
const TEHC_MS = 3 * 3600e3;
const TEHC_BAND_CLS = { ded: 'neg', cold: 'neg', active: '', hot: 'pos', euphoric: 'pos' };

async function refreshTrench(force) {
  const old = marketState.trench;
  if (!force && old && Date.now() - (old.at || 0) < TEHC_MS) return;
  try {
    const [t, p, c, b] = await Promise.allSettled(['trench', 'launchpads?window=1d', 'chains', 'bots?window=1d'].map((x) => getJson(TEHC_API + x, { timeout: 15000 })));
    const index = t.status === 'fulfilled' ? Market.trench(t.value) : null;
    if (!index) return; // the site didn't answer: keep what we had, try again next refresh
    const ok = (r) => (r.status === 'fulfilled' ? r.value : null);
    const keep = (k) => (old && old[k]) || null;
    marketState.trench = {
      at: Date.now(), index,
      pads: ok(p) ? Market.topPads(ok(p)) : keep('pads') || [], padsTracked: ok(p) ? Market.padsTracked(ok(p)) : keep('padsTracked'),
      chain: (ok(c) && Market.hottestChain(ok(c))) || keep('chain'), terminal: (ok(b) && Market.terminals(ok(b))) || keep('terminal'),
    };
    store.set('trench', marketState.trench);
  } catch { /* optional */ } finally { renderMarket(); }
}
// The trench index line for the AI prompts, or null.
const trenchContext = () => (marketState.trench ? Market.trenchLine(marketState.trench.index) : null);

// tehcscreener's look: a half-circle gauge with five bands, the score and band, "hottest" boxes and a year chart.
const TEHC_BANDS = [['ded', 0], ['cold', 20], ['active', 40], ['hot', 60], ['euphoric', 80]];
const TEHC_GREYS = ['#2b2b2b', '#454545', '#6b6b6b', '#a9a9a5', '#f2f2ee'];
function trenchGauge(score) {
  const cx = 100, cy = 100, r = 78;
  const pt = (deg) => [cx + r * Math.cos((deg - 180) * Math.PI / 180), cy + r * Math.sin((deg - 180) * Math.PI / 180)];
  const segs = TEHC_GREYS.map((g, i) => {
    const [x1, y1] = pt(i * 36 + 1.2), [x2, y2] = pt((i + 1) * 36 - 1.2);
    return `<path class="gauge-seg" d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${g}" stroke-width="16" fill="none"/>`;
  }).join('');
  return `<svg class="trench-gauge" viewBox="0 0 200 112" role="img" aria-label="Trench index ${score} of 100">${segs}
    <g class="trench-needle" transform="rotate(${Market.gaugeAngle(score)} ${cx} ${cy})"><line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - 58}" stroke="#f2f2ee" stroke-width="3" stroke-linecap="round"/></g>
    <circle cx="${cx}" cy="${cy}" r="6" fill="#f2f2ee"/></svg>`;
}
function trenchYear(hs) {
  if (hs.length < 2) return '';
  const W = 320, H = 150, L = 22, R = 62, T = 8, B = 20;
  const X = (i) => L + (i / (hs.length - 1)) * (W - L - R), Y = (v) => T + (1 - v / 100) * (H - T - B);
  const grid = [20, 40, 60, 80].map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#333" stroke-width="1"/>`).join('');
  const labels = TEHC_BANDS.slice().reverse().map(([name, lo]) => `<text class="band-label" x="${W - R + 6}" y="${(Y(lo + 10) + 4).toFixed(1)}">${name}</text>`).join('');
  const axis = [[0, 100], [Y(50), 50], [Y(0), 0]].map(([y, v]) => `<text class="axis-label" x="${L - 4}" y="${(v === 100 ? T + 4 : y + 4).toFixed(1)}" text-anchor="end">${v}</text>`).join('');
  const mon = (d) => { const t = Date.parse(d); return Number.isFinite(t) ? new Date(t).toLocaleString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }).toLowerCase().replace(' ', " '") : d; };
  return `<svg class="trench-year" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trench index, last ${hs.length} days">${grid}${labels}${axis}
    <polyline points="${hs.map((h, i) => `${X(i).toFixed(1)},${Y(h.score).toFixed(1)}`).join(' ')}" fill="none" stroke="#f2f2ee" stroke-width="1.6" stroke-linejoin="round"/>
    <text class="axis-label" x="${L}" y="${H - 4}">${esc(mon(hs[0].day))}</text><text class="axis-label" x="${W - R}" y="${H - 4}" text-anchor="end">${esc(mon(hs[hs.length - 1].day))}</text></svg>`;
}
function trenchHtml() {
  const tr = marketState.trench;
  if (!tr || !tr.index) return '';
  const t = tr.index, p = t.parts || {};
  const pct = (label, v) => (v == null ? '' : `${label} ${Market.ordinal(v)} pct`);
  const parts = [pct('launchpad volume', p.padVolume), pct('new launches', p.launches), pct('bot volume', p.botVolume), pct('bot fees', p.botFees)].filter(Boolean).join(' · ');
  const box = (title, hot, tracked, extra) => (hot ? `<div class="trench-box"><div class="trench-box-title">${esc(title)}</div><div><span class="muted">hottest:</span> ${esc(hot)}</div><div><span class="muted">tracked:</span> ${tracked == null ? '–' : tracked}${extra ? ` · ${esc(extra)}` : ''}</div></div>` : '');
  const top = (tr.pads || [])[0];
  const boxes = [
    box('chain stats', tr.chain && tr.chain.name, tr.chain && tr.chain.tracked),
    box('launchpad war', top && top.name, tr.padsTracked),
    box('trading terminals', tr.terminal && tr.terminal.name, tr.terminal && tr.terminal.tracked, tr.terminal && tr.terminal.fomoRank ? `FOMO #${tr.terminal.fomoRank}` : ''),
  ].join('');
  const pads = (tr.pads || []).length ? `<p class="muted small trench-pads">Top launchpads ${esc(t.day)}: ${tr.pads.map((x) => `<b>${esc(x.name)}</b> <span class="tag">${esc(x.chain)}</span> ${money(x.vol)}`).join(' · ')}</p>` : '';
  return `<div class="trench">
    <div class="trench-head">trench index</div>
    ${trenchGauge(t.score)}
    <div class="trench-score ${TEHC_BAND_CLS[t.band] || ''}">${t.score}</div><div class="trench-band">${esc(t.band || '?')}</div>
    <p class="muted small trench-parts">${esc(t.day)}${parts ? ' · ' + esc(parts) : ''}</p>
    ${boxes ? `<div class="trench-boxes">${boxes}</div>` : ''}
    <div class="trench-box trench-chart"><div class="trench-box-title">trench index, ${t.history.length >= 365 ? 'last year' : `last ${t.history.length} days`}</div>${trenchYear(t.history || [])}</div>
    ${pads}<p class="muted small">Source: <a href="https://tehcscreener.com/" target="_blank" rel="noopener">tehcscreener</a>, once a day; read ${esc(fmtDT(new Date(tr.at).toISOString()))}.</p></div>`;
}

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
  const sum = $('#marketSummary');
  const tr = marketState.trench && marketState.trench.index ? `Trenches ${marketState.trench.index.score}` : '';
  if (sum) sum.textContent = [t && t.mood ? `${MOOD_ICON[t.mood]} ${t.mood}${t.buyShare != null ? ` · ${Math.round(t.buyShare * 100)}% buyers` : ''}${d.movers && d.movers.length ? ` · ${d.movers.length} mover${d.movers.length === 1 ? '' : 's'}` : ''}` : (d && d.error ? 'unavailable' : 'loading…'), tr].filter(Boolean).join(' · ');
  const head = `<div class="row between wrap"><span class="muted small">Meme volume, Solana · Base · BNB</span><span class="row gap">${t && t.mood ? `<span class="mood ${MOOD_CLS[t.mood]}">${MOOD_ICON[t.mood]} ${esc(t.mood)}</span>` : ''}<button type="button" class="btn mini" id="marketRefresh" ${marketState.busy ? 'disabled' : ''}>${marketState.busy ? 'Loading…' : 'Refresh'}</button></span></div>`;
  if (!t) { card.innerHTML = head + `<p class="muted small">${d && d.error ? `<span class="neg">${esc(d.error)}</span>` : 'Loading meme market volume…'}</p>` + trenchHtml(); return; }
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
      <span class="mover-right"><b>${p.pace.toFixed(1)}×</b>${p.address && p.chain === 'Solana' && typeof flowInline === 'function' ? flowInline(p.address) : ''}${p.address ? fomoLink(p.chain, p.address) + `<button type="button" class="btn mini" data-market-ca="${esc(p.address)}">Check</button>` : ''}</span></div>`).join('')
    : '<p class="muted small">No coins are spiking right now (5-minute pace 3× with buyers ahead, $20k+ liquidity, $50k+ hourly volume).</p>';
  const posRows = d.positions.length ? `<h4 class="sub-head">Your open positions</h4>${d.positions.map((p) => `<div class="recent-item"><span><b>${esc(p.token)}</b> <span class="muted small">${p.pace == null ? 'no volume in the last hour' : paceText(p.pace)}</span></span><span class="mover-right"><span class="${p.label === 'Waking up' ? 'pos' : p.label === 'Quiet' ? 'muted' : ''}">${esc(p.label || '–')}</span>${typeof flowInline === 'function' ? flowInline(p.address) : ''}</span></div>`).join('')}` : '';
  card.innerHTML = head + `
    <div class="tiles mini market-tiles">${tiles.map(([l, v, s]) => `<div class="tile"><label>${l}</label><div class="big">${v}</div><div class="muted small">${esc(s)}</div></div>`).join('')}</div>
    <p class="muted small">Last hour by chain: ${chains}</p>
    <h4 class="sub-head">Meme volume, last hour, across your readings</h4>
    ${marketSpark(marketState.history)}
    ${trenchHtml()}
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
refreshTrench();
setInterval(() => { if (document.visibilityState === 'visible') { refreshMarket(); refreshTrench(); } }, MARKET_MS);
