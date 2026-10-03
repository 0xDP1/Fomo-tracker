// Find a trader: pure helpers (no DOM, no network) for a FOMO profile and its recent trades.
(function (root) {
  'use strict';
  const Stats = typeof module !== 'undefined' && module.exports ? require('./stats.js') : root.Stats;

  const isSol = (s) => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
  const isEvm = (s) => typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s);
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

  // Collect wallet addresses from the profile. The wallets field may be an object, an array of
  // strings or of {chain, address}, or nested; addresses are labelled by their format.
  function parseWallets(profile) {
    const out = { solana: [], evm: [] };
    const add = (s) => {
      if (isSol(s) && !out.solana.includes(s)) out.solana.push(s);
      else if (isEvm(s) && !out.evm.includes(s.toLowerCase())) out.evm.push(s.toLowerCase());
    };
    const walk = (v, depth, keyOk) => {
      if (v == null || depth > 5) return;
      if (typeof v === 'string') { if (keyOk) add(v); return; }
      if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1, keyOk); return; }
      if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, depth + 1, keyOk || /wallet|address|solana|evm/i.test(k));
    };
    const p = profile || {};
    if (p.wallets != null) walk(p.wallets, 0, true);
    if (!out.solana.length && !out.evm.length) walk(p, 0, false);
    return out;
  }

  const EVM_EXPLORERS = [['Base', 'https://basescan.org/address/'], ['BNB', 'https://bscscan.com/address/'], ['Ethereum', 'https://etherscan.io/address/']];
  function explorerLinks(wallets) {
    const links = [];
    for (const a of wallets.solana || []) links.push({ chain: 'Solana', address: a, url: 'https://solscan.io/account/' + a });
    for (const a of wallets.evm || []) for (const [chain, base] of EVM_EXPLORERS) links.push({ chain, address: a, url: base + a });
    return links;
  }

  // trades: parsed app trades ({cost, proceeds, openedAt, closedAt, isOpen}).
  function scorecard(profile, trades) {
    const p = profile || {};
    const all = trades || [];
    const closed = all.filter((t) => !t.isOpen);
    const s = closed.length ? Stats.computeStats(closed) : null;
    const holds = closed.filter((t) => t.openedAt && t.closedAt).map((t) => (Date.parse(t.closedAt) - Date.parse(t.openedAt)) / 1000).filter((x) => x >= 0);
    const times = all.flatMap((t) => [t.openedAt, t.closedAt]).map((x) => Date.parse(x)).filter(Number.isFinite);
    return {
      closed: closed.length,
      open: all.length - closed.length,
      winRate: s ? s.winRate : null,
      realizedPnl: s ? s.netPnl : null,
      avgSize: all.length ? all.reduce((sum, t) => sum + (Number(t.cost) || 0), 0) / all.length : null,
      avgHoldSec: num(p.averageHoldTimeSeconds) ?? (holds.length ? holds.reduce((a, b) => a + b, 0) / holds.length : null),
      totalTrades: num(p.numTrades) ?? all.length,
      lastActive: times.length ? new Date(Math.max(...times)).toISOString() : null,
    };
  }

  function profileSummary(profile) {
    const p = profile || {};
    const f = p.followers;
    return {
      handle: normHandle(p.handle || p.userHandle || ''),
      name: p.displayName || p.display_name || p.name || '',
      followers: num(f && typeof f === 'object' ? f.count ?? f.total : f),
      ageDays: num(p.accountAgeDays),
      isPrivate: p.private === true,
      volumeUsd: num(p.totalVolume ?? p.volumeUsd),
    };
  }

  function normHandle(s) {
    const h = String(s || '').trim().replace(/^@/, '').toLowerCase();
    return /^[a-z0-9_.]{1,32}$/.test(h) ? h : '';
  }

  // Claude's reply to "what handle is on this screenshot": JSON {"handle": ...}, maybe fenced, or prose with @handle.
  function handleFromReply(text) {
    const t = String(text || '');
    const m = t.match(/\{[\s\S]*\}/);
    if (m) {
      try { const j = JSON.parse(m[0]); return j && j.handle ? normHandle(j.handle) : ''; } catch { /* fall through to prose */ }
    }
    const at = t.match(/@([A-Za-z0-9_.]{1,32})/);
    return at ? normHandle(at[1].replace(/\.$/, '')) : '';
  }

  const api = { parseWallets, explorerLinks, scorecard, profileSummary, handleFromReply, isSol, isEvm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Trader = api;
})(typeof window !== 'undefined' ? window : globalThis);
