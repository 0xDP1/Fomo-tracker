const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../fee-drag.js');

const NOW = Date.parse('2026-10-08T12:00:00Z');
const D = 86400000;
const tr = (daysAgo, cost, pnl) => ({ cost, proceeds: cost + pnl, openedAt: new Date(NOW - daysAgo * D - 3600e3).toISOString(), closedAt: new Date(NOW - daysAgo * D).toISOString() });

test('estimate: last 30 days only, trades per day, size, monthly cost and break-even win rates', () => {
  // 6 wins of +50% and 4 losses of -25% on size 100, plus one old trade outside the window
  const trades = [];
  for (let i = 0; i < 6; i++) trades.push(tr(i + 1, 100, 50));
  for (let i = 0; i < 4; i++) trades.push(tr(i + 10, 100, -25));
  trades.push(tr(45, 1000, -900));
  const e = F.estimate(trades, NOW, 0.04);
  assert.equal(e.trades, 10);
  assert.ok(Math.abs(e.perDay - 10 / 30) < 1e-9);
  assert.equal(e.avgSize, 100);
  assert.equal(e.monthlyCost, 40);
  assert.ok(Math.abs(e.winRate - 0.6) < 1e-9);
  // W = 0.5, L = 0.25: with costs 0.25 / 0.75, without (0.25 - 0.04) / 0.75
  assert.ok(Math.abs(e.needWithCosts - 1 / 3) < 1e-9);
  assert.ok(Math.abs(e.needWithoutCosts - 0.21 / 0.75) < 1e-9);
  // net PnL 300 - 100 = 200; gross = 240; costs are 40 / 240 of it
  assert.equal(e.netPnl, 200);
  assert.ok(Math.abs(e.costShareOfGross - 40 / 240) < 1e-9);
  assert.equal(e.enough, true);
});

test('estimate: costs above the average loss floor the no-cost break-even at 0; gross share only when gross is positive', () => {
  const trades = [tr(1, 100, 10), tr(2, 100, 10), tr(3, 100, -2), tr(4, 100, -2), tr(5, 100, -2)];
  const e = F.estimate(trades, NOW, 0.05);
  assert.equal(e.needWithoutCosts, 0);
  const losing = [tr(1, 100, 5), tr(2, 100, -50), tr(3, 100, -50), tr(4, 100, -50), tr(5, 100, -50)];
  assert.equal(F.estimate(losing, NOW, 0.04).costShareOfGross, null);
});

test('estimate: not enough data under 5 trades or without both a win and a loss', () => {
  assert.equal(F.estimate([tr(1, 100, 10), tr(2, 100, -10)], NOW, 0.04).enough, false);
  const allWins = [1, 2, 3, 4, 5].map((d) => tr(d, 100, 10));
  const e = F.estimate(allWins, NOW, 0.04);
  assert.equal(e.enough, false);
  assert.equal(e.monthlyCost, 20, 'the cost estimate still works');
  assert.equal(F.estimate([], NOW, 0.04).trades, 0);
});
