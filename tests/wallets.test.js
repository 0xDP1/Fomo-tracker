// docs/features/my-wallets.md: several of the owner's wallets as one view: trades merged and split back, balances and GMGN stats summed.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../wallets.js');

const A = 'A1111111111111111111111111111111111111111111', B = 'B2222222222222222222222222222222222222222222';
const t = (id, closedAt, extra) => Object.assign({ id, token: id.toUpperCase(), closedAt, cost: 10, proceeds: 12, source: 'gmgn' }, extra);

test('mergeTrades tags each trade with its wallet, oldest close first; splitTrades strips the tag and routes untagged ones', () => {
  const merged = W.mergeTrades({ [A]: [t('a2', '2026-10-15T10:00:00Z'), t('a1', '2026-10-14T10:00:00Z')], [B]: [t('b1', '2026-10-14T20:00:00Z')] });
  assert.deepEqual(merged.map((x) => [x.id, x.wallet]), [['a1', A], ['b1', B], ['a2', A]]);
  const back = W.splitTrades(merged.concat([t('m1', '2026-10-16T00:00:00Z', { source: 'manual' })]), [A, B], A);
  assert.deepEqual(Object.keys(back).sort(), [A, B].sort());
  assert.deepEqual(back[A].map((x) => x.id), ['a1', 'a2', 'm1'], 'the untagged manual trade goes to the fallback wallet');
  assert.deepEqual(back[B].map((x) => x.id), ['b1']);
  assert.ok(back[A].every((x) => !('wallet' in x)), 'the tag is in memory only');
  assert.deepEqual(W.splitTrades([t('x', '2026-10-16T00:00:00Z', { wallet: 'unknown' })], [A], A)[A].length, 1, 'a tag for a wallet no longer mine goes to the fallback');
  assert.deepEqual(W.splitTrades([], [A, B], A), { [A]: [], [B]: [] }, 'a wallet whose trades were all deleted is saved empty');
  assert.deepEqual(W.mergeOpen({ [A]: [{ token: 'X', cost: 5 }], [B]: [] }), [{ token: 'X', cost: 5, wallet: A }]);
});

test('sumBalances: SOL and tokens added up, tokens merged by mint, one SOL price, unpriced tokens stay unpriced', () => {
  const s = W.sumBalances([
    { sol: 4.5, solPrice: 150, tokens: [{ mint: 'M1', amount: 10, usd: 20 }, { mint: 'M2', amount: 5, usd: NaN }], tokenUsd: 20, totalUsd: 695 },
    { sol: 2, solPrice: 150, tokens: [{ mint: 'M1', amount: 5, usd: 10 }], tokenUsd: 10, totalUsd: 310 },
    null,
  ]);
  assert.deepEqual([s.sol, s.solPrice, s.tokenUsd, s.totalUsd, s.wallets], [6.5, 150, 30, 1005, 2]);
  assert.deepEqual(s.tokens.map((x) => [x.mint, x.amount, Number.isFinite(x.usd) ? x.usd : 'unpriced']), [['M1', 15, 30], ['M2', 5, 'unpriced']]);
  assert.equal(W.sumBalances([]), null);
});

test('sumStats: realized profit and counts summed, the win rate weighted by tokens traded', () => {
  const s = W.sumStats([
    { realized7: 840, realized30: 3100, unrealized: 20, winRate: 58, tokens: 12, buys: 31, sells: 29 },
    { realized7: -100, realized30: 50, unrealized: null, winRate: 40, tokens: 4, buys: 6, sells: 5 },
    { realized7: 10, realized30: null, unrealized: null, winRate: null, tokens: 0, buys: 1, sells: 0 },
  ]);
  assert.deepEqual(s, { realized7: 750, realized30: 3150, unrealized: 20, tokens: 16, buys: 38, sells: 34, winRate: 54, wallets: 3 }, '(58×12 + 40×4) / 16 = 53.5 → 54');
  assert.equal(W.sumStats([null]), null);
});

test('labelFor and isAllInput', () => {
  assert.equal(W.labelFor(A, { alice: A, 'B222…2222': B }), 'alice', 'a FOMO handle names it');
  assert.equal(W.labelFor(B, { alice: A, 'B222…2222': B }), 'B222…2222');
  assert.equal(W.labelFor(B, { 'B222…2222': B }, { [B]: 'Main' }), 'Main', 'a name the owner gave wins');
  assert.equal(W.labelFor(B, {}), 'B222…2222');
  assert.equal(W.isAllInput('All my wallets'), true);
  assert.equal(W.isAllInput(' all '), true);
  assert.equal(W.isAllInput('alice'), false);
});

test('setupLink: ?mine= lists the wallets, names pair by position, bad entries are skipped', () => {
  const r = W.setupLink(`?mine=${A},nope,${B},${A}&names=Main,x,Second&user=ignored`);
  assert.deepEqual(r, { wallets: [A, B], names: { [A]: 'Main', [B]: 'Second' }, skipped: 1 });
  assert.deepEqual(W.setupLink(`?mine=${A}`), { wallets: [A], names: {}, skipped: 0 });
  assert.deepEqual(W.setupLink('?mine='), { wallets: [], names: {}, skipped: 0 });
  assert.equal(W.setupLink('?user=alice'), null, 'no mine parameter: not a setup link');
  assert.equal(W.setupLink(''), null);
});
