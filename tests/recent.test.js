const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../recent.js');

const NOW = 1791800000000;
const M = 60000;
const q = (list) => Object.fromEntries(list.map((e) => [e.address, Object.assign({ chain: 'solana', posters: ['x'], firstPoster: 'x', channels: ['first scan'], mentions: 1, lastAt: e.firstAt }, e)]));

test('recentAddresses: the newest 50 by call time', () => {
  const queue = q(Array.from({ length: 60 }, (_, i) => ({ address: 'C' + i, firstAt: NOW - i * M })));
  const r = R.recentAddresses(queue);
  assert.equal(r.length, 50);
  assert.equal(r[0], 'C0');
  assert.equal(r[49], 'C49');
});

test('update: the base is the alert\'s call market cap, else the first read; latest and peak follow; old calls drop off', () => {
  const queue = q([{ address: 'A', firstAt: NOW - 5 * M, callMcap: 100000, symbol: 'AAA' }, { address: 'B', firstAt: NOW - 2 * M, symbol: 'BBB', sources: ['telegram'], channels: ['Alpha calls'] }]);
  let { track } = R.update({}, queue, { A: 150000, B: 50000 }, NOW);
  assert.deepEqual([track.A.base, track.A.last, track.A.peak], [100000, 150000, 150000]);
  assert.deepEqual([track.B.base, track.B.baseAt, track.B.sources, track.B.channels], [50000, NOW, ['telegram'], ['Alpha calls']]);
  ({ track } = R.update(track, queue, { A: 120000 }, NOW + M));
  assert.deepEqual([track.A.last, track.A.peak, R.xNow(track.A), R.xPeak(track.A)], [120000, 150000, 1.2, 1.5], 'the peak stays');
  assert.equal(track.B.last, 50000, 'not read this time: unchanged');
  const many = q(Array.from({ length: 51 }, (_, i) => ({ address: 'N' + i, firstAt: NOW + (i + 1) * M })));
  ({ track } = R.update(track, Object.assign({}, queue, many), {}, NOW + 2 * M));
  assert.equal(track.A, undefined, 'no longer among the last 50');
  assert.equal(Object.keys(track).length, 50);
});

test('update: alerts at 2× and 4×, each once per call, the highest level only on a jump', () => {
  const queue = q([{ address: 'A', firstAt: NOW, callMcap: 100000, symbol: 'AAA' }, { address: 'B', firstAt: NOW, callMcap: 100000, symbol: 'BBB' }]);
  let r = R.update({}, queue, { A: 199000, B: 100000 }, NOW + M);
  assert.deepEqual(r.alerts, []);
  r = R.update(r.track, queue, { A: 200000, B: 450000 }, NOW + 2 * M);
  assert.deepEqual(r.alerts.map((a) => [a.symbol, a.level]), [['AAA', 2], ['BBB', 4]], 'B jumped straight to 4×: one alert');
  r = R.update(r.track, queue, { A: 250000, B: 500000 }, NOW + 3 * M);
  assert.deepEqual(r.alerts, [], 'never twice');
  r = R.update(r.track, queue, { A: 400000 }, NOW + 4 * M);
  assert.deepEqual(r.alerts.map((a) => [a.symbol, a.level, a.x]), [['AAA', 4, 4]]);
});

test('stats: win rate (peak 1.5×), 2× hits, best, median peak; calls without a price are left out', () => {
  const rec = (sym, base, peak, extra) => Object.assign({ symbol: sym, base, peak, last: peak }, extra);
  const list = [rec('A', 100, 149), rec('B', 100, 150), rec('C', 100, 420), rec('D', 100, 90), { symbol: 'E', base: null, peak: null }];
  const s = R.stats(list);
  assert.deepEqual([s.n, s.won, s.winRate, s.hit2, s.best.symbol, s.best.x, s.medianPeak], [4, 2, 0.5, 1, 'C', 4.2, 1.495]);
  assert.deepEqual(R.stats([]), { n: 0, won: 0, winRate: null, hit2: 0, best: null, medianPeak: null });
});

