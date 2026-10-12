// Coin strength: pure helpers, no DOM, no network. How healthy a coin's market is (not whether it is a trap: that is the
// rug check), from liquidity, volume, how spread out the holders are (counting linked wallets as one), the total fees
// traders paid and how much SOL the top holders keep. Five parts of 20 points; a part with no data is "not read" and the
// score is out of the parts that were read (never counted as good).
// Thresholds are first guesses, to retune from the Signal scorecard.
(function (root) {
  'use strict';
  const PART = 20;
  const EMPTY_SOL = 0.1, LOW_SOL = 1, FUNDED_SOL = 5;
  const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const usd = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`);
  const pct = (v, d = 1) => `${(Math.round(v * 10 ** d) / 10 ** d).toFixed(d)}%`;

  // A part from its sub-checks [points, max] (null points = not read), scaled to PART.
  function part(subs, detail) {
    const known = subs.filter(([p]) => p != null);
    if (!known.length) return { pts: null, max: PART, detail: 'not read' };
    const got = known.reduce((a, [p]) => a + p, 0), of = known.reduce((a, [, m]) => a + m, 0);
    return { pts: Math.round((got / of) * PART), max: PART, detail };
  }

  function liquidity({ liq, mcap }) {
    const ratio = liq != null && mcap ? liq / mcap : null;
    return part([
      [ratio == null ? null : ratio >= 0.10 ? 15 : ratio >= 0.05 ? 8 : 0, 15],
      [liq == null ? null : liq >= 30000 ? 10 : liq >= 10000 ? 5 : 0, 10],
    ], liq == null ? 'not read' : `${usd(liq)}${ratio != null ? `, ${pct(ratio * 100, 0)} of market cap` : ''}`);
  }

  // Turnover: 24h volume / market cap. 0.5-3x is healthy; under 0.2x barely traded; over 10x looks like wash trading.
  // Pace: the last hour at least half of the 24h average.
  function volume({ vol24h, vol1h, mcap }) {
    const t = vol24h != null && mcap ? vol24h / mcap : null;
    const pace = vol1h != null && vol24h ? (vol1h * 24) / vol24h : null;
    return part([
      [t == null ? null : t > 10 ? 0 : t >= 0.5 && t <= 3 ? 15 : t >= 0.2 ? 8 : 0, 15],
      [pace == null ? null : pace >= 0.5 ? 10 : pace >= 0.25 ? 5 : 0, 10],
    ], t == null ? 'not read' : `24h volume ${t.toFixed(1)}× market cap${t > 10 ? ' (wash trading?)' : ''}${pace != null ? `, last hour ${pace >= 0.5 ? 'keeping pace' : 'slowing'}` : ''}`);
  }

  // The largest holder is the bigger of the top wallet and the largest linked group (groupPct, named by groupLabel):
  // splitting a bag across many small wallets doesn't make it safe.
  function holders({ topHolderPct, groupPct, groupLabel, top10Pct, holderCount }) {
    const tw = n(topHolderPct), g = n(groupPct), t = n(top10Pct), h = n(holderCount);
    const byGroup = g != null && (tw == null || g > tw);
    const w = byGroup ? g : tw;
    const big = w == null ? '' : byGroup ? `largest group ${pct(w)}${groupLabel ? ` (${groupLabel})` : ''}${tw != null ? `, largest wallet ${pct(tw)}` : ''}` : `largest wallet ${pct(w)}`;
    return part([
      [w == null ? null : w < 3 ? 10 : w < 5 ? 6 : w < 10 ? 2 : 0, 10],
      [t == null ? null : t < 20 ? 8 : t < 30 ? 5 : t <= 40 ? 2 : 0, 8],
      [h == null ? null : h >= 500 ? 7 : h >= 100 ? 4 : 0, 7],
    ], [big, t != null ? `top 10 ${pct(t, 0)}` : '', h != null ? `${h.toLocaleString('en-US')} holders` : ''].filter(Boolean).join(', ') || 'not read');
  }

  // The largest linked group from what the check found: GMGN's bundler / insider / sniper / dev labels, the bundle still
  // held, and the biggest operator from "Analyze top wallets". -> { pct, label } or null.
  function largestGroup(f) {
    const x = f || {};
    const c = [
      { pct: n(x.gmRiskPct), label: x.gmRiskN ? `GMGN: ${x.gmRiskN} bundler, insider, sniper or dev wallets` : 'GMGN-tagged wallets' },
      { pct: n(x.insiderPct), label: 'bundle still held' },
      { pct: n(x.operatorWallets) >= 2 ? n(x.operatorPct) : null, label: `${x.operatorWallets} linked wallets` },
    ].filter((g) => g.pct != null && g.pct > 0).sort((a, b) => b.pct - a.pct);
    return c.length ? c[0] : null;
  }

  // SOL balances of the top real holders. holders: [{ addr, pct }], balances: { addr: SOL or null (not read) }.
  // Empty wallets (under 0.1 SOL) hold a bag and nothing else: the bundle / burner pattern. Funded ones (5+ SOL) look like
  // real buyers. Look-alikes: 3+ wallets with nearly the same SOL (within 2%) and supply (within 10%), one person's setup.
  function walletBalances(list, balances) {
    const read = (list || []).filter((h) => h && h.addr && n((balances || {})[h.addr]) != null).map((h) => ({ addr: h.addr, pct: Number(h.pct) || 0, sol: n(balances[h.addr]) }));
    if (!read.length) return null;
    const sum = (a) => a.reduce((s, h) => s + h.pct, 0);
    const empty = read.filter((h) => h.sol < EMPTY_SOL), low = read.filter((h) => h.sol >= EMPTY_SOL && h.sol < LOW_SOL), funded = read.filter((h) => h.sol >= FUNDED_SOL);
    let look = [];
    const pool = read.filter((h) => h.sol >= 0.05 && h.pct > 0).sort((a, b) => a.sol - b.sol);
    for (const a of pool) {
      const g = pool.filter((b) => Math.abs(b.sol - a.sol) <= 0.02 * a.sol && Math.abs(b.pct - a.pct) <= 0.1 * a.pct);
      if (g.length > look.length) look = g;
    }
    const lookAlike = look.length >= 3 ? { n: look.length, pct: sum(look), sol: look.reduce((a, h) => a + h.sol, 0) / look.length, each: sum(look) / look.length } : null;
    return { n: read.length, readPct: sum(read), emptyN: empty.length, emptyPct: sum(empty), lowN: low.length, lowPct: sum(low), fundedN: funded.length, fundedPct: sum(funded), lookAlike };
  }

  // Red / amber / green flags from walletBalances, in plain words.
  function walletFlags(w) {
    if (!w) return [];
    const out = [];
    const s = (k) => (k === 1 ? '' : 's');
    if (w.emptyN) out.push({ kind: w.emptyPct >= 5 ? 'red' : 'amber', text: `${pct(w.emptyPct)} of supply in ${w.emptyN} near-empty wallet${s(w.emptyN)} (under ${EMPTY_SOL} SOL)` });
    if (w.lookAlike) out.push({ kind: 'red', text: `${w.lookAlike.n} look-alike wallets: ~${w.lookAlike.sol.toFixed(2)} SOL and ~${pct(w.lookAlike.each)} of supply each (${pct(w.lookAlike.pct)} together), likely one person` });
    if (w.lowN) out.push({ kind: 'amber', text: `${w.lowN} wallet${s(w.lowN)} with ${EMPTY_SOL}–${LOW_SOL} SOL hold ${pct(w.lowPct)}` });
    if (w.fundedN) out.push({ kind: 'green', text: `${pct(w.fundedPct)} held by ${w.fundedN} wallet${s(w.fundedN)} with ${FUNDED_SOL}+ SOL` });
    return out;
  }

  function wallets({ wallets: w }) {
    if (!w || w.n < 3) return part([[null, 1]]);
    const funded = w.readPct ? w.fundedPct / w.readPct : 0;
    return part([
      [w.emptyPct < 2 ? 10 : w.emptyPct < 5 ? 6 : w.emptyPct < 10 ? 2 : 0, 10],
      [funded >= 0.5 ? 6 : funded >= 0.25 ? 3 : 0, 6],
      [w.lookAlike ? 0 : 4, 4],
    ], `${w.n} top wallets read: ${w.emptyN} empty, ${w.lowN} low, ${w.fundedN} funded${w.lookAlike ? `, ${w.lookAlike.n} look-alikes` : ''}`);
  }

  // Total fees traders paid (priority fees and tips) against the volume over the same time: real buyers pay to get in,
  // wash-trading bots keep fees tiny.
  function fees({ totalFeesUsd, feesVolumeUsd, feeSource }) {
    const f = n(totalFeesUsd), v = n(feesVolumeUsd);
    const r = f != null && v ? f / v : null;
    return part([[r == null ? null : r >= 0.005 ? 25 : r >= 0.0025 ? 15 : r >= 0.001 ? 8 : 0, 25]],
      r == null ? 'not read' : `${usd(f)} paid, ${pct(r * 100, 2)} of volume${r < 0.001 ? ' (bot volume?)' : ''}${feeSource ? ` · ${feeSource}` : ''}`);
  }

  // input: { liq, mcap, vol24h, vol1h, topHolderPct, groupPct, groupLabel, top10Pct, holderCount, totalFeesUsd,
  // feesVolumeUsd, feeSource, wallets (walletBalances) }
  // -> { score 0-100 or null (fewer than 2 parts read), label, parts: { liquidity, volume, holders, fees, wallets }, read }
  function strength(input) {
    const i = input || {};
    const parts = { liquidity: liquidity(i), volume: volume(i), holders: holders(i), fees: fees(i), wallets: wallets(i) };
    const read = Object.values(parts).filter((p) => p.pts != null);
    if (read.length < 2) return { score: null, label: null, parts, read: read.length };
    const score = Math.round((100 * read.reduce((a, p) => a + p.pts, 0)) / (read.length * PART));
    return { score, label: score >= 70 ? 'Strong' : score >= 40 ? 'Mixed' : 'Weak', parts, read: read.length };
  }

  // GMGN token info: its total fees in USD. The field name is not in GMGN's docs, so look for a total-fee number in the
  // reply (top level, then stat / pool). null when there is none.
  function gmgnTotalFees(info) {
    const d = info && info.data !== undefined && typeof info.data === 'object' ? info.data : info;
    for (const o of [d, d && d.stat, d && d.pool]) {
      if (!o || typeof o !== 'object') continue;
      for (const [k, v] of Object.entries(o)) if (/^total_?fees?(_usd)?$/i.test(k) && n(v) != null) return n(v);
    }
    return null;
  }

  // The fee figure to use: GMGN's total covers the coin's whole life, so it is compared with the 24h volume only while
  // the coin is under a day old; otherwise the app's own 24h estimate (Helius sample, SOL), when one was taken.
  function feeInput({ gmgnFeesUsd, ageHours, vol24h, sampleSol24h, solUsd }) {
    if (n(gmgnFeesUsd) != null && n(ageHours) != null && ageHours <= 24) return { totalFeesUsd: gmgnFeesUsd, feesVolumeUsd: vol24h, feeSource: 'GMGN total fees' };
    if (n(sampleSol24h) != null && n(solUsd)) return { totalFeesUsd: sampleSol24h * solUsd, feesVolumeUsd: vol24h, feeSource: 'own 24h estimate' };
    return { totalFeesUsd: null, feesVolumeUsd: vol24h, feeSource: n(gmgnFeesUsd) != null ? 'GMGN total covers more than 24h' : '' };
  }

  // Signal scorecard groups.
  const group = (score) => (score == null ? 'not scored' : score >= 70 ? '70+' : score >= 40 ? '40–69' : 'under 40');

  const api = { strength, largestGroup, walletBalances, walletFlags, gmgnTotalFees, feeInput, group, PART, EMPTY_SOL, LOW_SOL, FUNDED_SOL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Strength = api;
})(typeof window !== 'undefined' ? window : globalThis);
