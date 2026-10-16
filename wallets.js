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

  // A setup link (docs/features/my-wallets.md, Setup link): ?mine=<addr>,<addr>&names=<name>,<name> ->
  // { wallets, names: { addr: name }, skipped } or null without a mine parameter. Bad entries are skipped; a name
  // pairs with the wallet in the same position; duplicates keep their first position.
  const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  function setupLink(search) {
    let q;
    try { q = new URLSearchParams(String(search || '')); } catch { return null; }
    const mine = q.get('mine');
    if (mine == null) return null;
    const list = mine.split(',').map((x) => x.trim());
    const nameList = (q.get('names') || '').split(',').map((x) => x.trim().slice(0, 40));
    const wallets = [];
    const names = {};
    let skipped = 0;
    list.forEach((w, i) => {
      if (!w) return;
      if (!SOL_ADDR.test(w)) { skipped++; return; }
      if (!wallets.includes(w)) wallets.push(w);
      if (nameList[i] && !names[w]) names[w] = nameList[i];
    });
    return { wallets, names, skipped };
  }

  // Pasted wallets (docs/features/my-wallets.md, Paste my wallets): one per line or separated by commas; each may be a
  // bare address or a GMGN wallet link (with or without the referral code), with an optional name after a space.
  // -> { wallets, names, skipped } like setupLink.
  const GMGN_LINK = /gmgn\.ai\/sol\/(?:address|wallet)\/(?:[A-Za-z0-9]{4,12}_)?([1-9A-HJ-NP-Za-km-z]{32,44})(?![1-9A-HJ-NP-Za-km-z])/i;
  const walletOf = (tok) => { if (SOL_ADDR.test(tok)) return tok; const m = GMGN_LINK.exec(tok); return m ? m[1] : null; };
  function parsePaste(text) {
    const wallets = [];
    const names = {};
    let skipped = 0;
    for (const seg of String(text || '').split(/[\n,]+/)) {
      const parts = seg.trim().split(/\s+/).filter(Boolean);
      if (!parts.length) continue;
      const w = walletOf(parts[0]);
      if (!w) { skipped++; continue; }
      if (!wallets.includes(w)) wallets.push(w);
      const name = parts.slice(1).join(' ').trim().slice(0, 40);
      if (name && !names[w]) names[w] = name;
    }
    return { wallets, names, skipped };
  }

  const api = { mergeTrades, splitTrades, mergeOpen, sumBalances, sumStats, labelFor, isAllInput, setupLink, parsePaste, short, ALL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Wallets = api;
})(typeof window !== 'undefined' ? window : globalThis);