test('statsBy: per group (channel or source), groups under 3 calls left out, best win rate first', () => {
  const rec = (peak, channels) => ({ symbol: 's', base: 100, peak, last: peak, channels });
  const list = [rec(200, ['Man Cave']), rec(160, ['Man Cave']), rec(100, ['Man Cave']), rec(100, ["Rob's"]), rec(90, ["Rob's"]), rec(300, ["Rob's"]), rec(500, ['tiny'])];
  const by = R.statsBy(list, (r) => r.channels);
  assert.deepEqual(by.map((g) => [g.group, g.n, Math.round(g.winRate * 100)]), [['Man Cave', 3, 67], ["Rob's", 3, 33]]);
});

// Bug (2026-10-12, owner: "the peak isn't updating"): the peak was only the highest of the once-a-minute reads made while
// the app was open, so a pump while the phone was locked, or between two reads, never showed. Candle highs fix it.
test('a pump between reads or while the app was closed still sets the peak (GeckoTerminal candle highs)', () => {
  const queue = q([{ address: 'A', firstAt: NOW - 60 * M, callMcap: 100000, symbol: 'AAA' }]);
  let { track } = R.update({}, queue, { A: 100000 }, NOW);
  ({ track } = R.update(track, queue, { A: 120000 }, NOW + 30 * M)); // the app comes back after it ran to 3× and fell back
  assert.equal(R.xPeak(track.A), 1.2, 'reads alone miss the pump');
  // 5-minute candles, newest first: [time s, open, high, low, close, volume]. Price $0.0001 = $100k market cap now 0.00012.
  const candles = [
    [(NOW + 25 * M) / 1000, 0.00013, 0.00013, 0.00012, 0.00012, 1],
    [(NOW + 10 * M) / 1000, 0.00011, 0.0003, 0.00011, 0.00025, 1],
    [(NOW - 120 * M) / 1000, 0.00001, 0.0009, 0.00001, 0.00002, 1], // before the call: ignored
  ];
  const high = R.highSince(candles, (NOW - 60 * M) / 1000);
  assert.equal(high, 0.0003);
  const r = R.addHighs(track, { A: R.mcapAtPrice(high, { mcap: 120000, price: 0.00012 }) }, NOW + 30 * M);
  assert.equal(R.xPeak(r.track.A), 3);
  assert.equal(r.track.A.peakFrom, 'candles');
  assert.deepEqual(r.alerts.map((a) => [a.address, a.level, a.away]), [['A', 2, true]], 'the 2× alert fires once, marked as missed while away');
  assert.deepEqual(R.addHighs(r.track, { A: 250000 }, NOW + 31 * M).alerts, [], 'a lower high changes nothing');
  assert.equal(R.addHighs(r.track, { A: 250000 }, NOW + 31 * M).track.A.peak, 300000);
  assert.equal(R.highSince([], 0), null);
});

test('candlesDue: newest calls first, at most 10, each at most every 10 minutes', () => {
  const queue = q(Array.from({ length: 14 }, (_, i) => ({ address: 'C' + i, firstAt: NOW - i * M })));
  let { track } = R.update({}, queue, Object.fromEntries(Object.keys(queue).map((a) => [a, 100000])), NOW);
  const due = R.candlesDue(track, NOW);
  assert.equal(due.length, 10);
  assert.equal(due[0], 'C0');
  track = R.markCandles(track, due, NOW);
  assert.deepEqual(R.candlesDue(track, NOW + 5 * M), ['C10', 'C11', 'C12', 'C13']);
  assert.equal(R.candlesDue(track, NOW + 11 * M).length, 10, 'after 10 minutes they are due again');
});

