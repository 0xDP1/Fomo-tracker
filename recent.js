// Recent calls: pure helpers, no DOM, no network. Keeps the last 50 calls with the market cap at the call, the latest
// and the peak since, fires an alert the first time a call reaches 2× and 4×, and works out the win rate (a win is a
// call that reached 1.5× its call market cap, the same line the alert bots use for caller medals).
(function (root) {
  'use strict';
  const KEEP = 50;
  const WIN_X = 1.5;
  const ALERT_X = [2, 4];
  const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

  // The newest KEEP queue entries by call time (addresses).
  const recentAddresses = (queue, keep = KEEP) => Object.values(queue || {}).filter((e) => e && e.address).sort((a, b) => (b.firstAt || 0) - (a.firstAt || 0)).slice(0, keep).map((e) => e.address);

  // track: { [address]: { at, symbol, chain, poster, channels, sources, groups, base, baseAt, last, lastAt, peak, peakAt, alerted } }.
  // Starts tracking new calls (the base is the alert's call market cap when there is one, else the first market cap
  // read), adds market caps read now (mcaps: { address: usd }), and drops calls no longer among the last KEEP.
  // Returns the new track and the alerts to show: [{ address, symbol, level, x }], each level once per call.
  function update(track, queue, mcaps, now, keep = KEEP) {
    const keepSet = new Set(recentAddresses(queue, keep));
    const out = {}, alerts = [];
    for (const a of keepSet) {
      const e = queue[a];
      const prev = (track || {})[a];
      const r = prev ? Object.assign({}, prev, { alerted: (prev.alerted || []).slice() }) : { at: e.firstAt || now, base: n(e.callMcap), baseAt: n(e.callMcap) != null ? e.firstAt : null, last: null, lastAt: null, peak: null, peakAt: null, alerted: [] };
      Object.assign(r, { symbol: e.symbol || r.symbol || '', chain: e.chainId || e.chain || r.chain || '', poster: e.firstPoster || r.poster || '', channels: (e.channels || []).slice(), sources: Array.isArray(e.sources) ? e.sources.slice() : (e.channels || []).length ? ['discord'] : [] }, Array.isArray(e.groups) ? { groups: e.groups.slice() } : {});
      const m = n((mcaps || {})[a]);
      if (m != null && m > 0) {
        if (r.base == null) { r.base = m; r.baseAt = now; }
        r.last = m; r.lastAt = now;
        if (r.peak == null || m > r.peak) { r.peak = m; r.peakAt = now; }
        const x = m / r.base;
        for (const lv of ALERT_X) if (x >= lv && !r.alerted.includes(lv)) { r.alerted.push(lv); alerts.push({ address: a, symbol: r.symbol, level: lv, x }); }
      }
      out[a] = r;
    }
    // Only the highest new level per call (a jump straight to 4× is one alert, not two).
    const top = new Map();
    for (const al of alerts) if (!top.has(al.address) || top.get(al.address).level < al.level) top.set(al.address, al);
    return { track: out, alerts: [...top.values()] };
  }

  // ---- Candle highs (GeckoTerminal): the true peak, including pumps between reads or while the app was closed ----
  const CANDLES_PER_TICK = 10;              // GeckoTerminal's free API allows about 30 requests a minute
  const CANDLES_EVERY = 10 * 60000;

  // GeckoTerminal ohlcv_list rows [time s, open, high, low, close, volume] -> the highest high from sinceSec on.
  // A 5-minute candle that started up to 5 minutes before the call is counted (the call is inside it).
  function highSince(list, sinceSec) {
    let hi = null;
    for (const c of list || []) {
      const t = n(c && c[0]), h = n(c && c[2]);
      if (t == null || h == null || t < sinceSec - 300) continue;
      if (hi == null || h > hi) hi = h;
    }
    return hi;
  }
  // A call with no market cap of its own takes the first read as its base. When that read came over LATE_MS after the
  // call (the app was closed), the base is the close of the candle the call is in instead (bug 11: a dump after the call
  // otherwise read as a pump). With no candle at the call, only highs after the late read count.
  // -> { high, base } as prices; base is null when the base stays as it is.
  const LATE_MS = 5 * 60000;
  const lateBase = (r) => r.baseFrom !== 'candles' && r.baseAt != null && r.at != null && r.baseAt - r.at > LATE_MS;
  function readCandles(list, r) {
    const callSec = Math.floor(r.at / 1000);
    let base = null;
    if (lateBase(r)) {
      let at = null;
      for (const c of list || []) {
        const t = n(c && c[0]), close = n(c && c[4]);
        if (t == null || close == null || !(close > 0) || t > callSec || t < callSec - 300) continue;
        if (at == null || t > at) { at = t; base = close; }
      }
    }
    const high = highSince(list, lateBase(r) && base == null ? Math.floor(r.baseAt / 1000) : callSec);
    return { high, base };
  }
  // A price -> market cap with the supply implied by today's market cap and price.
  const mcapAtPrice = (price, { mcap, price: now }) => (n(price) > 0 && n(mcap) > 0 && n(now) > 0 ? Math.round(price * mcap / now) : null);

  // highs: { address: market cap at the candle high, or { high, base } as market caps from readCandles }. A base
  // replaces a late one. Raises the peak when a high is above it; alerts for levels not yet alerted are marked away
  // (reached between reads or while the app was closed). One alert per call, the highest.
  function addHighs(track, highs, now) {
    const out = Object.assign({}, track), alerts = [];
    for (const [a, v] of Object.entries(highs || {})) {
      const obj = v && typeof v === 'object';
      let prev = out[a];
      const h = n(obj ? v.high : v), base = obj ? n(v.base) : null;
      if (!prev || !prev.base) continue;
      if (base > 0) prev = out[a] = Object.assign({}, prev, { base, baseAt: prev.at, baseFrom: 'candles' });
      if (h == null || !(h > 0)) continue;
      if (prev.peak != null && h <= prev.peak) continue;
      const r = Object.assign({}, prev, { peak: h, peakAt: now, peakFrom: 'candles', alerted: (prev.alerted || []).slice() });
      const x = h / r.base;
      let top = null;
      for (const lv of ALERT_X) if (x >= lv && !r.alerted.includes(lv)) { r.alerted.push(lv); top = lv; }
      if (top) alerts.push({ address: a, symbol: r.symbol, level: top, x, away: true });
      out[a] = r;
    }
    return { track: out, alerts };
  }

  // The calls whose candles are due: priced, newest call first, not read in the last CANDLES_EVERY.
  const candlesDue = (track, now, max = CANDLES_PER_TICK) => Object.entries(track || {})
    .filter(([, r]) => r.base && (!r.candlesAt || now - r.candlesAt >= CANDLES_EVERY))
    .sort((x, y) => (y[1].at || 0) - (x[1].at || 0)).slice(0, max).map(([a]) => a);
  const markCandles = (track, addrs, now) => { const out = Object.assign({}, track); for (const a of addrs) if (out[a]) out[a] = Object.assign({}, out[a], { candlesAt: now }); return out; };

  const xNow = (r) => (r && r.base && r.last != null ? r.last / r.base : null);
  const xPeak = (r) => (r && r.base && r.peak != null ? r.peak / r.base : null);

  // { n (calls with a price), won (peak ≥ 1.5×), winRate, hit2, best: { symbol, x }, medianPeak } over the calls given.
  function stats(records) {
    const priced = (records || []).filter((r) => xPeak(r) != null);
    if (!priced.length) return { n: 0, won: 0, winRate: null, hit2: 0, best: null, medianPeak: null };
    const peaks = priced.map(xPeak).sort((a, b) => a - b);
    const mid = peaks.length % 2 ? peaks[(peaks.length - 1) / 2] : (peaks[peaks.length / 2 - 1] + peaks[peaks.length / 2]) / 2;
    const best = priced.reduce((b, r) => (xPeak(r) > xPeak(b) ? r : b));
    const won = priced.filter((r) => xPeak(r) >= WIN_X).length;
    return { n: priced.length, won, winRate: won / priced.length, hit2: priced.filter((r) => xPeak(r) >= 2).length, best: { symbol: best.symbol, x: xPeak(best) }, medianPeak: mid };
  }

  // Stats per group: key(record) -> one or more group names. Groups with fewer than min calls are left out.
  function statsBy(records, key, min = 3) {
    const by = new Map();
    for (const r of records || []) for (const g of [].concat(key(r) || [])) { if (!g) continue; if (!by.has(g)) by.set(g, []); by.get(g).push(r); }
    return [...by.entries()].map(([group, list]) => Object.assign({ group }, stats(list))).filter((s) => s.n >= min).sort((a, b) => b.winRate - a.winRate || b.n - a.n);
  }

  // Sort and filter for the list (docs/features/recent-sort.md). by: new | now | peak; dir: desc | asc;
  // min: null (any), a gain as a fraction (0.5 = +50%) or 'losers'. The filter uses gain now when sorting by newest.
  function view(records, { by = 'new', dir = 'desc', min = null } = {}) {
    const measure = by === 'peak' ? xPeak : xNow;
    let list = (records || []).slice();
    if (min === 'losers') list = list.filter((r) => { const x = measure(r); return x != null && x < 1; });
    else if (typeof min === 'number') list = list.filter((r) => { const x = measure(r); return x != null && x - 1 >= min - 1e-9; });
    const sign = dir === 'asc' ? 1 : -1;
    if (by === 'new') return list.sort((a, b) => sign * ((a.at || 0) - (b.at || 0)));
    return list.sort((a, b) => {
      const xa = measure(a), xb = measure(b);
      if (xa == null || xb == null) return Number(xa == null) - Number(xb == null);
      return sign * (xa - xb) || (b.at || 0) - (a.at || 0);
    });
  }

  const api = { recentAddresses, view, update, stats, statsBy, xNow, xPeak, highSince, readCandles, mcapAtPrice, addHighs, candlesDue, markCandles, KEEP, WIN_X, ALERT_X, CANDLES_PER_TICK, CANDLES_EVERY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Recent = api;
})(typeof window !== 'undefined' ? window : globalThis);
