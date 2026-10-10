// Wallet memory: pure helpers, no DOM, no network. Learns which wallets took profit on coins from the Call queue that
// later rugged or ran, grades each wallet over time, and matches the graded wallets against a new coin's wallets.
(function (root) {
  'use strict';
  const RUG_RET = -0.8;       // a mark at -80% or worse: rugged
  const RUN_RET = 2;          // a mark at +200% (3×) or better: ran
  const MIN_PROFIT = 500;     // USD a wallet must have made on the coin to be remembered
  const EARLY_MS = 10 * 60000; // bought no later than 10 minutes after the call was seen
  const MAX_WALLETS = 5000;
  const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

  // A priced call from the Call queue book { at, ret: { '1h' | '6h' | '24h': number | 'missed' } }.
  // 'rug' as soon as any mark is -80% or worse; 'runner' once the 24h mark is in and a mark reached 3×;
  // null when it is neither (or never priced); 'pending' while it can still go either way.
  function outcome(entry) {
    const ret = (entry && entry.ret) || {};
    const marks = Object.values(ret).filter((r) => typeof r === 'number');
    if (marks.some((r) => r <= RUG_RET)) return 'rug';
    if (ret['24h'] === undefined) return 'pending';
    if (marks.some((r) => r >= RUN_RET)) return 'runner';
    return null;
  }

  // GMGN top traders by profit: the real wallets that were in early and took real profit.
  function profitable(list, calledAt) {
    return (list || [])
      .filter((t) => t && t.address && !t.exchange && (n(t.addr_type) || 0) === 0)
      .map((t) => ({ address: t.address, usd: Math.max(n(t.realized_profit) || 0, n(t.profit) || 0), start: n(t.start_holding_at) }))
      .filter((t) => t.usd >= MIN_PROFIT && (t.start == null || !calledAt || t.start * 1000 <= calledAt + EARLY_MS))
      .map(({ address, usd }) => ({ address, usd }));
  }

  const empty = () => ({ coins: {}, wallets: {} });

  // Records one finished coin and the wallets that profited on it. Learning the same coin twice changes nothing.
  function learn(mem, coin, label, wallets, now) {
    const m = { coins: Object.assign({}, (mem || {}).coins), wallets: Object.assign({}, (mem || {}).wallets) };
    if (m.coins[coin.address] || (label !== 'rug' && label !== 'runner')) return m;
    m.coins[coin.address] = { label, symbol: coin.symbol || '', chain: coin.chain || '', at: now, wallets: wallets.length };
    for (const w of wallets) {
      const r = Object.assign({ rug: 0, run: 0, usd: 0, last: 0 }, m.wallets[w.address]);
      if (label === 'rug') r.rug++; else r.run++;
      r.usd += w.usd; r.last = now;
      m.wallets[w.address] = r;
    }
    const all = Object.entries(m.wallets);
    if (all.length > MAX_WALLETS) {
      all.sort((a, b) => a[1].last - b[1].last).slice(0, all.length - MAX_WALLETS).forEach(([a]) => delete m.wallets[a]);
    }
    return m;
  }

  // rug: profited on 2+ rugs, at least twice as many rugs as runners; runner: the mirror; bot: profits on both;
  // null: seen once, not enough to say.
  function grade(rec) {
    if (!rec) return null;
    if (rec.rug >= 2 && rec.rug >= 2 * rec.run) return 'rug';
    if (rec.run >= 2 && rec.run >= 2 * rec.rug) return 'runner';
    if (rec.rug >= 1 && rec.run >= 1) return 'bot';
    return null;
  }

  // The graded wallets among a coin's addresses.
  function match(mem, addresses) {
    const out = { rug: [], runner: [], bot: [] };
    const wallets = (mem && mem.wallets) || {};
    for (const a of new Set(addresses || [])) {
      const rec = wallets[a], g = grade(rec);
      if (g) out[g].push(Object.assign({ address: a }, rec));
    }
    for (const k of Object.keys(out)) out[k].sort((x, y) => (y.rug + y.run) - (x.rug + x.run));
    return out;
  }

  function stats(mem) {
    const coins = Object.values((mem && mem.coins) || {});
    const by = { rug: 0, runner: 0, bot: 0 };
    for (const rec of Object.values((mem && mem.wallets) || {})) { const g = grade(rec); if (g) by[g]++; }
    return { rugs: coins.filter((c) => c.label === 'rug').length, runners: coins.filter((c) => c.label === 'runner').length, wallets: Object.keys((mem && mem.wallets) || {}).length, graded: by };
  }

  const api = { outcome, profitable, empty, learn, grade, match, stats, RUG_RET, RUN_RET, MIN_PROFIT, MAX_WALLETS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WalletMem = api;
})(typeof window !== 'undefined' ? window : globalThis);
