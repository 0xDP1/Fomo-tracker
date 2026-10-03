// Holder lessons: pure helpers (no DOM, no network). Snapshot a coin's holders, match snapshots to
// your trades, and find the holder warning signs that keep costing you money.
(function (root) {
  'use strict';
  const Stats = typeof module !== 'undefined' && module.exports ? require('./stats.js') : root.Stats;

  const H = 3600000;
  const ENTRY_BEFORE = 24 * H;  // a check up to 24h before buying counts as "at entry"
  const ENTRY_AFTER = 6 * H;    // ...and up to 6h after
  const MIN_TRADES = 5;         // a pattern needs this many trades before it is shown
  const COSTLY_GAP = 0.15;      // and a win rate this far under your overall rate to warn

  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const key = (addr) => (/^0x/i.test(addr || '') ? String(addr).toLowerCase() : String(addr || ''));

  function snapshot(facts, risk, at, after = false) {
    const f = facts || {};
    return {
      at, after: !!after,
      topHolderPct: n(f.topHolderPct), top10Pct: n(f.top10Pct),
      bundleHeldPct: n(f.insiderPct), bundleLaunchPct: n(f.bundleLaunchPct),
      creatorPct: n(f.creatorPct), freshTop: n(f.freshTopHolders), holders: n(f.holders),
      lpLockedPct: n(f.lpLockedPct), liquidityUsd: n(f.liquidityUsd), mcapUsd: n(f.mcapUsd), ageHours: n(f.ageHours),
      verdict: risk && risk.verdict ? risk.verdict : null, score: risk ? n(risk.score) : null,
    };
  }

  // Each test returns true (has the warning sign), false (doesn't) or null (not known for this coin).
  const cmp = (v, fn) => (v == null ? null : fn(v));
  const PATTERNS = [
    { key: 'bundleHeld', label: 'Bundles still holding 10%+', test: (s) => cmp(s.bundleHeldPct, (v) => v >= 10) },
    { key: 'bundleLaunch', label: '25%+ bundled at launch', test: (s) => cmp(s.bundleLaunchPct, (v) => v >= 25) },
    { key: 'whale', label: 'One wallet holding 10%+', test: (s) => cmp(s.topHolderPct, (v) => v >= 10) },
    { key: 'top10', label: 'Top 10 wallets holding 40%+', test: (s) => cmp(s.top10Pct, (v) => v >= 40) },
    { key: 'creator', label: 'Creator holding 5%+', test: (s) => cmp(s.creatorPct, (v) => v >= 5) },
    { key: 'fresh', label: '3+ fresh wallets among top holders', test: (s) => cmp(s.freshTop, (v) => v >= 3) },
    { key: 'lp', label: 'LP not locked or burned', test: (s) => cmp(s.lpLockedPct, (v) => v < 90) },
    { key: 'fewHolders', label: 'Under 300 holders', test: (s) => cmp(s.holders, (v) => v < 300) },
    { key: 'young', label: 'Under 1 hour old', test: (s) => cmp(s.ageHours, (v) => v < 1) },
    { key: 'thinLiq', label: 'Under $20k liquidity', test: (s) => cmp(s.liquidityUsd, (v) => v < 20000) },
    { key: 'risky', label: 'Risk check said Caution or worse', test: (s) => cmp(s.verdict, (v) => ['Caution', 'High risk', 'Walk away'].includes(v)) },
  ];

  // db: { address: [snapshot, ...] } oldest first. Keeps `perCoin` per coin and `maxCoins` coins (most recently checked).
  function addSnapshot(db, address, snap, maxCoins = 600, perCoin = 4) {
    const out = Object.assign({}, db);
    const k = key(address);
    out[k] = (out[k] || []).concat(snap).slice(-perCoin);
    const coins = Object.keys(out);
    if (coins.length > maxCoins) {
      const last = (c) => out[c][out[c].length - 1].at;
      coins.sort((a, b) => last(a) - last(b)).slice(0, coins.length - maxCoins).forEach((c) => delete out[c]);
    }
    return out;
  }

  // The snapshot that best describes the coin when you traded it.
  function snapshotFor(trade, db) {
    const list = (db || {})[key(trade.address || trade.mint)];
    if (!list || !list.length) return null;
    const open = Date.parse(trade.openedAt || trade.closedAt);
    const dist = (s) => Math.abs(s.at - open);
    const entry = list.filter((s) => !s.after && s.at >= open - ENTRY_BEFORE && s.at <= open + ENTRY_AFTER).sort((a, b) => dist(a) - dist(b))[0];
    if (entry) return { snap: entry, kind: 'entry' };
    return { snap: list.slice().sort((a, b) => dist(a) - dist(b))[0], kind: 'later' };
  }

  function group(trades) {
    if (!trades.length) return { count: 0, wins: 0, losses: 0, winRate: null, pnl: 0 };
    const s = Stats.computeStats(trades);
    return { count: s.count, wins: s.wins, losses: s.losses, winRate: s.winRate, pnl: s.netPnl };
  }

  function patternStats(trades, db) {
    const closed = (trades || []).filter((t) => !t.isOpen && t.closedAt);
    const matched = closed.map((t) => ({ t, m: snapshotFor(t, db) })).filter((x) => x.m);
    const baselineWinRate = closed.length ? Stats.computeStats(closed).winRate : null;
    const rows = PATTERNS.map((p) => {
      const yes = [], no = [];
      for (const { t, m } of matched) { const r = p.test(m.snap); if (r === true) yes.push(t); else if (r === false) no.push(t); }
      const w = group(yes), wo = group(no);
      const enough = w.count >= MIN_TRADES;
      const costly = enough && w.pnl < 0 && baselineWinRate != null && w.winRate <= baselineWinRate - COSTLY_GAP + 1e-9;
      return { key: p.key, label: p.label, with: w, without: wo, enough, costly };
    }).sort((a, b) => (b.enough - a.enough) || (a.with.pnl - b.with.pnl));
    return {
      closed: closed.length, covered: matched.length,
      entry: matched.filter((x) => x.m.kind === 'entry').length, later: matched.filter((x) => x.m.kind === 'later').length,
      baselineWinRate, rows,
    };
  }

  // Costly patterns this coin's snapshot matches.
  function warningsFor(snap, stats) {
    if (!snap || !stats) return [];
    return stats.rows.filter((r) => r.costly && PATTERNS.find((p) => p.key === r.key).test(snap) === true);
  }

  const api = { snapshot, PATTERNS, addSnapshot, snapshotFor, patternStats, warningsFor, MIN_TRADES, COSTLY_GAP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Lessons = api;
})(typeof window !== 'undefined' ? window : globalThis);
