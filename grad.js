// pump.fun graduations: pure helpers (no DOM, no network). PumpPortal's migration feed -> wait 3 minutes -> the market
// check on DexScreener -> the holder and rug check -> passed or cut, with the reason (docs/features/graduations.md).
(function (root) {
  'use strict';
  const Scanner = typeof module !== 'undefined' && module.exports ? require('./scanner.js') : root.Scanner;
  const WAIT_MS = 3 * 60000;
  const KEEP = 50;
  const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const BAD_VERDICTS = ['High risk', 'Walk away'];

  // One feed message -> { mint, signature, pool, at } for a graduation, else null.
  function parse(text, now) {
    let j;
    try { j = JSON.parse(text); } catch { return null; }
    if (!j || j.txType !== 'migrate' || !MINT.test(String(j.mint || ''))) return null;
    return { mint: j.mint, signature: String(j.signature || ''), pool: String(j.pool || ''), at: now };
  }

  // Adds a graduate (once per coin), newest first, the last KEEP.
  function add(list, g) {
    if (!g || (list || []).some((x) => x.mint === g.mint)) return list || [];
    return [Object.assign({}, g, { status: 'waiting', dueAt: g.at + WAIT_MS })].concat(list || []).slice(0, KEEP);
  }
  const due = (list, now) => (list || []).filter((x) => x.status === 'waiting' && x.dueAt <= now).map((x) => x.mint);

  // DexScreener pair -> the reason it is cut, or null. A pool with no time counts from the graduation.
  function marketCut(pair, now, gradAt) {
    if (!pair) return 'no DexScreener pool yet';
    // The pool is dated a few seconds after the graduation; the 3-minute wait already covers "too new".
    const createdAt = Math.min(pair.pairCreatedAt || gradAt || now, now - WAIT_MS);
    const p = { createdAt, liq: pair.liquidity ? Number(pair.liquidity.usd) : null, vol24: pair.volume ? Number(pair.volume.h24) : null, mcap: Number(pair.marketCap) || Number(pair.fdv) || null };
    return Scanner.freeCut(p, now) || Scanner.tradeCut(Object.assign({}, pair, { pairCreatedAt: createdAt }), now);
  }
  // gatherFacts' { facts, risk } -> the reason it is cut, or null.
  function holderCut(got) {
    const c = Scanner.chainCut(got && got.facts, 'solana');
    if (c.cut) return c.cut;
    const v = got && got.risk && got.risk.verdict;
    return BAD_VERDICTS.includes(v) ? `rug check says ${v}` : null;
  }
  // A pool DexScreener has not indexed yet gets one more look, 5 minutes later.
  const RETRY_MS = 5 * 60000;
  const canRetry = (g) => !!g && !g.retried;
  const retryLater = (list, mint, now) => (list || []).map((x) => (x.mint === mint ? Object.assign({}, x, { status: 'waiting', dueAt: now + RETRY_MS, retried: true }) : x));
  // The outcome for one coin: { status: cut | passed | error, stage, why, symbol, mcap, liq }.
  const setResult = (list, mint, r, now) => (list || []).map((x) => (x.mint === mint ? Object.assign({}, x, r, { checkedAt: now }) : x));

  const api = { parse, add, due, marketCut, holderCut, setResult, canRetry, retryLater, WAIT_MS, RETRY_MS, KEEP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Grad = api;
})(typeof window !== 'undefined' ? window : globalThis);
