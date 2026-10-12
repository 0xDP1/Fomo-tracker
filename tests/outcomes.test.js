const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../outcomes.js');

const M = 60000;
const AT = 1791800000000;
// 5-minute candles from the call: closes[i] for candle i (highs = closes unless given).
const candles = (closes, highs) => closes.map((c, i) => ({ t: AT + i * 5 * M, o: i ? closes[i - 1] : 1, h: highs ? highs[i] : c, l: c, c }));
const flat = (len, v = 1) => Array.from({ length: len }, () => v);

test('outcome: 2x at 59 minutes is a fast runner, known at once', () => {
  const cs = candles([1.2, 1.5, ...flat(9, 1.4), 1.1], [1.2, 1.5, ...flat(9, 1.4), 2.05]); // candle 11 starts at 55 min
  const o = O.outcome(cs, AT, 1, AT + 61 * M);
  assert.deepEqual([o.label, o.fast, o.h1.peak, o.m15.peak], ['runner', true, 2.05, 1.5]);
  assert.equal(o.h4.done, false, 'the 4 h window is still open');
});

test('outcome: 2x after the first hour is a runner but not fast; 1.99x is not a runner', () => {
  const late = candles([...flat(12, 1.2), 2.0, ...flat(35, 1.5)]);
  assert.deepEqual(['label', 'fast'].map((k) => O.outcome(late, AT, 1, AT + 241 * M)[k]), ['runner', false]);
  const almost = candles([...flat(12, 1.2), 1.99, ...flat(35, 1.5)]);
  assert.equal(O.outcome(almost, AT, 1, AT + 241 * M).label, 'flat');
});

test('outcome: under 0.3x at 4 h is dead, 0.3x is flat; no label before the 4 h mark unless it ran', () => {
  assert.equal(O.outcome(candles([...flat(47, 0.5), 0.29]), AT, 1, AT + 241 * M).label, 'dead');
  assert.equal(O.outcome(candles([...flat(47, 0.5), 0.3]), AT, 1, AT + 241 * M).label, 'flat');
  assert.equal(O.outcome(candles(flat(20, 0.2)), AT, 1, AT + 100 * M).label, null, 'still inside the 4 h window');
  assert.deepEqual(O.outcome([], AT, 1, AT + 300 * M, { noPool: true }), { label: 'dead', fast: false, noPool: true });
  assert.equal(O.outcome([], AT, 1, AT + 60 * M, { noPool: true }).label, null);
});

test('outcome: candles before the call are ignored; no base price uses the call candle\'s open', () => {
  const cs = [{ t: AT - 10 * M, o: 1, h: 9, l: 1, c: 1 }, { t: AT - 3 * M, o: 2, h: 2.2, l: 2, c: 2.1 }, { t: AT + 2 * M, o: 2.1, h: 4.4, l: 2, c: 4 }];
  const o = O.outcome(cs, AT, null, AT + 241 * M);
  assert.equal(o.base, 2, 'the candle the call fell in (started 3 min before)');
  assert.equal(o.h4.peak, 2.2, 'the 9x before the call does not count');
  assert.equal(o.label, 'runner');
});

test('candlesFrom: GeckoTerminal OHLCV, newest first in seconds -> oldest first in ms', () => {
  const j = { data: { attributes: { ohlcv_list: [[1791800600, 2, 3, 1.5, 2.5, 100], [1791800300, 1, 2, 0.9, 2, 50]] } } };
  assert.deepEqual(O.candlesFrom(j), [{ t: 1791800300000, o: 1, h: 2, l: 0.9, c: 2 }, { t: 1791800600000, o: 2, h: 3, l: 1.5, c: 2.5 }]);
  assert.deepEqual(O.candlesFrom({}), []);
});

