// Watchlist: wallets you pasted in Settings, matched against a coin's GMGN top holders and traders. Pure helpers,
// no DOM, no network. Works in the browser (window.Watchlist) and in Node (module.exports) for tests.
(function (root) {
  'use strict';
  const TAGS = ['smart', 'kol', 'rug', 'insider'];
  const NAME_MAX = 30;
  const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const EVM = /^0x[0-9a-fA-F]{40}$/;
  const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const key = (a) => (EVM.test(a) ? a.toLowerCase() : a);

  // Text from the Settings box -> { wallets: [{ address, name, tag }], skipped }. Entries are split by new lines
  // and commas; the first address in an entry is the wallet, a tag word (smart, kol, rug, insider, also #rug or [rug])
  // sets the tag, the other words are the name. Entries without an address are counted as skipped.
  function parse(text) {
    const wallets = [], seen = new Set();
    let skipped = 0;
    for (const entry of String(text || '').split(/[\n,]+/)) {
      const words = entry.trim().split(/\s+/).filter(Boolean);
      if (!words.length) continue;
      const i = words.findIndex((w) => SOL.test(w) || EVM.test(w));
      if (i < 0) { skipped++; continue; }
      const address = key(words[i]);
      let tag = '';
      const rest = [];
      for (const w of words.slice(0, i).concat(words.slice(i + 1))) {
        const t = w.replace(/^[#[]+|]+$/g, '').toLowerCase();
        if (TAGS.includes(t)) { if (!tag) tag = t; } else rest.push(w);
      }
      if (seen.has(address)) continue;
      seen.add(address);
      wallets.push({ address, name: rest.join(' ').slice(0, NAME_MAX), tag });
    }
    return { wallets, skipped };
  }

  // The saved list back as text for the Settings box; parse(toText(x)) gives x again.
  const toText = (wallets) => (wallets || []).map((w) => [w.address, w.name, w.tag ? '#' + w.tag : ''].filter(Boolean).join(' ')).join('\n');

  // GMGN amount_percentage: share of supply held now (0-1). sell_amount_percentage: share of its buy sold (0-1).
  function status(heldPct, soldPct) {
    const held = heldPct != null ? `holds ${heldPct.toFixed(1)}%` : '';
    if (soldPct != null && soldPct >= 0.99) return 'sold';
    if (soldPct != null && soldPct >= 0.01) return [held, `sold ${Math.round(soldPct * 100)}%`].filter(Boolean).join(', ');
    return held || 'in the top traders';
  }

  // Listed wallets among a coin's GMGN top holders and top traders, in list order.
  function match(list, holders, traders) {
    if (!list || !list.length) return [];
    const byAddr = (rows) => { const m = new Map(); for (const r of rows || []) if (r && r.address) m.set(key(r.address), r); return m; };
    const h = byAddr(holders), t = byAddr(traders);
    const out = [];
    for (const w of list) {
      const hr = h.get(w.address), tr = t.get(w.address);
      if (!hr && !tr) continue;
      const frac = n(hr && hr.amount_percentage) ?? n(tr && tr.amount_percentage);
      const heldPct = frac != null ? frac * 100 : null;
      const soldPct = n(tr && tr.sell_amount_percentage);
      out.push(Object.assign({}, w, { heldPct, soldPct, status: status(heldPct, soldPct) }));
    }
    return out;
  }

  const api = { parse, toText, match, TAGS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Watchlist = api;
})(typeof window !== 'undefined' ? window : globalThis);
