// GMGN home (docs/features/gmgn-home.md): pure helpers, no DOM, no network. The owner's own GMGN wallet: the address
// from a bare address or a GMGN wallet link, its buys and sells from GMGN's wallet activity paired into closed trades
// and open positions in USD, and GMGN's wallet stats boiled down for the Home tiles.
(function (root) {
  'use strict';
  const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const LEFT_CLOSED = 0.05; // a trip whose remaining amount is 5% or less of what was bought counts as closed
  const LEFT_OPEN = 0.10;   // more than this still held after some sells: the position is open, the trip not closed

  // A bare Solana address, or a GMGN wallet link (gmgn.ai/sol/address/<wallet>, with or without ?tab=…).
  function parseWalletInput(text) {
    const s = String(text || '').trim();
    if (SOL.test(s)) return s;
    // bug 26: a link shared from GMGN carries a referral code before the wallet ("/address/AonIxw2x_<wallet>").
    const m = /gmgn\.ai\/sol\/(?:address|wallet)\/(?:[A-Za-z0-9]{4,12}_)?([1-9A-HJ-NP-Za-km-z]{32,44})(?![1-9A-HJ-NP-Za-km-z])/i.exec(s);
    return m ? m[1] : null;
  }

  const rowOf = (a) => {
    const type = a && (a.event_type || a.type);
    if (type !== 'buy' && type !== 'sell') return null;
    const address = a.token && (a.token.address || a.token.token_address);
    const usd = n(a.cost_usd), at = n(a.timestamp);
    if (!address || !(usd > 0) || at == null) return null;
    return { type, address, symbol: (a.token && a.token.symbol) || '', usd, at: at * 1000, amount: n(a.token_amount != null ? a.token_amount : a.amount), tx: String(a.tx_hash || a.hash || ''), price: n(a.price_usd) };
  };

  // GMGN wallet activity rows (buys and sells, any order, pages included) -> { closed, open }.
  // A trip is a run of buys and sells of one token: it closes when the token is sold down (5% or less of the bought
  // amount left, or every sell before the next buy when GMGN gives no amounts) and the next buy starts a new trip.
  // Closed trades are in USD at GMGN's own prices, shaped like the app's other synced trades (source 'gmgn').
  function trades(rows, prevById) {
    const prev = prevById || {};
    const list = (rows || []).map(rowOf).filter(Boolean).sort((a, b) => a.at - b.at || (a.type === 'buy' ? -1 : 1));
    const trips = new Map(); // address -> current trip
    const closed = [], open = [];
    const finish = (t) => {
      const last = t.sells[t.sells.length - 1];
      const id = 'g_' + (last.tx || `${t.address}_${last.at}`);
      const old = prev[id] || {};
      closed.push({ id, token: t.symbol || t.address.slice(0, 6), address: t.address, mint: t.address, chain: 'Solana', openedAt: new Date(t.buys[0].at).toISOString(), closedAt: new Date(last.at).toISOString(), cost: round(t.cost), proceeds: round(t.proceeds), fills: t.buys.length + t.sells.length, notes: old.notes || '', tags: old.tags || [], source: 'gmgn' });
    };
    const leftShare = (t) => (t.bought > 0 && t.sold != null ? Math.max(0, t.bought - t.sold) / t.bought : null);
    for (const r of list) {
      let t = trips.get(r.address);
      if (r.type === 'buy') {
        if (t && t.sells.length) {
          const left = leftShare(t);
          if (left == null || left <= LEFT_CLOSED) { finish(t); t = null; }
        }
        if (!t) { t = { address: r.address, symbol: r.symbol, buys: [], sells: [], cost: 0, proceeds: 0, bought: 0, sold: 0 }; trips.set(r.address, t); }
        t.buys.push(r); t.cost += r.usd; if (r.symbol) t.symbol = r.symbol;
        if (r.amount != null && t.bought != null) t.bought += r.amount; else t.bought = null;
        continue;
      }
      if (!t) continue; // sold something bought before the window: nothing to pair it with
      t.sells.push(r); t.proceeds += r.usd;
      if (r.amount != null && t.sold != null) t.sold += r.amount; else t.sold = null;
    }
    for (const t of trips.values()) {
      if (!t.sells.length) { open.push(openOf(t, 1)); continue; }
      const left = leftShare(t);
      if (left == null || left <= LEFT_CLOSED) { finish(t); continue; }
      // sold some, still holding more than a tenth of it: an open position carrying the rest of its cost
      if (left > LEFT_OPEN) open.push(openOf(t, left, t.proceeds));
      else finish(t);
    }
    closed.sort((a, b) => Date.parse(a.closedAt) - Date.parse(b.closedAt));
    return { closed, open };
  }
  const round = (v) => Math.round(v * 100) / 100;
  const openOf = (t, share, realized) => ({ source: 'gmgn', token: t.symbol || t.address.slice(0, 6), address: t.address, mint: t.address, chain: 'Solana', cost: round(t.cost * share), qty: t.bought != null && t.sold != null ? Math.max(0, t.bought - t.sold) : null, openedAt: new Date(t.buys[0].at).toISOString(), realized: realized != null ? round(realized) : 0 });

  // GMGN wallet stats (7 and 30 days; an object or a one-row list) -> the Home tile numbers; null without the 7-day read.
  function stats(s7, s30) {
    const first = (d) => (Array.isArray(d) ? d[0] : d && Array.isArray(d.list) ? d.list[0] : d) || null;
    const a = first(s7), b = first(s30);
    if (!a) return null;
    const pnl = a.pnl_stat || {};
    const roi = (r) => { if (!r) return null; const p = n(r.realized_profit), c = n(r.bought_cost != null ? r.bought_cost : r.total_cost); if (c > 0 && p != null) return p / c; return n(r.realized_profit_pnl != null ? r.realized_profit_pnl : r.pnl); };
    return { realized7: n(a.realized_profit), roi7: roi(a), unrealized: n(a.unrealized_profit), winRate: n(pnl.winrate) != null ? Math.round(n(pnl.winrate) * 100) : null, tokens: Math.round(n(pnl.token_num) || 0), buys: Math.round(n(a.buy) || 0), sells: Math.round(n(a.sell) || 0), realized30: b ? n(b.realized_profit) : null, roi30: roi(b) };
  }

  const api = { parseWalletInput, trades, stats, LEFT_CLOSED, LEFT_OPEN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GmgnSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
