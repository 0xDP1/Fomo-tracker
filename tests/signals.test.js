const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../signals.js');

test('signalsOf: buckets from a queue entry and the first caller profile', () => {
  const e = { bundle: { scanned: true, bundledPct: 31 }, verdict: 'Caution', channels: ['first scan', 'price move'], liq: 12000 };
  assert.deepEqual(S.signalsOf(e, { winRate: 52 }), { bundle: '30%+', caller: '50%+', verdict: 'Caution', channels: ['first scan', 'price move'], liq: '$10–30k', strength: 'not scored', source: 'Discord', like: 'not scored' });
  assert.deepEqual(S.signalsOf({ bundle: { scanned: false }, liq: 5000 }, null), { bundle: 'not scanned', caller: 'no record', verdict: 'not checked', channels: [], liq: 'under $10k', strength: 'not scored', source: 'pasted', like: 'not scored' });
  assert.equal(S.signalsOf({ bundle: { scanned: true, bundledPct: 0 }, liq: 40000 }, { winRate: 44 }).bundle, 'under 15%');
  assert.equal(S.signalsOf({ liq: 40000 }, { winRate: 39 }).caller, 'under 40%');
  assert.equal(S.signalsOf({ liq: 40000 }, { winRate: 39 }).liq, '$30k+');
  assert.equal(S.signalsOf({}, { winRate: null }).caller, 'no record');
});

test('fillSignals: fills what is missing and never rewrites what is known', () => {
  const book = [{ address: 'A', ret: {} }, { address: 'B', ret: {}, sig: { bundle: 'under 15%', caller: '50%+', verdict: 'Looks OK', channels: ['x'], liq: '$30k+' } }];
  const queue = { A: { address: 'A', firstPoster: 'amy', bundle: { scanned: true, bundledPct: 20 }, liq: 9000, channels: ['first scan'] }, B: { address: 'B', firstPoster: 'bo', bundle: { scanned: true, bundledPct: 50 }, verdict: 'Walk away', liq: 1, channels: ['y'] } };
  const profiles = { amy: { winRate: 45 }, bo: { winRate: 10 } };
  let out = S.fillSignals(book, queue, profiles);
  assert.deepEqual(out[0].sig, { bundle: '15–30%', caller: '40–49%', verdict: 'not checked', channels: ['first scan'], liq: 'under $10k', strength: 'not scored', source: 'Discord', like: 'not scored' });
  assert.deepEqual(out[1].sig, Object.assign({}, book[1].sig, { strength: 'not scored', source: 'Discord', like: 'not scored' }), 'known signals stay as they were; strength, source and like are added');
  // the rug check finishes later: a "not checked" verdict and "not scanned" bundle get filled in
  queue.A.verdict = 'High risk';
  out = S.fillSignals(out, queue, profiles);
  assert.equal(out[0].sig.verdict, 'High risk');
  assert.equal(out[0].sig.caller, '40–49%');
});

test('scorecard: groups, counts, share up and average returns, with too-few-calls marked', () => {
  const mk = (bundle, r6, r1) => ({ ret: { '1h': r1, '6h': r6 }, sig: { bundle, caller: 'no record', verdict: 'not checked', channels: ['first scan'], liq: '$30k+' } });
  const book = [mk('30%+', -0.5, -0.2), mk('30%+', -0.3, 0.1), mk('30%+', 0.2, 'missed'), mk('30%+', -0.1, 0), mk('30%+', -0.4, -0.1),
    mk('under 15%', 0.5, 0.2), mk('under 15%', 1.0, 0.3), mk('under 15%', 'missed', 0.1)];
  const rows = S.scorecard(book);
  const hi = rows.find((r) => r.signal === 'Bundled' && r.group === '30%+');
  assert.deepEqual([hi.h6.n, hi.h6.up, hi.enough], [5, 1, true]);
  assert.ok(Math.abs(hi.h6.avg - (-0.22)) < 1e-9);
  assert.deepEqual([hi.h1.n, hi.h1.up], [4, 1], 'missed marks are not counted');
  const lo = rows.find((r) => r.signal === 'Bundled' && r.group === 'under 15%');
  assert.deepEqual([lo.h6.n, lo.enough], [2, false], 'fewer than 5 priced at 6h is too few');
  assert.equal(rows.find((r) => r.signal === 'Channel').group, 'first scan');
  assert.deepEqual(S.scorecard([]), []);
  const order = rows.filter((r) => r.signal === 'Bundled').map((r) => r.group);
  assert.deepEqual(order, ['30%+', 'under 15%'], 'groups keep their natural order');
});

