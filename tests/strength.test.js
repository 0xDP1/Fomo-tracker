const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../strength.js');

const strong = { liq: 40000, mcap: 300000, vol24h: 450000, vol1h: 25000, topHolderPct: 2.9, top10Pct: 15.5, holderCount: 2725, totalFeesUsd: 3000, feesVolumeUsd: 450000, feeSource: 'GMGN total fees' };
const pts = (o, k) => S.strength(Object.assign({}, strong, o)).parts[k].pts;

test('strength: a healthy coin scores high with a line per part', () => {
  const r = S.strength(strong);
  assert.equal(r.score, 100);
  assert.equal(r.label, 'Strong');
  assert.equal(r.read, 4);
  assert.equal(r.parts.liquidity.detail, '$40.0k, 13% of market cap');
  assert.equal(r.parts.volume.detail, '24h volume 1.5× market cap, last hour keeping pace');
  assert.equal(r.parts.holders.detail, 'largest wallet 2.9%, top 10 16%, 2,725 holders');
  assert.equal(r.parts.fees.detail, '$3.0k paid, 0.67% of volume · GMGN total fees');
});

test('strength: liquidity edges (share of market cap and size)', () => {
  assert.equal(pts({ liq: 30000, mcap: 300000 }, 'liquidity'), 20, '10% and $30k');
  assert.equal(pts({ liq: 29999, mcap: 300000 }, 'liquidity'), 10, 'just under 10% and $30k: 8 + 5 of 25, scaled to 20');
  assert.equal(pts({ liq: 9999, mcap: 300000 }, 'liquidity'), 0, 'under 5% and under $10k');
});

test('strength: volume edges (healthy turnover, wash trading, pace)', () => {
  const v = (vol24h, vol1h) => pts({ vol24h, vol1h, mcap: 100000 }, 'volume');
  assert.equal(v(50000, 50000 / 24), 20, '0.5× and keeping pace');
  assert.equal(v(300000, 300000 / 24), 20, '3×');
  assert.equal(v(400000, 400000 / 24), 14, 'over 3×: half marks for turnover');
  assert.equal(v(1100000, 1100000 / 24), 8, 'over 10×: wash trading, no turnover points');
  assert.equal(v(19000, 19000 / 24), 8, 'under 0.2×: barely traded');
  assert.equal(v(100000, 100000 / 24 * 0.24), 12, 'the last hour far below its pace');
  assert.match(S.strength(Object.assign({}, strong, { vol24h: 3.5e6, mcap: 300000 })).parts.volume.detail, /wash trading\?/);
});

test('strength: holder spread edges (3% wallet, top 10, holder count)', () => {
  assert.equal(pts({ topHolderPct: 2.99, top10Pct: 19.9, holderCount: 500 }, 'holders'), 20);
  assert.equal(pts({ topHolderPct: 3 }, 'holders'), 17, 'a 3% wallet costs 4 of 10 (21 of 25, scaled to 20)');
  assert.equal(pts({ topHolderPct: 10, top10Pct: 41, holderCount: 99 }, 'holders'), 0);
});

test('strength: a linked group bigger than the top wallet counts as the largest holder', () => {
  const g = S.largestGroup({ gmRiskPct: 14, gmRiskN: 6, insiderPct: 4, operatorPct: 9, operatorWallets: 3 });
  assert.deepEqual(g, { pct: 14, label: 'GMGN: 6 bundler, insider, sniper or dev wallets' });
  const r = S.strength(Object.assign({}, strong, { topHolderPct: 2, groupPct: g.pct, groupLabel: g.label }));
  assert.equal(r.parts.holders.pts, 12, 'a 2% wallet alone would get 20; 14% in bundlers gets the 10%+ line (15 of 25)');
  assert.equal(r.parts.holders.detail, 'largest group 14.0% (GMGN: 6 bundler, insider, sniper or dev wallets), largest wallet 2.0%, top 10 16%, 2,725 holders');
  assert.equal(pts({ topHolderPct: 2.9, groupPct: 1.5 }, 'holders'), 20, 'a smaller group changes nothing');
  assert.equal(S.largestGroup({ operatorPct: 30, operatorWallets: 1 }), null, 'one wallet is not a group');
  assert.deepEqual(S.largestGroup({ insiderPct: 8, operatorPct: 11, operatorWallets: 4 }), { pct: 11, label: '4 linked wallets' });
  assert.equal(S.largestGroup({}), null);
});

