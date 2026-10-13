// docs/features/graduations.md
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../grad.js');

const T = Date.parse('2026-10-13T06:00:00Z'), M = 60000, H = 3600000;
// A real message from PumpPortal's migration feed, 2026-10-13.
const REAL = '{"signature":"2HErXHsn1iSG8xXFKDrDSHr68xQMYtsDUjQJfjBo8nrnGsbZH2BrzTb46ZXz3rCGfz5WNXEBCgVGxDQ6miEWmjY8","mint":"858P8u5xQkutWh8wUmvg835XFFMkD1h2SHuEvRXmpump","txType":"migrate","pool":"pump-amm"}';

test('parse: graduations only; the subscribe reply, other events and junk are ignored', () => {
  assert.deepEqual(G.parse(REAL, T), { mint: '858P8u5xQkutWh8wUmvg835XFFMkD1h2SHuEvRXmpump', signature: '2HErXHsn1iSG8xXFKDrDSHr68xQMYtsDUjQJfjBo8nrnGsbZH2BrzTb46ZXz3rCGfz5WNXEBCgVGxDQ6miEWmjY8', pool: 'pump-amm', at: T });
  assert.equal(G.parse('{"message":"Subscribed to \'migration\' events."}', T), null);
  assert.equal(G.parse('{"mint":"858P8u5xQkutWh8wUmvg835XFFMkD1h2SHuEvRXmpump","txType":"buy"}', T), null);
  assert.equal(G.parse('not json', T), null);
  assert.equal(G.parse('{"txType":"migrate","mint":"<script>"}', T), null, 'a mint must look like a Solana address');
});

test('add and due: one entry per coin, newest first, the last 50; checked 3 minutes after graduating', () => {
  let list = [];
  list = G.add(list, G.parse(REAL, T));
  list = G.add(list, G.parse(REAL, T + M)); // the same coin again
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].status, list[0].dueAt], ['waiting', T + 3 * M]);
  assert.deepEqual(G.due(list, T + 2 * M), []);
  assert.deepEqual(G.due(list, T + 3 * M), ['858P8u5xQkutWh8wUmvg835XFFMkD1h2SHuEvRXmpump']);
  for (let i = 0; i < 60; i++) list = G.add(list, { mint: 'Coin' + String(i).padStart(3, '0') + 'x'.repeat(36), signature: 's' + i, pool: 'pump-amm', at: T + i * M });
  assert.equal(list.length, 50);
  assert.equal(list[0].mint.slice(0, 7), 'Coin059', 'newest first');
});

const pair = (o) => Object.assign({ chainId: 'solana', pairCreatedAt: T, liquidity: { usd: 22000 }, marketCap: 85000, fdv: 85000, volume: { h24: 30000 }, txns: { h24: { buys: 120, sells: 60 }, h1: { buys: 120, sells: 60 } }, baseToken: { symbol: 'FOO' }, priceUsd: '0.000085' }, o);

test('marketCut: the Scanner\'s liquidity, volume, market cap and trade cuts on the DexScreener pair', () => {
  const now = T + 3 * M;
  assert.equal(G.marketCut(pair(), now), null);
  assert.equal(G.marketCut(null, now), 'no DexScreener pool yet');
  assert.equal(G.marketCut(pair({ liquidity: { usd: 9000 } }), now), 'liquidity $9k under $12k');
  assert.equal(G.marketCut(pair({ volume: { h24: 3000 } }), now), 'volume $3k under $8k');
  assert.equal(G.marketCut(pair({ marketCap: 40000, fdv: 40000 }), now), 'market cap $40k outside $60k to $8M');
  assert.equal(G.marketCut(pair({ txns: { h24: { buys: 10, sells: 5 }, h1: { buys: 10, sells: 5 } } }), now), '15 trades, under 30');
  assert.equal(G.marketCut(pair({ txns: { h24: { buys: 40, sells: 0 }, h1: { buys: 40, sells: 0 } } }), now), '40 buys and no sells in the last hour');
  assert.equal(G.marketCut(pair({ pairCreatedAt: undefined }), now), null, 'no pool time: the graduation time counts');
});

test('holderCut: the Scanner\'s holder cut, and a High risk or Walk away verdict', () => {
  const got = (facts, verdict = 'Looks OK') => ({ facts: Object.assign({ topHolderPct: 3, top10Pct: 25, holders: 400, mintAuthority: false, freezeAuthority: false, creatorPct: 2 }, facts), risk: { verdict } });
  assert.equal(G.holderCut(got({})), null);
  assert.equal(G.holderCut(got({ top10Pct: 72 })), 'top 10 hold 72%, over 60%');
  assert.equal(G.holderCut(got({ holders: 40 })), '40 holders, under 80');
  assert.equal(G.holderCut(got({}, 'Walk away')), 'rug check says Walk away');
  assert.equal(G.holderCut(got({}, 'High risk')), 'rug check says High risk');
});

test('setResult: a coin ends cut (with its stage and reason), passed, or failed to check', () => {
  let list = G.add([], G.parse(REAL, T));
  const mint = list[0].mint;
  list = G.setResult(list, mint, { status: 'cut', stage: 'Market', why: 'liquidity $9k under $12k', symbol: 'FOO', mcap: 40000, liq: 9000 }, T + 3 * M);
  assert.deepEqual([list[0].status, list[0].stage, list[0].why, list[0].symbol, list[0].checkedAt], ['cut', 'Market', 'liquidity $9k under $12k', 'FOO', T + 3 * M]);
  assert.deepEqual(G.due(list, T + H), [], 'checked once');
});

