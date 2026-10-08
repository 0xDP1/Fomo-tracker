// Coin age at entry: pure helpers (no DOM, no network). How old was each coin when you bought it,
// and how did trades in each age band turn out?
(function (root) {
  'use strict';
  const Stats = typeof module !== 'undefined' && module.exports ? require('./stats.js') : root.Stats;
  const H = 3600000;
  const BANDS = [['Under 1 hour', 0, H], ['1 to 24 hours', H, 24 * H], ['1 to 7 days', 24 * H, 7 * 24 * H], ['Over 7 days', 7 * 24 * H, Infinity]];

  const same = (a, b) => (/^0x/i.test(a || '') ? String(a).toLowerCase() === String(b || '').toLowerCase() : a === b);
  const coinOf = (t) => t.address || t.mint || '';

  // DexScreener /latest/dex/tokens/a,b,c -> the earliest pool creation time for `address` (ms) or null.
  function earliestLaunch(json, address) {
    const ts = ((json && json.pairs) || []).filter((p) => p.baseToken && same(p.baseToken.address, address) && Number(p.pairCreatedAt) > 0).map((p) => Number(p.pairCreatedAt));
    return ts.length ? Math.min(...ts) : null;
  }

  function bandOf(ageMs) {
    if (ageMs == null || !(ageMs >= 0)) return null;
    const b = BANDS.find(([, lo, hi]) => ageMs >= lo && ageMs < hi);
    return b ? b[0] : null;
  }

  // launches: { address: ms | null }. Addresses not in the map have not been looked up yet.
  function launchFor(launches, addr) {
    if (!addr) return undefined;
    if (addr in launches) return launches[addr];
    const k = Object.keys(launches).find((x) => same(x, addr));
    return k ? launches[k] : undefined;
  }

  function byAge(trades, launches) {
    const groups = Object.fromEntries(BANDS.map(([b]) => [b, []]));
    let unknown = 0;
    for (const t of trades || []) {
      const launch = launchFor(launches || {}, coinOf(t));
      const band = launch ? bandOf(Date.parse(t.openedAt) - launch) : null;
      if (band) groups[band].push(t); else unknown++;
    }
    const rows = BANDS.map(([band]) => {
      const g = groups[band];
      if (!g.length) return { band, count: 0, wins: 0, losses: 0, winRate: null, pnl: 0, avgPct: null };
      const s = Stats.computeStats(g);
      const avgPct = s.trades.reduce((a, x) => a + x.pnlPct, 0) / s.trades.length;
      return { band, count: s.count, wins: s.wins, losses: s.losses, winRate: s.wins + s.losses ? s.winRate : null, pnl: s.netPnl, avgPct };
    });
    return { rows, unknown };
  }

  const missing = (trades, launches) => [...new Set((trades || []).map(coinOf).filter((a) => a && launchFor(launches || {}, a) === undefined))];

  const api = { earliestLaunch, bandOf, byAge, missing, BANDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EntryAge = api;
})(typeof window !== 'undefined' ? window : globalThis);