test('walletBalances: empty under 0.1 SOL, low under 1, funded 5+; wallets not read are left out', () => {
  const hs = [{ addr: 'a', pct: 3 }, { addr: 'b', pct: 2 }, { addr: 'c', pct: 1.5 }, { addr: 'd', pct: 1 }, { addr: 'e', pct: 4 }, { addr: 'f', pct: 9 }];
  const w = S.walletBalances(hs, { a: 0.0999, b: 0.1, c: 0.99, d: 5, e: 4.99 });
  assert.deepEqual([w.n, w.emptyN, w.emptyPct, w.lowN, w.lowPct, w.fundedN, w.fundedPct, w.lookAlike], [5, 1, 3, 2, 3.5, 1, 1, null]);
  assert.deepEqual(S.walletFlags(w), [
    { kind: 'amber', text: '3.0% of supply in 1 near-empty wallet (under 0.1 SOL)' },
    { kind: 'amber', text: '2 wallets with 0.1–1 SOL hold 3.5%' },
    { kind: 'green', text: '1.0% held by 1 wallet with 5+ SOL' },
  ]);
  assert.equal(S.walletFlags(S.walletBalances(hs, { a: 0, b: 0.01, e: 0 }))[0].kind, 'red', '9% in empty wallets');
  assert.equal(S.walletBalances(hs, {}), null);
});

test('walletBalances: look-alikes fire on 3 wallets with near-identical SOL and supply, not on 2', () => {
  const hs = [{ addr: 'a', pct: 1.5 }, { addr: 'b', pct: 1.55 }, { addr: 'c', pct: 1.45 }, { addr: 'd', pct: 1.5 }];
  const three = S.walletBalances(hs, { a: 0.5, b: 0.505, c: 0.495, d: 12 });
  assert.equal(three.lookAlike.n, 3);
  assert.match(S.walletFlags(three).find((f) => f.kind === 'red').text, /^3 look-alike wallets: ~0\.50 SOL and ~1\.5% of supply each \(4\.5% together\), likely one person$/);
  assert.equal(S.walletBalances(hs, { a: 0.5, b: 0.505, c: 0.6, d: 12 }).lookAlike, null, 'only 2 alike');
  assert.equal(S.walletBalances([{ addr: 'a', pct: 1 }, { addr: 'b', pct: 3 }, { addr: 'c', pct: 1 }], { a: 0.5, b: 0.5, c: 0.5 }).lookAlike, null, 'same SOL but different supply');
  assert.equal(S.walletBalances(hs, { a: 0.01, b: 0.01, c: 0.01 }).lookAlike, null, 'dust balances are the empty flag, not look-alikes');
});

