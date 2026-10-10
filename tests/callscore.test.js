const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../calls.js');

const NOW = 1791600000000;
const H = 3600000;
const entry = (o) => Object.assign({ address: 'Coin', posters: ['a'], channels: ['first scan'], firstAt: NOW - 30 * 60000, mcap: 200000, liq: 30000, callMcap: 150000, mentions: 1 }, o);

test('callScore: a strong call scores high with its reasons', () => {
  const e = entry({ posters: ['a', 'b', 'c'], channels: ['first scan', 'group traction'], bundle: { scanned: true, bundledPct: 12 }, snap: { top5Pct: 18 } });
  const s = C.callScore(e, { winRate: 62, medal: 'gold' }, NOW);
  // caller 42/50*24 = 20.2 + 6 -> 26; traction 15 + 10 -> 25; clean 10 + 8 + 7 = 25; not pumped 10; fresh 10
  assert.deepEqual(s.parts, { caller: 26, traction: 25, clean: 25, pumped: 10, fresh: 10, bonus: 0, minus: 0 });
  assert.equal(s.score, 96);
  assert.deepEqual(s.reasons, ['🥇 62% caller', '3 callers', 'in group traction']);
  assert.deepEqual(s.flags, []);
});

test('callScore: an unknown single call stays well under 60', () => {
  const s = C.callScore(entry({}), null, NOW);
  // caller 0, traction 0, clean 5 (bundle unknown) + 3 (top 5 unknown) + 7 (liq 15% of mcap), not pumped 10, fresh 10
  assert.equal(s.score, 35);
  assert.deepEqual(s.reasons, []);
});

test('callScore: red flags pull a coin down', () => {
  const good = entry({ posters: ['a', 'b', 'c'], bundle: { scanned: true, bundledPct: 12 }, snap: { top5Pct: 18 } });
  const prof = { winRate: 62, medal: 'gold' };
  const base = C.callScore(good, prof, NOW).score;
  const bundled = C.callScore(Object.assign({}, good, { bundle: { scanned: true, bundledPct: 55, serial: true } }), prof, NOW);
  assert.ok(bundled.score < 60, `bundled ${bundled.score}`);
  assert.deepEqual(bundled.flags, ['55% bundled', 'serial bundler dev']);
  assert.equal(C.callScore(Object.assign({}, good, { snap: { top5Pct: 50 } }), prof, NOW).flags[0], 'top 5 hold 50%');
  assert.equal(C.callScore(Object.assign({}, good, { verdict: 'Walk away' }), prof, NOW).score, Math.max(0, base - 50));
  assert.equal(C.callScore(Object.assign({}, good, { verdict: 'High risk' }), prof, NOW).score, base - 30);
  const seed = C.callScore(entry({}), { medal: 'new', winRate: null }, NOW);
  assert.deepEqual(seed.flags, ['caller has no record']);
  assert.equal(seed.score, 25);
});

test('callScore: pumped and stale calls lose their bonus', () => {
  const pumped = C.callScore(entry({ mcap: 600000, callMcap: 150000 }), null, NOW);
  assert.equal(pumped.parts.pumped, 0);
  assert.ok(pumped.flags.includes('already 4.0× since the call'));
  assert.equal(C.callScore(entry({ mcap: 400000, callMcap: 150000 }), null, NOW).parts.pumped, 5, 'up to 3× is half marks');
  assert.equal(C.callScore(entry({ firstAt: NOW - 3 * H }), null, NOW).parts.fresh, 5, 'within 6 hours is half marks');
  assert.equal(C.callScore(entry({ firstAt: NOW - 7 * H }), null, NOW).parts.fresh, 0);
});

test('callScore: caller points scale with win rate and medal, capped at 30', () => {
  const pts = (p) => C.callScore(entry({}), p, NOW).parts.caller;
  assert.equal(pts({ winRate: 20 }), 0);
  assert.equal(pts({ winRate: 45 }), 12);
  assert.equal(pts({ winRate: 90, medal: 'gold' }), 30);
  assert.equal(pts({ winRate: 70, medal: 'bronze' }), 26);
  assert.equal(pts({ medal: 'silver' }), 4, 'a medal without a rate still counts');
});
