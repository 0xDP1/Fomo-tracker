// Bundle check: pure helpers (no DOM, no network) for isitbundled.com's free API — how much supply was bought
// together at launch, whether a bundling tool (Proxima) made the coin, and the dev's recent launches.
(function (root) {
  'use strict';
  const BATCH = 100;          // the API takes up to 100 mints per request
  const SKIP_AUTO = 40;       // over this % bundled, skip the automatic rug check
  const SERIAL_MIN = 3;       // launches in 7 days, all bundled
  const n = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

  function parse(t) {
    if (!t || !t.mint) return null;
    const scanned = !!t.status && t.status !== 'unscanned';
    const devLaunches7d = n(t.devLaunches7d), devBundled7d = n(t.devBundled7d);
    return {
      mint: t.mint, status: t.status || 'unscanned', scanned,
      bundledPct: scanned ? n(t.bundledPct) : null, creatorBundlePct: n(t.creatorBundlePct), otherBundlesPct: n(t.otherBundlesPct),
      firstSecondPct: n(t.firstSecondPct), devBoughtPct: n(t.devBoughtPct), wallets: n(t.bundleWallets),
      devLaunches7d, devBundled7d, serial: scanned && devLaunches7d >= SERIAL_MIN && devBundled7d === devLaunches7d,
      proxima: !!(t.madeWithProxima || t.proximaAfterLaunch), sumo: !!t.madeWithSumo,
      risk: t.risk || null, insidersHoldPct: n(t.insidersHoldPct), flaggedHoldPct: n(t.flaggedHoldPct),
      report: t.report || ('https://isitbundled.com/' + t.mint),
    };
  }

  function label(b) {
    if (!b) return '';
    if (!b.scanned) return 'not scanned';
    const tool = b.proxima ? 'Proxima · ' : b.sumo ? 'Sumo · ' : '';
    return b.bundledPct > 0 ? `${tool}bundled ${Math.round(b.bundledPct)}%` : tool ? tool.replace(' · ', '') : 'no bundle';
  }

  const skipAutoCheck = (b) => !!(b && b.scanned && b.bundledPct != null && b.bundledPct > SKIP_AUTO);

  // Risk-check facts from a parsed result (names start with ib so they never mix with RugCheck or TrenchBot).
  const facts = (b) => (b && b.scanned ? { ibBundledPct: b.bundledPct, ibFirstSecondPct: b.firstSecondPct, ibProxima: b.proxima, ibSerialBundler: b.serial, ibDevLaunches7d: b.devLaunches7d, ibDevBundled7d: b.devBundled7d } : {});

  function solanaBatches(addresses) {
    const sol = [...new Set((addresses || []).filter((a) => a && !/^0x/i.test(a)))];
    const out = [];
    for (let i = 0; i < sol.length; i += BATCH) out.push(sol.slice(i, i + BATCH));
    return out;
  }

  const api = { parse, label, skipAutoCheck, facts, solanaBatches, BATCH, SKIP_AUTO, SERIAL_MIN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Bundle = api;
})(typeof window !== 'undefined' ? window : globalThis);
