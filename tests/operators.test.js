const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../operators.js');
const C = require('../check.js');
const L = require('../lessons.js');

const MINT = 'CoinMint11111111111111111111111111111111111';
const WSOL = 'So11111111111111111111111111111111111111112';
const T0 = 1_800_000_000;
const sol = (from, to, ts, sig) => ({ signature: sig, timestamp: ts, type: 'TRANSFER', feePayer: from, nativeTransfers: [{ fromUserAccount: from, toUserAccount: to, amount: 2e9 }], tokenTransfers: [] });
const buy = (who, ts, sig) => ({ signature: sig, timestamp: ts, type: 'SWAP', feePayer: who, nativeTransfers: [{ fromUserAccount: who, toUserAccount: 'Pool', amount: 1e9 }], tokenTransfers: [{ fromUserAccount: 'PoolVault', toUserAccount: who, mint: MINT, tokenAmount: 100 }] });

test('walletLinks: first SOL funder, coin received by transfer, virgin history', () => {
  // newest first, as Helius returns them
  const txs = [buy('W1', T0 + 300, 'b'), sol('Funder', 'W1', T0, 'f'), sol('Other', 'W1', T0 + 100, 'g')].sort((a, b) => b.timestamp - a.timestamp);
  assert.deepEqual(O.walletLinks('W1', txs, MINT, true), { funder: 'Funder', fundedAt: T0, gotFrom: null, gotByTransfer: false, virgin: true, complete: true });
  const gift = { signature: 'x', timestamp: T0 + 50, type: 'TRANSFER', feePayer: 'Boss', nativeTransfers: [], tokenTransfers: [{ fromUserAccount: 'Boss', toUserAccount: 'W2', mint: MINT, tokenAmount: 500 }] };
  const r = O.walletLinks('W2', [gift, sol('Funder', 'W2', T0, 'f2')], MINT, true);
  assert.equal(r.gotByTransfer, true);
  assert.equal(r.gotFrom, 'Boss');
  const traded = { signature: 'y', timestamp: T0 + 10, type: 'SWAP', feePayer: 'W3', nativeTransfers: [], tokenTransfers: [{ fromUserAccount: 'P', toUserAccount: 'W3', mint: 'OtherCoin', tokenAmount: 1 }] };
  assert.equal(O.walletLinks('W3', [buy('W3', T0 + 20, 'b3'), traded, sol('F', 'W3', T0, 'f3')], MINT, true).virgin, false, 'traded another token first');
  assert.equal(O.walletLinks('W3', [buy('W3', T0 + 20, 'b3'), { ...traded, tokenTransfers: [{ fromUserAccount: 'P', toUserAccount: 'W3', mint: WSOL, tokenAmount: 1 }] }, sol('F', 'W3', T0, 'f3')], MINT, true).virgin, true, 'wrapped SOL does not count');
  // history not fully loaded: no funder link, not virgin
  assert.deepEqual(O.walletLinks('W4', [buy('W4', T0, 'b4')], MINT, false), { funder: null, fundedAt: null, gotFrom: null, gotByTransfer: false, virgin: false, complete: false });
});

const h = (addr, pct, funder, fundedAt, gotFrom = null) => ({ addr, pct, funder, fundedAt, gotFrom });

test('cluster: shared funder within 72 h, holder-funds-holder and holder-sends-coin links; exchanges and stale links ignored', () => {
  const ops = O.cluster([
    h('A', 5, 'F1', T0), h('B', 4, 'F1', T0 + 3600), h('C', 3, 'A', T0 + 7200),   // A,B share F1; A funded C
    h('D', 6, 'F2', T0), h('E', 2, 'F2', T0 + 80 * 3600),                       // same funder but 80 h apart
    h('G', 2, '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9', T0), h('H', 2, '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9', T0 + 60), // exchange
    h('I', 1, null, null, 'D'),                                                  // D sent the coin to I
  ]);
  assert.deepEqual(ops.map((o) => [o.wallets.slice().sort().join(','), o.pct]), [['A,B,C', 12], ['D,I', 7], ['E', 2], ['G', 2], ['H', 2]]);
});

test('dumpDrop: constant-product price impact of selling an operator\'s share into the pool', () => {
  // liquidity $100k -> $50k per side; 10% of a $500k cap = $50k sold -> price falls to (50/100)^2 = 25% -> 75% drop
  assert.ok(Math.abs(O.dumpDrop(10, 500000, 100000) - 0.75) < 1e-9);
  assert.ok(Math.abs(O.dumpDrop(1, 500000, 100000) - (1 - (50000 / 55000) ** 2)) < 1e-9);
  assert.equal(O.dumpDrop(5, null, 100000), null);
  assert.equal(O.dumpDrop(5, 500000, 0), null);
});

test('summarize: biggest operator, its drop, and transfer / virgin shares of analyzed supply', () => {
  const holders = [
    { ...h('A', 5, 'F1', T0), gotByTransfer: true, virgin: true }, { ...h('B', 5, 'F1', T0 + 60), gotByTransfer: false, virgin: true },
    { ...h('C', 10, null, null), gotByTransfer: false, virgin: false },
  ];
  const s = O.summarize(holders, 500000, 100000);
  assert.deepEqual(s.top.wallets.slice().sort(), ['A', 'B']);
  assert.equal(s.top.pct, 10);
  assert.ok(Math.abs(s.top.drop - 0.75) < 1e-9);
  assert.equal(s.analyzedPct, 20);
  assert.equal(s.transferPct, 5);
  assert.equal(s.virginPct, 10);
  assert.equal(s.operators.length, 2);
});

test('assessRisk: a multi-wallet operator that could crash the price is critical at 50%, high at 25%', () => {
  assert.equal(C.assessRisk({ operatorWallets: 3, operatorPct: 12, operatorDrop: 0.6 }).findings[0].sev, 'critical');
  const f = C.assessRisk({ operatorWallets: 3, operatorPct: 12, operatorDrop: 0.3 }).findings[0];
  assert.equal(f.key, 'operator');
  assert.equal(f.sev, 'high');
  assert.match(f.title, /One operator controls 3 wallets/);
  assert.match(f.detail, /12% of supply.*about 30%/);
  assert.equal(C.assessRisk({ operatorWallets: 3, operatorPct: 2, operatorDrop: 0.2 }).findings.length, 0);
  assert.equal(C.assessRisk({ operatorWallets: 1, operatorPct: 12, operatorDrop: 0.9 }).findings.filter((x) => x.key === 'operator').length, 0, 'a single wallet is the whale check, not an operator');
});

test('Holder lessons learns from hidden operators', () => {
  const s = L.snapshot({ operatorWallets: 3, operatorDrop: 0.3 }, null, 0);
  assert.equal(s.operatorDrop, 0.3);
  assert.equal(s.operatorWallets, 3);
  const p = L.PATTERNS.find((x) => x.key === 'operator');
  assert.match(p.label, /Hidden operator could drop it 25%\+/);
  assert.equal(p.test(s), true);
  assert.equal(p.test(L.snapshot({ operatorWallets: 1, operatorDrop: 0.9 }, null, 0)), false);
  assert.equal(p.test(L.snapshot({}, null, 0)), null);
});
