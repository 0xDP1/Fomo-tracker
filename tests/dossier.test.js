const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../dossier.js');
const C = require('../check.js');

const W = 'CreatorWallet1111111111111111111111111111111';
const SOL = 'So11111111111111111111111111111111111111112';
const tx = (over) => Object.assign({ signature: 's', timestamp: 1000, feePayer: W, type: 'CREATE', tokenTransfers: [], accountData: [] }, over);

test('launchesFrom: finds coins the wallet created, newest first, skipping the coin being checked', () => {
  const txs = [
    tx({ signature: 'a', timestamp: 100, tokenTransfers: [{ mint: 'MintA', toUserAccount: W }] }),
    tx({ signature: 'b', timestamp: 300, tokenTransfers: [{ mint: 'MintB', toUserAccount: W }] }),
    tx({ signature: 'c', timestamp: 200, type: 'SWAP', tokenTransfers: [{ mint: 'MintC', toUserAccount: W }] }),   // a buy, not a launch
    tx({ signature: 'd', timestamp: 250, feePayer: 'Other', tokenTransfers: [{ mint: 'MintD', toUserAccount: 'Other' }] }), // someone else's
    tx({ signature: 'e', timestamp: 50, tokenTransfers: [{ mint: SOL }, { mint: 'MintE' }] }),                       // SOL is ignored
    tx({ signature: 'f', timestamp: 400, tokenTransfers: [{ mint: 'Current', toUserAccount: W }] }),
    tx({ signature: 'g', timestamp: 90, accountData: [{ tokenBalanceChanges: [{ mint: 'MintG' }] }] }),             // no dev buy: mint only in balance changes
    tx({ signature: 'h', timestamp: 120, tokenTransfers: [{ mint: 'MintA', toUserAccount: W }] }),                  // same mint again
  ];
  const got = D.launchesFrom(txs, W, 'Current');
  assert.deepEqual(got.map((x) => x.mint), ['MintB', 'MintA', 'MintG', 'MintE']);
  assert.equal(got[1].t, 120, 'keeps the latest sighting of a mint');
  assert.equal(D.launchesFrom(txs, W, 'Current', 2).length, 2, 'capped');
});

test('outcome: dead, quiet, alive and too new', () => {
  const NOW = 1e12, H = 3600000;
  const pair = (liq, vol) => ({ liquidity: { usd: liq }, volume: { h24: vol } });
  assert.equal(D.outcome(null, NOW - 48 * H, NOW), 'dead', 'no pool');
  assert.equal(D.outcome(pair(500, 90000), NOW - 48 * H, NOW), 'dead', 'liquidity gone');
  assert.equal(D.outcome(pair(20000, 100), NOW - 48 * H, NOW), 'quiet');
  assert.equal(D.outcome(pair(20000, 50000), NOW - 48 * H, NOW), 'alive');
  assert.equal(D.outcome(null, NOW - 2 * H, NOW), 'new', 'too new to call');
  assert.equal(D.outcome(undefined, NOW - 48 * H, NOW), 'unknown', 'DexScreener did not answer');
});

test('summarize: counts and the serial rugger rule', () => {
  const rows = (...o) => o.map((outcome) => ({ outcome }));
  let s = D.summarize(rows('dead', 'dead', 'dead', 'alive'));
  assert.deepEqual([s.counted, s.dead, s.alive, s.rugger], [4, 3, 1, true]);
  assert.equal(D.summarize(rows('dead', 'dead', 'alive', 'alive')).rugger, false, 'two dead is not enough');
  assert.equal(D.summarize(rows('dead', 'dead', 'dead', ...Array(8).fill('alive'))).rugger, false, 'a prolific creator with a good record is not flagged');
  s = D.summarize(rows('new', 'unknown', 'dead'));
  assert.deepEqual([s.counted, s.dead, s.newer, s.unknown], [1, 1, 1, 1]);
  assert.equal(D.summarize([]).counted, 0);
});

test('risk check: a serial rugger becomes a high finding, others add nothing', () => {
  const base = { liquidityUsd: 50000, mcapUsd: 400000, ageHours: 24, holders: 300, lpLockedPct: 100, mintAuthority: false, topHolderPct: 3 };
  const bad = C.assessRisk(Object.assign({ creatorDead: 7, creatorCounted: 9 }, base));
  const f = bad.findings.find((x) => x.key === 'devhistory');
  assert.ok(f, 'finding present');
  assert.equal(f.sev, 'high');
  assert.match(f.title, /7 of 9/);
  assert.equal(C.assessRisk(Object.assign({ creatorDead: 2, creatorCounted: 9 }, base)).findings.some((x) => x.key === 'devhistory'), false);
  assert.equal(C.assessRisk(base).findings.some((x) => x.key === 'devhistory'), false);
});
