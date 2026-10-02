// Pure trading-stats / sizing / swap-pairing logic. No DOM access.
// Works in the browser (window.Stats) and in Node (module.exports) for tests.
(function (root) {
  'use strict';

  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const LAMPORTS = 1e9;

  // trade: { id, token, openedAt, closedAt, cost, proceeds, notes, source }
  // pnl = proceeds - cost, pnlPct = pnl / cost
  function enrich(t) {
    const cost = Number(t.cost) || 0;
    const proceeds = Number(t.proceeds) || 0;
    const pnl = proceeds - cost;
    return Object.assign({}, t, { cost, proceeds, pnl, pnlPct: cost > 0 ? pnl / cost : 0 });
  }

  function byClose(a, b) {
    return new Date(a.closedAt || a.openedAt) - new Date(b.closedAt || b.openedAt);
  }

  function computeStats(rawTrades) {
    const trades = rawTrades.map(enrich).sort(byClose);
    const wins = trades.filter((t) => t.pnl > 0);
    const losses = trades.filter((t) => t.pnl < 0);
    const sum = (arr, k) => arr.reduce((s, t) => s + t[k], 0);
    const avg = (arr, k) => (arr.length ? sum(arr, k) / arr.length : 0);

    const grossProfit = sum(wins, 'pnl');
    const grossLoss = -sum(losses, 'pnl');
    const decided = wins.length + losses.length;
    const winRate = decided ? wins.length / decided : 0;
    const avgWin = avg(wins, 'pnl');
    const avgLoss = -avg(losses, 'pnl') || 0;
    const avgWinPct = avg(wins, 'pnlPct');
    const avgLossPct = -avg(losses, 'pnlPct') || 0;

    // Equity curve + max drawdown (absolute, from running peak of cumulative pnl)
    let cum = 0, peak = 0, maxDD = 0;
    const equity = trades.map((t) => {
      cum += t.pnl;
      peak = Math.max(peak, cum);
      maxDD = Math.max(maxDD, peak - cum);
      return { at: t.closedAt || t.openedAt, value: cum };
    });

    // Streaks
    let curStreak = 0, longestWin = 0, longestLoss = 0, run = 0, runSign = 0;
    for (const t of trades) {
      const s = Math.sign(t.pnl);
      if (s === 0) continue;
      if (s === runSign) run++;
      else { run = 1; runSign = s; }
      if (s > 0) longestWin = Math.max(longestWin, run);
      else longestLoss = Math.max(longestLoss, run);
    }
    curStreak = run * runSign;

    const holds = trades
      .filter((t) => t.openedAt && t.closedAt)
      .map((t) => new Date(t.closedAt) - new Date(t.openedAt))
      .filter((ms) => ms >= 0);

    return {
      trades,
      count: trades.length,
      wins: wins.length,
      losses: losses.length,
      breakeven: trades.length - decided,
      winRate,
      netPnl: grossProfit - grossLoss,
      totalCost: sum(trades, 'cost'),
      grossProfit,
      grossLoss,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
      avgWin,
      avgLoss,
      avgWinPct,
      avgLossPct,
      payoff: avgLossPct > 0 ? avgWinPct / avgLossPct : 0,
      expectancy: trades.length ? (grossProfit - grossLoss) / trades.length : 0,
      expectancyPct: winRate * avgWinPct - (1 - winRate) * avgLossPct,
      avgPnlPct: avg(trades, 'pnlPct'),
      largestWin: wins.length ? Math.max(...wins.map((t) => t.pnl)) : 0,
      largestLoss: losses.length ? -Math.min(...losses.map((t) => t.pnl)) : 0,
      maxDrawdown: maxDD,
      equity,
      currentStreak: curStreak,
      longestWinStreak: longestWin,
      longestLossStreak: longestLoss,
      avgHoldMs: holds.length ? holds.reduce((a, b) => a + b, 0) / holds.length : 0,
    };
  }

  function byToken(rawTrades) {
    const map = new Map();
    for (const t of rawTrades.map(enrich)) {
      const k = t.token || '?';
      const g = map.get(k) || { token: k, count: 0, wins: 0, pnl: 0, cost: 0 };
      g.count++;
      if (t.pnl > 0) g.wins++;
      g.pnl += t.pnl;
      g.cost += t.cost;
      map.set(k, g);
    }
    return [...map.values()].sort((a, b) => b.pnl - a.pnl);
  }

  // Kelly fraction for a bet that wins `payoff` x the amount lost.
  function kelly(winRate, payoff) {
    if (!(payoff > 0)) return 0;
    return winRate - (1 - winRate) / payoff;
  }

  // Fixed-fractional sizing: lose at most riskPct of balance if the stop hits.
  function riskSize({ balance, riskPct, stopPct, maxPct }) {
    if (!(balance > 0) || !(riskPct > 0) || !(stopPct > 0)) return { size: 0, capped: false };
    let size = (balance * riskPct) / stopPct;
    const cap = maxPct > 0 ? balance * maxPct : Infinity;
    const capped = size > cap;
    if (capped) size = cap;
    return { size, capped, maxLoss: size * stopPct };
  }

  // ---- Swap pairing (Helius enhanced transactions -> round-trip trades) ----

  // Reduce one Helius enhanced tx to { at, sig, mint, tokenDelta, solDelta } or null.
  function parseSwap(tx, wallet) {
    if (!tx || tx.transactionError) return null;
    const acct = (tx.accountData || []).find((a) => a.account === wallet);
    let solDelta = acct ? acct.nativeBalanceChange / LAMPORTS : 0;
    const tokenDeltas = new Map();
    for (const tt of tx.tokenTransfers || []) {
      const amt = Number(tt.tokenAmount) || 0;
      let sign = 0;
      if (tt.toUserAccount === wallet) sign = 1;
      else if (tt.fromUserAccount === wallet) sign = -1;
      if (!sign) continue;
      if (tt.mint === SOL_MINT) { solDelta += sign * amt; continue; } // wrapped SOL
      tokenDeltas.set(tt.mint, (tokenDeltas.get(tt.mint) || 0) + sign * amt);
    }
    const moved = [...tokenDeltas.entries()].filter(([, d]) => Math.abs(d) > 0);
    if (moved.length !== 1) return null; // token<->token or multi-leg swaps are skipped
    const [mint, tokenDelta] = moved[0];
    if (Math.sign(tokenDelta) === Math.sign(solDelta)) return null; // not a SOL-quoted swap
    return { at: new Date(tx.timestamp * 1000).toISOString(), sig: tx.signature, mint, tokenDelta, solDelta };
  }

  // Average-cost pairing per mint. A trade closes when the position is (nearly) fully sold.
  function pairSwaps(swaps) {
    const sorted = swaps.slice().sort((a, b) => new Date(a.at) - new Date(b.at));
    const pos = new Map();
    const closed = [];
    for (const s of sorted) {
      let p = pos.get(s.mint);
      if (s.tokenDelta > 0) {
        if (!p) { p = { mint: s.mint, qty: 0, cost: 0, invested: 0, proceeds: 0, openedAt: s.at, sigs: [] }; pos.set(s.mint, p); }
        p.qty += s.tokenDelta;
        p.cost += -s.solDelta;
        p.invested += -s.solDelta;
        p.sigs.push(s.sig);
      } else {
        if (!p || p.qty <= 0) continue; // sold something bought before the history window
        const sold = -s.tokenDelta;
        const frac = Math.min(1, sold / p.qty);
        p.cost -= p.cost * frac;
        p.qty -= sold;
        p.proceeds += s.solDelta;
        p.sigs.push(s.sig);
        if (frac >= 0.999 || p.qty <= 0) {
          closed.push({
            id: 'h_' + s.sig,
            token: s.mint,
            mint: s.mint,
            openedAt: p.openedAt,
            closedAt: s.at,
            cost: p.invested,
            proceeds: p.proceeds,
            notes: '',
            source: 'helius',
            sigs: p.sigs,
          });
          pos.delete(s.mint);
        }
      }
    }
    const open = [...pos.values()].filter((p) => p.qty > 0);
    return { closed, open };
  }

  const api = { computeStats, byToken, kelly, riskSize, parseSwap, pairSwaps, enrich, SOL_MINT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Stats = api;
})(typeof window !== 'undefined' ? window : globalThis);
