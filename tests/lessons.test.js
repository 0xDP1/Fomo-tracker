const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lessons.js');

const H = 3600000;
const T0 = Date.parse('2026-09-10T12:00:00Z');
// closed trade on coin `addr`, opened at T0 + i hours, cost 100, given pnl
const trade = (addr, pnl, i = 0, extra = {}) => Object.assign({ address: addr, cost: 100, proceeds: 100 + pnl, openedAt: new Date(T0 + i * H).toISOString(), closedAt: new Date(T0 + i * H + H).toISOString() }, extra);
const snap = (at, facts, risk = { verdict: 'Looks OK', score: 90 }, after = false) => L.snapshot(facts, risk, at, after);

test('snapshot keeps only the holder facts, unknowns as null', () => {
  const s = L.snapshot({ topHolderPct: 12, top10Pct: 45, insiderPct: 18, bundleLaunchPct: 30, creatorPct: 2, freshTopHolders: 4, holders: 250, lpLockedPct: 100, liquidityUsd: 15000, mcapUsd: 90000, ageHours: 0.5, _holders: [1, 2], buys1h: 9 }, { verdict: 'Caution', score: 60 }, 1000);
  assert.deepEqual(s, { at: 1000, after: false, topHolderPct: 12, top10Pct: 45, bundleHeldPct: 18, bundleLaunchPct: 30, creatorPct: 2, freshTop: 4, holders: 250, lpLockedPct: 100, liquidityUsd: 15000, mcapUsd: 90000, ageHours: 0.5, verdict: 'Caution', score: 60 });
  assert.equal(L.snapshot({}, null, 5).topHolderPct, null);
  assert.equal(L.snapshot({}, null, 5).verdict, null);
});

test('patterns: thresholds at their edges, unknown when the fact is missing', () => {
  const t = (key, facts, risk) => L.PATTERNS.find((p) => p.key === key).test(L.snapshot(facts, risk, 0));
  assert.equal(t('bundleHeld', { insiderPct: 10 }), true);
  assert.equal(t('bundleHeld', { insiderPct: 9.9 }), false);
  assert.equal(t('bundleHeld', {}), null);
  assert.equal(t('bundleLaunch', { bundleLaunchPct: 25 }), true);
  assert.equal(t('whale', { topHolderPct: 10 }), true);
  assert.equal(t('top10', { top10Pct: 39.9 }), false);
  assert.equal(t('creator', { creatorPct: 5 }), true);
  assert.equal(t('fresh', { freshTopHolders: 3 }), true);
  assert.equal(t('lp', { lpLockedPct: 89 }), true);
  assert.equal(t('lp', { lpLockedPct: 100 }), false);
  assert.equal(t('fewHolders', { holders: 299 }), true);
  assert.equal(t('young', { ageHours: 0.99 }), true);
  assert.equal(t('thinLiq', { liquidityUsd: 19999 }), true);
  assert.equal(t('risky', {}, { verdict: 'Caution' }), true);
  assert.equal(t('risky', {}, { verdict: 'Looks OK' }), false);
  assert.equal(t('risky', {}, null), null);
});

test('addSnapshot keeps a few per coin and caps the number of coins', () => {
  let db = {};
  for (let i = 0; i < 6; i++) db = L.addSnapshot(db, 'MintA', snap(i, { holders: i }), 3, 4);
  assert.deepEqual(db.MintA.map((s) => s.at), [2, 3, 4, 5]);
  db = L.addSnapshot(db, '0xABCdef0000000000000000000000000000000001', snap(10, {}), 3, 4);
  assert.ok(db['0xabcdef0000000000000000000000000000000001'], 'EVM addresses are stored lowercase');
  db = L.addSnapshot(db, 'MintC', snap(11, {}), 3, 4);
  db = L.addSnapshot(db, 'MintD', snap(12, {}), 3, 4);
  assert.deepEqual(Object.keys(db).sort(), ['0xabcdef0000000000000000000000000000000001', 'MintC', 'MintD'], 'oldest coin dropped');
});

test('snapshotFor: entry window is 24h before to 6h after opening, nearest wins; otherwise later', () => {
  const t = trade('MintA', 10, 0);
  let db = {};
  db = L.addSnapshot(db, 'MintA', snap(T0 - 30 * H, { holders: 1 }));
  db = L.addSnapshot(db, 'MintA', snap(T0 - 2 * H, { holders: 2 }));
  db = L.addSnapshot(db, 'MintA', snap(T0 + 1 * H, { holders: 3 }));
  let r = L.snapshotFor(t, db);
  assert.equal(r.kind, 'entry');
  assert.equal(r.snap.holders, 3);
  db = { MintA: [snap(T0 + 48 * H, { holders: 9 }, undefined, true)] };
  r = L.snapshotFor(t, db);
  assert.equal(r.kind, 'later');
  assert.equal(L.snapshotFor(trade('Other', 1), db), null);
  // Helius trades carry `mint` instead of `address`; EVM matching ignores case
  assert.equal(L.snapshotFor({ mint: 'MintA', openedAt: t.openedAt, closedAt: t.closedAt }, db).kind, 'later');
  const evm = '0xABCdef0000000000000000000000000000000001';
  const db2 = L.addSnapshot({}, evm, snap(T0, {}));
  assert.equal(L.snapshotFor(trade(evm.toLowerCase(), 1), db2).kind, 'entry');
});

