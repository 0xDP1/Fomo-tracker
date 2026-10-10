// GMGN data (through the Discord feed Worker, which holds the API key): pure helpers, no DOM, no network.
// Early traders (who got in first and whether they have sold), holder labels and a dev's created tokens.
(function (root) {
  'use strict';
  const CHAIN = { solana: 'sol', sol: 'sol', bsc: 'bsc', bnb: 'bsc', 'bnb chain': 'bsc', base: 'base', ethereum: 'eth', eth: 'eth', arbitrum: 'arbitrum', hyperliquid: 'hyperevm', hyperevm: 'hyperevm', robinhood: 'robinhood', 'robinhood chain': 'robinhood', arc: 'arc' };
  const EARLY_N = 10;
  const H = 3600000;
  const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

  const toGmgnChain = (chain) => CHAIN[String(chain || '').trim().toLowerCase()] || null;

  // list: GMGN top traders. The earliest EARLY_N real wallets (pools and exchanges left out) and what they did.
  function earlyTraders(list, count = EARLY_N) {
    const real = (list || []).filter((t) => t && t.addr_type !== 2 && !t.exchange && n(t.start_holding_at) != null);
    if (!real.length) return null;
    const early = real.sort((a, b) => a.start_holding_at - b.start_holding_at).slice(0, count);
    const rows = early.map((t) => ({ address: t.address, startAt: t.start_holding_at * 1000, soldPct: n(t.sell_amount_percentage) || 0, realized: n(t.realized_profit) || 0, heldPct: (n(t.amount_percentage) || 0) * 100, tags: [].concat(t.maker_token_tags || t.tags || []) }));
    return {
      n: rows.length,
      soldHalf: rows.filter((r) => r.soldPct >= 0.5).length,
      exited: rows.filter((r) => r.soldPct >= 0.99).length,
      realized: rows.reduce((a, r) => a + r.realized, 0),
      heldPct: rows.reduce((a, r) => a + r.heldPct, 0),
      rows,
    };
  }

  // GMGN created tokens for a dev wallet: launch counts plus the newest launches (GMGN caps the list at ~100).
  function devFromCreated(data) {
    const d = data && data.data !== undefined && !data.tokens ? data.data : data;
    if (!d || typeof d !== 'object') return null;
    const tokens = Array.isArray(d.tokens) ? d.tokens : Array.isArray(d.list) ? d.list : [];
    const stuck = n(d.inner_count) || 0, graduated = n(d.open_count) || 0;
    const rows = tokens.map((t) => ({ mint: t.token_address || t.address || '', symbol: t.symbol || t.token_symbol || '', launchedAt: (n(t.create_timestamp) || n(t.created_timestamp) || 0) * 1000, mcap: n(t.market_cap), ath: n(t.token_ath_mc) })).filter((r) => r.mint);
    return { launches: Math.max(stuck + graduated, rows.length), graduated, stuck, rows };
  }

  // Without a pool reading, a launch's state comes from its market cap now (pump.fun coins start near $4-5k).
  function outcomeFromMcap(row, now) {
    if (now - row.launchedAt < 6 * H) return 'new';
    if (row.mcap == null) return 'unknown';
    return row.mcap < 5000 ? 'dead' : row.mcap < 15000 ? 'quiet' : 'alive';
  }

  // GMGN's own wallet labels on the top 100 holders (pools and burn addresses left out). Risky: bundlers, insiders
  // ("rat traders"), snipers and the dev's own wallets. Good: smart money and KOLs, and whether they are selling.
  // Only the top 100 come back, so shares are floors. amount_percentage is a fraction of total supply.
  const RISK_LABELS = [['bundler', 'bundler'], ['rat_trader', 'insider'], ['sniper', 'sniper'], ['dev_team', 'dev team'], ['creator', 'dev team']];
  const SMART_MIN = 3;
  function holderLabels(list) {
    const wallets = (list || []).filter((h) => h && h.address && !h.exchange && (n(h.addr_type) || 0) === 0);
    if (!wallets.length) return null;
    const pctOf = (h) => (n(h.amount_percentage) || 0) * 100;
    const labelsOf = (h) => [].concat(h.maker_token_tags || [], h.tags || []).map(String);
    const risky = [], byLabel = {};
    for (const h of wallets) {
      const tags = labelsOf(h);
      const names = [...new Set(RISK_LABELS.filter(([t]) => tags.includes(t)).map(([, name]) => name))];
      if (!names.length) continue;
      const row = { address: h.address, labels: names, heldPct: pctOf(h), soldPct: n(h.sell_amount_percentage) || 0 };
      risky.push(row);
      for (const name of names) { const b = byLabel[name] || (byLabel[name] = { n: 0, heldPct: 0 }); b.n++; b.heldPct += row.heldPct; }
    }
    const group = (want) => {
      const g = wallets.filter((h) => labelsOf(h).some((t) => want.includes(t)));
      return { n: g.length, heldPct: g.reduce((a, h) => a + pctOf(h), 0), soldHalf: g.filter((h) => (n(h.sell_amount_percentage) || 0) > 0.5).length };
    };
    const smart = group(['smart_degen', 'pump_smart']);
    return {
      wallets: wallets.length,
      riskPct: risky.reduce((a, r) => a + r.heldPct, 0),
      riskN: risky.length,
      byLabel,
      risky: risky.sort((a, b) => b.heldPct - a.heldPct),
      smart: Object.assign(smart, { exiting: smart.n >= SMART_MIN && smart.soldHalf / smart.n > 0.5 }),
      kol: group(['renowned', 'kol']),
    };
  }

  // GMGN's embeddable price chart (docs.gmgn.ai, "integrate GMGN price chart"), and the coin's GMGN page.
  /** @type {[string, string][]} */
  const CHART_INTERVALS = [['1S', '1s'], ['1', '1m'], ['5', '5m'], ['15', '15m'], ['60', '1h']];
  function chartUrl(chain, ca, interval = '1') {
    const c = toGmgnChain(chain);
    const a = String(ca || '').trim();
    if (!c || !a) return null;
    const iv = CHART_INTERVALS.some(([v]) => v === interval) ? interval : '1';
    return `https://www.gmgn.cc/kline/${c}/${/^0x/i.test(a) ? a.toLowerCase() : a}?theme=dark&interval=${iv}`;
  }
  const gmgnPage = (chain, ca) => { const c = toGmgnChain(chain); return c && ca ? `https://gmgn.ai/${c}/token/${ca}` : null; };

  const api = { toGmgnChain, earlyTraders, holderLabels, SMART_MIN, devFromCreated, outcomeFromMcap, chartUrl, gmgnPage, CHART_INTERVALS, EARLY_N };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Gmgn = api;
})(typeof window !== 'undefined' ? window : globalThis);
