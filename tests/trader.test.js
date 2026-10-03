const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../trader.js');

const SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL2 = 'So11111111111111111111111111111111111111112';
const EVM = '0x4bc1782fafb967834e0e75947ba15113e48fc70e';

test('parseWallets reads object, array and nested layouts and labels by address format', () => {
  assert.deepEqual(T.parseWallets({ wallets: { solana: SOL, evm: EVM } }), { solana: [SOL], evm: [EVM] });
  assert.deepEqual(T.parseWallets({ wallets: [{ chain: 'solana', address: SOL }, { chain: 'base', address: EVM.toUpperCase().replace('0X', '0x') }, { chain: 'bnb', address: EVM }] }), { solana: [SOL], evm: [EVM] });
  assert.deepEqual(T.parseWallets({ wallets: [SOL, SOL2] }), { solana: [SOL, SOL2], evm: [] });
  assert.deepEqual(T.parseWallets({ wallets: { primary: { address: SOL } } }), { solana: [SOL], evm: [] });
  // no wallets field: fall back to address-like keys elsewhere in the profile, ignoring unrelated strings
  assert.deepEqual(T.parseWallets({ handle: 'x', solanaAddress: SOL, description: 'gm' }), { solana: [SOL], evm: [] });
  assert.deepEqual(T.parseWallets({}), { solana: [], evm: [] });
});

test('explorerLinks: Solscan for Solana, one entry per EVM chain sharing the address', () => {
  const links = T.explorerLinks({ solana: [SOL], evm: [EVM] });
  assert.deepEqual(links.map((l) => l.chain), ['Solana', 'Base', 'BNB', 'Ethereum']);
  assert.equal(links[0].url, `https://solscan.io/account/${SOL}`);
  assert.equal(links[1].url, `https://basescan.org/address/${EVM}`);
  assert.equal(links[2].url, `https://bscscan.com/address/${EVM}`);
  assert.equal(links[3].url, `https://etherscan.io/address/${EVM}`);
});

test('scorecard: win rate and PnL from closed trades, size over all, hold and totals from the profile', () => {
  const trades = [
    { cost: 100, proceeds: 200, openedAt: '2026-10-01T10:00:00Z', closedAt: '2026-10-01T11:00:00Z', isOpen: false },
    { cost: 100, proceeds: 50, openedAt: '2026-10-01T12:00:00Z', closedAt: '2026-10-01T15:00:00Z', isOpen: false },
    { cost: 100, proceeds: 300, openedAt: '2026-10-02T09:00:00Z', closedAt: '2026-10-02T09:30:00Z', isOpen: false },
    { cost: 60, proceeds: 60, openedAt: '2026-10-03T08:00:00Z', closedAt: '2026-10-03T08:00:00Z', isOpen: true },
  ];
  const s = T.scorecard({ numTrades: 654, averageHoldTimeSeconds: 5400 }, trades);
  assert.equal(s.closed, 3);
  assert.equal(s.open, 1);
  assert.ok(Math.abs(s.winRate - 2 / 3) < 1e-9);
  assert.equal(s.realizedPnl, 250);
  assert.equal(s.avgSize, 90);
  assert.equal(s.avgHoldSec, 5400);
  assert.equal(s.totalTrades, 654);
  assert.equal(s.lastActive, '2026-10-03T08:00:00.000Z');
  // without profile figures it falls back to the trades
  const f = T.scorecard({}, trades);
  assert.equal(f.avgHoldSec, (3600 + 10800 + 1800) / 3);
  assert.equal(f.totalTrades, 4);
  assert.equal(T.scorecard({}, []).winRate, null);
});

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
