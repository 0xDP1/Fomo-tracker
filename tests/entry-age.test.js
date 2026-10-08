const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../entry-age.js');

const H = 3600000;
const LAUNCH = Date.parse('2026-09-01T00:00:00Z');
const tr = (addr, ageMs, pnl) => ({ address: addr, cost: 100, proceeds: 100 + pnl, openedAt: new Date(LAUNCH + ageMs).toISOString(), closedAt: new Date(LAUNCH + ageMs + H).toISOString() });

test('earliestLaunch: earliest pair for the coin, case-insensitive for EVM, null when unknown', () => {
  const j = { pairs: [{ baseToken: { address: 'Mint1' }, pairCreatedAt: LAUNCH + 5 * H }, { baseToken: { address: 'Mint1' }, pairCreatedAt: LAUNCH }, { baseToken: { address: 'Other' }, pairCreatedAt: 1 }] };
  assert.equal(A.earliestLaunch(j, 'Mint1'), LAUNCH);
  assert.equal(A.earliestLaunch({ pairs: [{ baseToken: { address: '0xABC' }, pairCreatedAt: LAUNCH }] }, '0xabc'), LAUNCH);
  assert.equal(A.earliestLaunch(j, 'Nope'), null);
  assert.equal(A.earliestLaunch({ pairs: [{ baseToken: { address: 'Mint1' } }] }, 'Mint1'), null);
});

test('bandOf: edges at 1 hour, 24 hours and 7 days', () => {
  assert.equal(A.bandOf(0), 'Under 1 hour');
  assert.equal(A.bandOf(H - 1), 'Under 1 hour');
  assert.equal(A.bandOf(H), '1 to 24 hours');
  assert.equal(A.bandOf(24 * H), '1 to 7 days');
  assert.equal(A.bandOf(7 * 24 * H), 'Over 7 days');
  assert.equal(A.bandOf(-1), null);
  assert.equal(A.bandOf(null), null);
});

test('byAge: groups closed trades by coin age at entry with win rate, PnL and average return', () => {
  const launches = { New1: LAUNCH, New2: LAUNCH, Mid: LAUNCH, Old: LAUNCH, Late: LAUNCH + 99 * H };
  const trades = [
    tr('New1', 10 * 60000, -40), tr('New2', 30 * 60000, -20), tr('New1', 50 * 60000, 60),
    tr('Mid', 5 * H, 30),
    tr('Old', 10 * 24 * H, 50), tr('Old', 12 * 24 * H, -10),
    tr('Late', 2 * H, 5),        // only a later pool known: negative age -> unknown
    tr('Unseen', 2 * H, 5),      // no launch time
    Object.assign(tr('Mid', 3 * H, 1), { mint: 'Mid', address: undefined }), // Helius trades carry mint
  ];
  const r = A.byAge(trades, launches);
  const row = (b) => r.rows.find((x) => x.band === b);
  assert.deepEqual(r.rows.map((x) => x.band), ['Under 1 hour', '1 to 24 hours', '1 to 7 days', 'Over 7 days']);
  assert.equal(row('Under 1 hour').count, 3);
  assert.equal(row('Under 1 hour').wins, 1);
  assert.equal(row('Under 1 hour').pnl, 0);
  assert.ok(Math.abs(row('Under 1 hour').avgPct - 0) < 1e-9);
  assert.ok(Math.abs(row('Under 1 hour').winRate - 1 / 3) < 1e-9);
  assert.equal(row('1 to 24 hours').count, 2, 'the mint-only Helius trade is matched too');
  assert.equal(row('1 to 7 days').count, 0);
  assert.equal(row('1 to 7 days').winRate, null);
  assert.equal(row('Over 7 days').pnl, 40);
  assert.equal(r.unknown, 2);
  assert.deepEqual(A.missing(trades, launches).sort(), ['Unseen']);
});
