// Token check: pure rug-risk scoring, trim-plan math and watch signals. No DOM, no network.
// Works in the browser (window.Check) and in Node (module.exports) for tests.
(function (root) {
  'use strict';

  const CHAIN_NAMES = { solana: 'Solana', ethereum: 'Ethereum', base: 'Base', bsc: 'BNB', monad: 'Monad', robinhood: 'Robinhood', arbitrum: 'Arbitrum' };

  // 'solana' for a base58 mint, 'evm' for a 0x address, null otherwise.
  function detectChain(ca) {
    if (/^0x[0-9a-fA-F]{40}$/.test(ca)) return 'evm';
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ca)) return 'solana';
    return null;
  }

  // Pull a contract address out of pasted text (a bare CA, or a DexScreener / pump.fun / GMGN link).
  function extractAddress(text) {
    const s = String(text || '').trim();
    const evm = s.match(/0x[0-9a-fA-F]{40}/);
    if (evm) return evm[0];
    const parts = s.split(/[^1-9A-HJ-NP-Za-km-z]+/).filter((p) => p.length >= 32 && p.length <= 44);
    return parts.sort((a, b) => b.length - a.length)[0] || null;
  }

  const SEV_WEIGHT = { critical: 35, high: 18, medium: 9, low: 3 };
  const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
  const pct = (n) => `${Math.round(n)}%`;
  // Creator history (Dev dossier): 3+ dead launches and most of the counted launches dead.
  const RUGGER = { dead: 3, share: 0.6 };

  // facts: numbers are percentages of supply (0-100) unless named *Usd / *Hours.
  // Any field left undefined is "not checked" and produces no finding; it is listed under `unknown`.
  function assessRisk(f = {}) {
    const findings = [];
    const add = (sev, key, title, detail) => findings.push({ sev, key, title, detail });
    const n = (k) => (typeof f[k] === 'number' && Number.isFinite(f[k]) ? f[k] : null);

    if (f.honeypot === true) add('critical', 'honeypot', 'Honeypot: you can buy but not sell', 'The contract blocks or breaks sells. Walk away.');
    const sellTax = n('sellTax'), buyTax = n('buyTax');
    if (sellTax != null) {
      if (sellTax >= 20) add('critical', 'sellTax', `${pct(sellTax)} sell tax`, 'Most of what you sell goes to the contract, not to you.');
      else if (sellTax >= 10) add('high', 'sellTax', `${pct(sellTax)} sell tax`, 'A heavy sell tax eats your exits.');
      else if (sellTax >= 5) add('medium', 'sellTax', `${pct(sellTax)} sell tax`, 'Factor the tax into every trim.');
    }
    if (buyTax != null && buyTax >= 10) add('high', 'buyTax', `${pct(buyTax)} buy tax`, 'You start the trade down by the tax.');

    if (f.mintAuthority === true) add('high', 'mint', 'Supply can still be minted', 'The mint authority has not been revoked. Whoever holds it can print tokens over your head.');
    if (f.freezeAuthority === true) add('high', 'freeze', 'Your tokens can be frozen', 'The freeze authority is live. The team can stop wallets from selling.');
    if (f.ownerCanModify === true) add('high', 'owner', 'Owner can change the contract', 'Proxy, hidden owner, editable taxes or a blacklist: the rules can change after you buy.');
    if (f.openSource === false) add('high', 'closed', 'Contract is not verified', 'Unverified code means nobody can read what it does.');

    const lpLocked = n('lpLockedPct');
    if (lpLocked != null) {
      if (lpLocked < 50) add('critical', 'lp', 'LP in a wallet that can pull it', `Only ${pct(lpLocked)} of the liquidity is locked or burned. The rest can be pulled at any time.`);
      else if (lpLocked < 90) add('medium', 'lp', `${pct(100 - lpLocked)} of LP is unlocked`, 'Most liquidity is safe, but part of it can still be removed.');
    }

    // insiderPct = bundled/insider supply STILL HELD. bundleLaunchPct = what was bundled at launch (may have sold since).
    const insider = n('insiderPct'), launch = n('bundleLaunchPct');
    if (insider != null) {
      const who = f.insiderWallets ? ` across ${f.insiderWallets} linked wallets` : f.bundleCount ? ` across ${f.bundleCount} bundles` : '';
      const atLaunch = launch != null && launch > insider + 1 ? ` ${pct(launch)} was bundled at launch;` : '';
      if (insider >= 20) add('critical', 'bundle', 'Bundled supply sitting unsold over your head', `${atLaunch} ${pct(insider)} of supply${who} is still held by wallets that bought together. That is the exit liquidity trap.`.trim());
      else if (insider >= 10) add('high', 'bundle', 'Bundled supply over your head', `${atLaunch} ${pct(insider)} of supply${who} is still held by wallets that bought together.`.trim());
      else if (insider >= 5) add('medium', 'bundle', 'Some bundled supply', `${atLaunch} ${pct(insider)} of supply${who} looks coordinated.`.trim());
      else if (launch != null && launch >= 15) add('low', 'bundleSold', 'Bundle has already sold', `${pct(launch)} was bundled at launch but only ${pct(insider)} is still held. The snipers have mostly dumped; watch for them re-buying.`);
    }

    // Bundle check (isitbundled.com): what was bought together at launch. A held-bundle finding above already covers it.
    const ib = n('ibBundledPct');
    if (ib != null && ib >= 15 && !findings.some((x) => x.key === 'bundle')) {
      const extra = `${f.ibProxima ? ' Made with Proxima, a bundling launch tool.' : ''}${n('ibFirstSecondPct') != null ? ` ${pct(f.ibFirstSecondPct)} was bought in the first second.` : ''}`;
      add(ib >= 30 ? 'high' : 'medium', 'launchbundle', `${pct(ib)} of supply was bundled at launch`, `Wallets bought together at launch.${extra} They may still be holding or may have sold. Data: isitbundled.com.`);
    }
    if (f.ibSerialBundler === true) add('high', 'serialbundler', `Dev bundles every launch: ${f.ibDevBundled7d} of ${f.ibDevLaunches7d} in 7 days`, 'The wallet that made this coin bundled every coin it launched this week. Data: isitbundled.com.');

    // GMGN early traders: most of the first buyers have already sold, so buying now means buying from them.
    const eSold = n('gmEarlySold'), eN = n('gmEarlyN');
    if (eSold != null && eN >= 5 && eSold / eN >= 0.8) add('medium', 'earlysellers', `${eSold} of the first ${eN} buyers have sold`, 'The earliest wallets have sold half or more of their bags. Buying now means buying what they are selling. Data: GMGN.');

    const whale = n('topHolderPct');
    if (whale != null) {
      if (whale >= 20) add('critical', 'whale', 'One whale who is the chart', `The largest wallet holds ${pct(whale)} of supply. When they sell, the chart is over.`);
      else if (whale >= 10) add('high', 'whale', 'One wallet is a big part of the chart', `The largest wallet holds ${pct(whale)} of supply.`);
      else if (whale >= 5) add('low', 'whale', `Largest wallet holds ${pct(whale)}`, 'Not alarming, but keep an eye on it.');
    }
    const top10 = n('top10Pct');
    if (top10 != null) {
      if (top10 >= 60) add('high', 'top10', `Top 10 wallets hold ${pct(top10)}`, 'Supply is concentrated. A few sellers move the price.');
      else if (top10 >= 40) add('medium', 'top10', `Top 10 wallets hold ${pct(top10)}`, 'Fairly concentrated.');
    }
    const creator = n('creatorPct');
    if (creator != null) {
      if (creator >= 10) add('high', 'creator', `Creator still holds ${pct(creator)}`, 'The deployer has a large bag to dump.');
      else if (creator >= 5) add('medium', 'creator', `Creator holds ${pct(creator)}`, 'Watch for the deployer selling.');
    }

    const liq = n('liquidityUsd'), mcap = n('mcapUsd');
    if (liq != null) {
      if (liq < 5000) add('critical', 'liq', 'Almost no liquidity', `$${Math.round(liq).toLocaleString()} in the pool. You cannot get out at size.`);
      else if (liq < 20000) add('high', 'liq', 'Thin liquidity', `$${Math.round(liq).toLocaleString()} in the pool. Expect big slippage on exits.`);
      else if (mcap > 0 && liq / mcap < 0.03) add('medium', 'liqRatio', 'Liquidity is small for the market cap', `Liquidity is ${(100 * liq / mcap).toFixed(1)}% of market cap.`);
    }
    const age = n('ageHours');
    if (age != null) {
      if (age < 1) add('medium', 'age', `Brand new: ${Math.max(1, Math.round(age * 60))} minutes old`, 'Most rugs happen in the first hour.');
      else if (age < 24) add('low', 'age', `${Math.round(age)} hours old`, 'Still in the window where most tokens die.');
    }
    const holders = n('holders');
    if (holders != null) {
      if (holders < 50) add('high', 'holders', `Only ${holders} holders`, 'Too few real buyers to absorb any selling.');
      else if (holders < 200) add('medium', 'holders', `${holders} holders`, 'A small holder base.');
    }
    const fresh = n('freshTopHolders'), analyzed = n('analyzedHolders');
    if (fresh != null && analyzed >= 3) {
      if (fresh >= Math.max(3, Math.ceil(analyzed / 2))) add('high', 'fresh', 'Top holders are fresh wallets', `${fresh} of the ${analyzed} largest wallets have almost no history. Wallets made for this launch are the sniper and bundle pattern.`);
      else if (fresh >= 2) add('medium', 'fresh', `${fresh} fresh wallets among the top holders`, 'Some of the biggest holders were created recently.');
    }
    const avgFee = n('avgFeeSol');
    if (avgFee != null) {
      if (avgFee >= 0.02) add('medium', 'botfees', 'Bots are fighting over this coin', `Average fee per transaction is ${avgFee.toFixed(4)} SOL: traders are paying heavy priority tips, so you are competing with bots on every fill.`);
      else if (avgFee >= 0.005) add('low', 'botfees', 'Elevated fees on this coin', `Average fee per transaction is ${avgFee.toFixed(4)} SOL, above a normal swap. Some bot activity.`);
    }
    // Operator check (Helius): linked wallets run by one operator, and what their exit would do to the price.
    const opW = n('operatorWallets'), opPct = n('operatorPct'), opDrop = n('operatorDrop');
    if (opW != null && opW >= 2 && opDrop != null && opDrop >= 0.25) add(opDrop >= 0.5 ? 'critical' : 'high', 'operator', `One operator controls ${opW} wallets`, `${opW} linked wallets hold ${opPct != null ? opPct.toFixed(0) : '?'}% of supply together. If they sold into the pool the price would drop about ${Math.round(opDrop * 100)}%.`);
    // Flow check (Helius): one wallet making up the hour's volume means the volume is not a crowd.
    const flowTop = n('flowTopShare');
    if (flowTop != null && flowTop >= 0.3) add(flowTop >= 0.5 ? 'high' : 'medium', 'onewallet', 'One wallet is the volume', `A single wallet made ${Math.round(flowTop * 100)}% of the last hour's trading volume. That is wash trading or one whale, not a crowd of buyers.`);
    // Dev dossier (Helius): a creator whose earlier coins mostly died.
    const cDead = n('creatorDead'), cCount = n('creatorCounted');
    if (cDead != null && cCount > 0 && cDead >= RUGGER.dead && cDead / cCount >= RUGGER.share) add('high', 'devhistory', `Creator has ${cDead} of ${cCount} earlier launches dead`, 'The wallet that launched this coin has a record of coins whose markets died. Serial launchers often sell into the first buyers.');
    if (f.mutableMetadata === true) add('low', 'meta', 'Token name and image can be changed', 'Mutable metadata is common on new launches, but it allows rebrands.');
    const b1 = n('buys1h'), s1 = n('sells1h');
    if (b1 != null && s1 != null && b1 + s1 >= 20 && s1 > b1 * 1.5) add('medium', 'selling', 'Sellers outnumber buyers right now', `${s1} sells vs ${b1} buys in the last hour.`);

    findings.sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev]);
    const score = Math.max(0, 100 - findings.reduce((s, x) => s + SEV_WEIGHT[x.sev], 0));
    const critical = findings.some((x) => x.sev === 'critical');
    const high = findings.some((x) => x.sev === 'high');
    const verdict = critical ? 'Walk away' : score < 45 ? 'High risk' : score < 75 || high ? 'Caution' : 'Looks OK';
    const important = { lpLockedPct: 'LP lock', insiderPct: 'bundles', topHolderPct: 'top holders', mintAuthority: 'mint authority', honeypot: 'honeypot test', holders: 'holder count' };
    const unknown = Object.keys(important).filter((k) => f[k] == null).map((k) => important[k]);
    return { score, verdict, findings, unknown };
  }

  // Trim ladder between the entry market cap and the target. Sizes are in the same unit as `size`.
  function buildPlan({ entryMcap, targetMcap, size, stopPct = 0.3 }) {
    if (!(entryMcap > 0) || !(targetMcap > entryMcap) || !(size > 0)) return null;
    const X = targetMcap / entryMcap;
    const sells = X >= 2.5 ? [30, 30, 30] : X >= 1.4 ? [40, 50] : [90];
    const nLv = sells.length;
    let remaining = 100, proceeds = 0, freeRideAt = null;
    const levels = sells.map((sellPct, i) => {
      const mult = Math.pow(X, (i + 1) / nLv);
      const mcap = entryMcap * mult;
      const sellValue = size * mult * sellPct / 100;
      remaining -= sellPct;
      proceeds += sellValue;
      if (freeRideAt == null && proceeds >= size) freeRideAt = i;
      return { i, mult, mcap, sellPct, sellValue, remainingPct: remaining, cumProceeds: proceeds };
    });
    const runnerPct = remaining;
    const runnerValueAtTarget = size * X * runnerPct / 100;
    return {
      entryMcap, targetMcap, size, X, stopPct, levels, runnerPct, freeRideAt,
      stop: { mcap: entryMcap * (1 - stopPct), loss: size * stopPct },
      expectedAtTarget: proceeds + runnerValueAtTarget,
    };
  }

  // Watch-time signal. mcap is current; sessionHigh is the highest mcap seen since watching began;
  // liq0 is liquidity when watching began. takenIdx lists levels the trader already sold.
  function monitorSignal({ plan, mcap, sessionHigh = 0, liq0 = 0, liq = null, change5m = 0, change1h = 0, buys5m = 0, sells5m = 0, buys1h = 0, sells1h = 0, takenIdx = [] }) {
    const reasons = [];
    let verdict = 'hold';
    const bump = (v) => { if (v === 'exit' || (v === 'trim' && verdict === 'hold')) verdict = v; };
    const hits = plan ? plan.levels.filter((l) => !takenIdx.includes(l.i) && mcap >= l.mcap).map((l) => l.i) : [];
    const gain = plan && sessionHigh > 0 ? sessionHigh / plan.entryMcap - 1 : 0;
    const drawdown = sessionHigh > 0 ? Math.max(0, 1 - mcap / sessionHigh) : 0;

    if (liq0 > 0 && liq != null && liq < liq0 * 0.7) { bump('exit'); reasons.push({ key: 'liq', text: `Liquidity is down ${pct(100 * (1 - liq / liq0))} since you started watching. That is a pull. Walk away.` }); }
    if (plan && mcap <= plan.stop.mcap) { bump('exit'); reasons.push({ key: 'stop', text: `Stop hit: market cap is ${pct(100 * (1 - mcap / plan.entryMcap))} below your entry. Take the loss and walk away.` }); }
    if (verdict !== 'exit') {
      if (drawdown >= 0.35 && gain >= 0.5) { bump('trim'); reasons.push({ key: 'top', text: `The top is in: ${pct(drawdown * 100)} off the high after a ${pct(gain * 100)} run. Sell into whatever bid is left.` }); }
      else if (drawdown >= 0.2 && gain >= 0.3) { bump('trim'); reasons.push({ key: 'dist', text: `Distribution: ${pct(drawdown * 100)} off the session high. Trim into strength while there is still a bid.` }); }
      if (change5m >= 40 && sells5m > buys5m) { bump('trim'); reasons.push({ key: 'blowoff', text: `Blow-off: +${pct(change5m)} in 5 minutes and sellers now outnumber buyers. Trim into strength.` }); }
      if (buys1h + sells1h >= 30 && sells1h > buys1h * 1.5 && change1h < 0) { bump('trim'); reasons.push({ key: 'sellers', text: `Sellers are ${(sells1h / Math.max(1, buys1h)).toFixed(1)}× buyers over the last hour and price is slipping. Trim.` }); }
      for (const i of hits) { bump('trim'); const l = plan.levels[i]; reasons.push({ key: 'level' + i, text: `Target ${i + 1} hit at ${fmtMcap(l.mcap)}. Sell ${l.sellPct}% on plan.` }); }
    }
    return { verdict, reasons, hits, gain, drawdown };
  }

  function fmtMcap(n) {
    if (!(n >= 0)) return '–';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'k';
    return '$' + Math.round(n);
  }

  // "2.5m" / "$1.2k" / "800000" -> number
  function parseMcap(s) {
    const m = String(s || '').trim().replace(/[$,\s]/g, '').match(/^([\d.]+)([kmb])?$/i);
    if (!m) return NaN;
    return Number(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1);
  }

  // CrawlScan (crawlscan.fun) reports operator clusters for pump.fun and Robinhood Chain coins.
  const crawlscanUrl = (chainId, ca) => (['solana', 'robinhood'].includes(chainId) ? 'https://crawlscan.fun/?ca=' + encodeURIComponent(ca) : null);

  // FOMO coin pages (fomo.family/tokens/<chain>/<address>); the FOMO app opens them on a phone. Chain names are FOMO's own.
  const FOMO_CHAINS = { solana: 'solana', sol: 'solana', base: 'base', bsc: 'bnb', bnb: 'bnb', 'bnb chain': 'bnb', binance: 'bnb', ethereum: 'ethereum', eth: 'ethereum', monad: 'monad', hyperliquid: 'hyperliquid', hyperevm: 'hyperliquid', robinhood: 'robinhood', 'robinhood chain': 'robinhood', arc: 'arc' };
  function fomoUrl(chain, address) {
    const slug = FOMO_CHAINS[String(chain || '').trim().toLowerCase()];
    const a = String(address || '').trim();
    if (!slug || !a) return null;
    const evm = /^0x[0-9a-fA-F]{40}$/.test(a);
    if (slug === 'solana' ? !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) : !evm) return null;
    return `https://fomo.family/tokens/${slug}/${evm ? a.toLowerCase() : a}`;
  }

  const api = { detectChain, extractAddress, assessRisk, buildPlan, monitorSignal, fmtMcap, parseMcap, crawlscanUrl, fomoUrl, CHAIN_NAMES, RUGGER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Check = api;
})(typeof window !== 'undefined' ? window : globalThis);
