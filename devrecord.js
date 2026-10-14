// Dev track record (docs/features/dev-record.md): how far the dev's earlier coins got (peak market cap, holders,
// volume, fees) and one bundle verdict that reads the bundle together with that record. Dead coins on their own say
// little (most coins fade); a dev whose coins never get anywhere, or one whose coins run, says a lot.
// Pure helpers, no DOM, no network.
(function (root) {
  'use strict';
  const H = 3600000;
  const PROVEN = { once: 1e6, twice: 1e5 };   // one coin past $1M, or two past $100k
  const NEVER = { min: 5, peak: 50000 };       // 5+ judged launches, none ever above $50k
  const MIN_AGE_MS = 6 * H;                    // younger launches may still run: not counted for "never"
  const BUNDLE = { fine: 15, bad: 30, heldBundled: 10 };
  const TOP_N = 5;

  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  // The first number found under any of the names, on the object or one level down (GMGN nests some figures).
  function pick(obj, names) {
    if (!obj || typeof obj !== 'object') return null;
    for (const k of names) { const v = num(obj[k]); if (v != null) return v; }
    for (const v of Object.values(obj)) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      for (const k of names) { const x = num(v[k]); if (x != null) return x; }
    }
    return null;
  }
  // GMGN field names are not documented; these are read when present and shown as "—" when not.
  const HOLDER_KEYS = ['holder_count', 'holders', 'holder_num'];
  const VOLUME_KEYS = ['total_volume', 'volume_total', 'history_volume', 'all_volume', 'volume'];
  const FEE_KEYS = ['global_fee', 'global_fees', 'total_fee', 'total_fees', 'fees'];
  const extras = (obj) => ({ holders: pick(obj, HOLDER_KEYS), volume: pick(obj, VOLUME_KEYS), fees: pick(obj, FEE_KEYS) });
  // GMGN token/info -> { holders, volume, fees } (each null when GMGN didn't send it).
  const fromInfo = (info) => extras(info && info.data !== undefined && typeof info.data === 'object' ? info.data : info);
  // GMGN created-tokens answer -> { mint: { holders, volume, fees } } for the coins that came with those figures.
  function extrasByMint(data) {
    const d = data && data.data !== undefined && !data.tokens ? data.data : data;
    const tokens = d && (Array.isArray(d.tokens) ? d.tokens : Array.isArray(d.list) ? d.list : []);
    const out = {};
    for (const t of tokens || []) { const m = t && (t.token_address || t.address); if (m) out[m] = extras(t); }
    return out;
  }
  const needsInfo = (r) => r.holders == null || r.volume == null || r.fees == null;
  // Fill a row's missing figures from token/info, keeping what the created-tokens list already gave.
  const merge = (r, x) => Object.assign({}, r, { holders: r.holders ?? x.holders, volume: r.volume ?? x.volume, fees: r.fees ?? x.fees });

  // The rows worth a token/info lookup: the top few by peak.
  const topByPeak = (rows, n = TOP_N) => rows.filter((r) => r.ath > 0).sort((a, b) => b.ath - a.ath).slice(0, n);

  // rows: [{ mint, symbol, launchedAt, mcap, ath, holders, volume, fees }] (the coin being checked left out).
  function summarize(rows, now = Date.now()) {
    const list = rows || [];
    const peaks = list.filter((r) => num(r.ath) > 0);
    const sorted = peaks.map((r) => r.ath).sort((a, b) => a - b);
    const median = !sorted.length ? null : sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    const best = peaks.slice().sort((a, b) => b.ath - a.ath)[0] || null;
    const over100k = peaks.filter((r) => r.ath >= PROVEN.twice).length, over1m = peaks.filter((r) => r.ath >= PROVEN.once).length;
    const aged = peaks.filter((r) => !r.launchedAt || now - r.launchedAt >= MIN_AGE_MS);
    const total = (k) => { const xs = list.map((r) => num(r[k])).filter((v) => v != null); return xs.length ? { sum: xs.reduce((a, b) => a + b, 0), n: xs.length } : null; };
    const mostHolders = list.filter((r) => num(r.holders) != null).sort((a, b) => b.holders - a.holders)[0] || null;
    let verdict;
    if (!list.length) verdict = 'none';
    else if (over1m >= 1 || over100k >= 2) verdict = 'proven';
    else if (aged.length >= NEVER.min && !peaks.some((r) => r.ath >= NEVER.peak)) verdict = 'never';
    else if (!peaks.length) verdict = 'unknown';
    else verdict = 'mixed';
    return { launches: list.length, peaked: peaks.length, aged: aged.length, best, median, over100k, over1m, mostHolders, volume: total('volume'), fees: total('fees'), verdict };
  }

  const VERDICT_LABEL = { proven: 'Proven dev', never: 'Never gets anywhere', mixed: 'Mixed record', unknown: 'No peaks reported', none: 'No history' };

  // launchPct: share bundled at launch; heldPct: bundled share still held; dev: summarize().verdict.
  // -> { key, cls: 'pos' | 'warn-text' | 'neg' | 'muted', label, text } or null when nothing is known.
  /** @param {{ launchPct?: number | null, heldPct?: number | null }} [shares] @param {string} [dev] */
  function bundleVerdict(shares = {}, dev) {
    const { launchPct, heldPct } = shares;
    const launch = num(launchPct), held = num(heldPct);
    if (launch == null && held == null) return null;
    const p = (v) => `${Math.round(v)}%`;
    const bundled = (launch ?? held) >= BUNDLE.fine || (held != null && held >= BUNDLE.heldBundled);
    if (bundled && dev === 'never') return { key: 'extraction', cls: 'neg', label: 'Extraction pattern', text: 'Bundled launch from a dev whose earlier coins never got anywhere: the bundle is likely there to sell into the first buyers.' };
    if (bundled && dev === 'proven') return { key: 'team', cls: 'pos', label: 'Team launch', text: `Bundled${held != null ? ` (${p(held)} still held)` : ''}, but this dev has taken coins high before: the bundle is likely a team backing its chart. Still watch it sell.` };
    if (held != null) {
      if (held >= BUNDLE.bad) return { key: 'heldBig', cls: 'neg', label: `Bundle held: ${p(held)}`, text: `${p(held)} of supply is still held by wallets that bought together. That is supply waiting to sell into you.` };
      if (held >= BUNDLE.fine) return { key: 'held', cls: 'warn-text', label: `Bundle held: ${p(held)}`, text: `${p(held)} of supply is still held by the bundle. Watch it.` };
      if (launch != null && launch >= BUNDLE.fine) return { key: 'sold', cls: 'pos', label: 'Bundle sold', text: `${p(launch)} was bundled at launch, only ${p(held)} is still held. It is history, not a threat.` };
      return { key: 'small', cls: 'pos', label: 'Small bundle', text: `${p(held)} of supply held by the bundle: normal for a launch.` };
    }
    if (launch >= BUNDLE.bad) return { key: 'launchBig', cls: 'warn-text', label: `${p(launch)} bundled`, text: `${p(launch)} was bundled at launch; how much is still held isn't known.` };
    if (launch >= BUNDLE.fine) return { key: 'launch', cls: 'warn-text', label: `${p(launch)} bundled`, text: `${p(launch)} was bundled at launch; how much is still held isn't known.` };
    return { key: 'small', cls: 'pos', label: 'Small bundle', text: `${p(launch)} bundled at launch: normal for a launch.` };
  }

  // Risk-check facts from a summary (names start with dev so they never mix with other sources).
  const facts = (s) => (s ? { devVerdict: s.verdict, devAged: s.aged, devBestPeak: s.best ? s.best.ath : null, devOver100k: s.over100k, devOver1m: s.over1m } : {});

  // What a Call queue row keeps: small, saved with the queue.
  /** @param {{ launchPct?: number | null, heldPct?: number | null }} [bundle] */
  function compact(s, bv, wallet, bundle = {}, now = Date.now()) {
    return { wallet, verdict: s.verdict, launches: s.launches, best: s.best ? s.best.ath : null, bestSym: s.best ? s.best.symbol || '' : '', over100k: s.over100k, over1m: s.over1m, heldPct: num(bundle.heldPct), launchPct: num(bundle.launchPct), bundle: bv ? { key: bv.key, label: bv.label, cls: bv.cls } : null, at: now };
  }

  const api = { PROVEN, NEVER, BUNDLE, TOP_N, MIN_AGE_MS, VERDICT_LABEL, pick, extras, extrasByMint, fromInfo, needsInfo, merge, topByPeak, summarize, bundleVerdict, facts, compact };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DevRecord = api;
})(typeof window !== 'undefined' ? window : globalThis);
