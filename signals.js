// Signal scorecard and callers leaderboard: pure helpers (no DOM, no network). Which call signals were followed
// by gains, from the Call queue's paper book, and the caller directory ranked by win rate.
(function (root) {
  'use strict';
  const MIN_GROUP = 5;          // priced calls at 6h before a group's numbers mean anything
  const HORIZONS = ['1h', '6h', '24h'];
  /** @type {[string, string, string[] | null][]} */
  const SIGNALS = [
    ['Bundled', 'bundle', ['30%+', '15–30%', 'under 15%', 'not scanned']],
    ['First caller win rate', 'caller', ['50%+', '40–49%', 'under 40%', 'no record']],
    ['Rug verdict', 'verdict', ['Looks OK', 'Caution', 'High risk', 'Walk away', 'not checked']],
    ['Channel', 'channels', null],
    ['Liquidity', 'liq', ['$30k+', '$10–30k', 'under $10k']],
  ];
  const UNKNOWN = { bundle: 'not scanned', caller: 'no record', verdict: 'not checked' };

  function signalsOf(e, profile) {
    const b = e && e.bundle;
    const w = profile && profile.winRate;
    const liq = e && e.liq;
    return {
      bundle: !b || !b.scanned || b.bundledPct == null ? 'not scanned' : b.bundledPct >= 30 ? '30%+' : b.bundledPct >= 15 ? '15–30%' : 'under 15%',
      caller: w == null ? 'no record' : w >= 50 ? '50%+' : w >= 40 ? '40–49%' : 'under 40%',
      verdict: (e && e.verdict) || 'not checked',
      channels: ((e && e.channels) || []).slice(),
      liq: liq == null ? 'under $10k' : liq >= 30000 ? '$30k+' : liq >= 10000 ? '$10–30k' : 'under $10k',
    };
  }

  // Fill each book entry's signals from its queue entry: unknown values get filled as checks finish; known ones stay.
  function fillSignals(book, queue, profiles) {
    return (book || []).map((x) => {
      const e = (queue || {})[x.address];
      if (!e) return x;
      const fresh = signalsOf(e, (profiles || {})[String(e.firstPoster || '').toLowerCase()]);
      if (!x.sig) return Object.assign({}, x, { sig: fresh });
      const sig = Object.assign({}, x.sig);
      for (const k of Object.keys(UNKNOWN)) if (!sig[k] || sig[k] === UNKNOWN[k]) sig[k] = fresh[k];
      if (!sig.channels || !sig.channels.length) sig.channels = fresh.channels;
      if (!sig.liq) sig.liq = fresh.liq;
      return JSON.stringify(sig) === JSON.stringify(x.sig) ? x : Object.assign({}, x, { sig });
    });
  }

  const mark = (list, k) => {
    const rs = list.map((x) => (x.ret || {})[k]).filter((r) => typeof r === 'number');
    return { n: rs.length, up: rs.filter((r) => r > 0).length, avg: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null };
  };

  // [{ signal, group, calls, h1, h6, h24, enough }] for every group that has at least one call.
  function scorecard(book) {
    const withSig = (book || []).filter((x) => x.sig);
    const rows = [];
    for (const [signal, key, order] of SIGNALS) {
      const groups = new Map();
      for (const x of withSig) for (const g of [].concat(/** @type {any} */ (x.sig)[key] || [])) { if (!groups.has(g)) groups.set(g, []); groups.get(g).push(x); }
      const names = order ? order.filter((g) => groups.has(g)) : [...groups.keys()];
      for (const g of names) {
        const list = groups.get(g);
        const r = { signal, group: g, calls: list.length };
        for (const h of HORIZONS) r['h' + h.replace('h', '')] = mark(list, h);
        r.enough = r.h6.n >= MIN_GROUP;
        rows.push(r);
      }
    }
    return rows;
  }

  // own: Calls.callerStats(book) rows ({ poster, h6: { n, up, avg } }).
  function leaderboard(profiles, own, minCalls) {
    const ownBy = new Map((own || []).map((r) => [String(r.poster).toLowerCase(), r]));
    return Object.entries(profiles || {})
      .filter(([, p]) => p && p.winRate != null)
      .map(([key, p]) => ({ key, name: p.name || key, medal: p.medal, group: p.group || '', winRate: p.winRate, hit7: p.hit7 == null ? null : p.hit7, median: p.median == null ? null : p.median, samples: p.calls30 != null ? p.calls30 : p.calls || 0, updatedAt: p.updatedAt || 0, own: ownBy.get(key) || null }))
      .filter((r) => r.samples >= (minCalls || 0))
      .sort((a, b) => b.winRate - a.winRate || b.samples - a.samples || a.name.localeCompare(b.name));
  }

  const postedBy = (e, name) => { const n = String(name || '').toLowerCase(); return String(e.firstPoster || '').toLowerCase() === n || (e.posters || []).some((p) => String(p).toLowerCase() === n); };

  const api = { signalsOf, fillSignals, scorecard, leaderboard, postedBy, MIN_GROUP, SIGNALS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Signals = api;
})(typeof window !== 'undefined' ? window : globalThis);
