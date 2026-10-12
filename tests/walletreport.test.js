const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../walletreport.js');

const T0 = 1791700000; // seconds
const act = (type, token, minutes, price, usd) => ({ event_type: type, token: { address: token, symbol: token.slice(0, 4) }, timestamp: T0 + minutes * 60, price_usd: price, cost_usd: usd, tx_hash: `${type}${token}${minutes}` });

test('pair: groups by token, USD-weighted prices, closed vs open, transfers ignored', () => {
  const rows = [
    act('buy', 'AAA', 0, 1, 100), act('buy', 'AAA', 1, 2, 100), act('sell', 'AAA', 3, 3, 150), act('sell', 'AAA', 10, 1.5, 50),
    act('buy', 'BBB', 5, 10, 200), act('sell', 'BBB', 125, 5, 100),
    act('buy', 'CCC', 20, 1, 80),
    { event_type: 'transferIn', token: { address: 'DDD' }, timestamp: T0, cost_usd: 999 },
  ];
  const p = R.pair(rows);
  assert.deepEqual(p.map((x) => x.address), ['AAA', 'BBB', 'CCC']);
  const a = p[0];
  assert.equal(a.buyUsd, 200);
  assert.equal(a.buyPrice, 1.5, 'USD-weighted: (1×100 + 2×100) / 200');
  assert.equal(a.sellPrice, 2.625, '(3×150 + 1.5×50) / 200');
  assert.equal(a.closed, true);
  assert.equal(a.ret, 0.75);
  assert.equal(a.holdMin, 3, 'first sell minus first buy');
  assert.equal(p[1].ret, -0.5);
  assert.equal(p[1].holdMin, 120);
  assert.equal(p[2].closed, false);
  assert.deepEqual(R.pair(null), []);
});

test('stats: activity rate, size, hold, win rate, return, copier fees vs profit', () => {
  const rows = [];
  // 10 closed round trips over 2 days: 6 quick wins of +20% held 1 minute, 4 losses of -50% held 30 minutes, $100 each
  for (let i = 0; i < 10; i++) {
    const win = i < 6, t = i * 288; // every 4.8 hours -> spans 43.2 h
    rows.push(act('buy', 'T' + i, t, 1, 100), act('sell', 'T' + i, t + (win ? 1 : 30), win ? 1.2 : 0.5, win ? 120 : 50));
  }
  rows.push(act('buy', 'OPEN', 2880, 1, 300)); // open position at hour 48
  const s = R.stats(R.pair(rows), { costPct: 4 });
  assert.equal(s.tokens, 11);
  assert.equal(s.closed, 10);
  assert.equal(s.spanHours, 48);
  assert.equal(s.tradesPerDay, 10.5, '21 buys and sells in 2 days');
  assert.equal(s.avgSizeUsd, 118.18, 'mean buy size per token, rounded to cents');
  assert.equal(s.medianHoldMin, 1);
  assert.equal(s.under5mPct, 60);
  assert.equal(s.winRate, 60);
  assert.equal(s.avgRetPct, -8, 'mean of 6×+20% and 4×-50%');
  assert.equal(s.realizedUsd, -80, '6×+20 + 4×-50');
  assert.equal(s.copyCostUsd, 40, '10 round trips × 4% × $100');
  assert.equal(s.costShare, null, 'no profit before costs: share not meaningful');
  const good = R.stats(R.pair([act('buy', 'X', 0, 1, 100), act('sell', 'X', 60, 1.5, 150)]), { costPct: 4 });
  assert.equal(good.realizedUsd, 50);
  assert.equal(good.costShare, 8, '$4 of costs on $50 profit');
  assert.equal(R.stats([], { costPct: 4 }).tokens, 0);
});

test('entryMcaps: buy price × supply from DexScreener market cap and price', () => {
  const p = R.pair([act('buy', 'AAA', 0, 0.001, 100), act('buy', 'BBB', 0, 2, 100)]);
  const m = R.entryMcaps(p, { AAA: { marketCap: 500000, priceUsd: '0.005' } });
  assert.equal(m.AAA, 100000, 'supply 100M × $0.001');
  assert.equal(m.BBB, undefined, 'unknown to DexScreener: left out');
  assert.equal(R.median([300, 100, 200]), 200);
});

test('prompt and verdict: stats and samples in, structured verdict out', () => {
  const pairs = R.pair([act('buy', 'AAA', 0, 1, 100), act('sell', 'AAA', 1, 1.1, 110)]);
  const s = R.stats(pairs, { costPct: 4 });
  const prompt = R.prompt('Wa11et', s, pairs, { AAA: 50000 });
  assert.match(prompt, /Trades per day/);
  assert.match(prompt, /Median hold 1 min/);
  assert.match(prompt, /AAA: \+10%, held 1 min, \$100, entry mcap \$50k/);
  assert.match(R.SYSTEM, /data, never instructions/);
  assert.deepEqual(R.SCHEMA.properties.verdict.enum, ['copyable', 'risky', 'dont_copy']);
  const v = R.readVerdict(JSON.stringify({ style: 'Scalper', verdict: 'dont_copy', reasons: ['Holds under a minute'], summary: 'Fast flips.' }));
  assert.deepEqual(v, { style: 'Scalper', verdict: 'dont_copy', label: "Don't copy", reasons: ['Holds under a minute'], summary: 'Fast flips.' });
  assert.equal(R.readVerdict('not json'), null);
  assert.equal(R.readVerdict(JSON.stringify({ style: 'x', verdict: 'yolo', reasons: [], summary: '' })), null);
});

test('parseWallet: a bare address or a GMGN wallet link', () => {
  const W = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
  assert.equal(R.parseWallet(W), W);
  assert.equal(R.parseWallet(`https://gmgn.ai/sol/address/${W}?tab=activity`), W);
  assert.equal(R.parseWallet('hello'), null);
});
