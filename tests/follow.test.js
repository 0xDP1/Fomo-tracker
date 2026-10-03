const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../follow.js');

test('normHandle strips @, spaces, profile URLs and lowercases', () => {
  assert.equal(F.normHandle('  @Alice '), 'alice');
  assert.equal(F.normHandle('https://fomo.family/@Bob_1'), 'bob_1');
  assert.equal(F.normHandle('fomo.family/carol'), 'carol');
  assert.equal(F.normHandle('bad handle!'), '');
  assert.equal(F.normHandle(''), '');
});

test('toEvents: a closed position gives a buy and a sell with PnL, an open one only a buy', () => {
  const items = [
    { id: 'f_1', token: 'BONK', address: 'MintA', chain: 'Solana', openedAt: '2026-10-01T10:00:00.000Z', closedAt: '2026-10-01T12:00:00.000Z', cost: 100, proceeds: 160, isOpen: false },
    { id: 'f_2', token: 'PEPE', address: '0xabc', chain: 'Base', openedAt: '2026-10-02T09:00:00.000Z', closedAt: '2026-10-02T09:00:00.000Z', cost: 50, proceeds: 50, isOpen: true },
  ];
  const ev = F.toEvents('alice', items);
  assert.equal(ev.length, 3);
  const sell = ev.find((e) => e.side === 'sell');
  assert.deepEqual([sell.handle, sell.token, sell.usd, sell.pnl, sell.at], ['alice', 'BONK', 160, 60, '2026-10-01T12:00:00.000Z']);
  const buys = ev.filter((e) => e.side === 'buy');
  assert.deepEqual(buys.map((e) => e.token).sort(), ['BONK', 'PEPE']);
  assert.equal(buys.find((e) => e.token === 'PEPE').usd, 50);
  assert.equal(buys.find((e) => e.token === 'PEPE').pnl, null);
});

test('toEvents: fill rows keep their own side, value and PnL; rows without a time are dropped', () => {
  const ev = F.toEvents('bob', [
    { fill: true, side: 'buy', at: '2026-10-02T08:00:00.000Z', value: 20, pnl: null, id: 'x1', token: 'WIF', address: 'MintW', chain: 'Solana' },
    { fill: true, side: 'sell', at: '2026-10-02T08:30:00.000Z', value: 35, pnl: 15, id: 'x2', token: 'WIF', address: 'MintW', chain: 'Solana' },
    { fill: true, side: 'sell', at: null, value: 1, pnl: 0, id: 'x3', token: 'WIF', address: 'MintW', chain: 'Solana' },
  ]);
  assert.deepEqual(ev.map((e) => [e.side, e.usd, e.pnl]), [['buy', 20, null], ['sell', 35, 15]]);
});

test('mergeFeed: two traders merged newest first, duplicates removed, limited', () => {
  const a = F.toEvents('alice', [
    { id: 'f_1', token: 'BONK', address: 'MintA', chain: 'Solana', openedAt: '2026-10-01T10:00:00.000Z', closedAt: '2026-10-01T12:00:00.000Z', cost: 100, proceeds: 160, isOpen: false },
  ]);
  const b = F.toEvents('bob', [
    { fill: true, side: 'buy', at: '2026-10-01T11:00:00.000Z', value: 20, pnl: null, id: 'x1', token: 'WIF', address: 'MintW', chain: 'Solana' },
  ]);
  const feed = F.mergeFeed([a, b, a]);
  assert.deepEqual(feed.map((e) => `${e.handle}:${e.side}:${e.token}`), ['alice:sell:BONK', 'bob:buy:WIF', 'alice:buy:BONK']);
  assert.equal(F.mergeFeed([a, b], 2).length, 2);
});
