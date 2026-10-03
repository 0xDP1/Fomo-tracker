// Followed traders: pure helpers (no DOM, no network) that turn a trader's parsed FOMO trades into a feed.
(function (root) {
  'use strict';

  // "@Alice", "fomo.family/@alice" or a profile URL -> "alice". Returns '' when it isn't a plausible handle.
  function normHandle(raw) {
    let s = String(raw || '').trim();
    const m = s.match(/fomo\.family\/@?([^/?#\s]+)/i);
    if (m) s = m[1];
    s = s.replace(/^@/, '').toLowerCase();
    return /^[a-z0-9_.]{1,32}$/.test(s) ? s : '';
  }

  const ev = (handle, side, at, usd, pnl, t, id) => ({
    key: `${handle}|${side}|${id}`, handle, side, at, usd: Number(usd) || 0, pnl: pnl == null ? null : Number(pnl),
    token: t.token || '?', address: t.address || '', chain: t.chain || '',
  });

  // items: output of parseFomoTrade (positions) or its fill rows. Each position gives a buy at open,
  // and a sell at close once it is fully sold. Fill rows keep their own side.
  function toEvents(handle, items) {
    const out = [];
    for (const t of items || []) {
      if (t.fill) {
        if (t.at && (t.side === 'buy' || t.side === 'sell')) out.push(ev(handle, t.side, t.at, t.value, t.side === 'sell' ? t.pnl : null, t, t.id));
        continue;
      }
      if (t.openedAt) out.push(ev(handle, 'buy', t.openedAt, t.cost, null, t, t.id));
      if (!t.isOpen && t.closedAt) out.push(ev(handle, 'sell', t.closedAt, t.proceeds, (Number(t.proceeds) || 0) - (Number(t.cost) || 0), t, t.id));
    }
    return out;
  }

  // Merge several traders' events, newest first, dropping duplicates.
  function mergeFeed(lists, limit = 40) {
    const seen = new Map();
    for (const list of lists || []) for (const e of list || []) if (!seen.has(e.key)) seen.set(e.key, e);
    return [...seen.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
  }

  const api = { normHandle, toEvents, mergeFeed };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Follow = api;
})(typeof window !== 'undefined' ? window : globalThis);
