// Find a trader: pure helpers (no DOM, no network) that read a FOMO profile's win rate and trading style.
(function (root) {
  'use strict';
  const Stats = typeof module !== 'undefined' && module.exports ? require('./stats.js') : root.Stats;

  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const MIN_CLOSED = 5; // fewer closed trades than this is not enough for a style read

  const holdLabel = (sec) => (sec < 15 * 60 ? 'Scalper' : sec < 6 * 3600 ? 'Day trader' : sec < 3 * 86400 ? 'Swing trader' : 'Holder');
  const activityLabel = (perDay) => (perDay >= 20 ? 'Very active' : perDay >= 5 ? 'Active' : 'Selective');
  function winProfileLabel(winRate, payoff) {
    if (winRate < 0.45 && payoff >= 2) return 'Lottery hunter';
    if (winRate >= 0.6 && payoff < 1) return 'Quick profit taker';
    return 'Balanced';
  }
  const median = (xs) => { const a = xs.slice().sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

  // Win rate and trading style from a profile and its parsed trades ({cost, proceeds, openedAt, closedAt, isOpen, chain}).
  function style(profile, trades) {
    const p = profile || {};
    const all = trades || [];
    const closed = all.filter((t) => !t.isOpen);
    const s = closed.length ? Stats.computeStats(closed) : null;
    const holds = closed.filter((t) => t.openedAt && t.closedAt).map((t) => (Date.parse(t.closedAt) - Date.parse(t.openedAt)) / 1000).filter((x) => x >= 0);
    const medianHoldSec = holds.length ? median(holds) : num(p.averageHoldTimeSeconds);

    let tradesPerDay = null;
    const total = num(p.numTrades), age = num(p.accountAgeDays);
    if (total != null && age != null && age > 0) tradesPerDay = total / Math.max(1, age);
    else if (all.length) {
      const times = all.flatMap((t) => [t.openedAt, t.closedAt]).map((x) => Date.parse(x)).filter(Number.isFinite);
      const spanDays = times.length ? (Math.max(...times) - Math.min(...times)) / 86400000 : 0;
      tradesPerDay = all.length / Math.max(1, spanDays);
    }

    const counts = {};
    for (const t of all) if (t.chain) counts[t.chain] = (counts[t.chain] || 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const mainChain = top ? top[0] : '';
    const chainLabel = !top ? '' : top[1] / all.length >= 0.6 ? 'mostly ' + mainChain : 'multi-chain';

    const enough = closed.length >= MIN_CLOSED;
    const hold = medianHoldSec != null ? holdLabel(medianHoldSec) : '';
    const activity = tradesPerDay != null ? activityLabel(tradesPerDay) : '';
    const winProfile = s ? winProfileLabel(s.winRate, s.payoff) : '';
    return {
      enough, closed: closed.length, open: all.length - closed.length,
      wins: s ? s.wins : 0, losses: s ? s.losses : 0, winRate: s ? s.winRate : null,
      avgWinPct: s ? s.avgWinPct : null, avgLossPct: s ? s.avgLossPct : null, payoff: s ? s.payoff : null,
      medianHoldSec, hold, tradesPerDay, activity, winProfile,
      avgSize: all.length ? all.reduce((sum, t) => sum + (Number(t.cost) || 0), 0) / all.length : null,
      mainChain, chainLabel,
      summary: enough ? [hold, activity.toLowerCase(), winProfile.toLowerCase(), chainLabel].filter(Boolean).join(' · ') : '',
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

  const api = { style, profileSummary, handleFromReply, MIN_CLOSED };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Trader = api;
})(typeof window !== 'undefined' ? window : globalThis);
