const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../bundle.js');
const C = require('../check.js');
const F = require('./fixtures/isitbundled.json');

test('parse: a bundled launch with a serial-bundler dev', () => {
  const b = B.parse(F.serial);
  assert.equal(b.scanned, true);
  assert.equal(b.status, 'bundled');
  assert.equal(b.bundledPct, 26.6);
  assert.equal(b.wallets, F.serial.bundleWallets);
  assert.deepEqual([b.devLaunches7d, b.devBundled7d, b.serial], [6, 6, true]);
  assert.match(b.report, /^https:\/\/isitbundled\.com\//);
});

test('parse: Proxima, no bundle, and unscanned', () => {
  assert.equal(B.parse(F.proxima).proxima, true);
  assert.equal(B.parse(F.proxima_after_launch).proxima, true);
  const nb = B.parse(F.no_bundle);
  assert.deepEqual([nb.scanned, nb.bundledPct, nb.serial], [true, 0, false]);
  const un = B.parse(F.unscanned);
  assert.equal(un.scanned, false, 'unscanned is not the same as clean');
  assert.equal(un.bundledPct, null);
  assert.equal(B.parse(null), null);
});

test('label: short tag for a queue row', () => {
  assert.equal(B.label(B.parse(F.serial)), 'bundled 27%');
  assert.equal(B.label(B.parse(F.proxima)), 'Proxima · bundled 54%');
  assert.equal(B.label(B.parse(F.no_bundle)), 'no bundle');
  assert.equal(B.label(B.parse(F.unscanned)), 'not scanned');
});

test('solanaBatches: Solana only, 100 per request, no repeats', () => {
  const sol = Array.from({ length: 230 }, (_, i) => 'So1ana' + String(i).padStart(38, 'A'));
  const out = B.solanaBatches([...sol, sol[0], '0x36eaa40f85818496cdcdab022e57ab66979b7777']);
  assert.deepEqual(out.map((b) => b.length), [100, 100, 30]);
  assert.ok(!out.flat().some((a) => a.startsWith('0x')));
});

test('risk check: launch bundles and serial bundlers become findings, without double counting held bundles', () => {
  const base = { liquidityUsd: 50000, mcapUsd: 400000, ageHours: 24, holders: 300, lpLockedPct: 100, mintAuthority: false, topHolderPct: 3 };
  const keys = (f) => C.assessRisk(Object.assign({}, base, f)).findings.map((x) => `${x.sev}:${x.key}`);
  assert.ok(keys({ ibBundledPct: 31 }).includes('high:launchbundle'));
  assert.ok(keys({ ibBundledPct: 16 }).includes('medium:launchbundle'));
  assert.ok(!keys({ ibBundledPct: 10 }).some((k) => k.endsWith('launchbundle')));
  assert.ok(!keys({ ibBundledPct: 40, insiderPct: 25 }).some((k) => k.endsWith('launchbundle')), 'a held-bundle finding already covers it');
  assert.ok(keys({ ibSerialBundler: true, ibDevLaunches7d: 6, ibDevBundled7d: 6 }).includes('high:serialbundler'));
  const f = C.assessRisk(Object.assign({}, base, { ibBundledPct: 54.4, ibProxima: true })).findings.find((x) => x.key === 'launchbundle');
  assert.match(f.title, /54% of supply was bundled at launch/);
  assert.match(f.detail, /Proxima/);
});

test('autoCheckSkip: coins over 40% bundled are not worth an automatic rug check', () => {
  assert.equal(B.skipAutoCheck(B.parse(F.proxima)), true);
  assert.equal(B.skipAutoCheck(B.parse(F.serial)), false);
  assert.equal(B.skipAutoCheck(B.parse(F.unscanned)), false);
  assert.equal(B.skipAutoCheck(null), false);
});
