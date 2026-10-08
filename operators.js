// Operator check: pure helpers (no DOM, no network). Groups top holders that one person runs, from
// Helius wallet histories, and estimates what the biggest group could do to the price.
// Idea and signal names credit CrawlScan (crawlscan.fun, MIT); this code is written for this app.
(function (root) {
  'use strict';
  const WSOL = 'So11111111111111111111111111111111111111112';
  const LINK_WINDOW_SEC = 72 * 3600;
  // Exchange hot wallets fund thousands of unrelated users, so a shared exchange funder is not a link.
  const EXCHANGES = new Set([
    '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9', '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', // Binance
    'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS', // Coinbase
    '5VCwKtCXgCJ6kit5FybXjvriW3xELsFDhYrPSqtJNmcD', // OKX
    'AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2', // Bybit
  ]);

  // txs: Helius enhanced transactions for `addr` (any order). complete: the whole history was read.
  function walletLinks(addr, txs, mint, complete) {
    const list = (txs || []).filter((t) => t && t.timestamp).slice().sort((a, b) => a.timestamp - b.timestamp);
    let funder = null, fundedAt = null, gotFrom = null, gotByTransfer = false;
    if (complete) {
      for (const t of list) {
        const inSol = (t.nativeTransfers || []).find((x) => x.toUserAccount === addr && x.fromUserAccount && x.fromUserAccount !== addr && Number(x.amount) > 0);
        if (inSol) { funder = inSol.fromUserAccount; fundedAt = t.timestamp; break; }
      }
    }
    for (const t of list) {
      if (t.type === 'SWAP' || t.feePayer === addr) continue;
      const gift = (t.tokenTransfers || []).find((x) => x.mint === mint && x.toUserAccount === addr && x.fromUserAccount && x.fromUserAccount !== addr);
      if (gift) { gotByTransfer = true; gotFrom = gotFrom || gift.fromUserAccount; }
    }
    let virgin = false;
    if (complete) {
      const firstTouch = list.findIndex((t) => (t.tokenTransfers || []).some((x) => x.mint === mint));
      const before = firstTouch < 0 ? list : list.slice(0, firstTouch);
      virgin = !before.some((t) => (t.tokenTransfers || []).some((x) => x.mint !== mint && x.mint !== WSOL && (x.toUserAccount === addr || x.fromUserAccount === addr)));
    }
    return { funder, fundedAt, gotFrom, gotByTransfer, virgin, complete: !!complete };
  }

  // holders: [{ addr, pct, funder, fundedAt, gotFrom }]. Returns operators, biggest first.
  function cluster(holders) {
    const list = holders || [];
    const parent = list.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const join = (i, j) => { parent[find(i)] = find(j); };
    const idx = new Map(list.map((x, i) => [x.addr, i]));
    list.forEach((a, i) => {
      if (a.funder && idx.has(a.funder)) join(i, idx.get(a.funder));
      if (a.gotFrom && idx.has(a.gotFrom)) join(i, idx.get(a.gotFrom));
      list.forEach((b, j) => {
        if (j <= i || !a.funder || a.funder !== b.funder || EXCHANGES.has(a.funder)) return;
        if (a.fundedAt != null && b.fundedAt != null && Math.abs(a.fundedAt - b.fundedAt) <= LINK_WINDOW_SEC) join(i, j);
      });
    });
    const groups = new Map();
    list.forEach((x, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, { wallets: [], pct: 0 }); const g = groups.get(r); g.wallets.push(x.addr); g.pct += Number(x.pct) || 0; });
    return [...groups.values()].sort((a, b) => (b.pct - a.pct) || (b.wallets.length - a.wallets.length));
  }

  // Selling pct% of supply into an x*y=k pool with `liqUsd` total liquidity.
  function dumpDrop(pct, mcapUsd, liqUsd) {
    if (!(mcapUsd > 0) || !(liqUsd > 0) || !(pct >= 0)) return null;
    const R = liqUsd / 2, x = (pct / 100) * mcapUsd;
    return 1 - (R / (R + x)) ** 2;
  }

  function summarize(holders, mcapUsd, liqUsd) {
    const ops = cluster(holders);
    const top = ops[0] ? Object.assign({}, ops[0], { drop: dumpDrop(ops[0].pct, mcapUsd, liqUsd) }) : null;
    const sum = (f) => (holders || []).filter(f).reduce((s, x) => s + (Number(x.pct) || 0), 0);
    return { operators: ops, top, analyzedPct: sum(() => true), transferPct: sum((x) => x.gotByTransfer), virginPct: sum((x) => x.virgin) };
  }

  const api = { walletLinks, cluster, dumpDrop, summarize, EXCHANGES, LINK_WINDOW_SEC };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Operators = api;
})(typeof window !== 'undefined' ? window : globalThis);
