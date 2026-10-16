// My wallets (docs/features/my-wallets.md): pure helpers, no DOM, no network. Several of the owner's wallets seen as
// one: trades merged with a wallet tag and split back for saving, balances summed, GMGN stats summed, wallet labels.
(function (root) {
  'use strict';
  const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const ALL = 'all'; // the pseudo wallet key the combined view keeps its own balance history under

  // { wallet: trades[] } -> one list, each trade tagged with its wallet (in memory only), newest close last.
  function mergeTrades(byWallet) {
    const out = [];
    for (const [wallet, list] of Object.entries(byWallet || {})) for (const t of list || []) out.push(Object.assign({}, t, { wallet }));
    return out.sort((a, b) => Date.parse(a.closedAt) - Date.parse(b.closedAt));
  }
  // The merged list -> { wallet: trades[] } with the tag stripped; a trade without a tag goes to fallback.
  function splitTrades(trades, wallets, fallback) {
    const out = {};
    for (const w of wallets || []) out[w] = [];
    for (const t of trades || []) {
      const w = t.wallet && out[t.wallet] ? t.wallet : fallback;
      if (!w) continue;
      const rest = Object.assign({}, t);
      delete rest.wallet;
      (out[w] = out[w] || []).push(rest);
    }
    return out;
  }
  const mergeOpen = (byWallet) => [].concat(...Object.entries(byWallet || {}).map(([wallet, list]) => (list || []).map((p) => Object.assign({}, p, { wallet }))));

  // Balance snapshots [{ sol, solPrice, tokens: [{ mint, amount, usd }], tokenUsd, totalUsd }] -> one snapshot, tokens
  // merged by mint, plus the count of wallets read.
  function sumBalances(list) {
    const got = (list || []).filter(Boolean);
    if (!got.length) return null;
    const tokens = new Map();
    for (const w of got) for (const t of w.tokens || []) {
      const cur = tokens.get(t.mint) || { mint: t.mint, amount: 0, usd: 0, priced: true };
      cur.amount += n(t.amount) || 0;
      if (Number.isFinite(t.usd)) cur.usd += t.usd; else cur.priced = false;
      tokens.set(t.mint, cur);
    }
    const toks = [...tokens.values()].map((t) => ({ mint: t.mint, amount: t.amount, usd: t.priced ? t.usd : NaN })).sort((a, b) => (b.usd || 0) - (a.usd || 0));
    const sol = got.reduce((s, w) => s + (n(w.sol) || 0), 0);
    const solPrice = got.map((w) => n(w.solPrice)).find((p) => p > 0) || null;
    const tokenUsd = toks.reduce((s, t) => s + (t.usd || 0), 0);
    return { sol, solPrice, tokens: toks, tokenUsd, totalUsd: sol * (solPrice || 0) + tokenUsd, wallets: got.length, at: Date.now() };
  }

  // GmgnSync.stats() results -> summed realized profit, tokens, buys and sells; the win rate weighted by tokens traded.
  function sumStats(list) {
    const got = (list || []).filter(Boolean);
    if (!got.length) return null;
    const add = (k) => (got.some((s) => n(s[k]) != null) ? got.reduce((a, s) => a + (n(s[k]) || 0), 0) : null);
    const weighted = got.filter((s) => s.winRate != null && s.tokens > 0);
    const wt = weighted.reduce((a, s) => a + s.tokens, 0);
    return {
      realized7: add('realized7'), realized30: add('realized30'), unrealized: add('unrealized'),
      tokens: add('tokens') || 0, buys: add('buys') || 0, sells: add('sells') || 0,
      winRate: wt ? Math.round(weighted.reduce((a, s) => a + s.winRate * s.tokens, 0) / wt) : null,
      wallets: got.length,
    };
  }

  // The name shown for a wallet: the name the owner gave it (names: address -> name), else its FOMO handle in the
  // linked list, else its short address.
  const short = (a) => (a ? a.slice(0, 4) + '…' + a.slice(-4) : '');
  function labelFor(address, profiles, names) {
    if (names && names[address]) return names[address];
    const hit = Object.keys(profiles || {}).find((k) => profiles[k] === address && !k.includes('…'));
    return hit || short(address);
  }
  const isAllInput = (text) => /^\s*all(\s+my\s+wallets)?\s*$/i.test(String(text || ''));

  const api = { mergeTrades, splitTrades, mergeOpen, sumBalances, sumStats, labelFor, isAllInput, short, ALL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Wallets = api;
})(typeof window !== 'undefined' ? window : globalThis);
