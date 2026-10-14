// docs/features/dev-record.md: the dev's track record, the bundle verdict, and how both reach the risk check and the
// Call queue score.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../devrecord.js');
const C = require('../check.js');
const Calls = require('../calls.js');

const NOW = 1791600000000;
const D = 86400000;
const row = (ath, o = {}) => Object.assign({ mint: 'M' + Math.random(), symbol: 'X', launchedAt: NOW - 3 * D, mcap: 3000, ath }, o);

test('summarize: one coin past $1M, or two past $100k, is a proven dev', () => {
  let s = R.summarize([row(1.4e6, { symbol: 'BIG' }), row(8000), row(9000)], NOW);
  assert.equal(s.verdict, 'proven');
  assert.deepEqual([s.best.symbol, s.best.ath, s.over1m, s.over100k, s.launches], ['BIG', 1.4e6, 1, 1, 3]);
  assert.equal(R.summarize([row(150000), row(120000), row(5000)], NOW).verdict, 'proven');
  assert.equal(R.summarize([row(150000), row(20000)], NOW).verdict, 'mixed', 'one coin past $100k is not enough');
});

test('summarize: 5+ launches that never passed $50k is "never gets anywhere"; dead coins that ran are not', () => {
  const flops = [12000, 8000, 30000, 6000, 45000].map((a) => row(a));
  let s = R.summarize(flops, NOW);
  assert.equal(s.verdict, 'never');
  assert.equal(s.aged, 5);
  assert.equal(s.median, 12000);
  assert.equal(R.summarize(flops.slice(0, 4), NOW).verdict, 'mixed', 'four is too few to judge');
  // every coin is dead now (mcap $3k), but one ran to $300k first: no warning
  s = R.summarize([...flops, row(300000)], NOW);
  assert.equal(s.verdict, 'mixed');
  // launches under 6 hours old may still run: not counted
  s = R.summarize([...flops.slice(0, 4), row(9000, { launchedAt: NOW - 3600000 })], NOW);
  assert.equal(s.verdict, 'mixed');
});

test('summarize: a fresh wallet is "none", peaks missing is "unknown", missing figures stay null', () => {
  assert.equal(R.summarize([], NOW).verdict, 'none');
  const s = R.summarize([row(null), row(undefined)], NOW);
  assert.equal(s.verdict, 'unknown');
  assert.deepEqual([s.best, s.median, s.volume, s.fees, s.mostHolders], [null, null, null, null, null]);
  const t = R.summarize([row(90000, { holders: 800, volume: 2e6, fees: 40 }), row(60000, { holders: 1200, volume: 1e6 })], NOW);
  assert.deepEqual([t.mostHolders.holders, t.volume, t.fees], [1200, { sum: 3e6, n: 2 }, { sum: 40, n: 1 }]);
});

test('GMGN figures: read under the names GMGN may use, top level or one level down; merge keeps what is known', () => {
  assert.deepEqual(R.fromInfo({ data: { holder_count: '1500', stat: { total_volume: 3.2e6 }, global_fee: 55.5 } }), { holders: 1500, volume: 3.2e6, fees: 55.5 });
  assert.deepEqual(R.fromInfo({ symbol: 'X' }), { holders: null, volume: null, fees: null });
  const by = R.extrasByMint({ tokens: [{ token_address: 'A', holder_count: 10, total_fees: 2 }, { address: 'B' }] });
  assert.deepEqual(by, { A: { holders: 10, volume: null, fees: 2 }, B: { holders: null, volume: null, fees: null } });
  const m = R.merge({ mint: 'A', holders: 10, volume: null, fees: null }, { holders: 99, volume: 500, fees: null });
  assert.deepEqual([m.holders, m.volume, m.fees], [10, 500, null]);
  assert.equal(R.needsInfo(m), true);
  assert.deepEqual(R.topByPeak([row(5), row(null), row(50), row(500)], 2).map((r) => r.ath), [500, 50]);
});

test('bundleVerdict: held size decides, the dev record turns a bundle into a team launch or extraction', () => {
  assert.equal(R.bundleVerdict({}, 'proven'), null);
  assert.equal(R.bundleVerdict({ launchPct: 40, heldPct: 3 }).key, 'sold');
  assert.equal(R.bundleVerdict({ launchPct: 40, heldPct: 3 }).cls, 'pos');
  assert.equal(R.bundleVerdict({ heldPct: 12 }).key, 'small');
  assert.equal(R.bundleVerdict({ heldPct: 20 }).key, 'held');
  assert.equal(R.bundleVerdict({ heldPct: 35 }).cls, 'neg');
  assert.equal(R.bundleVerdict({ launchPct: 35 }).key, 'launchBig', 'launch only: held unknown');
  assert.equal(R.bundleVerdict({ launchPct: 25, heldPct: 20 }, 'proven').key, 'team');
  assert.equal(R.bundleVerdict({ launchPct: 25, heldPct: 2 }, 'never').key, 'extraction');
  assert.equal(R.bundleVerdict({ launchPct: 5, heldPct: 2 }, 'never').key, 'small', 'not bundled: no extraction');
});

