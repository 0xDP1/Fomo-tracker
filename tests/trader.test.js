const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../trader.js');

test('profileSummary picks name, followers, age and the private flag', () => {
  const p = T.profileSummary({ handle: 'Alice', displayName: 'Alice A', followers: 1200, accountAgeDays: 90, private: false, totalVolume: 50000 });
  assert.deepEqual(p, { handle: 'alice', name: 'Alice A', followers: 1200, ageDays: 90, isPrivate: false, volumeUsd: 50000 });
  assert.equal(T.profileSummary({ followers: { count: 5 } }).followers, 5);
});

test('handleFromReply reads the handle Claude returns for a screenshot', () => {
  assert.equal(T.handleFromReply('{"handle": "@Kyle_99"}'), 'kyle_99');
  assert.equal(T.handleFromReply('```json\n{"handle":"bob"}\n```'), 'bob');
  assert.equal(T.handleFromReply('{"handle": null}'), '');
  assert.equal(T.handleFromReply('The handle is @carol.sol'), 'carol.sol');
  assert.equal(T.handleFromReply('I cannot see a profile.'), '');
});

// closed trade helper: cost 100, pnl as given, held `holdMin` minutes, on `chain`
const day0 = Date.parse('2026-09-01T00:00:00Z');
const tr = (pnl, holdMin, i = 0, chain = 'Solana') => {
  const open = day0 + i * 3600000;
  return { cost: 100, proceeds: 100 + pnl, openedAt: new Date(open).toISOString(), closedAt: new Date(open + holdMin * 60000).toISOString(), isOpen: false, chain };
};

test('style: hold labels at their edges use the median hold', () => {
  const at = (min) => T.style({}, [1, 2, 3, 4, 5].map((i) => tr(10, min, i))).hold;
  assert.equal(at(14), 'Scalper');
  assert.equal(at(15), 'Day trader');
  assert.equal(at(359), 'Day trader');
  assert.equal(at(360), 'Swing trader');
  assert.equal(at(3 * 1440 - 1), 'Swing trader');
  assert.equal(at(3 * 1440), 'Holder');
  // median, not mean: one very long hold does not change a scalper
  const s = T.style({}, [tr(10, 5, 1), tr(10, 6, 2), tr(10, 7, 3), tr(10, 8, 4), tr(10, 50000, 5)]);
  assert.equal(s.hold, 'Scalper');
  assert.equal(s.medianHoldSec, 7 * 60);
});

test('style: activity from profile trades per day, with edges', () => {
  const five = [1, 2, 3, 4, 5].map((i) => tr(10, 30, i));
  assert.equal(T.style({ numTrades: 2000, accountAgeDays: 100 }, five).activity, 'Very active');
  assert.equal(T.style({ numTrades: 1999, accountAgeDays: 100 }, five).activity, 'Active');
  assert.equal(T.style({ numTrades: 500, accountAgeDays: 100 }, five).activity, 'Active');
  assert.equal(T.style({ numTrades: 499, accountAgeDays: 100 }, five).activity, 'Selective');
  assert.equal(T.style({ numTrades: 499, accountAgeDays: 100 }, five).tradesPerDay, 4.99);
  // no profile numbers: falls back to the sample's own span (5 trades within a day -> 5/day)
  assert.equal(T.style({}, five).activity, 'Active');
});

test('style: win profile labels', () => {
  // 4 losses of -10%, 1 win of +100%: win rate 20%, payoff 10 -> lottery hunter
  const lotto = T.style({}, [tr(-10, 30, 1), tr(-10, 30, 2), tr(-10, 30, 3), tr(-10, 30, 4), tr(100, 30, 5)]);
  assert.equal(lotto.winProfile, 'Lottery hunter');
  assert.ok(Math.abs(lotto.winRate - 0.2) < 1e-9);
  assert.equal(lotto.wins, 1);
  assert.equal(lotto.losses, 4);
  // 4 wins of +10%, 1 loss of -50%: win rate 80%, payoff 0.2 -> quick profit taker
  assert.equal(T.style({}, [tr(10, 30, 1), tr(10, 30, 2), tr(10, 30, 3), tr(10, 30, 4), tr(-50, 30, 5)]).winProfile, 'Quick profit taker');
  // win rate exactly 45% is not a lottery hunter; exactly 60% with payoff < 1 is a quick profit taker
  const mk = (w, l, wp, lp) => Array.from({ length: w }, (_, i) => tr(wp, 30, i)).concat(Array.from({ length: l }, (_, i) => tr(-lp, 30, w + i)));
  assert.equal(T.style({}, mk(9, 11, 30, 10)).winProfile, 'Balanced');
  assert.equal(T.style({}, mk(6, 4, 5, 10)).winProfile, 'Quick profit taker');
  assert.equal(T.style({}, mk(3, 2, 20, 20)).winProfile, 'Balanced');
});

test('style: size, main chain and summary line', () => {
  const trades = [tr(10, 30, 1), tr(10, 30, 2), tr(-10, 30, 3), tr(10, 30, 4, 'Base'), tr(10, 30, 5)];
  trades.push({ cost: 50, proceeds: 50, openedAt: '2026-09-02T00:00:00Z', closedAt: '2026-09-02T00:00:00Z', isOpen: true, chain: 'Solana' });
  const s = T.style({ numTrades: 3000, accountAgeDays: 100 }, trades);
  assert.equal(s.avgSize, (500 + 50) / 6);
  assert.equal(s.mainChain, 'Solana');
  assert.equal(s.chainLabel, 'mostly Solana');
  assert.equal(s.summary, 'Day trader · very active · balanced · mostly Solana');
  const mixed = T.style({}, [tr(10, 30, 1, 'Base'), tr(10, 30, 2, 'Base'), tr(10, 30, 3, 'Solana'), tr(10, 30, 4, 'Solana'), tr(10, 30, 5, 'BNB')]);
  assert.equal(mixed.chainLabel, 'multi-chain');
});

test('style: fewer than 5 closed trades is not enough for a read', () => {
  const s = T.style({}, [tr(10, 30, 1), tr(-10, 30, 2), tr(10, 30, 3), tr(10, 30, 4)]);
  assert.equal(s.enough, false);
  assert.equal(s.closed, 4);
  assert.ok(Math.abs(s.winRate - 0.75) < 1e-9);
  assert.equal(s.summary, '');
  assert.equal(T.style({}, []).winRate, null);
});
