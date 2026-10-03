// Market pulse: pure helpers (no DOM, no network) for meme-market volume, mood and movers.
(function (root) {
  'use strict';

  const MAJORS = new Set(['SOL', 'WSOL', 'ETH', 'WETH', 'BNB', 'WBNB', 'BTC', 'WBTC', 'CBBTC', 'USDC', 'USDT', 'USDE', 'DAI', 'PYUSD', 'EURC', 'FDUSD', 'USD1', 'USDS', 'MSOL', 'JITOSOL', 'BSOL', 'JUPSOL', 'STETH', 'WSTETH', 'CBETH', 'RETH', 'JUP', 'JTO', 'PYTH', 'RAY', 'ORCA', 'CAKE']);
  const isMajor = (sym) => MAJORS.has(String(sym || '').toUpperCase());
  const CHAINS = { solana: 'Solana', base: 'Base', bsc: 'BNB', ethereum: 'Ethereum', eth: 'Ethereum' };
  const chainName = (id) => CHAINS[String(id || '').toLowerCase()] || String(id || '');
  const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

  const PACE_HOT = 1.3, PACE_COLD = 0.7;
  const MOVER = { pace: 3, liq: 20000, h1: 50000, max: 10 };

  // GeckoTerminal /networks/{network}/trending_pools or /pools (with include=base_token).
  function fromGecko(json, network) {
    const tokens = new Map(((json && json.included) || []).filter((x) => x.type === 'token').map((x) => [x.id, x.attributes || {}]));
    return ((json && json.data) || []).map((p) => {
      const a = p.attributes || {};
      const baseId = p.relationships && p.relationships.base_token && p.relationships.base_token.data && p.relationships.base_token.data.id;
      const tok = tokens.get(baseId) || {};
      const v = a.volume_usd || {}, tx = a.transactions || {}, ch = a.price_change_percentage || {};
      return {
        id: p.id, chain: chainName(network),
        symbol: tok.symbol || String(a.name || '?').split(' / ')[0],
        address: tok.address || (baseId ? String(baseId).replace(/^[^_]+_/, '') : ''),
        liq: n(a.reserve_in_usd), mcap: n(a.market_cap_usd) ?? n(a.fdv_usd),
        vol: { m5: n(v.m5) || 0, m30: n(v.m30), h1: n(v.h1) || 0 },
        buys5: Number(tx.m5 && tx.m5.buys) || 0, sells5: Number(tx.m5 && tx.m5.sells) || 0,
        chg5: n(ch.m5), url: `https://www.geckoterminal.com/${network}/pools/${a.address || ''}`,
      };
    }).filter((p) => !isMajor(p.symbol));
  }

  // DexScreener pairs (no 30-minute window).
  function fromDex(json) {
    return ((json && json.pairs) || []).map((p) => ({
      id: (p.chainId || '') + '_' + (p.pairAddress || ''), chain: chainName(p.chainId),
      symbol: (p.baseToken && p.baseToken.symbol) || '?', address: (p.baseToken && p.baseToken.address) || '',
      liq: n(p.liquidity && p.liquidity.usd), mcap: n(p.marketCap ?? p.fdv),
      vol: { m5: n(p.volume && p.volume.m5) || 0, m30: null, h1: n(p.volume && p.volume.h1) || 0 },
      buys5: Number(p.txns && p.txns.m5 && p.txns.m5.buys) || 0, sells5: Number(p.txns && p.txns.m5 && p.txns.m5.sells) || 0,
      chg5: n(p.priceChange && p.priceChange.m5), url: p.url || '',
    })).filter((p) => !isMajor(p.symbol));
  }

  const dedupe = (pools) => [...new Map((pools || []).map((p) => [p.id, p])).values()];

  function mood(pace5, pace30) {
    if (pace5 == null) return null;
    const ps = pace30 == null ? [pace5] : [pace5, pace30];
    if (ps.every((p) => p > PACE_HOT)) return 'Heating up';
    if (ps.every((p) => p < PACE_COLD)) return 'Cooling';
    return 'Steady';
  }

  function totals(pools) {
    const list = dedupe(pools);
    const has30 = list.length > 0 && list.every((p) => p.vol.m30 != null);
    const vol = { m5: 0, m30: has30 ? 0 : null, h1: 0 };
    const byChain = {};
    let buys = 0, sells = 0;
    for (const p of list) {
      vol.m5 += p.vol.m5; vol.h1 += p.vol.h1; if (has30) vol.m30 += p.vol.m30;
      const c = byChain[p.chain] || (byChain[p.chain] = { m5: 0, h1: 0, count: 0 });
      c.m5 += p.vol.m5; c.h1 += p.vol.h1; c.count++;
      buys += p.buys5; sells += p.sells5;
    }
    const pace5 = vol.h1 > 0 ? (vol.m5 * 12) / vol.h1 : null;
    const pace30 = vol.h1 > 0 && vol.m30 != null ? (vol.m30 * 2) / vol.h1 : null;
    return { count: list.length, vol, byChain, buys5: buys, sells5: sells, buyShare: buys + sells ? buys / (buys + sells) : null, pace5, pace30, mood: mood(pace5, pace30) };
  }

  function movers(pools) {
    return dedupe(pools).map((p) => Object.assign({}, p, { pace: p.vol.h1 > 0 ? (p.vol.m5 * 12) / p.vol.h1 : 0 }))
      .filter((p) => p.pace >= MOVER.pace && p.buys5 > p.sells5 && (p.liq || 0) >= MOVER.liq && p.vol.h1 >= MOVER.h1)
      .sort((a, b) => b.pace - a.pace).slice(0, MOVER.max);
  }

  // dex: output of the Check tab's fetchDex (vol5m, vol1h).
  function positionPace(dex) {
    const pace = dex && dex.vol1h > 0 ? (dex.vol5m * 12) / dex.vol1h : null;
    return { pace, label: pace == null ? '' : pace >= MOVER.pace ? 'Waking up' : pace < PACE_COLD ? 'Quiet' : 'Active' };
  }

  // One reading per minute, last 24 hours.
  function pushReading(history, reading, now) {
    const h = (history || []).filter((r) => now - r.t < 24 * 3600000);
    const r = Object.assign({ t: now }, reading);
    // a reading within a minute of the last one replaces it but keeps that minute's start time
    if (h.length && now - h[h.length - 1].t < 60000) h[h.length - 1] = Object.assign(r, { t: h[h.length - 1].t }); else h.push(r);
    return h;
  }

  const api = { fromGecko, fromDex, isMajor, totals, mood, movers, positionPace, pushReading, MOVER, PACE_HOT, PACE_COLD };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Market = api;
})(typeof window !== 'undefined' ? window : globalThis);
