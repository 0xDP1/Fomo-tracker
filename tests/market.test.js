const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../market.js');

// GeckoTerminal-shaped pool (numbers come as strings)
const gPool = (id, sym, quote, v5, v30, v1h, b5, s5, liq = 100000, extra = {}) => ({
  id: 'solana_' + id, type: 'pool',
  attributes: Object.assign({
    name: `${sym} / ${quote}`, address: id, market_cap_usd: '500000', fdv_usd: '600000', reserve_in_usd: String(liq),
    volume_usd: { m5: String(v5), m15: '0', m30: String(v30), h1: String(v1h), h6: '0', h24: '0' },
    transactions: { m5: { buys: b5, sells: s5 }, h1: { buys: 100, sells: 90 } },
    price_change_percentage: { m5: '3.5', h1: '12' },
  }, extra),
  relationships: { base_token: { data: { id: 'solana_' + sym + 'Mint', type: 'token' } } },
});
const gJson = (pools) => ({ data: pools, included: pools.map((p) => ({ id: p.relationships.base_token.data.id, type: 'token', attributes: { address: p.relationships.base_token.data.id.replace('solana_', ''), symbol: p.attributes.name.split(' / ')[0] } })) });

test('fromGecko parses pools and drops majors and stablecoins as the base token', () => {
  const pools = M.fromGecko(gJson([gPool('p1', 'BONK', 'SOL', 1000, 6000, 12000, 30, 20), gPool('p2', 'SOL', 'USDC', 9e6, 9e6, 9e6, 1, 1), gPool('p3', 'USDT', 'SOL', 1, 1, 1, 1, 1)]), 'solana');
  assert.equal(pools.length, 1);
  const p = pools[0];
  assert.deepEqual([p.symbol, p.chain, p.address, p.vol.m5, p.vol.m30, p.vol.h1, p.buys5, p.sells5, p.liq, p.mcap, p.chg5], ['BONK', 'Solana', 'BONKMint', 1000, 6000, 12000, 30, 20, 100000, 500000, 3.5]);
  assert.equal(p.id, 'solana_p1');
  assert.equal(M.isMajor('wsol'), true);
  assert.equal(M.isMajor('PEPE'), false);
});

test('fromDex parses DexScreener pairs with no 30-minute window', () => {
  const pools = M.fromDex({ pairs: [{ chainId: 'base', pairAddress: '0xpair', baseToken: { symbol: 'BRETT', address: '0xb' }, liquidity: { usd: 50000 }, marketCap: 900000, volume: { m5: 500, h1: 4000 }, txns: { m5: { buys: 9, sells: 3 } }, priceChange: { m5: 1.2 }, url: 'https://dexscreener.com/base/0xpair' }, { chainId: 'base', pairAddress: '0xq', baseToken: { symbol: 'WETH' }, volume: {} }] });
  assert.equal(pools.length, 1);
  assert.deepEqual([pools[0].chain, pools[0].vol.m5, pools[0].vol.m30, pools[0].vol.h1, pools[0].buys5], ['Base', 500, null, 4000, 9]);
});

test('totals: sums, dedupes by pool, per-chain split and buy share', () => {
  const a = M.fromGecko(gJson([gPool('p1', 'AAA', 'SOL', 1000, 6000, 12000, 30, 10), gPool('p2', 'BBB', 'SOL', 500, 3000, 6000, 10, 10)]), 'solana');
  const t = M.totals(a.concat(a));
  assert.equal(t.count, 2);
  assert.deepEqual(t.vol, { m5: 1500, m30: 9000, h1: 18000 });
  assert.equal(t.byChain.Solana.h1, 18000);
  assert.equal(t.buyShare, 40 / 60);
  assert.equal(t.pace5, 1500 * 12 / 18000);
  assert.equal(t.pace30, 9000 * 2 / 18000);
});

test('mood edges: both paces above 1.3 heat, both below 0.7 cool, else steady; 5m only when 30m missing', () => {
  assert.equal(M.mood(1.31, 1.31), 'Heating up');
  assert.equal(M.mood(1.3, 1.5), 'Steady');
  assert.equal(M.mood(2, 1.0), 'Steady');
  assert.equal(M.mood(0.69, 0.69), 'Cooling');
  assert.equal(M.mood(0.7, 0.5), 'Steady');
  assert.equal(M.mood(1.5, null), 'Heating up');
  assert.equal(M.mood(0.5, null), 'Cooling');
  assert.equal(M.mood(null, null), null);
});

test('movers: pace 3+, buyers ahead, $20k liquidity, $50k hourly volume; ranked by pace, top 10', () => {
  const g = [
    gPool('a', 'HOT', 'SOL', 20000, 40000, 60000, 50, 20),                // pace 4
    gPool('b', 'HOTTER', 'SOL', 30000, 50000, 60000, 50, 20),             // pace 6
    gPool('c', 'EDGE', 'SOL', 12500, 30000, 50000, 11, 10),               // pace 3, h1 exactly 50k, buys > sells
    gPool('d', 'SELLERS', 'SOL', 30000, 50000, 60000, 10, 20),            // sellers ahead
    gPool('e', 'THIN', 'SOL', 30000, 50000, 60000, 50, 20, 19999),        // liquidity under 20k
    gPool('f', 'SMALL', 'SOL', 20000, 30000, 49999, 50, 20),              // hourly volume under 50k
    gPool('g', 'SLOW', 'SOL', 12000, 30000, 50000, 50, 20),               // pace 2.88
    gPool('h', 'TIE', 'SOL', 20000, 40000, 60000, 20, 20),                // buys == sells
  ];
  const mv = M.movers(M.fromGecko(gJson(g), 'solana'));
  assert.deepEqual(mv.map((p) => p.symbol), ['HOTTER', 'HOT', 'EDGE']);
  assert.equal(mv[0].pace, 6);
  const many = Array.from({ length: 14 }, (_, i) => gPool('m' + i, 'M' + i, 'SOL', 20000 + i, 40000, 60000, 50, 20));
  assert.equal(M.movers(M.fromGecko(gJson(many), 'solana')).length, 10);
});

test('positionPace labels', () => {
  assert.deepEqual(M.positionPace({ vol5m: 1000, vol1h: 4000 }), { pace: 3, label: 'Waking up' });
  assert.equal(M.positionPace({ vol5m: 100, vol1h: 1800 }).label, 'Quiet');
  assert.equal(M.positionPace({ vol5m: 300, vol1h: 3600 }).label, 'Active');
  assert.equal(M.positionPace({ vol5m: 10, vol1h: 0 }).pace, null);
});

test('pushReading keeps one reading a minute for 24 hours', () => {
  const t0 = 1e12;
  let h = [];
  h = M.pushReading(h, { h1: 1 }, t0);
  h = M.pushReading(h, { h1: 2 }, t0 + 30000);
  assert.equal(h.length, 1);
  assert.equal(h[0].h1, 2, 'a second reading within a minute replaces the first');
  h = M.pushReading(h, { h1: 3 }, t0 + 61000);
  assert.equal(h.length, 2);
  h = M.pushReading(h, { h1: 4 }, t0 + 25 * 3600000);
  assert.deepEqual(h.map((r) => r.h1), [4], 'readings older than 24h are dropped');
});
