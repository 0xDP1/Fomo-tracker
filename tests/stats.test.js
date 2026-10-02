const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../stats.js');

const W = 'Wallet1111111111111111111111111111111111111';
const t = (cost, proceeds, day) => ({ cost, proceeds, openedAt: `2026-01-${day}T10:00:00Z`, closedAt: `2026-01-${day}T12:00:00Z` });

test('computeStats basics', () => {
  const s = S.computeStats([t(1, 2, 10), t(1, 0.5, 11), t(2, 3, 12), t(1, 0.8, 13)]);
  assert.equal(s.count, 4);
  assert.equal(s.wins, 2);
  assert.equal(s.losses, 2);
  assert.equal(s.winRate, 0.5);
  assert.ok(Math.abs(s.netPnl - 1.3) < 1e-9);
  assert.ok(Math.abs(s.grossProfit - 2) < 1e-9);
  assert.ok(Math.abs(s.grossLoss - 0.7) < 1e-9);
  assert.ok(Math.abs(s.maxDrawdown - 0.5) < 1e-9);
  assert.equal(s.currentStreak, -1);
  assert.equal(s.avgHoldMs, 2 * 3600 * 1000);
  // avg win pct = (100% + 50%)/2, avg loss pct = (50% + 20%)/2
  assert.ok(Math.abs(s.avgWinPct - 0.75) < 1e-9);
  assert.ok(Math.abs(s.avgLossPct - 0.35) < 1e-9);
});

test('streaks', () => {
  const s = S.computeStats([t(1, 2, 10), t(1, 2, 11), t(1, 2, 12), t(1, 0, 13), t(1, 0, 14)]);
  assert.equal(s.longestWinStreak, 3);
  assert.equal(s.longestLossStreak, 2);
  assert.equal(s.currentStreak, -2);
});

test('empty stats', () => {
  const s = S.computeStats([]);
  assert.equal(s.count, 0);
  assert.equal(s.winRate, 0);
  assert.equal(s.profitFactor, 0);
});

test('kelly and risk sizing', () => {
  assert.ok(Math.abs(S.kelly(0.5, 2) - 0.25) < 1e-9);
  assert.ok(S.kelly(0.3, 1) < 0);
  const r = S.riskSize({ balance: 10, riskPct: 0.02, stopPct: 0.25, maxPct: 0.5 });
  assert.ok(Math.abs(r.size - 0.8) < 1e-9);
  assert.ok(Math.abs(r.maxLoss - 0.2) < 1e-9);
  const c = S.riskSize({ balance: 10, riskPct: 0.1, stopPct: 0.1, maxPct: 0.2 });
  assert.equal(c.size, 2);
  assert.equal(c.capped, true);
});

function tx(sig, ts, solLamports, mint, amt) {
  return {
    signature: sig, timestamp: ts,
    accountData: [{ account: W, nativeBalanceChange: solLamports }],
    tokenTransfers: [amt > 0
      ? { mint, tokenAmount: amt, toUserAccount: W, fromUserAccount: 'pool' }
      : { mint, tokenAmount: -amt, fromUserAccount: W, toUserAccount: 'pool' }],
  };
}

test('parseSwap buy/sell and wSOL handling', () => {
  const buy = S.parseSwap(tx('a', 1000, -1e9, 'MINT', 500), W);
  assert.equal(buy.tokenDelta, 500);
  assert.equal(buy.solDelta, -1);
  const wsol = {
    signature: 'w', timestamp: 1,
    accountData: [{ account: W, nativeBalanceChange: -5000 }],
    tokenTransfers: [
      { mint: 'MINT', tokenAmount: 100, fromUserAccount: W, toUserAccount: 'pool' },
      { mint: S.SOL_MINT, tokenAmount: 2, toUserAccount: W, fromUserAccount: 'pool' },
    ],
  };
  const sell = S.parseSwap(wsol, W);
  assert.equal(sell.tokenDelta, -100);
  assert.ok(Math.abs(sell.solDelta - (2 - 0.000005)) < 1e-12);
  assert.equal(S.parseSwap({ signature: 'x', transactionError: {} }, W), null);
});

test('pairSwaps: scaling in and partial exits', () => {
  const swaps = [
    tx('b1', 1, -1e9, 'A', 100), tx('b2', 2, -1e9, 'A', 100), // 2 SOL for 200
    tx('s1', 3, 1.5e9, 'A', -100), tx('s2', 4, 0.5e9, 'A', -100), // 2 SOL out -> breakeven
    tx('b3', 5, -1e9, 'B', 10), tx('s3', 6, 3e9, 'B', -10), // +2 SOL
    tx('b4', 7, -1e9, 'C', 10), // still open
    tx('s4', 8, 1e9, 'D', -5), // sold without a known buy -> ignored
  ].map((x) => S.parseSwap(x, W));
  const { closed, open } = S.pairSwaps(swaps);
  assert.equal(closed.length, 2);
  const a = closed.find((c) => c.mint === 'A');
  assert.equal(a.cost, 2);
  assert.equal(a.proceeds, 2);
  const b = closed.find((c) => c.mint === 'B');
  assert.equal(b.proceeds - b.cost, 2);
  assert.equal(open.length, 1);
  assert.equal(open[0].mint, 'C');
});

test('no losses gives zero (not -0) avg loss', () => {
  const s = S.computeStats([t(1, 2, 10)]);
  assert.ok(Object.is(s.avgLoss, 0));
  assert.ok(Object.is(s.avgLossPct, 0));
});