test('leaderboard: sorted by win rate, small samples cut, joined with the app results', () => {
  const profiles = {
    amy: { name: 'Amy', medal: 'gold', group: 'PRO', winRate: 65, calls30: 120, hit7: 70, median: 1.6, calls: 3, updatedAt: 3 },
    bo: { name: 'bo', medal: 'silver', group: 'PST', winRate: 50, calls30: null, calls: 12, updatedAt: 2 },
    cy: { name: 'cy', medal: 'bronze', group: 'SER', winRate: 70, calls30: 4, calls: 1, updatedAt: 1 },
    dee: { name: 'dee', medal: 'new', group: 'WG', winRate: null, calls: 30, updatedAt: 4 },
    eve: { name: 'eve', medal: 'silver', group: 'CPT', winRate: 50, calls30: 300, calls: 2, updatedAt: 5 },
  };
  const own = [{ poster: 'amy', h6: { n: 3, up: 2, avg: 0.4 } }];
  const rows = S.leaderboard(profiles, own, 10);
  assert.deepEqual(rows.map((r) => r.name), ['Amy', 'eve', 'bo'], 'cy has 4 calls (cut), dee has no rate (cut); ties go to the bigger sample');
  assert.deepEqual([rows[0].samples, rows[0].own.h6.avg, rows[2].samples], [120, 0.4, 12]);
  assert.equal(rows[1].own, null);
  assert.equal(S.leaderboard(profiles, own, 0).length, 4, 'min 0 keeps everyone with a rate');
});

test('postedBy: a coin belongs to a caller when they posted or first called it (any case)', () => {
  const e = { firstPoster: 'MossadSleeper', posters: ['rinaut', 'MossadSleeper'] };
  assert.equal(S.postedBy(e, 'mossadsleeper'), true);
  assert.equal(S.postedBy(e, 'RINAUT'), true);
  assert.equal(S.postedBy(e, 'nobody'), false);
});

test('Strength: 70+, 40–69, under 40 or not scored, filled in once scored, and a scorecard row', () => {
  assert.deepEqual([70, 69, 40, 39, null, undefined].map((str) => S.signalsOf({ str }, null).strength), ['70+', '40–69', '40–69', 'under 40', 'not scored', 'not scored']);
  const out = S.fillSignals([{ address: 'A', ret: {}, sig: { bundle: 'under 15%', caller: '50%+', verdict: 'Looks OK', channels: [], liq: '$30k+', strength: 'not scored' } }], { A: { address: 'A', str: 81 } }, {});
  assert.equal(out[0].sig.strength, '70+');
  const rows = S.scorecard([{ ret: { '6h': 0.5 }, sig: { strength: '70+', channels: [] } }, { ret: { '6h': -0.5 }, sig: { strength: 'under 40', channels: [] } }]).filter((r) => r.signal === 'Strength');
  assert.deepEqual(rows.map((r) => r.group), ['70+', 'under 40']);
});

test('Source: Discord, Telegram, both or pasted, and a scorecard row', () => {
  const g = (e) => S.signalsOf(e, null).source;
  assert.equal(g({ sources: ['telegram'], channels: ['Alpha calls'] }), 'Telegram');
  assert.equal(g({ sources: ['discord', 'telegram'], channels: ['first scan', 'Alpha calls'] }), 'both');
  assert.equal(g({ sources: ['discord'], channels: ['first scan'] }), 'Discord');
  assert.equal(g({ channels: ['first scan'] }), 'Discord', 'saved before sources were kept: a channel means Discord');
  assert.equal(g({ sources: [], channels: [] }), 'pasted');
  const rows = S.scorecard([{ ret: { '6h': 0.5 }, sig: { source: 'Telegram', channels: [] } }, { ret: { '6h': -0.5 }, sig: { source: 'Discord', channels: [] } }]).filter((r) => r.signal === 'Source');
  assert.deepEqual(rows.map((r) => r.group), ['Discord', 'Telegram']);
});

test('likeGroup: the "like past winners" pill as a scorecard group', () => {
  assert.deepEqual([{ n: 5, of: 5 }, { n: 4, of: 5 }, { n: 2, of: 5 }, { n: 1, of: 2 }, { n: 0, of: 3 }, null, { n: 0, of: 0 }].map(S.likeGroup), ['4–5 of 5', '4–5 of 5', '2–3 of 5', '2–3 of 5', '0–1 of 5', 'not scored', 'not scored']);
  assert.equal(S.signalsOf({ like: { n: 3, of: 3 } }, null).like, '4–5 of 5');
});
