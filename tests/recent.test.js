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
