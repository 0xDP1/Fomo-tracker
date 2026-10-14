// docs/features/crawlscan.md: crawlscan.fun's answer boiled down for the app, and the findings it raises.
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../crawlscan.js');
const C = require('../check.js');
const FIX = require('./fixtures/crawlscan.json'); // a real answer, recorded 2026-10-14

const NOW = 1791600000000;

test('summarize: score, band, the five parts in order, the headline and the biggest operators', () => {
  const s = K.summarize(FIX, NOW);
  assert.deepEqual([s.score, s.band, s.ca.slice(0, 6), s.chain, s.at], [90, 'CLEAN', '49CHHU', 'solana', NOW]);
  assert.deepEqual(s.parts.map((p) => [p.key, p.max, p.value]), [['operator', 35, 35], ['virgin', 25, 25], ['transfer', 20, 20], ['sniper', 10, 10], ['concentration', 10, 0]]);
  assert.match(s.headline, /^19 wallets → 19 operators, biggest holds 20\.1% of float/);
  assert.equal(s.reason, 'top 20 hold 86.0% of float');
  assert.deepEqual([s.holders, s.wallets, s.operatorsN, s.operators.length], [19, 19, 19, 5]);
  assert.deepEqual([s.operators[0].wallets[0].slice(0, 6), Math.round(s.operators[0].share * 1000) / 1000, s.operators[0].tag, s.operators[0].sold], ['Hp4Pi8', 0.201, 'HOLDING', 0]);
  assert.ok(s.operators.every((o, i) => i === 0 || o.share <= s.operators[i - 1].share), 'biggest first');
  assert.deepEqual([Math.round(s.impact * 1000) / 1000, Math.round(s.concentration * 100) / 100, s.partial, s.limited, s.rug, s.symbol, s.mcapUsd], [0.059, 0.86, false, false, null, 'Kirk', 3521]);
});

test('summarize: a bare result works too; junk is null', () => {
  assert.equal(K.summarize(FIX.result, NOW).score, 90);
  assert.equal(K.summarize({ done: true }), null);
  assert.equal(K.summarize(null), null);
  assert.equal(K.summarize({ score: 59, band: 'RISKY', parts: { operator: 20.4 } }).parts[1].value, null, 'a missing part is unknown, not 0');
});

test('startOutcome: a job, a pause, or the error', () => {
  assert.deepEqual(K.startOutcome(200, { job: 'abc' }), { job: 'abc' });
  assert.deepEqual(K.startOutcome(503, { error: 'SOON' }), { error: 'paused' });
  assert.deepEqual(K.startOutcome(429, { error: 'too many scans, slow down' }), { error: 'too many scans, slow down' });
  assert.deepEqual(K.startOutcome(500, null), { error: 'HTTP 500' });
});

test('facts, fresh and label', () => {
  const s = K.summarize(FIX, NOW);
  assert.deepEqual(K.facts(s), { csScore: 90, csBand: 'CLEAN', csImpact: s.impact, csHeadline: s.headline });
  assert.deepEqual(K.facts(null), {});
  assert.equal(K.fresh(s, NOW + 29 * 60000), true);
  assert.equal(K.fresh(s, NOW + 31 * 60000), false);
  assert.equal(K.label(s), 'CS 90 · CLEAN');
  assert.equal(K.label(null), 'CS ?');
  assert.equal(K.isSolana('49CHHUSaiT1MfykF8khftpeFzvbstbkawfxM5Z6zpump'), true);
  assert.equal(K.isSolana('0x1234567890abcdef1234567890abcdef12345678'), false);
});

test('risk check: DANGER is high, RISKY medium, the CrawlScan dump impact replaces a smaller one of our own', () => {
  const base = { liquidityUsd: 50000, mcapUsd: 400000, ageHours: 24, holders: 300, lpLockedPct: 100, mintAuthority: false, topHolderPct: 3 };
  let r = C.assessRisk(Object.assign({}, base, { csScore: 31, csBand: 'DANGER', csImpact: 0.52, csHeadline: '9 wallets → 2 operators, biggest holds 60% of float, could move price −52% if sold' }));
  let f = r.findings.find((x) => x.key === 'crawlscan');
  assert.deepEqual([f.sev, f.title], ['high', 'CrawlScan: DANGER, 31/100']);
  assert.match(f.detail, /could move price −52% if sold/);
  r = C.assessRisk(Object.assign({}, base, { csScore: 59, csBand: 'RISKY', csImpact: 0.31, csHeadline: 'x' }));
  assert.equal(r.findings.find((x) => x.key === 'crawlscan').sev, 'medium');
  r = C.assessRisk(Object.assign({}, base, { csScore: 90, csBand: 'CLEAN', csImpact: 0.06, csHeadline: 'x' }));
  assert.equal(r.findings.some((x) => x.key === 'crawlscan'), false);
  assert.ok(r.goods.some((g) => g.key === 'crawlscan' && /CrawlScan: CLEAN, 90\/100/.test(g.title)), 'a clean scan is a good note');
  // the operator finding: our own estimate says 10%, CrawlScan says 31%: the larger one speaks
  r = C.assessRisk(Object.assign({}, base, { operatorWallets: 4, operatorPct: 9.7, operatorDrop: 0.10, csScore: 59, csBand: 'RISKY', csImpact: 0.31, csHeadline: 'x' }));
  const op = r.findings.find((x) => x.key === 'operator');
  assert.ok(op, 'operator finding present');
  assert.match(op.title, /31%/);
});