test('snapshot: the facts at the call; unknown ones fill in for 30 minutes, known ones never change', () => {
  const e = { address: 'A', firstAt: AT, launchedAt: AT - 20 * M, mcap: 100000, liq: 20000, vol24h: 150000, vol1h: 9000, price: 0.0001, posters: ['a', 'b'], sources: ['telegram'], snap: { holders: 300, top5Pct: 18 }, bundle: { scanned: true, bundledPct: 12 }, str: 64 };
  let s = O.snapshot(null, e, { winRate: 55 }, AT + M);
  assert.deepEqual(s.facts, { ageMin: 20, mcap: 100000, liq: 20000, liqPct: 20, vol1h: 9000, turnover: 1.5, holders: 300, top5Pct: 18, bundledPct: 12, callerWin: 55, callers: 2, str: 64, rugScore: null, topHolderPct: null, top10Pct: null, insiderPct: null, emptyPct: null, fundedN: null });
  const later = Object.assign({}, e, { mcap: 500000, score: 72, facts: { topHolderPct: 2.5, top10Pct: 19, insiderPct: 3 }, wal: { emptyPct: 1.2, fundedN: 6 } });
  s = O.snapshot(s, later, { winRate: 55 }, AT + 20 * M);
  assert.deepEqual([s.facts.mcap, s.facts.rugScore, s.facts.topHolderPct, s.facts.fundedN], [100000, 72, 2.5, 6], 'the market cap stays as it was at the call');
  const s2 = O.snapshot(s, Object.assign({}, later, { str: 10, snap: {} }), null, AT + 40 * M);
  assert.equal(s2, s, 'after 30 minutes nothing changes');
  assert.equal(O.snapshot(null, e, null, AT + 31 * M), null, 'a call first seen after 30 minutes has no call-time snapshot');
});

// A made-up set: runners have many funded wallets; the holder count says nothing.
const rec = (label, fundedN, holders, extra) => ({ label, facts: Object.assign({ fundedN, holders }, extra) });
const SET = [rec('runner', 8, 300), rec('runner', 6, 500), rec('runner', 7, 200), rec('runner', 9, 400), rec('flat', 2, 300), rec('dead', 1, 500), rec('flat', 3, 200), rec('dead', 2, 400), rec('flat', 6, 350)];

test('compare: the fact that predicts runners comes first, the one that does not scores near 0', () => {
  const c = O.compare(SET);
  assert.deepEqual([c.runners, c.rest, c.dead], [4, 5, 2]);
  assert.equal(c.rows[0].key, 'fundedN');
  assert.deepEqual([c.rows[0].runnerMedian, c.rows[0].restMedian, c.rows[0].higher], [7.5, 2, true]);
  assert.ok(c.rows[0].sep > 0.8, 'funded wallets separate: ' + c.rows[0].sep);
  const h = c.rows.find((r) => r.key === 'holders');
  assert.ok(h.sep < 0.2, 'holders do not: ' + h.sep);
  assert.equal(O.compare([rec('runner', 8, 1), rec('runner', 6, 1), rec('flat', 1, 1), rec('flat', 1, 1)]).rows.length, 0, 'under 3 on a side: nothing compared');
});

test('likeRunners: hidden under 30 runners; then counts the separating facts a coin shares with runners', () => {
  assert.equal(O.likeRunners({ fundedN: 9 }, O.compare(SET)), null, '4 runners is not enough');
  const many = [];
  for (let i = 0; i < 30; i++) many.push(rec('runner', 6 + (i % 4), 300 + (i % 10), { liqPct: 25 }));
  for (let i = 0; i < 40; i++) many.push(rec(i % 2 ? 'flat' : 'dead', 1 + (i % 3), 300 + (i % 10), { liqPct: 8 }));
  const c = O.compare(many);
  assert.deepEqual(O.likeRunners({ fundedN: 7, liqPct: 30, holders: 310 }, c), { n: 2, of: 2 }, 'holders do not separate, so they are left out');
  assert.deepEqual(O.likeRunners({ fundedN: 1, liqPct: 30 }, c), { n: 1, of: 2 });
  assert.equal(O.likeRunners({}, c), null);
});

test('prune: keeps the newest 300', () => {
  const s = Object.fromEntries(Array.from({ length: 305 }, (_, i) => ['C' + i, { at: i }]));
  const p = O.prune(s);
  assert.equal(Object.keys(p).length, 300);
  assert.equal(p.C0, undefined);
  assert.ok(p.C304);
});