test('strength: the Wallets part (empty supply, funded share, look-alikes); under 3 wallets read is not read', () => {
  const hs = Array.from({ length: 6 }, (_, i) => ({ addr: 'w' + i, pct: 2 + i * 0.7 }));
  const sol = (arr) => Object.fromEntries(arr.map((v, i) => ['w' + i, v]));
  const wp = (arr) => S.strength(Object.assign({}, strong, { wallets: S.walletBalances(hs, sol(arr)) })).parts.wallets;
  assert.equal(wp([9, 12, 30, 6, 2, 0.5]).pts, 20, 'no empties, most supply funded, no look-alikes');
  assert.equal(wp([0.01, 0.02, 0.05, 6, 2, 0.5]).pts, 6, '8.1% in empty wallets (2 of 10), 18% funded (0 of 6), no look-alikes (4 of 4)');
  assert.equal(wp([0.01, 0.02, 0.05, 6, 2, 0.5]).detail, '6 top wallets read: 3 empty, 1 low, 1 funded', '2 SOL is neither low nor funded');
  assert.deepEqual(S.strength(Object.assign({}, strong, { wallets: S.walletBalances(hs, sol([9, 9])) })).parts.wallets, { pts: null, max: 20, detail: 'not read' });
  const all = S.strength(Object.assign({}, strong, { wallets: S.walletBalances(hs, sol([9, 12, 30, 6, 7, 8])) }));
  assert.deepEqual([all.score, all.read], [100, 5]);
});

test('strength: total fees against volume (real buyers pay, bots do not)', () => {
  const f = (fee) => pts({ totalFeesUsd: fee, feesVolumeUsd: 100000 }, 'fees');
  assert.deepEqual([500, 499, 250, 100, 99].map(f), [20, 12, 12, 6, 0]);
  assert.match(S.strength(Object.assign({}, strong, { totalFeesUsd: 50, feesVolumeUsd: 100000 })).parts.fees.detail, /bot volume\?/);
});

test('strength: missing data is "not read", the score is out of the parts read, fewer than 2 parts gives no score', () => {
  const r = S.strength({ liq: 40000, mcap: 300000, vol24h: 450000, vol1h: 25000 });
  assert.deepEqual([r.parts.holders.pts, r.parts.fees.pts], [null, null]);
  assert.equal(r.parts.fees.detail, 'not read');
  assert.equal(r.score, 100, 'out of 50, not 100');
  assert.equal(r.read, 2);
  const weak = S.strength({ liq: 5000, mcap: 300000, vol24h: 1000, vol1h: 0 });
  assert.equal(weak.score, 0);
  assert.equal(weak.label, 'Weak');
  assert.equal(S.strength({ liq: 40000, mcap: 300000 }).score, null, 'one part is not enough');
  assert.equal(S.strength(null).score, null);
});

test('gmgnTotalFees: finds GMGN\'s total-fee number, top level or in stat; nothing else counts', () => {
  assert.equal(S.gmgnTotalFees({ address: 'x', total_fee: '1234.5', stat: {} }), 1234.5);
  assert.equal(S.gmgnTotalFees({ data: { stat: { total_fees: 99 } } }), 99);
  assert.equal(S.gmgnTotalFees({ pool: { fee_ratio: 0.1 }, stat: { top_10_holder_rate: 0.2 } }), null, 'the pool fee rate is not fees paid');
  assert.equal(S.gmgnTotalFees(null), null);
});

test('feeInput: GMGN total while the coin is under a day old, else the own 24h estimate, else not read', () => {
  assert.deepEqual(S.feeInput({ gmgnFeesUsd: 2000, ageHours: 5, vol24h: 300000 }), { totalFeesUsd: 2000, feesVolumeUsd: 300000, feeSource: 'GMGN total fees' });
  assert.deepEqual(S.feeInput({ gmgnFeesUsd: 2000, ageHours: 30, vol24h: 300000, sampleSol24h: 10, solUsd: 150 }), { totalFeesUsd: 1500, feesVolumeUsd: 300000, feeSource: 'own 24h estimate' });
  assert.deepEqual(S.feeInput({ gmgnFeesUsd: 2000, ageHours: 30, vol24h: 300000 }), { totalFeesUsd: null, feesVolumeUsd: 300000, feeSource: 'GMGN total covers more than 24h' });
  assert.equal(S.feeInput({ vol24h: 1 }).totalFeesUsd, null);
});

test('group: scorecard buckets', () => {
  assert.deepEqual([70, 69, 40, 39, null].map(S.group), ['70+', '40–69', '40–69', 'under 40', 'not scored']);
});