// Seen live on 2026-10-13: DexScreener dates the PumpSwap pool a few seconds after the graduation message, so at the
// 3-minute mark the Scanner's "too new (under 3 min)" rule cut real graduates; and a pool DexScreener has not indexed yet
// gets one more look 5 minutes later instead of being cut for good.
test('marketCut: a graduate is never "too new" at its check; a missing pool is looked at once more', () => {
  const now = T + 3 * M;
  assert.equal(G.marketCut(pair({ pairCreatedAt: T + 20000 }), now, T), null, 'pool 20 s younger than the graduation');
  let list = G.add([], G.parse(REAL, T));
  const mint = list[0].mint;
  list = G.retryLater(list, mint, now);
  assert.deepEqual([list[0].status, list[0].dueAt, list[0].retried], ['waiting', now + 5 * M, true]);
  assert.equal(G.canRetry(list[0]), false, 'only once');
  assert.equal(G.canRetry(G.add([], G.parse(REAL, T))[0]), true);
});

// docs/features/grad-filters.md: the owner's own numbers for graduations.
test('filters: the defaults are the numbers graduations used before', () => {
  assert.deepEqual(G.DEFAULTS, { waitMin: 3, liq: 12000, mcapMin: 60000, mcapMax: 8000000, vol: 8000, trades: 30, topWallet: 5, top10: 60, holders: 80, creator: 10, cutHighRisk: true, cutWalkAway: true });
  assert.equal(G.isDefault(G.DEFAULTS), true);
  assert.equal(G.isDefault(Object.assign({}, G.DEFAULTS, { liq: 15000 })), false);
});

test('filters: bad input is clamped to sane ranges; a max below the min is raised to it', () => {
  assert.deepEqual(G.clampFilters({ waitMin: 0, liq: -5, mcapMin: 'abc', mcapMax: 1000, vol: 2e9, trades: 3.7, topWallet: 150, top10: -1, holders: 80.4, creator: 200, cutHighRisk: false, cutWalkAway: 'yes' }),
    { waitMin: 1, liq: 0, mcapMin: 60000, mcapMax: 60000, vol: 1e8, trades: 4, topWallet: 100, top10: 0, holders: 80, creator: 100, cutHighRisk: false, cutWalkAway: true });
  assert.deepEqual(G.clampFilters({ waitMin: 99 }).waitMin, 30);
  assert.deepEqual(G.clampFilters(null), G.DEFAULTS);
});

test('filters: each one moves the cut at its edge, and the reason quotes the owner\'s number', () => {
  const now = T + 3 * M, f = (o) => Object.assign({}, G.DEFAULTS, o);
  assert.equal(G.marketCut(pair({ liquidity: { usd: 9000 } }), now, T, f({ liq: 8000 })), null);
  assert.equal(G.marketCut(pair({ liquidity: { usd: 9000 } }), now, T, f({ liq: 15000 })), 'liquidity $9k under $15k');
  assert.equal(G.marketCut(pair({ marketCap: 40000, fdv: 40000 }), now, T, f({ mcapMin: 30000 })), null);
  assert.equal(G.marketCut(pair(), now, T, f({ mcapMax: 80000 })), 'market cap $85k outside $60k to $80k');
  assert.equal(G.marketCut(pair({ volume: { h24: 3000 } }), now, T, f({ vol: 2000 })), null);
  assert.equal(G.marketCut(pair(), now, T, f({ trades: 200 })), '180 trades, under 200');
  const got = (facts, verdict = 'Looks OK') => ({ facts: Object.assign({ topHolderPct: 3, top10Pct: 25, holders: 400, mintAuthority: false, freezeAuthority: false, creatorPct: 2 }, facts), risk: { verdict } });
  assert.equal(G.holderCut(got({ topHolderPct: 8 }), f({ topWallet: 10 })), null);
  assert.equal(G.holderCut(got({ topHolderPct: 8 }), f({ topWallet: 6 })), 'top wallet holds 8.0%, over 6%');
  assert.equal(G.holderCut(got({ top10Pct: 72 }), f({ top10: 80 })), null);
  assert.equal(G.holderCut(got({ holders: 40 }), f({ holders: 30 })), null);
  assert.equal(G.holderCut(got({ holders: 40 }), f({ holders: 50 })), '40 holders, under 50');
  assert.equal(G.holderCut(got({ creatorPct: 4 }), f({ creator: 3 })), 'creator holds 4.0%, 3% or more');
  assert.equal(G.holderCut(got({}, 'Walk away'), f({ cutWalkAway: false })), null);
  assert.equal(G.holderCut(got({}, 'High risk'), f({ cutHighRisk: false })), null);
  assert.equal(G.holderCut(got({ mintAuthority: true }), f({ topWallet: 100, top10: 100, holders: 0, creator: 100, cutHighRisk: false, cutWalkAway: false })), 'mint authority still open', 'mint and freeze are never optional');
  // the wait
  const list = G.add([], G.parse(REAL, T), f({ waitMin: 10 }));
  assert.equal(list[0].dueAt, T + 10 * M);
});
