// Pure trading-stats / sizing / swap-pairing logic. No DOM access.
// Works in the browser (window.Stats) and in Node (module.exports) for tests.
(function (root) {
  'use strict';

  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const LAMPORTS = 1e9;

  // trade: { id, token, openedAt, closedAt, cost, proceeds, notes, source }
  // pnl = proceeds - cost, pnlPct = pnl / cost
  // A result within ±BREAKEVEN_PCT of the cost is breakeven: not a win, not a loss, no effect on streaks.
  const BREAKEVEN_PCT = 0.01;
  function enrich(t) {
    const cost = Number(t.cost) || 0;
    const proceeds = Number(t.proceeds) || 0;
    const pnl = proceeds - cost;
    const outcome = Math.abs(pnl) < BREAKEVEN_PCT * cost || pnl === 0 ? 0 : Math.sign(pnl);
    return Object.assign({}, t, { cost, proceeds, pnl, pnlPct: cost > 0 ? pnl / cost : 0, outcome });
  }

  // Oldest first by close time; ties break on open time, then id, so the order never depends on how the API listed them.
  function byClose(a, b) {
    const d = new Date(a.closedAt || a.openedAt).getTime() - new Date(b.closedAt || b.openedAt).getTime();
    if (d) return d;
    const o = new Date(a.openedAt || 0).getTime() - new Date(b.openedAt || 0).getTime();
    if (o) return o;
    return String(a.id || '').localeCompare(String(b.id || ''));
  }

  // Merge buy/sell fills into one round trip per position. A new buy after a sell starts a new trade.
  // fill: { key, token, address, chain, at, side: 'buy'|'sell', value, pnl (realized, may be null), id }
  function mergeFills(fills) {
    const sorted = fills.slice().sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    const open = new Map();
    const closed = [];
    const finish = (p) => {
      const pnlKnown = p.pnlSum != null;
      const cost = pnlKnown ? p.proceeds - p.pnlSum : p.buys;
      closed.push({ id: 'f_' + p.ids[p.ids.length - 1], token: p.token, address: p.address, chain: p.chain, openedAt: p.openedAt || p.firstSellAt, closedAt: p.lastSellAt, cost: Math.max(0, cost), proceeds: p.proceeds, fills: p.ids.length, isOpen: false, source: 'fomo', notes: '' });
    };
    for (const f of sorted) {
      const key = f.key || f.address || `${f.chain}:${f.token}`;
      let p = open.get(key);
      if (f.side === 'buy') {
        if (p && p.lastSellAt) { finish(p); p = null; }
        if (!p) { p = { token: f.token, address: f.address, chain: f.chain, buys: 0, proceeds: 0, pnlSum: null, openedAt: f.at, lastSellAt: null, firstSellAt: null, ids: [] }; open.set(key, p); }
        p.buys += f.value || 0;
        p.ids.push(f.id);
      } else {
        if (!p) { p = { token: f.token, address: f.address, chain: f.chain, buys: 0, proceeds: 0, pnlSum: null, openedAt: null, lastSellAt: null, firstSellAt: null, ids: [] }; open.set(key, p); }
        p.proceeds += f.value || 0;
        if (typeof f.pnl === 'number') p.pnlSum = (p.pnlSum || 0) + f.pnl;
        p.firstSellAt = p.firstSellAt || f.at;
        p.lastSellAt = f.at;
        p.ids.push(f.id);
      }
    }
    const stillOpen = [];
    for (const p of open.values()) {
      if (p.lastSellAt) finish(p);
      else stillOpen.push({ token: p.token, address: p.address, chain: p.chain, cost: p.buys, openedAt: p.openedAt, isOpen: true, source: 'fomo' });
    }
    return { closed, open: stillOpen };
  }

  function computeStats(rawTrades) {
    const trades = rawTrades.map(enrich).sort(byClose);
    const wins = trades.filter((t) => t.outcome > 0);
    const losses = trades.filter((t) => t.outcome < 0);
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
      const s = t.outcome;
      if (s === 0) continue;
      if (s === runSign) run++;
      else { run = 1; runSign = s; }
      if (s > 0) longestWin = Math.max(longestWin, run);
      else longestLoss = Math.max(longestLoss, run);
    }
    curStreak = run * runSign;

    const holds = trades
      .filter((t) => t.openedAt && t.closedAt)
      .map((t) => new Date(t.closedAt).getTime() - new Date(t.openedAt).getTime())
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
      sequence: trades.slice(-20).map((t) => ({ outcome: t.outcome, pnl: t.pnl, pnlPct: t.pnlPct, token: t.token, mint: t.mint, at: t.closedAt || t.openedAt })),
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
      if (t.outcome > 0) g.wins++;
      g.pnl += t.pnl;
      g.cost += t.cost;
      map.set(k, g);
    }
    return [...map.values()].sort((a, b) => b.pnl - a.pnl);
  }

  // Per-setup stats. A trade with several tags counts toward each; untagged trades group as "Untagged".
  function byTag(rawTrades) {
    const map = new Map();
    for (const t of rawTrades.map(enrich)) {
      const tags = Array.isArray(t.tags) && t.tags.length ? t.tags : ['Untagged'];
      for (const tag of tags) {
        const g = map.get(tag) || { tag, count: 0, wins: 0, losses: 0, pnl: 0, cost: 0, pctSum: 0 };
        g.count++;
        if (t.outcome > 0) g.wins++;
        if (t.outcome < 0) g.losses++;
        g.pnl += t.pnl;
        g.cost += t.cost;
        g.pctSum += t.pnlPct;
        map.set(tag, g);
      }
    }
    return [...map.values()]
      .map((g) => Object.assign(g, { winRate: g.wins + g.losses ? g.wins / (g.wins + g.losses) : 0, avgPct: g.pctSum / g.count, expectancy: g.pnl / g.count }))
      .sort((a, b) => b.pnl - a.pnl);
  }

  // Daily loss limit + losing-streak check. `now` is injectable for tests; "today" is the local calendar day.
  // level: 'stop' when a rule is broken, 'warn' when close (75% of the limit, or one loss away), else 'ok'.
  function riskStatus(rawTrades, { lossLimit = 0, maxLossStreak = 0, now = new Date() } = {}) {
    const trades = rawTrades.map(enrich).sort(byClose);
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const today = trades.filter((t) => new Date(t.closedAt || t.openedAt).getTime() >= dayStart);
    const todayPnl = today.reduce((s, t) => s + t.pnl, 0);
    let streak = 0;
    for (let i = trades.length - 1; i >= 0; i--) {
      if (trades[i].outcome < 0) streak++;
      else if (trades[i].outcome > 0) break;
    }
    const reasons = [];
    let level = 'ok';
    const bump = (l) => { if (l === 'stop' || (l === 'warn' && level === 'ok')) level = l; };
    if (lossLimit > 0) {
      if (todayPnl <= -lossLimit) { bump('stop'); reasons.push('limit'); }
      else if (todayPnl <= -0.75 * lossLimit) { bump('warn'); reasons.push('nearLimit'); }
    }
    if (maxLossStreak > 0) {
      if (streak >= maxLossStreak) { bump('stop'); reasons.push('streak'); }
      else if (maxLossStreak > 1 && streak === maxLossStreak - 1) { bump('warn'); reasons.push('nearStreak'); }
    }
    return { todayPnl, todayTrades: today.length, streak, level, reasons, limitUsed: lossLimit > 0 ? Math.max(0, -todayPnl) / lossLimit : 0 };
  }

  // Local-calendar day key, e.g. "2026-10-03".
  function dayKey(d) {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  }

  // Realized PnL per local day (by close time): { [dayKey]: { pnl, count, wins, losses, trades } }.
  function byDay(rawTrades) {
    const out = {};
    for (const t of rawTrades.map(enrich)) {
      const k = dayKey(t.closedAt || t.openedAt);
      const g = out[k] || (out[k] = { pnl: 0, count: 0, wins: 0, losses: 0, trades: [] });
      g.pnl += t.pnl;
      g.count++;
      if (t.outcome > 0) g.wins++;
      if (t.outcome < 0) g.losses++;
      g.trades.push(t);
    }
    return out;
  }

  // Summary of one calendar month (month is 0-based) from byDay output.
  function monthSummary(days, year, month) {
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
    const list = Object.entries(days).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => Object.assign({ day: k }, v));
    const sorted = list.slice().sort((a, b) => b.pnl - a.pnl);
    return {
      pnl: list.reduce((s, d) => s + d.pnl, 0),
      trades: list.reduce((s, d) => s + d.count, 0),
      greenDays: list.filter((d) => d.pnl > 0).length,
      redDays: list.filter((d) => d.pnl < 0).length,
      best: sorted[0] && sorted[0].pnl > 0 ? sorted[0] : null,
      worst: sorted.length && sorted[sorted.length - 1].pnl < 0 ? sorted[sorted.length - 1] : null,
      maxAbs: list.reduce((m, d) => Math.max(m, Math.abs(d.pnl)), 0),
    };
  }

  function groupStats(rawTrades, keyOf, labels) {
    const groups = labels.map((label) => ({ label, count: 0, wins: 0, losses: 0, pnl: 0, cost: 0 }));
    for (const t of rawTrades.map(enrich)) {
      const i = keyOf(t);
      if (i == null || i < 0) continue;
      const g = groups[i];
      g.count++;
      if (t.outcome > 0) g.wins++;
      if (t.outcome < 0) g.losses++;
      g.pnl += t.pnl;
      g.cost += t.cost;
    }
    return groups.map((g) => Object.assign(g, { winRate: g.wins + g.losses ? g.wins / (g.wins + g.losses) : 0, roi: g.cost ? g.pnl / g.cost : 0 }));
  }

  // By local weekday of the close, Monday first.
  function byWeekday(rawTrades) {
    return groupStats(rawTrades, (t) => (new Date(t.closedAt || t.openedAt).getDay() + 6) % 7, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  }

  /** @type {[number, string][]} */
  const HOLD_BUCKETS = [[5 * 60e3, '< 5 min'], [30 * 60e3, '5–30 min'], [2 * 3600e3, '30 min–2 h'], [12 * 3600e3, '2–12 h'], [48 * 3600e3, '12 h–2 days'], [Infinity, '> 2 days']];
  // By hold time; trades without both timestamps (or zero hold) are skipped.
  function byHoldTime(rawTrades) {
    return groupStats(rawTrades, (t) => {
      const ms = new Date(t.closedAt).getTime() - new Date(t.openedAt).getTime();
      if (!(ms > 0)) return null;
      return HOLD_BUCKETS.findIndex(([max]) => ms < max);
    }, HOLD_BUCKETS.map((b) => b[1]));
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
    const sorted = swaps.slice().sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
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

  const api = { computeStats, byToken, byTag, riskStatus, mergeFills, BREAKEVEN_PCT, dayKey, byDay, monthSummary, byWeekday, byHoldTime, kelly, riskSize, parseSwap, pairSwaps, enrich, SOL_MINT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Stats = api;
})(typeof window !== 'undefined' ? window : globalThis);
