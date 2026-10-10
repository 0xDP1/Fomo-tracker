// Flow check: pure helpers (no DOM, no network) that read a coin's recent swaps (Helius enhanced
// transactions) into volume windows, unique wallets, the top wallet's share and a plain label.
(function (root) {
  'use strict';
  const WINDOWS = { w5: 5, w30: 30, w60: 60 };
  const ONE_WALLET = { share: 0.3, minTrades: 10 };
  const REAL = { buyers: 20 };

  // The fee payer's net change in `mint`: positive = buy, negative = sell.
  function classify(tx, mint) {
    if (!tx || !tx.feePayer) return null;
    const me = tx.feePayer;
    let net = 0;
    for (const x of tx.tokenTransfers || []) {
      if (x.mint !== mint) continue;
      const amt = Number(x.tokenAmount) || 0;
      if (x.toUserAccount === me) net += amt;
      if (x.fromUserAccount === me) net -= amt;
    }
    if (!net) return null;
    return { sig: tx.signature, t: tx.timestamp, trader: me, side: net > 0 ? 'buy' : 'sell', tokens: Math.abs(net) };
  }

  function windowOf(trades, nowSec, minutes, price) {
    const ts = trades.filter((x) => nowSec - x.t <= minutes * 60);
    const b = ts.filter((x) => x.side === 'buy'), s = ts.filter((x) => x.side === 'sell');
    const sum = (arr) => arr.reduce((a, x) => a + x.tokens * price, 0);
    return { buyUsd: sum(b), sellUsd: sum(s), buys: b.length, sells: s.length, buyers: new Set(b.map((x) => x.trader)).size, sellers: new Set(s.map((x) => x.trader)).size };
  }

  // trades: classify() results. opts.exhausted: the page limit was hit before reading back far enough.
  function summarize(trades, nowSec, priceUsd, opts = {}) {
    const out = {};
    for (const [k, m] of Object.entries(WINDOWS)) out[k] = windowOf(trades, nowSec, m, priceUsd);
    const hour = trades.filter((x) => nowSec - x.t <= 3600);
    const byWallet = {};
    for (const x of hour) byWallet[x.trader] = (byWallet[x.trader] || 0) + x.tokens * priceUsd;
    const total = Object.values(byWallet).reduce((a, b) => a + b, 0);
    const [addr, vol] = Object.entries(byWallet).sort((a, b) => b[1] - a[1])[0] || [null, 0];
    out.top = { addr, share: total ? vol / total : 0 };
    out.trades60 = out.w60.buys + out.w60.sells;
    out.coveredMin = trades.length ? Math.round((nowSec - Math.min(...trades.map((x) => x.t))) / 60) : 0;
    out.complete = !opts.exhausted || out.coveredMin >= 60;
    return out;
  }

  function label(s) {
    if (s.trades60 >= ONE_WALLET.minTrades && s.top.share >= ONE_WALLET.share) return 'One wallet is the volume';
    const w = s.w60;
    if (w.buyers >= REAL.buyers && w.buyers >= w.sellers && w.buyUsd >= w.sellUsd) return 'Real demand';
    return 'Thin';
  }

  function topBuyers(trades, nowSec, n) {
    const by = {};
    for (const x of trades) if (x.side === 'buy' && nowSec - x.t <= 3600) by[x.trader] = (by[x.trader] || 0) + x.tokens;
    return Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, n).map(([a]) => a);
  }

  // Same rule as Analyze top wallets: the whole history fits in 30 transactions.
  const isFresh = (history) => Array.isArray(history) && history.length <= 30;

  // Helius has run out of credits for the plan (not a short rate limit, which passes in a minute).
  const outOfCredits = (status, body) => status === 402 || ((status === 429 || status === 403) && /credit|usage|quota|plan/i.test(String(body || '')));

  const api = { classify, summarize, label, topBuyers, isFresh, outOfCredits, WINDOWS, ONE_WALLET, REAL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Flow = api;
})(typeof window !== 'undefined' ? window : globalThis);
