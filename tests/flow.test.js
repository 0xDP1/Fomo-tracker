const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../flow.js');
const C = require('../check.js');

const MINT = 'CoinMint11111111111111111111111111111111111';
const NOW = 1_800_000_000; // seconds
// Helius enhanced transaction: the fee payer receives (buy) or sends (sell) `amt` of the coin
const tx = (sig, trader, side, amt, agoMin, extra = []) => ({
  signature: sig, timestamp: NOW - agoMin * 60, feePayer: trader, fee: 5000,
  tokenTransfers: [side === 'buy'
    ? { fromUserAccount: 'PoolVault', toUserAccount: trader, mint: MINT, tokenAmount: amt }
    : { fromUserAccount: trader, toUserAccount: 'PoolVault', mint: MINT, tokenAmount: amt }].concat(extra),
});

test('classify reads the fee payer\'s net change in the coin', () => {
  assert.deepEqual(F.classify(tx('s1', 'W1', 'buy', 100, 2), MINT), { sig: 's1', t: NOW - 120, trader: 'W1', side: 'buy', tokens: 100 });
  assert.equal(F.classify(tx('s2', 'W1', 'sell', 40, 2), MINT).side, 'sell');
  // other mints and transfers between other wallets are ignored
  assert.equal(F.classify({ signature: 's3', timestamp: NOW, feePayer: 'W1', tokenTransfers: [{ fromUserAccount: 'A', toUserAccount: 'B', mint: MINT, tokenAmount: 5 }] }, MINT), null);
  assert.equal(F.classify({ signature: 's4', timestamp: NOW, feePayer: 'W1', tokenTransfers: [{ fromUserAccount: 'P', toUserAccount: 'W1', mint: 'Other', tokenAmount: 5 }] }, MINT), null);
  // a buy and partial sell in one transaction nets out
  assert.equal(F.classify(tx('s5', 'W1', 'buy', 100, 1, [{ fromUserAccount: 'W1', toUserAccount: 'X', mint: MINT, tokenAmount: 30 }]), MINT).tokens, 70);
});

test('summarize: 5 / 30 / 60 minute windows, unique wallets, top wallet share and coverage', () => {
  const txs = [
    tx('a', 'B1', 'buy', 100, 1), tx('b', 'B2', 'buy', 200, 3), tx('c', 'S1', 'sell', 50, 4),
    tx('d', 'B1', 'buy', 50, 20), tx('e', 'S2', 'sell', 150, 45), tx('f', 'B3', 'buy', 400, 70),
  ];
  const s = F.summarize(txs.map((t) => F.classify(t, MINT)).filter(Boolean), NOW, 0.01);
  assert.deepEqual(s.w5, { buyUsd: 3, sellUsd: 0.5, buys: 2, sells: 1, buyers: 2, sellers: 1 });
  assert.deepEqual(s.w30, { buyUsd: 3.5, sellUsd: 0.5, buys: 3, sells: 1, buyers: 2, sellers: 1 });
  assert.deepEqual(s.w60, { buyUsd: 3.5, sellUsd: 2, buys: 3, sells: 2, buyers: 2, sellers: 2 }, 'the 70-minute-old buy is outside the hour');
  assert.equal(s.top.addr, 'B2');
  assert.ok(Math.abs(s.top.share - 2 / 5.5) < 1e-9);
  assert.equal(s.trades60, 5);
  assert.equal(s.coveredMin, 70);
  assert.equal(s.complete, true);
  const partial = F.summarize([F.classify(tx('x', 'B1', 'buy', 1, 12), MINT)], NOW, 1, { exhausted: true });
  assert.equal(partial.complete, false, 'pages ran out before the hour was covered');
  assert.equal(partial.coveredMin, 12);
});

const summary = (o) => Object.assign({ w60: { buyUsd: 1000, sellUsd: 800, buys: 40, sells: 30, buyers: 25, sellers: 20 }, top: { addr: 'X', share: 0.1 }, trades60: 70 }, o);

test('label: one wallet at 30% with 10+ trades, real demand needs 20 buyers and buyers ahead, else thin', () => {
  assert.equal(F.label(summary({ top: { addr: 'X', share: 0.3 } })), 'One wallet is the volume');
  assert.equal(F.label(summary({ top: { addr: 'X', share: 0.9 }, trades60: 9, w60: { buyUsd: 90, sellUsd: 10, buys: 6, sells: 3, buyers: 4, sellers: 2 } })), 'Thin', 'too few trades to call it one wallet');
  assert.equal(F.label(summary({})), 'Real demand');
  assert.equal(F.label(summary({ w60: { buyUsd: 1000, sellUsd: 800, buys: 40, sells: 30, buyers: 19, sellers: 10 } })), 'Thin');
  assert.equal(F.label(summary({ w60: { buyUsd: 1000, sellUsd: 800, buys: 40, sells: 30, buyers: 25, sellers: 26 } })), 'Thin');
  assert.equal(F.label(summary({ w60: { buyUsd: 700, sellUsd: 800, buys: 40, sells: 30, buyers: 25, sellers: 20 } })), 'Thin');
  assert.equal(F.label(summary({ w60: { buyUsd: 800, sellUsd: 800, buys: 40, sells: 30, buyers: 20, sellers: 20 } })), 'Real demand', 'ties count');
});

test('topBuyers ranks buyers by hour volume for the fresh-wallet check; isFresh matches Analyze top wallets', () => {
  const trades = [tx('a', 'B1', 'buy', 100, 1), tx('b', 'B2', 'buy', 300, 3), tx('c', 'B1', 'buy', 250, 5), tx('d', 'S1', 'sell', 900, 5)].map((t) => F.classify(t, MINT));
  assert.deepEqual(F.topBuyers(trades, NOW, 8), ['B1', 'B2']);
  assert.equal(F.isFresh(new Array(30).fill({})), true);
  assert.equal(F.isFresh(new Array(31).fill({})), false);
});

test('assessRisk: one wallet making up the volume is a finding (medium at 30%, high at 50%)', () => {
  assert.equal(C.assessRisk({ flowTopShare: 0.29 }).findings.length, 0);
  const m = C.assessRisk({ flowTopShare: 0.3 }).findings[0];
  assert.equal(m.key, 'onewallet');
  assert.equal(m.sev, 'medium');
  assert.match(m.title, /One wallet is the volume/);
  assert.match(m.detail, /30%/);
  assert.equal(C.assessRisk({ flowTopShare: 0.5 }).findings[0].sev, 'high');
});
