// Dev dossier: pure helpers (no DOM, no network). Find the coins a creator wallet launched from its Helius
// transactions, call each one's outcome from its DexScreener pool, and summarize the creator's record.
(function (root) {
  'use strict';
  const Check = typeof module !== 'undefined' && module.exports ? require('./check.js') : root.Check;

  const H = 3600000;
  const LAUNCH_TYPES = new Set(['CREATE', 'TOKEN_MINT', 'CREATE_TOKEN', 'INITIALIZE_MINT']);
  const IGNORE = new Set(['So11111111111111111111111111111111111111112', 'So11111111111111111111111111111111111111111', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']);
  const MIN_AGE_H = 6;          // younger launches are not judged
  const DEAD_LIQ = 1000;        // below this liquidity the market is gone
  const QUIET_VOL = 500;        // below this 24h volume it is just sitting there

  // txs: Helius enhanced transactions for the creator wallet. Returns [{ mint, t, sig }], newest first, one per mint.
  function launchesFrom(txs, wallet, currentMint, max = 20) {
    const byMint = new Map();
    for (const tx of txs || []) {
      if (!tx || tx.feePayer !== wallet || !LAUNCH_TYPES.has(tx.type)) continue;
      const mints = new Set();
      for (const x of tx.tokenTransfers || []) if (x.mint) mints.add(x.mint);
      for (const a of tx.accountData || []) for (const c of a.tokenBalanceChanges || []) if (c.mint) mints.add(c.mint);
      for (const m of mints) {
        if (IGNORE.has(m) || m === currentMint) continue;
        const prev = byMint.get(m);
        if (!prev || (tx.timestamp || 0) > prev.t) byMint.set(m, { mint: m, t: tx.timestamp || 0, sig: tx.signature });
      }
    }
    return [...byMint.values()].sort((a, b) => b.t - a.t).slice(0, max);
  }

  // pair: DexScreener best pair, null = no pool, undefined = lookup failed. launchedMs: when the coin was launched.
  function outcome(pair, launchedMs, nowMs) {
    if (pair === undefined) return 'unknown';
    if (nowMs - launchedMs < MIN_AGE_H * H) return 'new';
    if (!pair) return 'dead';
    const liq = Number(pair.liquidity && pair.liquidity.usd) || 0;
    const vol = Number(pair.volume && pair.volume.h24) || 0;
    if (liq < DEAD_LIQ) return 'dead';
    return vol < QUIET_VOL ? 'quiet' : 'alive';
  }

  function summarize(rows) {
    const c = { alive: 0, quiet: 0, dead: 0, new: 0, unknown: 0 };
    for (const r of rows || []) if (r.outcome in c) c[r.outcome] += 1;
    const counted = c.alive + c.quiet + c.dead;
    const rugger = c.dead >= Check.RUGGER.dead && counted > 0 && c.dead / counted >= Check.RUGGER.share;
    return { counted, alive: c.alive, quiet: c.quiet, dead: c.dead, newer: c.new, unknown: c.unknown, rugger };
  }

  const api = { launchesFrom, outcome, summarize, MIN_AGE_H, DEAD_LIQ, QUIET_VOL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Dossier = api;
})(typeof window !== 'undefined' ? window : globalThis);
