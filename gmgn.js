// GMGN data (through the Discord feed Worker, which holds the API key): pure helpers, no DOM, no network.
// Early traders (who got in first and whether they have sold) and a dev's created tokens.
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

  const api = { toGmgnChain, earlyTraders, devFromCreated, outcomeFromMcap, chartUrl, gmgnPage, CHART_INTERVALS, EARLY_N };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Gmgn = api;
})(typeof window !== 'undefined' ? window : globalThis);
