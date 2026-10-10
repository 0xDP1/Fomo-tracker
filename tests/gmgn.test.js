const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../gmgn.js');
const C = require('../check.js');

const T0 = 1791600000;
const trader = (i, o) => Object.assign({ address: 'W' + i, addr_type: 0, start_holding_at: T0 + i * 60, sell_amount_percentage: 0, realized_profit: 0, amount_percentage: 0.01 }, o);

test('toGmgnChain: app chain names to GMGN chain names', () => {
  assert.deepEqual(['solana', 'bsc', 'BNB', 'base', 'ethereum', 'hyperliquid', 'robinhood', 'arc', 'monad', 'evm'].map(G.toGmgnChain), ['sol', 'bsc', 'bsc', 'base', 'eth', 'hyperevm', 'robinhood', 'arc', null, null]);
});

test('earlyTraders: the first 10 wallets in, how many sold, what they took', () => {
  const list = [
    trader(0, { addr_type: 2, exchange: 'pump_amm', start_holding_at: T0 - 999 }), // the pool, ignored
    ...Array.from({ length: 12 }, (_, i) => trader(i + 1, { sell_amount_percentage: i < 8 ? (i < 5 ? 1 : 0.6) : 0.1, realized_profit: i < 8 ? 1000 : 0, amount_percentage: i < 8 ? 0 : 0.02 })),
  ];
  const s = G.earlyTraders(list.reverse());
  assert.equal(s.n, 10);
  assert.equal(s.soldHalf, 8);
  assert.equal(s.exited, 5);
  assert.equal(s.realized, 8000);
  assert.ok(Math.abs(s.heldPct - 4) < 1e-9, 'two early wallets still hold 2% each');
  assert.equal(s.rows[0].address, 'W1', 'earliest first');
  assert.equal(G.earlyTraders([trader(1, { start_holding_at: undefined })]), null, 'no entry times, no reading');
  assert.equal(G.earlyTraders([]), null);
});

test('risk check: most early buyers having sold becomes a finding', () => {
  const base = { liquidityUsd: 50000, mcapUsd: 400000, ageHours: 24, holders: 300, lpLockedPct: 100, mintAuthority: false, topHolderPct: 3 };
  const f = C.assessRisk(Object.assign({ gmEarlySold: 8, gmEarlyN: 10 }, base)).findings.find((x) => x.key === 'earlysellers');
  assert.equal(f.sev, 'medium');
  assert.match(f.title, /8 of the first 10 buyers have sold/);
  assert.equal(C.assessRisk(Object.assign({ gmEarlySold: 7, gmEarlyN: 10 }, base)).findings.some((x) => x.key === 'earlysellers'), false);
  assert.equal(C.assessRisk(Object.assign({ gmEarlySold: 4, gmEarlyN: 4 }, base)).findings.some((x) => x.key === 'earlysellers'), false, 'needs at least 5 early wallets');
});

test('devFromCreated: launch counts and rows from GMGN created tokens', () => {
  const d = G.devFromCreated({ inner_count: 63, open_count: 17, tokens: [
    { token_address: 'MintA', symbol: 'AAA', create_timestamp: T0 - 86400, market_cap: '3200', token_ath_mc: '41000' },
    { address: 'MintB', token_symbol: 'BBB', create_timestamp: T0 - 7200, market_cap: 90000, token_ath_mc: 120000 },
  ] });
  assert.deepEqual([d.launches, d.graduated, d.stuck], [80, 17, 63]);
  assert.deepEqual(d.rows.map((r) => [r.mint, r.symbol, r.mcap, r.ath]), [['MintA', 'AAA', 3200, 41000], ['MintB', 'BBB', 90000, 120000]]);
  assert.equal(d.rows[0].launchedAt, (T0 - 86400) * 1000);
  assert.equal(G.devFromCreated({ data: { inner_count: 1, open_count: 0, tokens: [] } }).launches, 1, 'unwraps a data envelope');
  assert.equal(G.devFromCreated(null), null);
});

test('outcomeFromMcap: dead, quiet, alive, too new', () => {
  const now = T0 * 1000;
  assert.equal(G.outcomeFromMcap({ mcap: 3000, launchedAt: now - 48 * 3600e3 }, now), 'dead');
  assert.equal(G.outcomeFromMcap({ mcap: 9000, launchedAt: now - 48 * 3600e3 }, now), 'quiet');
  assert.equal(G.outcomeFromMcap({ mcap: 90000, launchedAt: now - 48 * 3600e3 }, now), 'alive');
  assert.equal(G.outcomeFromMcap({ mcap: 3000, launchedAt: now - 3600e3 }, now), 'new');
  assert.equal(G.outcomeFromMcap({ mcap: null, launchedAt: now - 48 * 3600e3 }, now), 'unknown');
});
