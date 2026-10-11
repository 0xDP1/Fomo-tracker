// Wallet tracker: pure helpers, no DOM, no network. Picks the wallets worth a look among a coin's top profit-takers,
// reads their GMGN stats and recent trades into a card (profit and win rate over 1, 3, 7 and 30 days, volume, last
// trades, hold time, balance), grades each card against a checklist, and spots tracked wallets on a new coin.
(function (root) {
  'use strict';
  const MIN = 60000, H = 3600000, D = 24 * H;
  const MAX_CARDS = 8;
  // First guesses from docs/features/wallet-tracker.md, to retune from the Signal scorecard.
  const T = { minBuys30: 20, minWin30: 0.45, minProfit30: 1000, minPnl30: 0, minSteady: 3, activeMs: 3 * D, minSpent30: 2000, minSol: 1, minHeldUsd: 200, minHoldMs: 5 * MIN, maxTradesDay: 300 };
  /** @type {{ key: string, name: string, rule: string }[]} */
  const CHECKS = [
    { key: 'trades', name: 'Enough trades', rule: '20+ buys in 30 days' },
    { key: 'wins', name: 'Wins often', rule: '30-day win rate 45%+' },
    { key: 'money', name: 'Makes money', rule: '30-day realized profit $1,000+ and more back than spent' },
    { key: 'steady', name: 'Steady', rule: 'profitable in 3 of the 4 ranges' },
    { key: 'active', name: 'Active', rule: 'traded in the last 3 days' },
    { key: 'size', name: 'Real size', rule: '30-day spent buying $2,000+' },
    { key: 'balance', name: 'Has a balance', rule: '1+ SOL (or $200+ held on other chains)' },
    { key: 'copyable', name: 'Copyable', rule: 'typical hold 5 minutes or longer' },
    { key: 'bot', name: 'Not a bot', rule: 'under 300 trades a day' },
  ];
  // GMGN's tags for wallets that are never offered: the coin's bundlers, insiders ("rat traders"), snipers and dev.
  const NEVER = ['bundler', 'rat_trader', 'sniper', 'dev_team', 'creator'];
  const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const tagsOf = (t) => [].concat(t.maker_token_tags || [], t.tags || [], t.wallet_tag_v2 ? [t.wallet_tag_v2] : []).map(String);

  // GMGN top traders by profit -> up to MAX_CARDS real wallets that took profit, best first.
  // isBot(address): wallets the app already knows as bots (wallet memory).
  function candidates(list, isBot) {
    return (list || [])
      .filter((t) => t && t.address && !t.exchange && (n(t.addr_type) || 0) === 0)
      .filter((t) => { const tags = tagsOf(t); return !tags.some((x) => NEVER.includes(x) || /bot/i.test(x)); })
      .filter((t) => !(isBot && isBot(t.address)))
      .map((t) => ({ address: t.address, profit: n(t.realized_profit) || 0, soldPct: n(t.sell_amount_percentage) || 0, tags: tagsOf(t) }))
      .filter((t) => t.profit > 0)
      .sort((a, b) => b.profit - a.profit)
      .slice(0, MAX_CARDS);
  }

  // GMGN user/wallet_stats for one period (a bare object, or a one-row array for a batch).
  function fromStats(d) {
    const s = Array.isArray(d) ? d[0] : d && d.data !== undefined && typeof d.data === 'object' ? d.data : d;
    if (!s || typeof s !== 'object') return null;
    const profit = n(s.realized_profit), spent = n(s.total_cost);
    const pnl = n(s.pnl) != null ? n(s.pnl) : profit != null && spent ? profit / spent : null;
    return { profit, unrealized: n(s.unrealized_profit), winRate: n(s.winrate), spent, buys: n(s.buy_count), sells: n(s.sell_count), pnl };
  }

  // GMGN user/wallet_activity (one page, newest first) -> trades, 1 d and 3 d figures from the sells, hold time.
  // Transfers are not trades. On a sell, cost_usd - buy_cost_usd is that exit's profit. When the page is full and
  // its oldest row is younger than a range, that range's figure is marked partial.
  function fromActivity(d, now, limit) {
    const rows = ((d && (d.activities || d.list)) || []).filter((a) => a && n(a.timestamp) != null);
    const more = !!(d && d.next) || (limit != null && rows.length >= limit);
    const oldest = rows.reduce((m, a) => Math.min(m, n(a.timestamp) * 1000), Infinity);
    const reachMs = more ? (rows.length ? now - oldest : 0) : Infinity;
    const trades = rows.filter((a) => ['buy', 'sell'].includes(a.event_type ?? a.type)).map((a) => {
      const type = a.event_type ?? a.type, usd = n(a.cost_usd), cost = n(a.buy_cost_usd);
      const tok = a.token || {};
      return { type, address: tok.address || tok.token_address || '', symbol: tok.symbol || '', at: n(a.timestamp) * 1000, usd, profit: type === 'sell' && usd != null && cost != null ? usd - cost : null };
    }).sort((x, y) => y.at - x.at);
    const range = (ms) => {
      const sells = trades.filter((t) => t.type === 'sell' && t.profit != null && now - t.at <= ms);
      const wins = sells.filter((t) => t.profit > 0).length;
      return { profit: sells.reduce((a, t) => a + t.profit, 0), sells: sells.length, wins, winRate: sells.length ? wins / sells.length : null, partial: reachMs < ms };
    };
    // Hold time: each sell against the first buy of the same coin earlier in the page.
    const holds = [];
    for (const s of trades.filter((t) => t.type === 'sell')) {
      const buys = trades.filter((t) => t.type === 'buy' && t.address === s.address && t.at <= s.at);
      if (buys.length) holds.push(s.at - Math.min(...buys.map((b) => b.at)));
    }
    holds.sort((a, b) => a - b);
    const holdMs = holds.length ? (holds.length % 2 ? holds[(holds.length - 1) / 2] : (holds[holds.length / 2 - 1] + holds[holds.length / 2]) / 2) : null;
    return { d1: range(D), d3: range(3 * D), last: trades.slice(0, 5), lastAt: trades.length ? trades[0].at : null, holdMs, holdN: holds.length, trades: trades.length, reachMs, complete: !more };
  }

  // GMGN user/wallet_holdings -> the value of what the wallet holds (open positions).
  function fromHoldings(d) {
    const list = d && Array.isArray(d.list) ? d.list : d && d.data && Array.isArray(d.data.list) ? d.data.list : null;
    if (!list) return null;
    return { usd: list.reduce((a, h) => a + (n(h.usd_value) || 0), 0), n: list.length };
  }

  // card: { chain ('sol', 'bsc', …), s7, s30 (fromStats), act (fromActivity), sol (SOL balance or null), heldUsd, now }.
  // Each check is 'pass', 'fail', 'unknown' (missing data, which is not good news) or 'skip' (not measurable here).
  // pass: every check passes or is skipped.
  function checklist(card) {
    const { s7, s30, act } = card;
    const out = {};
    const set = (key, status, detail) => { out[key] = { status, detail }; };
    const s = s30 || {};
    const tri = (v, ok) => (v == null ? 'unknown' : ok(v) ? 'pass' : 'fail');
    set('trades', tri(s.buys, (v) => v >= T.minBuys30), s.buys == null ? 'no 30-day stats' : `${s.buys} buys`);
    set('wins', tri(s.winRate, (v) => v >= T.minWin30), s.winRate == null ? 'no 30-day stats' : `${Math.round(s.winRate * 100)}%`);
    set('money', s.profit == null || s.pnl == null ? 'unknown' : s.profit >= T.minProfit30 && s.pnl > T.minPnl30 ? 'pass' : 'fail', s.profit == null ? 'no 30-day stats' : `${s.profit < 0 ? '−' : ''}$${Math.abs(Math.round(s.profit)).toLocaleString('en-US')} realized`);
    // Steady: 1 d and 3 d count once their sells are fully read and there was at least one; 7 d and 30 d from GMGN.
    const ranges = [
      act && !act.d1.partial && act.d1.sells ? act.d1.profit > 0 : null,
      act && !act.d3.partial && act.d3.sells ? act.d3.profit > 0 : null,
      s7 && s7.profit != null ? s7.profit > 0 : null,
      s.profit != null ? s.profit > 0 : null,
    ];
    const up = ranges.filter((r) => r === true).length, open = ranges.filter((r) => r == null).length;
    set('steady', up >= T.minSteady ? 'pass' : up + open < T.minSteady ? 'fail' : 'unknown', `${up} of 4 profitable${open ? `, ${open} unknown` : ''}`);
    const lastAt = act ? act.lastAt : null;
    set('active', lastAt != null ? (card.now - lastAt <= T.activeMs ? 'pass' : 'fail') : act && act.complete ? 'fail' : 'unknown', lastAt != null ? `last trade ${Math.max(0, Math.round((card.now - lastAt) / H))}h ago` : 'no trades read');
    set('size', tri(s.spent, (v) => v >= T.minSpent30), s.spent == null ? 'no 30-day stats' : `$${Math.round(s.spent).toLocaleString('en-US')} spent`);
    if (card.chain === 'sol') set('balance', tri(card.sol, (v) => v >= T.minSol), card.sol == null ? 'SOL balance not read' : `${card.sol.toFixed(2)} SOL`);
    else set('balance', card.heldUsd == null ? 'skip' : card.heldUsd >= T.minHeldUsd ? 'pass' : 'fail', card.heldUsd == null ? 'holdings value not available' : `$${Math.round(card.heldUsd).toLocaleString('en-US')} held`);
    const hold = act ? act.holdMs : null;
    set('copyable', tri(hold, (v) => v >= T.minHoldMs), hold == null ? 'no round trips read' : `typical hold ${fmtHold(hold)}`);
    const perDay = s.buys != null && s.sells != null ? (s.buys + s.sells) / 30 : null;
    set('bot', tri(perDay, (v) => v < T.maxTradesDay), perDay == null ? 'no 30-day stats' : `${Math.round(perDay)} trades a day`);
    const checks = CHECKS.map((c) => Object.assign({}, c, out[c.key]));
    return { checks, pass: checks.every((c) => c.status === 'pass' || c.status === 'skip'), failed: checks.filter((c) => c.status === 'fail').length, unknown: checks.filter((c) => c.status === 'unknown').length };
  }

  function fmtHold(ms) {
    if (ms < MIN) return `${Math.round(ms / 1000)}s`;
    if (ms < H) return `${Math.round(ms / MIN)}m`;
    if (ms < D) return `${(ms / H).toFixed(1)}h`;
    return `${(ms / D).toFixed(1)}d`;
  }

  // A tracked wallet's row among a coin's top holders or traders: buying (in within the last hour and has sold under
  // half), selling (has sold half or more) or holding (in from earlier).
  function direction(row, now) {
    const sold = n(row.sell_amount_percentage) || 0, start = n(row.start_holding_at);
    const dir = sold >= 0.5 ? 'selling' : start != null && now - start * 1000 <= H ? 'buying' : 'holding';
    return { dir, soldPct: sold, heldPct: Math.max(0, 1 - sold) };
  }

  // tracked: [{ address, label }]. The tracked wallets among a coin's top holders and traders, with a conviction line
  // like "2 tracked wallets in this · both bought in the last hour, still holding 80%".
  function matchTracked(tracked, holders, traders, now) {
    const rows = new Map();
    for (const r of [].concat(traders || [], holders || [])) if (r && r.address) rows.set(r.address, r); // holders win
    const out = { buying: [], selling: [], holding: [] };
    for (const w of tracked || []) {
      const r = rows.get(w.address);
      if (!r) continue;
      const d = direction(r, now);
      out[d.dir].push({ address: w.address, label: w.label || '', soldPct: d.soldPct, heldPct: d.heldPct });
    }
    const total = out.buying.length + out.selling.length + out.holding.length;
    return { buying: out.buying.length, selling: out.selling.length, holding: out.holding.length, rows: out, n: total, line: convictionLine(out, total) };
  }

  function convictionLine(m, total) {
    if (!total) return null;
    const pct = (list) => Math.round((100 * list.reduce((a, r) => a + r.heldPct, 0)) / list.length);
    const parts = [];
    const b = m.buying.length, s = m.selling.length, h = m.holding.length;
    if (b) parts.push(`${b === total ? (total === 1 ? '' : total === 2 ? 'both ' : `all ${total} `) : `${b} `}bought in the last hour, still holding ${pct(m.buying)}%`);
    if (s) parts.push(`${s === total ? (total === 1 ? '' : total === 2 ? 'both ' : `all ${total} `) : `${s} `}sold most of it`);
    if (h) parts.push(`${h === total ? (total === 1 ? '' : total === 2 ? 'both ' : `all ${total} `) : `${h} `}holding from earlier`);
    return `${total} tracked wallet${total === 1 ? '' : 's'} in this · ${parts.join(' · ')}`;
  }

  const api = { candidates, fromStats, fromActivity, fromHoldings, checklist, direction, matchTracked, fmtHold, CHECKS, T, MAX_CARDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Wallets = api;
})(typeof window !== 'undefined' ? window : globalThis);