// 10 trades: 5 on bundled coins (1 win, 4 losses), 5 clean (4 wins, 1 loss), plus 2 trades with no snapshot
function sample() {
  const trades = [], db = {};
  for (let i = 0; i < 5; i++) {
    const a = 'Bund' + i;
    trades.push(trade(a, i === 0 ? 50 : -40, i));
    Object.assign(db, L.addSnapshot(db, a, snap(T0 + i * H, { insiderPct: 20, topHolderPct: 4 })));
  }
  for (let i = 0; i < 5; i++) {
    const a = 'Clean' + i;
    trades.push(trade(a, i === 0 ? -20 : 30, 10 + i));
    Object.assign(db, L.addSnapshot(db, a, snap(T0 + (10 + i) * H, { insiderPct: 2, topHolderPct: 4 })));
  }
  trades.push(trade('NoSnap1', 25, 20), trade('NoSnap2', 25, 21));
  return { trades, db };
}

test('patternStats: with vs without, coverage, baseline over all closed trades, ranked by money lost', () => {
  const { trades, db } = sample();
  const st = L.patternStats(trades, db);
  assert.equal(st.closed, 12);
  assert.equal(st.covered, 10);
  assert.equal(st.entry, 10);
  assert.equal(st.later, 0);
  assert.ok(Math.abs(st.baselineWinRate - 7 / 12) < 1e-9);
  const b = st.rows.find((r) => r.key === 'bundleHeld');
  assert.deepEqual([b.with.count, b.with.wins, b.with.losses, b.with.pnl], [5, 1, 4, -110]);
  assert.deepEqual([b.without.count, b.without.wins, b.without.pnl], [5, 4, 100]);
  assert.equal(b.enough, true);
  assert.equal(b.costly, true);
  assert.equal(st.rows[0].key, 'bundleHeld', 'biggest loser first');
  const whale = st.rows.find((r) => r.key === 'whale');
  assert.equal(whale.with.count, 0);
  assert.equal(whale.enough, false);
  assert.equal(st.rows.find((r) => r.key === 'lp').without.count, 0, 'unknown facts are left out of both sides');
});

test('costly needs 5 trades, a negative total and a win rate 15+ points under the baseline', () => {
  const { trades, db } = sample();
  // drop one bundled trade: only 4 with the pattern -> not enough
  const four = L.patternStats(trades.filter((t) => t.address !== 'Bund4'), db).rows.find((r) => r.key === 'bundleHeld');
  assert.equal(four.enough, false);
  assert.equal(four.costly, false);
  // bundled trades that net positive are not costly even with a low win rate
  const big = trades.map((t) => (t.address === 'Bund0' ? Object.assign({}, t, { proceeds: 100 + 500 }) : t));
  assert.equal(L.patternStats(big, db).rows.find((r) => r.key === 'bundleHeld').costly, false);
  // win rate within 15 points of baseline is not costly: make the bundled side 3 wins of 5 but net negative
  const close = trades.map((t) => (t.address === 'Bund1' || t.address === 'Bund2' ? Object.assign({}, t, { proceeds: 101.5 })
    : t.address === 'Clean1' ? Object.assign({}, t, { proceeds: 95 }) : t)); // baseline 8/12 = 67%, bundled 60%
  const cr = L.patternStats(close, db);
  const cb = cr.rows.find((r) => r.key === 'bundleHeld');
  assert.equal(cb.with.wins, 3);
  assert.ok(cb.with.pnl < 0);
  assert.equal(cb.costly, false);
});

test('warningsFor: only costly patterns the coin matches', () => {
  const { trades, db } = sample();
  const st = L.patternStats(trades, db);
  const bad = L.snapshot({ insiderPct: 30, topHolderPct: 4 }, null, 0);
  const w = L.warningsFor(bad, st);
  assert.deepEqual(w.map((r) => r.key), ['bundleHeld']);
  assert.equal(L.warningsFor(L.snapshot({ insiderPct: 1 }, null, 0), st).length, 0);
  assert.equal(L.warningsFor(L.snapshot({}, null, 0), st).length, 0, 'unknown facts never warn');
});
