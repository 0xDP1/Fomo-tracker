// Wallet copy gates (docs/features/wallet-gates.md): pure helpers, no DOM, no network. Four pass / fail gates on a
// wallet from GMGN's wallet stats (7 and 30 days), its all-time profits and the Wallet report's own trade stats, then
// one verdict that names its cause. A gate that could not be measured is "none", never a pass.
// Approach and thresholds credit: GMGN's wallet-analysis agent skill (github.com/GMGNAI/gmgn-skills).
(function (root) {
  'use strict';
  const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const i = (v) => Math.round(n(v) || 0);
  const MIN_TOKENS = 5;        // fewer tokens traded: no ratio on the record means anything
  const ONE_COIN = 0.75;       // the largest closed gain's share of all gains that makes it a one-coin record
  const MIN_WINNERS = 3, MIN_CLOSED = 8; // the one-coin test needs this much evidence
  const COOLED_7D = -0.10, GOOD_ALL = 0.10; // −10% over 7 days after +10% all-time: was good, not any more
  const MIN_ENTRY_MCAP = 30000; // median entry market cap under this: it buys before graduation
  const BIG_FOLLOWERS = 10000, SMALL_CAP = 1e6; // a crowd this size moves small caps before your order lands
  const MAX_TRADES_DAY = 100, MIN_AVG_BUY = 50;
  const LOSS_SHARE = 0.35;     // this share of its tokens down more than 50%: it does not cut
  const TAG_LABEL = { smart_money: 'smart money', kol: 'KOL', top_followed: 'widely followed', top_renamed: 'often renamed', sniper: 'sniper', rat_trader: 'rat trader', bundler: 'bundler', insider: 'insider', dev: 'dev', fresh_wallet: 'fresh wallet', wash_trader: 'wash trading flag', mev_bot: 'MEV bot', sandwich_bot: 'sandwich bot', bluechip_owner: 'bluechip owner', whale: 'whale', gmgn: 'GMGN user', photon: 'Photon user', bullx: 'BullX user', maestro: 'Maestro user', pepeboost: 'PepeBoost user' };

  const money = (v) => (v == null ? '?' : `${v < 0 ? '−' : ''}$${Math.abs(v) >= 1e6 ? (Math.abs(v) / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? Math.round(Math.abs(v) / 1e3) + 'k' : Math.round(Math.abs(v))}`);
  const pct = (v) => (v == null ? '?' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v * 100))}%`);
  const first = (d) => (Array.isArray(d) ? d[0] : d && Array.isArray(d.list) ? d.list[0] : d) || null;
  // A window's realized return: GMGN's own ratio when it gives one, else realized profit ÷ cost.
  const roiOf = (r, profitKey, costKey) => {
    if (!r) return null;
    const p = n(r[profitKey]), c = n(r[costKey]);
    if (c > 0 && p != null) return p / c;
    return profitKey === 'realized_profit' ? n(r.realized_profit_pnl != null ? r.realized_profit_pnl : r.pnl) : null;
  };

  // GMGN wallet stats for 7 and 30 days (an object, or a one-row list for a batch) and all-time profits -> one record.
  // Null without the 7-day stats; 30 days and all-time are optional (the gates say what is missing).
  function record(stats7, stats30, profitsAll) {
    const s7 = first(stats7), s30 = first(stats30), pa = first(profitsAll);
    if (!s7) return null;
    const pnl = s7.pnl_stat || {}, common = s7.common || {};
    const tags = Array.isArray(common.tags) ? common.tags.filter((t) => typeof t === 'string') : common.tag ? [String(common.tag)] : [];
    return {
      tokens: i(pnl.token_num),
      winRate: n(pnl.winrate) != null ? Math.round(n(pnl.winrate) * 100) : null,
      buys7: i(s7.buy), sells7: i(s7.sell),
      realized7: n(s7.realized_profit), roi7: roiOf(s7, 'realized_profit', 'bought_cost'),
      realized30: s30 ? n(s30.realized_profit) : null, roi30: roiOf(s30, 'realized_profit', 'bought_cost'),
      realizedAll: pa ? n(pa.total_realized_profit) : null, roiAll: roiOf(pa, 'total_realized_profit', 'total_realized_profit_cost'),
      avgHoldSec: n(pnl.avg_holding_period),
      buckets: { gt5x: i(pnl.pnl_gt_5x_num), x2to5: i(pnl.pnl_2x_5x_num), x0to2: i(pnl.pnl_0x_2x_num), lt0: i(pnl.pnl_nd5_0x_num), ltNeg50: i(pnl.pnl_lt_nd5_num) },
      tags,
      twitter: typeof common.twitter_username === 'string' ? common.twitter_username : '',
      followers: i(common.followers_count),
      createdTokens: i(common.created_token_count),
    };
  }

  // The one-coin test from the Wallet report's own closed trades: the largest gain's share of all gains, with enough
  // evidence (one winner among few trades is 100% by arithmetic, not by evidence).
  function concentration(pairs) {
    const closed = (pairs || []).filter((p) => p.closed);
    const wins = closed.filter((p) => p.ret > 0).map((p) => p.sellUsd * p.ret / (1 + p.ret));
    if (wins.length < MIN_WINNERS || closed.length < MIN_CLOSED) return null;
    const total = wins.reduce((s, x) => s + x, 0);
    return total > 0 ? Math.max(...wins) / total : null;
  }

  const median = (xs) => { const s = (xs || []).filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const gate = (key, label, state, why, cause) => ({ key, label, state, why, cause: cause || '' });

  // rec: record(); s: WalletReport.stats(); pairs: WalletReport.pair(); mcaps: WalletReport.entryMcaps().
  function gates(rec, s, pairs, mcaps) {
    const out = [];
    const has = (t) => !!(rec && rec.tags.includes(t));
    // G1 Real record
    if (!rec) out.push(gate('record', 'Real record', 'none', 'GMGN wallet stats not read'));
    else if (rec.tokens < MIN_TOKENS) out.push(gate('record', 'Real record', 'none', `only ${rec.tokens} tokens traded: too few to judge`, 'thin'));
    else if (rec.createdTokens > 0 && rec.createdTokens > 0.5 * rec.tokens) out.push(gate('record', 'Real record', 'fail', `launched ${rec.createdTokens} coins against ${rec.tokens} traded: its win rate is self-made`, 'it is a launcher trading its own coins'));
    else {
      const conc = concentration(pairs);
      if (conc != null && conc >= ONE_COIN) out.push(gate('record', 'Real record', 'fail', `one coin made ${Math.round(conc * 100)}% of its recent gains`, 'one coin made all the money'));
      else if (has('wash_trader')) out.push(gate('record', 'Real record', 'none', 'GMGN flags wash trading, which this app cannot check without its holdings', 'wash'));
      else out.push(gate('record', 'Real record', 'pass', `${rec.tokens} tokens traded${rec.createdTokens ? `, ${rec.createdTokens} launched` : ''}${conc != null ? `, biggest win ${Math.round(conc * 100)}% of gains` : ''}`));
    }
    // G2 Still working
    if (!rec) out.push(gate('current', 'Still working', 'none', 'GMGN wallet stats not read'));
    else if (rec.buys7 + rec.sells7 === 0) out.push(gate('current', 'Still working', 'none', 'no trades in the last 7 days', 'idle'));
    else if (rec.roi7 != null && rec.roiAll != null && rec.roi7 <= COOLED_7D && rec.roiAll > GOOD_ALL) out.push(gate('current', 'Still working', 'fail', `${pct(rec.roi7)} over 7 days after ${pct(rec.roiAll)} all-time: was good, not any more`, 'it has stopped making money'));
    else if (rec.realized7 != null && rec.realized30 != null && rec.realized7 < 0 && rec.realized30 < 0) out.push(gate('current', 'Still working', 'fail', `lost ${money(rec.realized7)} over 7 days and ${money(rec.realized30)} over 30`, 'it has stopped making money'));
    else if (rec.roiAll != null && rec.roiAll <= 0 && rec.realized7 != null && rec.realized7 <= 0) out.push(gate('current', 'Still working', 'fail', `${money(rec.realizedAll)} all-time and ${money(rec.realized7)} this week: it never worked`, 'it has never made money'));
    else if (rec.roiAll == null) out.push(gate('current', 'Still working', 'none', 'all-time profits not read, so the week cannot be compared with the record'));
    else out.push(gate('current', 'Still working', 'pass', `${pct(rec.roi7)} over 7 days${rec.roi30 != null ? `, ${pct(rec.roi30)} over 30` : ''}, ${pct(rec.roiAll)} all-time`));
    // G3 Reachable
    const medMc = median(Object.values(mcaps || {}));
    if (has('mev_bot') || has('sandwich_bot')) out.push(gate('reach', 'Reachable', 'fail', 'an MEV or sandwich bot: its edge is ordering power over orders like yours', 'you cannot get its fills'));
    else if (!s || !s.tokens) out.push(gate('reach', 'Reachable', 'none', 'no recent trades read'));
    else if (medMc != null && medMc < MIN_ENTRY_MCAP) out.push(gate('reach', 'Reachable', 'fail', `median entry market cap ${money(medMc)}: it buys before graduation, you would enter at several times its cost`, 'you cannot get its fills'));
    else if (rec && rec.followers >= BIG_FOLLOWERS && (medMc == null || medMc < SMALL_CAP)) out.push(gate('reach', 'Reachable', 'fail', `${money(rec.followers).slice(1)} followers trading small caps: its crowd moves the price before your order lands`, 'you cannot get its fills'));
    else if (s.tradesPerDay > MAX_TRADES_DAY) out.push(gate('reach', 'Reachable', 'fail', `${Math.round(s.tradesPerDay)} trades a day: a bot you would always trail`, 'you cannot get its fills'));
    else if (s.avgSizeUsd < MIN_AVG_BUY) out.push(gate('reach', 'Reachable', 'fail', `average buy ${money(s.avgSizeUsd)}: too small for your fees to leave anything`, 'you cannot get its fills'));
    else if (s.medianHoldMin != null && s.medianHoldMin < 1) out.push(gate('reach', 'Reachable', 'fail', 'median hold under a minute: a latency race', 'you cannot get its fills'));
    else out.push(gate('reach', 'Reachable', 'pass', `median hold ${s.medianHoldMin != null ? s.medianHoldMin + ' min' : '?'}, ${medMc != null ? `entry mcap ${money(medMc)}, ` : ''}average buy ${money(s.avgSizeUsd)}, ${Math.round(s.tradesPerDay)} trades a day`));
    // G4 Cuts losses
    if (!rec) out.push(gate('cuts', 'Cuts losses', 'none', 'GMGN wallet stats not read'));
    else if (rec.tokens < MIN_TOKENS) out.push(gate('cuts', 'Cuts losses', 'none', `only ${rec.tokens} tokens traded`));
    else {
      const share = rec.buckets.ltNeg50 / rec.tokens;
      const text = `${Math.round(share * 100)}% of its tokens down more than 50% (${rec.buckets.ltNeg50} of ${rec.tokens})`;
      out.push(share >= LOSS_SHARE ? gate('cuts', 'Cuts losses', 'fail', text + ': it does not cut', 'it does not cut losses') : gate('cuts', 'Cuts losses', 'pass', text));
    }
    return out;
  }

  // One verdict from the gates, in this order: the record and the week can veto, reach and loss-cutting change what to do.
  function verdict(gs) {
    const by = {}; for (const g of gs || []) by[g.key] = g;
    const v = (level, label, cause) => ({ level, label, cause, text: `${label} · ${cause}` });
    const G1 = by.record, G2 = by.current, G3 = by.reach, G4 = by.cuts;
    if (!G1 || !G2 || !G3 || !G4) return v('none', 'No read', 'the gates were not run');
    if (G2.cause === 'idle') return v('none', 'No read', 'no trades in 7 days');
    if (G1.state === 'fail') return v('bad', 'Do not copy', G1.cause);
    if (G1.cause === 'thin') return v('none', 'No read', G1.why.split(':')[0]);
    if (G2.state === 'fail') return v('bad', 'Do not copy', G2.cause);
    if (G1.cause === 'wash') return v('warn', 'Hold off', 'a wash-trading flag this app cannot check');
    if (G1.state === 'none' || G2.state === 'none') return v('warn', 'Hold off', G1.state === 'none' ? 'its record was not measured' : 'its all-time record was not read');
    if (G3.state === 'fail' && G4.state === 'fail') return v('warn', 'Watch, do not copy', 'you cannot get its fills, and it never cuts');
    if (G3.state === 'fail') return v('warn', 'Watch, do not copy', G3.cause);
    if (G4.state === 'fail') return v('warn', 'Copy the buys, not the exits', G4.cause);
    const none = [G3, G4].filter((g) => g.state === 'none').length;
    if (none) return v('warn', 'Hold off', `${none} of the four gates not measured`);
    return v('good', 'Copyable at small size', 'all four pass');
  }

  // Half the wallet's own average buy: above that your slippage is worse than its, so its results stop applying.
  const sizeCap = (s) => (s && s.avgSizeUsd > 0 ? Math.round(s.avgSizeUsd / 2) : null);

  function recordLine(rec) {
    if (!rec) return '';
    const parts = [`${rec.tokens} tokens`, rec.winRate != null ? `${rec.winRate}% won` : '', `realized ${money(rec.realized7)} in 7 days${rec.realizedAll != null ? `, ${money(rec.realizedAll)} all-time` : ''}`, rec.buckets.gt5x ? `${rec.buckets.gt5x} over 5×` : ''];
    return parts.filter(Boolean).join(' · ');
  }
  function identityLine(rec) {
    if (!rec) return '';
    const parts = [rec.tags.map((t) => TAG_LABEL[t] || t.replace(/_/g, ' ')).join(', '), rec.twitter ? `@${rec.twitter}` : '', rec.followers ? `${rec.followers >= 1000 ? (rec.followers / 1000).toFixed(rec.followers >= 10000 ? 0 : 1) + 'k' : rec.followers} followers` : ''];
    return parts.filter(Boolean).join(' · ');
  }
  // Lines for Claude's prompt, so its verdict reads the same facts as the rules.
  function promptLines(gs, v, rec) {
    if (!gs || !gs.length) return [];
    return ['Copy gates from GMGN wallet stats (pass / fail / not measured):', ...gs.map((g) => `- ${g.label}: ${g.state === 'none' ? 'not measured' : g.state} (${g.why})`), `Rule verdict: ${v.text}.`].concat(rec ? [`Record: ${recordLine(rec)}${identityLine(rec) ? `; ${identityLine(rec)}` : ''}.`] : []);
  }

  const api = { record, concentration, gates, verdict, sizeCap, recordLine, identityLine, promptLines, median, TAG_LABEL, MIN_TOKENS, ONE_COIN, LOSS_SHARE, MIN_ENTRY_MCAP, BIG_FOLLOWERS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WalletGates = api;
})(typeof window !== 'undefined' ? window : globalThis);
