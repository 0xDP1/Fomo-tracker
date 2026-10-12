// Call lessons: pure helpers, no DOM, no network. What each called coin looked like at the call, what it did in the
// next 15 minutes, 1 hour and 4 hours (from 5-minute price candles, so peaks while the app was closed count), and which
// facts at the call separate the runners from the rest. Simple and readable on purpose: medians and how often a
// runner's value beats the rest's, not a trained model.
(function (root) {
  'use strict';
  const M = 60000;
  const WINDOWS = { m15: 15 * M, h1: 60 * M, h4: 240 * M };
  const RUNNER_X = 2, DEAD_X = 0.3;
  const SNAP_FILL_MS = 30 * M;  // facts that arrive within 30 minutes of the call still count as "at the call"
  const KEEP = 300;
  const MIN_SIDE = 3;           // a fact needs 3+ runners and 3+ others with a value before it is compared
  const MIN_RUNNERS = 30;       // the "like past winners" pill waits for this many runners
  const TOP = 5;                // the pill uses the 5 facts that separate best
  const MIN_SEP = 0.2;          // ... and only those that separate at all
  const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

  /** @type {{ key: string, label: string, fmt: string }[]} */
  const FEATURES = [
    { key: 'ageMin', label: 'Minutes since launch', fmt: 'min' },
    { key: 'mcap', label: 'Market cap', fmt: 'usd' },
    { key: 'liq', label: 'Liquidity', fmt: 'usd' },
    { key: 'liqPct', label: 'Liquidity / market cap', fmt: 'pct' },
    { key: 'vol1h', label: 'Volume, last hour', fmt: 'usd' },
    { key: 'turnover', label: '24h volume / market cap', fmt: 'x' },
    { key: 'holders', label: 'Holders', fmt: 'n' },
    { key: 'top5Pct', label: 'Top 5 wallets', fmt: 'pct' },
    { key: 'bundledPct', label: 'Bundled at launch', fmt: 'pct' },
    { key: 'callerWin', label: 'First caller win rate', fmt: 'pct' },
    { key: 'callers', label: 'Callers', fmt: 'n' },
    { key: 'str', label: 'Strength (S)', fmt: 'n' },
    { key: 'rugScore', label: 'Rug score', fmt: 'n' },
    { key: 'topHolderPct', label: 'Largest wallet', fmt: 'pct' },
    { key: 'top10Pct', label: 'Top 10 wallets', fmt: 'pct' },
    { key: 'insiderPct', label: 'Bundle still held', fmt: 'pct' },
    { key: 'emptyPct', label: 'Supply in near-empty wallets', fmt: 'pct' },
    { key: 'fundedN', label: 'Top wallets with 5+ SOL', fmt: 'n' },
  ];

  // The facts a queue entry has, as numbers (null when unknown). profile: the first caller's record.
  function factsOf(e, profile) {
    const x = e || {};
    const mcap = n(x.mcap), liq = n(x.liq), v24 = n(x.vol24h);
    const at = n(x.firstAt), launched = n(x.launchedAt);
    const snap = x.snap || {}, b = x.bundle, f = x.facts || {}, w = x.wal || {};
    return {
      ageMin: at != null && launched ? Math.max(0, (at - launched) / M) : null,
      mcap, liq,
      liqPct: liq != null && mcap ? (100 * liq) / mcap : null,
      vol1h: n(x.vol1h),
      turnover: v24 != null && mcap ? v24 / mcap : null,
      holders: n(snap.holders) ?? n(f.holders),
      top5Pct: n(snap.top5Pct),
      bundledPct: b && b.scanned ? n(b.bundledPct) : null,
      callerWin: profile ? n(profile.winRate) : null,
      callers: Array.isArray(x.posters) ? x.posters.length : null,
      str: n(x.str),
      rugScore: n(x.score),
      topHolderPct: n(f.topHolderPct), top10Pct: n(f.top10Pct), insiderPct: n(f.insiderPct),
      emptyPct: n(w.emptyPct), fundedN: n(w.fundedN),
    };
  }

  // Start or fill a call's snapshot: facts still unknown get filled while the call is under 30 minutes old; known ones
  // stay as they were at the call. Returns the same object when nothing changed.
  function snapshot(prev, e, profile, now) {
    const at = n(e && e.firstAt);
    if (!at) return prev || null;
    if (!prev && now - at > SNAP_FILL_MS) return null; // seen too late to know what it looked like at the call
    const fresh = factsOf(e, profile);
    if (!prev) return { at, symbol: (e && e.symbol) || '', chain: (e && (e.chainId || e.chain)) || '', price: n(e.price), sources: Array.isArray(e.sources) ? e.sources.slice() : [], facts: fresh };
    if (now - prev.at > SNAP_FILL_MS) return prev;
    const facts = Object.assign({}, prev.facts);
    let changed = false;
    for (const k of Object.keys(fresh)) if (facts[k] == null && fresh[k] != null) { facts[k] = fresh[k]; changed = true; }
    const price = prev.price ?? n(e.price);
    if (price !== prev.price) changed = true;
    return changed ? Object.assign({}, prev, { facts, price }) : prev;
  }

  // GeckoTerminal OHLCV reply -> candles [{ t (ms, candle start), o, h, l, c }], oldest first.
  function candlesFrom(json) {
    const list = (json && json.data && json.data.attributes && json.data.attributes.ohlcv_list) || [];
    return list.map((r) => ({ t: Number(r[0]) * 1000, o: n(r[1]), h: n(r[2]), l: n(r[3]), c: n(r[4]) })).filter((k) => k.t && k.h != null && k.c != null).sort((a, b) => a.t - b.t);
  }

  // The outcome of a call from 5-minute candles. base: the price at the call (else the open of the candle the call fell
  // in). Peak and close within 15 min, 1 h and 4 h. label: 'runner' (2x+ within 4 h; fast if within 1 h), 'dead' (under
  // 0.3x at 4 h, or no pool), 'flat'; null while not known yet. A runner is known as soon as it happens.
  function outcome(candles, callAt, base, now, opts) {
    const o = opts || {};
    if (o.noPool) return now >= callAt + WINDOWS.h4 ? { label: 'dead', fast: false, noPool: true } : { label: null, noPool: true };
    const ks = (candles || []).filter((k) => k.t + 5 * M > callAt);
    const b = n(base) || (ks.length ? ks[0].o : null);
    if (!b || !ks.length) return { label: null };
    const win = (ms) => {
      const end = callAt + ms;
      if (now < end && now < callAt + 5 * M) return null;
      const in_ = ks.filter((k) => k.t < end && k.t < now);
      if (!in_.length) return null;
      return { peak: Math.max(...in_.map((k) => k.h)) / b, close: in_[in_.length - 1].c / b, done: now >= end };
    };
    const m15 = win(WINDOWS.m15), h1 = win(WINDOWS.h1), h4 = win(WINDOWS.h4);
    const fast = !!(h1 && h1.peak >= RUNNER_X);
    let label = null;
    if (h4 && h4.peak >= RUNNER_X) label = 'runner';
    else if (h4 && h4.done) label = h4.close < DEAD_X ? 'dead' : 'flat';
    return { base: b, m15, h1, h4, label, fast };
  }

  const median = (a) => {
    if (!a.length) return null;
    const s = a.slice().sort((x, y) => x - y);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  // How often a runner's value is above another call's (0.5 = no difference); ties count half.
  function above(rs, os) {
    let w = 0;
    for (const r of rs) for (const o of os) w += r > o ? 1 : r === o ? 0.5 : 0;
    return w / (rs.length * os.length);
  }

  // records: [{ facts, label }] with a final label. Returns { runners, rest, rows } where rows are the facts with enough
  // data, best separating first: { key, label, runnerMedian, restMedian, nRunners, nRest, sep (0-1), higher (runners
  // higher?) }.
  function compare(records) {
    const done = (records || []).filter((r) => r && r.label && r.facts);
    const run = done.filter((r) => r.label === 'runner'), rest = done.filter((r) => r.label !== 'runner');
    const rows = [];
    for (const f of FEATURES) {
      const rs = run.map((r) => n(r.facts[f.key])).filter((v) => v != null);
      const os = rest.map((r) => n(r.facts[f.key])).filter((v) => v != null);
      if (rs.length < MIN_SIDE || os.length < MIN_SIDE) continue;
      const a = above(rs, os);
      rows.push({ key: f.key, label: f.label, fmt: f.fmt, runnerMedian: median(rs), restMedian: median(os), nRunners: rs.length, nRest: os.length, sep: Math.abs(a - 0.5) * 2, higher: a > 0.5 });
    }
    rows.sort((x, y) => y.sep - x.sep);
    return { runners: run.length, rest: rest.length, fast: run.filter((r) => r.fast).length, dead: rest.filter((r) => r.label === 'dead').length, rows };
  }

  // How many of the best separating facts a new call shares with past runners: { n, of } or null (fewer than 30
  // runners, or no fact separates). "Shares" = on the runners' side of the halfway point between the two medians.
  function likeRunners(facts, cmp) {
    if (!cmp || cmp.runners < MIN_RUNNERS) return null;
    const top = cmp.rows.filter((r) => r.sep >= MIN_SEP && r.runnerMedian !== r.restMedian).slice(0, TOP);
    if (!top.length) return null;
    let got = 0, of = 0;
    for (const r of top) {
      const v = n((facts || {})[r.key]);
      if (v == null) continue;
      of++;
      const mid = (r.runnerMedian + r.restMedian) / 2;
      if (r.higher ? v > mid : v < mid) got++;
    }
    return of ? { n: got, of } : null;
  }

  // Keep the newest KEEP records.
  function prune(store) {
    const list = Object.entries(store || {}).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, KEEP);
    return Object.fromEntries(list);
  }

  // DexScreener chain id -> GeckoTerminal network.
  const GECKO_NET = { solana: 'solana', base: 'base', bsc: 'bsc', ethereum: 'eth' };

  const api = { FEATURES, WINDOWS, RUNNER_X, DEAD_X, SNAP_FILL_MS, KEEP, MIN_RUNNERS, MIN_SIDE, TOP, GECKO_NET, factsOf, snapshot, candlesFrom, outcome, compare, likeRunners, prune, median };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Outcomes = api;
})(typeof window !== 'undefined' ? window : globalThis);
