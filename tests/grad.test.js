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
  assert.equal(G.marketCut(pair({ volume: { h24: 3000 } }), now), 'volume $3k under $8k for its age');
  assert.equal(G.marketCut(pair({ marketCap: 40000, fdv: 40000 }), now), 'market cap $40k outside $60k to $8M');
  assert.equal(G.marketCut(pair({ txns: { h24: { buys: 10, sells: 5 }, h1: { buys: 10, sells: 5 } } }), now), '15 trades, under 30 for its age');
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
