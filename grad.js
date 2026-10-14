// pump.fun graduations: pure helpers (no DOM, no network). PumpPortal's migration feed -> wait (3 minutes by default) ->
// the market check on DexScreener -> the holder and rug check -> passed or cut, with the reason, using the owner's
// filters (docs/features/graduations.md, docs/features/grad-filters.md).
(function (root) {
  'use strict';
  const WAIT_MS = 3 * 60000;
  const KEEP = 50;
  const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  // The owner's filters (docs/features/grad-filters.md); the defaults are the Scanner's numbers graduations used before.
  const DEFAULTS = { waitMin: 3, liq: 12000, mcapMin: 60000, mcapMax: 8000000, vol: 8000, trades: 30, topWallet: 5, top10: 60, holders: 80, creator: 10, cutHighRisk: true, cutWalkAway: true };
  const RANGES = { waitMin: [1, 30, 1], liq: [0, 1e8, 1], mcapMin: [0, 1e9, 1], mcapMax: [0, 1e9, 1], vol: [0, 1e8, 1], trades: [0, 1e5, 1], topWallet: [0, 100], top10: [0, 100], holders: [0, 1e6, 1], creator: [0, 100] };
  const BUYS_NEED_SELLS = 20;
  function clampFilters(f) {
    const out = Object.assign({}, DEFAULTS);
    for (const [k, [lo, hi, step]] of Object.entries(RANGES)) {
      const v = f && f[k] !== '' && f[k] != null ? Number(f[k]) : NaN;
      if (Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, step ? Math.round(v) : v));
    }
    if (out.mcapMax < out.mcapMin) out.mcapMax = out.mcapMin;
    for (const k of ['cutHighRisk', 'cutWalkAway']) out[k] = f && typeof f[k] === 'boolean' ? f[k] : DEFAULTS[k];
    return out;
  }
  const isDefault = (f) => Object.keys(DEFAULTS).every((k) => f && f[k] === DEFAULTS[k]);
  const money = (v) => (v >= 1e6 ? '$' + Number((v / 1e6).toFixed(1)) + 'M' : v >= 1000 ? '$' + Math.round(v / 1000) + 'k' : '$' + Math.round(v)); // bug 18: no "$0k"
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

  // One feed message -> { mint, signature, pool, at } for a graduation, else null.
  function parse(text, now) {
    let j;
    try { j = JSON.parse(text); } catch { return null; }
    if (!j || j.txType !== 'migrate' || !MINT.test(String(j.mint || ''))) return null;
    return { mint: j.mint, signature: String(j.signature || ''), pool: String(j.pool || ''), at: now };
  }

  // Adds a graduate (once per coin), newest first, the last KEEP, due after the owner's wait.
  function add(list, g, f) {
    if (!g || (list || []).some((x) => x.mint === g.mint)) return list || [];
    const wait = f && f.waitMin ? f.waitMin * 60000 : WAIT_MS;
    return [Object.assign({}, g, { status: 'waiting', dueAt: g.at + wait })].concat(list || []).slice(0, KEEP);
  }
  const due = (list, now) => (list || []).filter((x) => x.status === 'waiting' && x.dueAt <= now).map((x) => x.mint);

  // DexScreener pair -> the reason it is cut, or null: liquidity, volume and market cap, then trades.
  function marketCut(pair, now, gradAt, filters) {
    const f = filters || DEFAULTS;
    if (!pair) return 'no DexScreener pool yet';
    const liq = num(pair.liquidity && pair.liquidity.usd), vol = num(pair.volume && pair.volume.h24), mcap = num(pair.marketCap) || num(pair.fdv);
    if (liq == null) return 'no liquidity data';
    if (liq < f.liq) return `liquidity ${money(liq)} under ${money(f.liq)}`;
    if (vol == null) return 'no volume data';
    if (vol < f.vol) return `volume ${money(vol)} under ${money(f.vol)}`;
    if (mcap == null) return 'no market cap data';
    if (mcap < f.mcapMin || mcap > f.mcapMax) return `market cap ${money(mcap)} outside ${money(f.mcapMin)} to ${money(f.mcapMax)}`;
    const t24 = (pair.txns && pair.txns.h24) || {}, t1 = (pair.txns && pair.txns.h1) || {};
    const trades = (Number(t24.buys) || 0) + (Number(t24.sells) || 0);
    if (trades < f.trades) return `${trades} trades, under ${f.trades}`;
    if ((Number(t1.buys) || 0) > BUYS_NEED_SELLS && !(Number(t1.sells) > 0)) return `${t1.buys} buys and no sells in the last hour`;
    return null;
  }
  // gatherFacts' { facts, risk } -> the reason it is cut, or null. Missing facts are not cut. Mint and freeze always count.
  function holderCut(got, filters) {
    const f = filters || DEFAULTS, x = (got && got.facts) || {};
    const rules = [
      [num(x.topHolderPct), (v) => v > f.topWallet, (v) => `top wallet holds ${v.toFixed(1)}%, over ${f.topWallet}%`],
      [num(x.top10Pct), (v) => v > f.top10, (v) => `top 10 hold ${v.toFixed(0)}%, over ${f.top10}%`],
      [num(x.holders), (v) => v < f.holders, (v) => `${v} holders, under ${f.holders}`],
      [x.mintAuthority, (v) => v === true, () => 'mint authority still open'],
      [x.freezeAuthority, (v) => v === true, () => 'freeze authority still open'],
      [num(x.creatorPct), (v) => v >= f.creator, (v) => `creator holds ${v.toFixed(1)}%, ${f.creator}% or more`],
    ];
    const hit = rules.find(([v, bad]) => v != null && bad(v));
    if (hit) return hit[2](hit[0]);
    const verdict = got && got.risk && got.risk.verdict;
    if ((verdict === 'High risk' && f.cutHighRisk) || (verdict === 'Walk away' && f.cutWalkAway)) return `rug check says ${verdict}`;
    return null;
  }
  // A pool DexScreener has not indexed yet gets one more look, 5 minutes later.
  const RETRY_MS = 5 * 60000;
  const canRetry = (g) => !!g && !g.retried;
  const retryLater = (list, mint, now) => (list || []).map((x) => (x.mint === mint ? Object.assign({}, x, { status: 'waiting', dueAt: now + RETRY_MS, retried: true }) : x));
  // The outcome for one coin: { status: cut | passed | error, stage, why, symbol, mcap, liq }.
  const setResult = (list, mint, r, now) => (list || []).map((x) => (x.mint === mint ? Object.assign({}, x, r, { checkedAt: now }) : x));

  const api = { parse, add, due, marketCut, holderCut, setResult, canRetry, retryLater, DEFAULTS, clampFilters, isDefault, WAIT_MS, RETRY_MS, KEEP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Grad = api;
})(typeof window !== 'undefined' ? window : globalThis);
