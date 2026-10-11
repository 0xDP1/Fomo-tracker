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

// LP unlock date (docs/features/lp-unlock-date.md)
const NOW = Date.UTC(2026, 9, 11);
const DAY = 86400000;
const sec = (ms) => Math.floor(ms / 1000);

test('lpUnlockFromRugcheck: earliest dated lock holding a real part of the pool, dust and permanent locks ignored', () => {
  const bonk = require('./fixtures/rugcheck-lockers.json');
  // BONK's dated lockers are expired, but each holds well under 10% of its $1.75M liquidity: no time-limited lock that matters.
  assert.equal(C.lpUnlockFromRugcheck(bonk.lockers, bonk.totalMarketLiquidity), false);
  const lockers = {
    a: { type: 'jupiter_locker', unlockDate: sec(NOW + 200 * DAY), usdcLocked: 30000 },
    b: { type: 'streamflow', unlockDate: sec(NOW + 3 * DAY), usdcLocked: 20000 },
    c: { type: 'streamflow', unlockDate: sec(NOW + 1 * DAY), usdcLocked: 50 }, // dust
    d: { type: 'raydium_locker', unlockDate: 0, usdcLocked: 40000 }, // permanent
  };
  assert.equal(C.lpUnlockFromRugcheck(lockers, 100000), sec(NOW + 3 * DAY) * 1000);
  assert.equal(C.lpUnlockFromRugcheck({ d: lockers.d }, 100000), false);
  assert.equal(C.lpUnlockFromRugcheck({}, 100000), false);
  assert.equal(C.lpUnlockFromRugcheck(undefined, 100000), undefined, 'no lockers field: not checked');
});

test('lpUnlockFromGoplus: earliest end_time among locked LP holders with a real share', () => {
  const gp = require('./fixtures/goplus-lp-locked.json');
  assert.equal(C.lpUnlockFromGoplus(gp.lp_holders), Date.parse('2092-09-20T16:00:00+00:00'));
  const hs = [
    { is_locked: 1, percent: '0.5', locked_detail: [{ end_time: '2026-10-14T00:00:00+00:00' }, { end_time: '2027-06-01T00:00:00+00:00' }] },
    { is_locked: 1, percent: '0.01', locked_detail: [{ end_time: '2026-10-12T00:00:00+00:00' }] }, // under 10% of LP
    { is_locked: 0, percent: '0.4' },
  ];
  assert.equal(C.lpUnlockFromGoplus(hs), Date.parse('2026-10-14T00:00:00+00:00'));
  assert.equal(C.lpUnlockFromGoplus([{ is_locked: 1, percent: '0.9', locked_detail: null }]), false, 'locked without dates');
  assert.equal(C.lpUnlockFromGoplus([]), false);
  assert.equal(C.lpUnlockFromGoplus(undefined), undefined);
});

test('assessRisk: LP unlocking within 60 days or already expired is high; later, none or burned is quiet', () => {
  const find = (f) => C.assessRisk(f, NOW).findings.find((x) => x.key === 'lpunlock');
  const soon = find({ lpLockedPct: 100, lpUnlockAt: NOW + 3 * DAY });
  assert.equal(soon.sev, 'high');
  assert.match(soon.title, /LP unlocks in 3 days/);
  assert.match(find({ lpUnlockAt: NOW + 5 * 3600000 }).title, /under a day/);
  assert.ok(find({ lpUnlockAt: NOW + 60 * DAY }), '60 days is inside the line');
  assert.equal(find({ lpUnlockAt: NOW + 61 * DAY }), undefined);
  assert.equal(find({ lpUnlockAt: NOW + 200 * DAY }), undefined);
  const gone = find({ lpUnlockAt: NOW - DAY });
  assert.equal(gone.sev, 'high');
  assert.match(gone.title, /LP lock has expired/);
  assert.equal(find({ lpLockedPct: 100, lpUnlockAt: false }), undefined, 'burned or permanent: nothing to flag');
  assert.ok(C.assessRisk({}, NOW).unknown.includes('LP unlock date'));
  assert.ok(!C.assessRisk({ lpUnlockAt: false }, NOW).unknown.includes('LP unlock date'));
});

// Creator share from RugCheck's creatorBalance (docs/features/creator-balance.md)
test('creatorPctFromRugcheck: creatorBalance / supply, also for creators outside the top holders', () => {
  const fx = require('./fixtures/rugcheck-creator.json');
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);
  near(C.creatorPctFromRugcheck(fx.outside), 6.6285714223523);
  assert.equal(C.creatorPctFromRugcheck(fx.soldout), 0, 'sold out is 0%, a checked answer');
  near(C.creatorPctFromRugcheck(fx.inside), fx.inside.topHolders.find((h) => h.owner === fx.inside.creator || h.address === fx.inside.creator).pct);
  assert.equal(C.creatorPctFromRugcheck({ ...fx.outside, creator: null }), undefined, 'no creator named: unknown');
  // No creatorBalance: fall back to the creator's top-holder row, else unknown.
  assert.equal(C.creatorPctFromRugcheck({ creator: 'X', token: { supply: 1000 }, topHolders: [{ owner: 'X', pct: 4.5 }] }), 4.5);
  assert.equal(C.creatorPctFromRugcheck({ creator: 'X', token: { supply: 1000 }, topHolders: [] }), undefined);
  assert.equal(C.creatorPctFromRugcheck({ creator: 'X', creatorBalance: 5, token: {}, topHolders: [] }), undefined, 'no supply: unknown');
  assert.equal(C.creatorPctFromRugcheck(undefined), undefined);
});
