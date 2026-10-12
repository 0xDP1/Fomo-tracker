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

  // track: { [address]: { at, symbol, chain, poster, channels, sources, base, baseAt, last, lastAt, peak, peakAt, alerted } }.
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
      Object.assign(r, { symbol: e.symbol || r.symbol || '', chain: e.chainId || e.chain || r.chain || '', poster: e.firstPoster || r.poster || '', channels: (e.channels || []).slice(), sources: Array.isArray(e.sources) ? e.sources.slice() : (e.channels || []).length ? ['discord'] : [] });
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

  const api = { recentAddresses, update, stats, statsBy, xNow, xPeak, KEEP, WIN_X, ALERT_X };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Recent = api;
})(typeof window !== 'undefined' ? window : globalThis);