// Sort and filter (docs/features/recent-sort.md)
test('view: sort by newest, gain now or peak in both directions; min gain and losers filters; unpriced last', () => {
  const r = (symbol, at, base, last, peak) => ({ symbol, at, base, last, peak });
  const recs = [r('A', 5, 100, 150, 300), r('B', 4, 100, 80, 120), r('C', 3, 100, 210, 210), r('D', 2, null, null, null), r('E', 1, 100, 40, 100)];
  const syms = (o) => R.view(recs, o).map((x) => x.symbol).join('');
  assert.equal(syms({ by: 'new', dir: 'desc' }), 'ABCDE');
  assert.equal(syms({ by: 'new', dir: 'asc' }), 'EDCBA');
  assert.equal(syms({ by: 'now', dir: 'desc' }), 'CABED', 'gain now, highest first, unpriced last');
  assert.equal(syms({ by: 'now', dir: 'asc' }), 'EBACD', 'lowest first, unpriced still last');
  assert.equal(syms({ by: 'peak', dir: 'desc' }), 'ACBED');
  assert.equal(syms({ by: 'peak', dir: 'desc', min: 1 }), 'AC', 'peak at least 2×');
  assert.equal(syms({ by: 'now', dir: 'desc', min: 0.5 }), 'CA', 'now at least +50%');
  assert.equal(syms({ by: 'now', dir: 'desc', min: 0 }), 'CA');
  assert.equal(syms({ by: 'new', dir: 'desc', min: 'losers' }), 'BE', 'Newest + filter uses gain now');
  assert.equal(syms({ by: 'peak', dir: 'desc', min: 3 }), '', 'nobody reached 4×');
  assert.equal(syms({}), 'ABCDE', 'defaults: newest first, no filter');
});

// Bug 11 (2026-10-12, owner: "I just got a notification to a coin but it's only at 3k mc"): SOLA was called at 05:43 at
// about $8k with no market cap in the call. The app was closed, so its first read, at 15:02, was the dump at $3.2k and
// became the base; the candle highs since the call ($8.9k) then read as 2.8× and fired "reached 2× while you were away".
// A base read late now comes from the candle at the call.
test('a base read long after the call comes from the candle at the call, so the dump after it is no pump', () => {
  const at = Date.UTC(2026, 9, 12, 5, 43, 50), read = Date.UTC(2026, 9, 12, 15, 2);
  const queue = q([{ address: 'S', firstAt: at, symbol: 'SOLA' }]);
  let { track } = R.update({}, queue, { S: 3203 }, read);
  assert.deepEqual([track.S.base, track.S.baseAt], [3203, read], 'no market cap in the call: the first read is the base');
  // SOLA's real 5-minute candles (GeckoTerminal), priced so that $1 = $1 of market cap.
  const t = (h, m) => Date.UTC(2026, 9, 12, h, m) / 1000;
  const candles = [
    [t(5, 25), 5495, 10080, 3679, 4313, 10344], [t(5, 30), 4313, 5999, 3466, 3466, 3630], [t(5, 35), 3466, 4753, 3369, 4632, 1954],
    [t(5, 40), 4632, 8687, 4632, 8090, 9349], [t(5, 45), 8090, 8858, 5293, 6908, 3472], [t(5, 50), 6908, 6908, 4121, 5131, 4175],
    [t(5, 55), 5131, 5681, 4831, 5465, 523], [t(6, 0), 5465, 5465, 3346, 3346, 935], [t(7, 50), 3239, 3239, 3231, 3231, 3], [t(9, 25), 3231, 3231, 3203, 3203, 0],
  ];
  const c = R.readCandles(candles, track.S);
  assert.deepEqual(c, { high: 8858, base: 8090 }, 'the base is the close of the candle the call is in');
  const r = R.addHighs(track, { S: c }, read);
  assert.deepEqual(r.alerts, [], 'no "reached 2×" alert');
  assert.deepEqual([r.track.S.base, r.track.S.baseFrom, r.track.S.peak], [8090, 'candles', 8858]);
  assert.equal(R.xNow(r.track.S).toFixed(2), '0.40', 'down 60% since the call');
  assert.deepEqual(R.readCandles(candles, r.track.S), { high: 8858, base: null }, 'rebased once only');
  // No candle at the call: only highs after the late read count (none here: the last candle is before it).
  const later = candles.filter((x) => x[0] >= t(7, 0));
  assert.deepEqual(R.readCandles(later, track.S), { high: null, base: null });
  assert.deepEqual(R.readCandles(later.concat([[read / 1000, 3203, 3500, 3203, 3400, 50]]), track.S), { high: 3500, base: null });
  // A base from the call's own market cap is never replaced.
  const withMcap = R.update({}, q([{ address: 'S', firstAt: at, callMcap: 8000, symbol: 'SOLA' }]), { S: 3203 }, read).track;
  assert.deepEqual(R.readCandles(candles, withMcap.S), { high: 8858, base: null });
});
