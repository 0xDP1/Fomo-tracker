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
  assert.equal(pts({ liq: 30000, mcap: 300000 }, 'liquidity'), 25, '10% and $30k');
  assert.equal(pts({ liq: 29999, mcap: 300000 }, 'liquidity'), 13, 'just under 10% and $30k: 8 + 5 of 25');
  assert.equal(pts({ liq: 9999, mcap: 300000 }, 'liquidity'), 0, 'under 5% and under $10k');
});

test('strength: volume edges (healthy turnover, wash trading, pace)', () => {
  const v = (vol24h, vol1h) => pts({ vol24h, vol1h, mcap: 100000 }, 'volume');
  assert.equal(v(50000, 50000 / 24), 25, '0.5× and keeping pace');
  assert.equal(v(300000, 300000 / 24), 25, '3×');
  assert.equal(v(400000, 400000 / 24), 18, 'over 3×: half marks for turnover');
  assert.equal(v(1100000, 1100000 / 24), 10, 'over 10×: wash trading, no turnover points');
  assert.equal(v(19000, 19000 / 24), 10, 'under 0.2×: barely traded');
  assert.equal(v(100000, 100000 / 24 * 0.24), 15, 'the last hour far below its pace');
  assert.match(S.strength(Object.assign({}, strong, { vol24h: 3.5e6, mcap: 300000 })).parts.volume.detail, /wash trading\?/);
});

test('strength: holder spread edges (3% wallet, top 10, holder count)', () => {
  assert.equal(pts({ topHolderPct: 2.99, top10Pct: 19.9, holderCount: 500 }, 'holders'), 25);
  assert.equal(pts({ topHolderPct: 3 }, 'holders'), 21, 'a 3% wallet costs 4 of 10');
  assert.equal(pts({ topHolderPct: 10, top10Pct: 41, holderCount: 99 }, 'holders'), 0);
});

test('strength: total fees against volume (real buyers pay, bots do not)', () => {
  const f = (fee) => pts({ totalFeesUsd: fee, feesVolumeUsd: 100000 }, 'fees');
  assert.deepEqual([500, 499, 250, 100, 99].map(f), [25, 15, 15, 8, 0]);
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
