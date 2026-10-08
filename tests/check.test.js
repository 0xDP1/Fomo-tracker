const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../check.js');

test('detectChain and extractAddress', () => {
  assert.equal(C.detectChain('0x4bc1782fafb967834e0e75947ba15113e48fc70e'), 'evm');
  assert.equal(C.detectChain('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), 'solana');
  assert.equal(C.detectChain('hello'), null);
  assert.equal(C.extractAddress('https://dexscreener.com/solana/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v?x=1'), 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  assert.equal(C.extractAddress('CA: 0x4bc1782fafb967834e0e75947ba15113e48fc70e lol'), '0x4bc1782fafb967834e0e75947ba15113e48fc70e');
  assert.equal(C.extractAddress('nothing here'), null);
});

test('assessRisk: clean token looks OK, flags are listed as unknown when not checked', () => {
  const r = C.assessRisk({ liquidityUsd: 80000, mcapUsd: 900000, ageHours: 48, holders: 1200, lpLockedPct: 100, insiderPct: 1, topHolderPct: 3, top10Pct: 20, mintAuthority: false, honeypot: false });
  assert.equal(r.verdict, 'Looks OK');
  assert.equal(r.findings.length, 0);
  assert.equal(r.score, 100);
  const u = C.assessRisk({ liquidityUsd: 80000 });
  assert.ok(u.unknown.includes('LP lock'));
  assert.ok(u.unknown.includes('bundles'));
});

test('assessRisk: the three headline rug patterns are critical and sorted first', () => {
  const r = C.assessRisk({ insiderPct: 32, insiderWallets: 14, lpLockedPct: 10, topHolderPct: 25, ageHours: 0.3, liquidityUsd: 50000, mcapUsd: 300000 });
  assert.equal(r.verdict, 'Walk away');
  const keys = r.findings.map((f) => f.key);
  assert.deepEqual(keys.slice(0, 3).sort(), ['bundle', 'lp', 'whale']);
  assert.ok(r.findings.find((f) => f.key === 'bundle').title.includes('Bundled supply'));
  assert.ok(r.findings.find((f) => f.key === 'lp').title.includes('LP in a wallet'));
  assert.ok(r.findings.find((f) => f.key === 'whale').title.includes('One whale'));
  assert.ok(r.findings.find((f) => f.key === 'bundle').detail.includes('14 linked wallets'));
  assert.equal(r.score, 0);
});

test('assessRisk: mid-range flags give Caution / High risk', () => {
  const c = C.assessRisk({ liquidityUsd: 15000, mcapUsd: 200000, holders: 150, lpLockedPct: 100, insiderPct: 2, topHolderPct: 4 });
  assert.equal(c.verdict, 'Caution'); // high (liq) + medium (holders) = 27 off -> 73
  const h = C.assessRisk({ mintAuthority: true, freezeAuthority: true, topHolderPct: 12, top10Pct: 65, lpLockedPct: 100 });
  assert.equal(h.verdict, 'High risk');
  assert.equal(C.assessRisk({ honeypot: true }).verdict, 'Walk away');
  assert.equal(C.assessRisk({ sellTax: 25 }).verdict, 'Walk away');
});

test('buildPlan: three geometric levels, runner, stop and free-ride point', () => {
  const p = C.buildPlan({ entryMcap: 100000, targetMcap: 800000, size: 100, stopPct: 0.3 });
  assert.equal(p.X, 8);
  assert.equal(p.levels.length, 3);
  assert.ok(Math.abs(p.levels[0].mult - 2) < 1e-9);
  assert.ok(Math.abs(p.levels[1].mult - 4) < 1e-9);
  assert.ok(Math.abs(p.levels[2].mcap - 800000) < 1e-6);
  assert.equal(p.levels[0].sellValue, 60); // 30% of 100 at 2x
  assert.equal(p.levels[1].cumProceeds, 180);
  assert.equal(p.freeRideAt, 1);
  assert.equal(p.runnerPct, 10);
  assert.equal(p.stop.mcap, 70000);
  assert.equal(p.stop.loss, 30);
  assert.ok(Math.abs(p.expectedAtTarget - (60 + 120 + 240 + 80)) < 1e-9);
  assert.equal(C.buildPlan({ entryMcap: 100000, targetMcap: 150000, size: 50 }).levels.length, 2);
  assert.equal(C.buildPlan({ entryMcap: 100000, targetMcap: 120000, size: 50 }).levels[0].sellPct, 90);
  assert.equal(C.buildPlan({ entryMcap: 100000, targetMcap: 90000, size: 50 }), null);
});

test('monitorSignal: holds, calls trims on levels and distribution, exits on stop or LP pull', () => {
  const plan = C.buildPlan({ entryMcap: 100000, targetMcap: 800000, size: 100, stopPct: 0.3 });
  let s = C.monitorSignal({ plan, mcap: 150000, sessionHigh: 150000, liq0: 50000, liq: 52000 });
  assert.equal(s.verdict, 'hold');
  s = C.monitorSignal({ plan, mcap: 210000, sessionHigh: 210000, liq0: 50000, liq: 60000 });
  assert.equal(s.verdict, 'trim');
  assert.deepEqual(s.hits, [0]);
  assert.ok(s.reasons[0].text.includes('Target 1 hit'));
  s = C.monitorSignal({ plan, mcap: 210000, sessionHigh: 210000, liq0: 50000, liq: 60000, takenIdx: [0] });
  assert.equal(s.verdict, 'hold'); // already taken
  s = C.monitorSignal({ plan, mcap: 300000, sessionHigh: 400000, liq0: 50000, liq: 60000, takenIdx: [0] });
  assert.equal(s.verdict, 'trim'); // 25% off a 4x high -> distribution
  assert.ok(s.reasons.some((r) => r.key === 'dist'));
  s = C.monitorSignal({ plan, mcap: 180000, sessionHigh: 180000, liq0: 50000, liq: 60000, change5m: 55, buys5m: 10, sells5m: 25 });
  assert.ok(s.reasons.some((r) => r.key === 'blowoff'));
  s = C.monitorSignal({ plan, mcap: 65000, sessionHigh: 120000, liq0: 50000, liq: 50000 });
  assert.equal(s.verdict, 'exit');
  assert.ok(s.reasons.some((r) => r.key === 'stop'));
  s = C.monitorSignal({ plan, mcap: 500000, sessionHigh: 500000, liq0: 50000, liq: 20000 });
  assert.equal(s.verdict, 'exit');
  assert.ok(s.reasons.some((r) => r.key === 'liq'));
  assert.equal(C.monitorSignal({ plan: null, mcap: 1, sessionHigh: 1 }).verdict, 'hold');
});

test('fmtMcap and parseMcap', () => {
  assert.equal(C.fmtMcap(1234567), '$1.23M');
  assert.equal(C.fmtMcap(45000), '$45.0k');
  assert.equal(C.parseMcap('2.5m'), 2500000);
  assert.equal(C.parseMcap('$800k'), 800000);
  assert.equal(C.parseMcap('1,200,000'), 1200000);
  assert.ok(Number.isNaN(C.parseMcap('abc')));
});

test('assessRisk: bundle detail distinguishes launch bundling from what is still held', () => {
  const r = C.assessRisk({ insiderPct: 24, bundleLaunchPct: 40, bundleCount: 6 });
  const f = r.findings.find((x) => x.key === 'bundle');
  assert.equal(f.sev, 'critical');
  assert.ok(f.detail.includes('40% was bundled at launch'));
  assert.ok(f.detail.includes('24% of supply across 6 bundles is still held'));
  const sold = C.assessRisk({ insiderPct: 2, bundleLaunchPct: 35 });
  assert.equal(sold.findings[0].key, 'bundleSold');
  assert.equal(sold.findings[0].sev, 'low');
  assert.equal(C.assessRisk({ insiderPct: 2, bundleLaunchPct: 5 }).findings.length, 0);
});

test('assessRisk: fresh wallets among top holders', () => {
  const r = C.assessRisk({ analyzedHolders: 8, freshTopHolders: 5 });
  assert.equal(r.findings[0].key, 'fresh');
  assert.equal(r.findings[0].sev, 'high');
  assert.equal(C.assessRisk({ analyzedHolders: 8, freshTopHolders: 2 }).findings[0].sev, 'medium');
  assert.equal(C.assessRisk({ analyzedHolders: 8, freshTopHolders: 1 }).findings.length, 0);
  assert.equal(C.assessRisk({ analyzedHolders: 2, freshTopHolders: 2 }).findings.length, 0); // too few analyzed
});

test('assessRisk: heavy fees on the coin flag bot activity', () => {
  assert.equal(C.assessRisk({ avgFeeSol: 0.03 }).findings[0].key, 'botfees');
  assert.equal(C.assessRisk({ avgFeeSol: 0.03 }).findings[0].sev, 'medium');
  assert.equal(C.assessRisk({ avgFeeSol: 0.008 }).findings[0].sev, 'low');
  assert.equal(C.assessRisk({ avgFeeSol: 0.0001 }).findings.length, 0);
});

test('crawlscanUrl: CrawlScan report link for Solana and Robinhood Chain coins only', () => {
  assert.equal(C.crawlscanUrl('solana', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), 'https://crawlscan.fun/?ca=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  assert.equal(C.crawlscanUrl('robinhood', '0x4bc1782fafb967834e0e75947ba15113e48fc70e'), 'https://crawlscan.fun/?ca=0x4bc1782fafb967834e0e75947ba15113e48fc70e');
  assert.equal(C.crawlscanUrl('base', '0x4bc1782fafb967834e0e75947ba15113e48fc70e'), null);
  assert.equal(C.crawlscanUrl('bsc', '0x4bc1782fafb967834e0e75947ba15113e48fc70e'), null);
});
