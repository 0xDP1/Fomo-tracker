// Scanner: pure helpers (no DOM, no network). New launches -> free cut -> trade cut -> chain cut ->
// judge gates -> at most one pick, plus paper trades that score the picks later.
// Thresholds come from @savipww's guide as published in the jev-desk README; they are unvalidated.
(function (root) {
  'use strict';
  const Market = typeof module !== 'undefined' && module.exports ? require('./market.js') : root.Market;

  const H = 3600000;
  const FREE = { minAgeH: 0.05, maxAgeH: 72, liq: 12000, vol24: 40000, mcapMin: 60000, mcapMax: 8000000 };
  const TRADE = { trades24: 150, buys1hNeedSells: 20 };
  // A coin a few minutes old can't have a day's volume yet: under 6 hours the volume and trade minimums scale with its
  // age, with a floor, so young coins are judged on their pace instead of being cut for being new.
  const YOUNG = { fullAtH: 6, volFloor: 8000, tradesFloor: 30 };
  const ageShare = (ageH) => (ageH == null ? 1 : Math.min(1, ageH / YOUNG.fullAtH));
  const volNeeded = (ageH) => Math.max(YOUNG.volFloor, FREE.vol24 * ageShare(ageH));
  const tradesNeeded = (ageH) => Math.max(YOUNG.tradesFloor, Math.round(TRADE.trades24 * ageShare(ageH)));
  const CHAIN = { topWallet: 5, top10: 60, holders: 80 };
  const SOFT = [
    ['concentration_is_exit_risk', '<=', 0.55, 'holder concentration looks like exit risk'],
    ['momentum_already_spent', '<=', 0.60, 'momentum already spent'],
    ['liquidity_fits_ticket', '>=', 0.60, 'liquidity too thin for the ticket'],
    ['dev_still_loaded', '<=', 0.55, 'dev still loaded'],
    ['crowd', '>=', 0.55, 'not enough of a real crowd'],
  ];
  const PICK = { worth: 0.60, confidence: 0.55 };
  const HORIZONS = { '1h': [1 * H, 1.5 * H], '6h': [6 * H, 8 * H], '24h': [24 * H, 30 * H] };

  const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const same = (a, b) => (/^0x/i.test(a || '') ? String(a).toLowerCase() === String(b || '').toLowerCase() : a === b);
  const CHAINS = { solana: 'Solana', base: 'Base', bsc: 'BNB' };

  // GeckoTerminal /networks/{net}/new_pools?include=base_token
  function fromGeckoNew(json, network) {
    const tokens = new Map(((json && json.included) || []).filter((x) => x.type === 'token').map((x) => [x.id, x.attributes || {}]));
    return ((json && json.data) || []).map((p) => {
      const a = p.attributes || {};
      const baseId = p.relationships && p.relationships.base_token && p.relationships.base_token.data && p.relationships.base_token.data.id;
      const tok = tokens.get(baseId) || {};
      return {
        id: p.id, chain: CHAINS[network] || network, network,
        symbol: tok.symbol || String(a.name || '?').split(' / ')[0],
        address: tok.address || (baseId ? String(baseId).replace(/^[^_]+_/, '') : ''),
        liq: n(a.reserve_in_usd), mcap: n(a.market_cap_usd) ?? n(a.fdv_usd), vol24: n(a.volume_usd && a.volume_usd.h24),
        createdAt: a.pool_created_at ? Date.parse(a.pool_created_at) : null,
        url: `https://www.geckoterminal.com/${network}/pools/${a.address || ''}`,
      };
    }).filter((p) => !Market.isMajor(p.symbol));
  }

  const money = (v) => '$' + (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.round(v / 1000) + 'k');
  function freeCut(p, now) {
    if (p.createdAt == null) return 'no launch time';
    const age = (now - p.createdAt) / H;
    if (age < FREE.minAgeH) return 'too new (under 3 min)';
    if (age > FREE.maxAgeH) return 'too old (over 72 h)';
    if (p.liq == null) return 'no liquidity data';
    if (p.liq < FREE.liq) return `liquidity ${money(p.liq)} under $12k`;
    if (p.vol24 == null) return 'no volume data';
    const vNeed = volNeeded(age);
    if (p.vol24 < vNeed) return age < YOUNG.fullAtH ? `volume ${money(p.vol24)} under ${money(vNeed)} for its age` : `24h volume ${money(p.vol24)} under $40k`;
    if (p.mcap == null) return 'no market cap data';
    if (p.mcap < FREE.mcapMin || p.mcap > FREE.mcapMax) return `market cap ${money(p.mcap)} outside $60k to $8M`;
    return null;
  }

  // DexScreener /latest/dex/tokens/a,b,c -> the token's deepest pair.
  function bestPair(json, address) {
    const ps = ((json && json.pairs) || []).filter((p) => p.baseToken && same(p.baseToken.address, address));
    return ps.length ? ps.sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0))[0] : null;
  }

  function tradeCut(pair, now) {
    if (!pair) return 'no DexScreener pair';
    const ageH = pair.pairCreatedAt && now ? (now - pair.pairCreatedAt) / H : null;
    const tNeed = tradesNeeded(ageH);
    const t24 = (pair.txns && pair.txns.h24) || {}, t1 = (pair.txns && pair.txns.h1) || {};
    const trades = (Number(t24.buys) || 0) + (Number(t24.sells) || 0);
    if (trades < tNeed) return ageH != null && ageH < YOUNG.fullAtH ? `${trades} trades, under ${tNeed} for its age` : `${trades} trades in 24h, under 150`;
    if ((Number(t1.buys) || 0) > TRADE.buys1hNeedSells && !(Number(t1.sells) > 0)) return `${t1.buys} buys and no sells in the last hour`;
    return null;
  }

  // facts: from the Check tab's fetchers. Missing facts are listed as unchecked, never cut.
  function chainCut(facts, chainId) {
    const f = facts || {};
    const rules = chainId === 'solana' ? [
      ['top wallet', n(f.topHolderPct), (v) => v > CHAIN.topWallet, (v) => `top wallet holds ${v.toFixed(1)}%, over 5%`],
      ['top 10', n(f.top10Pct), (v) => v > CHAIN.top10, (v) => `top 10 hold ${v.toFixed(0)}%, over 60%`],
      ['holders', n(f.holders), (v) => v < CHAIN.holders, (v) => `${v} holders, under 80`],
      ['mint authority', f.mintAuthority, (v) => v === true, () => 'mint authority still open'],
      ['freeze authority', f.freezeAuthority, (v) => v === true, () => 'freeze authority still open'],
    ] : [['honeypot', f.honeypot, (v) => v === true, () => 'honeypot']];
    const unchecked = rules.filter(([, v]) => v == null).map(([label]) => label);
    const hit = rules.find(([, v, bad]) => v != null && bad(v));
    return { cut: hit ? hit[3](hit[1]) : null, unchecked };
  }

  const JUDGE_KEYS = ['concentration_is_exit_risk', 'momentum_already_spent', 'liquidity_fits_ticket', 'dev_still_loaded', 'crowd', 'worth_trading_at_all', 'confidence'];
  const SHAPES = ['building', 'steady', 'fading', 'one_buyer'];
  const JUDGE_SCHEMA = {
    type: 'object',
    properties: Object.assign(Object.fromEntries(JUDGE_KEYS.map((k) => [k, { type: 'number' }])), { shape: { type: 'string', enum: SHAPES }, reason: { type: 'string' } }),
    required: JUDGE_KEYS.concat(['shape', 'reason']),
    additionalProperties: false,
  };

  function parseJudge(text) {
    let j;
    try { j = JSON.parse(String(text || '').trim()); } catch { return null; }
    if (!j || typeof j !== 'object' || !JUDGE_KEYS.every((k) => Number.isFinite(Number(j[k])))) return null;
    const out = { shape: SHAPES.includes(j.shape) ? j.shape : 'steady', reason: String(j.reason || '').slice(0, 240) };
    for (const k of JUDGE_KEYS) out[k] = Math.min(1, Math.max(0, Number(j[k])));
    return out;
  }

  function softCut(j) {
    const fails = SOFT.filter(([k, op, t]) => (op === '<=' ? !(j[k] <= t) : !(j[k] >= t))).map(([k, , , why]) => `${why} (${j[k].toFixed(2)})`);
    if (j.shape === 'fading') fails.push('chart shape is fading');
    if (j.shape === 'one_buyer') fails.push('chart shape is one buyer');
    return fails;
  }

  function pick(cands) {
    const ok = (cands || []).filter((c) => c.judge && !softCut(c.judge).length && c.judge.worth_trading_at_all >= PICK.worth && c.judge.confidence >= PICK.confidence);
    return ok.sort((a, b) => b.judge.worth_trading_at_all * b.judge.confidence - a.judge.worth_trading_at_all * a.judge.confidence)[0] || null;
  }

  // ---- paper trades ----
  function addPaper(book, p, price, now) {
    if (!(price > 0) || (book || []).some((x) => same(x.address, p.address) && now - x.at < 24 * H)) return book || [];
    return (book || []).concat({ symbol: p.symbol, address: p.address, chain: p.chain, at: now, price, ret: {} }).slice(-200);
  }
  const open = (x, now) => Object.entries(HORIZONS).filter(([k, [s, e]]) => x.ret[k] === undefined && now >= x.at + s && now <= x.at + e).map(([k]) => k);
  const due = (book, now) => [...new Set((book || []).filter((x) => open(x, now).length).map((x) => x.address))];
  function applyPrices(book, prices, now) {
    return (book || []).map((x) => {
      const ret = Object.assign({}, x.ret);
      for (const [k, [s, e]] of Object.entries(HORIZONS)) {
        if (ret[k] !== undefined || now < x.at + s) continue;
        if (now > x.at + e) { ret[k] = 'missed'; continue; }
        const px = prices[x.address];
        if (px > 0) ret[k] = px / x.price - 1;
      }
      return Object.assign({}, x, { ret });
    });
  }
  function scorecard(book) {
    const out = { picks: (book || []).length };
    for (const k of Object.keys(HORIZONS)) {
      const rs = (book || []).map((x) => x.ret[k]).filter((r) => typeof r === 'number');
      out[k] = { n: rs.length, up: rs.filter((r) => r > 0).length, avg: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null };
    }
    return out;
  }

  const api = { fromGeckoNew, freeCut, bestPair, tradeCut, chainCut, parseJudge, softCut, pick, addPaper, due, applyPrices, scorecard, JUDGE_SCHEMA, FREE, TRADE, CHAIN, PICK, HORIZONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Scanner = api;
})(typeof window !== 'undefined' ? window : globalThis);