test('risk check: "never" is a high finding, bundled "never" is extraction, proven is a good note', () => {
  const base = { liquidityUsd: 50000, mcapUsd: 400000, ageHours: 24, holders: 300, lpLockedPct: 100, mintAuthority: false, topHolderPct: 3 };
  const never = R.facts(R.summarize([12000, 8000, 30000, 6000, 45000].map((a) => row(a)), NOW));
  let r = C.assessRisk(Object.assign({}, base, never));
  let f = r.findings.find((x) => x.key === 'devhistory');
  assert.equal(f.sev, 'high');
  assert.match(f.title, /Dev's 5 earlier coins never got anywhere/);
  assert.match(f.detail, /peaked at \$45k/);
  r = C.assessRisk(Object.assign({}, base, never, { bundleLaunchPct: 30, insiderPct: 4 }));
  assert.ok(r.findings.some((x) => x.key === 'extraction'));
  assert.equal(r.findings.some((x) => x.key === 'devhistory'), false, 'one finding, not two');
  const proven = R.facts(R.summarize([row(2.1e6), row(150000)], NOW));
  r = C.assessRisk(Object.assign({}, base, proven, { insiderPct: 12 }));
  const g = r.goods.find((x) => x.key === 'provendev');
  assert.match(g.title, /\$2\.1M/);
  assert.match(g.detail, /team backing its chart/);
  assert.equal(r.findings.some((x) => /dev/i.test(x.key)), false);
  const plain = C.assessRisk(base);
  assert.equal(C.assessRisk(Object.assign({}, base, proven)).score, plain.score, 'a note only: the risk score is unchanged');
});

test('callScore: the bundle counts what is still held when known; the dev check adds or takes points', () => {
  const entry = (o) => Object.assign({ address: 'Coin', posters: ['a'], channels: ['first scan'], firstAt: NOW - 30 * 60000, mcap: 200000, liq: 30000, callMcap: 150000, mentions: 1 }, o);
  const bundled = { bundle: { scanned: true, bundledPct: 45 } };
  const launchOnly = Calls.callScore(entry(bundled), null, NOW);
  assert.ok(launchOnly.flags.includes('45% bundled'), 'unchanged without a held figure');
  const sold = Calls.callScore(entry(Object.assign({ facts: { insiderPct: 4 } }, bundled)), null, NOW);
  assert.equal(sold.flags.includes('45% bundled'), false);
  assert.equal(sold.score - launchOnly.score, 35, 'no 25-point flag, full 10 clean-launch points');
  const heavy = Calls.callScore(entry({ facts: { insiderPct: 32 } }), null, NOW);
  assert.ok(heavy.flags.includes('32% bundle still held'));
  const deepWins = Calls.callScore(entry({ facts: { insiderPct: 32 }, deep: { heldPct: 5 } }), null, NOW);
  assert.equal(deepWins.flags.some((x) => /held/.test(x)), false, 'the Dev check figure is newer');
  const base = Calls.callScore(entry({}), null, NOW);
  const proven = Calls.callScore(entry({ deep: { verdict: 'proven' } }), null, NOW);
  assert.equal(proven.score - base.score, 10);
  assert.ok(proven.reasons.includes('proven dev'));
  const never = Calls.callScore(entry({ deep: { verdict: 'never' } }), null, NOW);
  assert.equal(base.score - never.score, 15);
  assert.ok(never.flags.includes('dev\'s coins never get anywhere'));
});

test('compact: what a Call queue row keeps', () => {
  const s = R.summarize([row(2.1e6, { symbol: 'BIG' }), row(150000)], NOW);
  const c = R.compact(s, R.bundleVerdict({ launchPct: 25, heldPct: 20 }, s.verdict), 'Dev1', { heldPct: 20, launchPct: 25 }, NOW);
  assert.deepEqual(c, { wallet: 'Dev1', verdict: 'proven', launches: 2, best: 2.1e6, bestSym: 'BIG', over100k: 2, over1m: 1, heldPct: 20, launchPct: 25, bundle: { key: 'team', label: 'Team launch', cls: 'pos' }, at: NOW });
});
