// Fee drag: pure helpers (no DOM, no network). What trading costs take from a frequent trader.
(function (root) {
  'use strict';
  const Stats = typeof module !== 'undefined' && module.exports ? require('./stats.js') : root.Stats;
  const WINDOW_DAYS = 30;
  const MIN_TRADES = 5;

  // trades: closed trades. costPct: round-trip cost as a fraction (0.04 = 4%).
  function estimate(trades, now, costPct) {
    const since = now - WINDOW_DAYS * 86400000;
    const recent = (trades || []).filter((t) => t.closedAt && Date.parse(t.closedAt) >= since && Date.parse(t.closedAt) <= now);
    const c = Math.max(0, Number(costPct) || 0);
    const out = { trades: recent.length, perDay: recent.length / WINDOW_DAYS, avgSize: null, monthlyCost: 0, winRate: null, needWithCosts: null, needWithoutCosts: null, netPnl: 0, costShareOfGross: null, enough: false };
    if (!recent.length) return out;
    const s = Stats.computeStats(recent);
    out.avgSize = recent.reduce((a, t) => a + (Number(t.cost) || 0), 0) / recent.length;
    out.monthlyCost = recent.length * out.avgSize * c;
    out.netPnl = s.netPnl;
    const gross = s.netPnl + out.monthlyCost;
    out.costShareOfGross = gross > 0 ? out.monthlyCost / gross : null;
    out.enough = recent.length >= MIN_TRADES && s.wins > 0 && s.losses > 0;
    if (out.enough) {
      const W = s.avgWinPct, L = s.avgLossPct;
      out.winRate = s.winRate;
      out.needWithCosts = L / (W + L);
      out.needWithoutCosts = Math.max(0, L - c) / (W + L);
    }
    return out;
  }

  const api = { estimate, WINDOW_DAYS, MIN_TRADES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FeeDrag = api;
})(typeof window !== 'undefined' ? window : globalThis);
