const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../calls.js');
const A = require('./fixtures/alerts.json');

test('parseAlert: market snapshot, contract address and the caller who triggered it (first scan alert)', () => {
  const a = C.parseAlert(A.first_scan);
  assert.equal(a.address, '6KDpQM4BVDdtAkjtyFDiBCkbii8q8BieEyXXm6kNpump');
  assert.equal(a.chain, 'solana');
  assert.equal(a.symbol, 'TM');
  assert.equal(a.name, 'TeleMoney');
  assert.deepEqual([a.snap.fdv, a.snap.liq, a.snap.vol, a.snap.holders], [184000, 18200, 242000, 729]);
  assert.equal(a.snap.ageMs, 10 * 60000);
  assert.equal(a.snap.priceUsd, 0.00019117520561085682);
  assert.deepEqual([a.snap.buys, a.snap.sells, a.snap.change1h], [2100, 2000, 1399]);
  assert.deepEqual(a.snap.top5, [3.4, 3.0, 2.8, 1.8, 1.4]);
  assert.equal(a.snap.top5Pct, 19);
  assert.equal(a.trigger.caller, 'chillz05');
  assert.equal(a.trigger.group, 'CPT');
  assert.equal(a.trigger.mcap, 184000);
  assert.equal(a.trigger.ts, 1791613040000);
  assert.deepEqual(a.trigger.stats, { medal: 'bronze', hit7: 30, hit30: 44, calls30: 250, median: 1.36 });
  assert.equal(a.trigger.winRate, 44, 'the 30 day hit rate is the win rate');
});

test('parseAlert: last mentions, medals, seedlings and the arrow line', () => {
  const a = C.parseAlert(A.price_move_13);
  assert.equal(a.address, '8vYJgiQPkpDtbWkDy1wyYDcUq3D9fUXVJUtt6aNEpump');
  assert.equal(a.mentions.length, 13);
  assert.equal(a.trigger.caller, 'mossadsleeper');
  assert.deepEqual([a.trigger.mcap, a.trigger.medal, a.trigger.winRate, a.trigger.group], [528000, 'silver', 50, 'PST']);
  const nonstop = a.mentions.find((m) => m.caller === 'nonstopnuke');
  assert.deepEqual([nonstop.medal, nonstop.winRate, nonstop.group, nonstop.mcap], ['new', null, 'WG', 164000]);
  assert.equal(a.mentions.find((m) => m.caller === 'jacksnsol').medal, 'gold');
  assert.equal(a.mentions.find((m) => m.caller === '_ditro').winRate, 47, 'underscores in names are kept');
  assert.equal(a.first.caller, 'mossadsleeper');
  assert.equal(a.first.mcap, 81900, 'the earliest mention is the first caller');
  assert.equal(C.parseAlert(A.price_move).mentions.map((m) => m.caller).join(), 'h0und824,valor456564');
});

test('parseAlert: plain chat and ordinary posts are not alerts', () => {
  assert.equal(C.parseAlert({ id: '1', content: 'ape 7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', embeds: [] }), null);
  assert.equal(C.parseAlert({ id: '1', content: 'hello', embeds: [{ description: 'nothing here' }] }), null);
});

test('fromDiscordMessages: an alert gives one call for the real contract, credited to the real caller', () => {
  const calls = C.fromDiscordMessages([A.first_scan, A.group_traction]);
  assert.equal(calls.length, 2, 'wallet and pair addresses in the links are not coins');
  const c = calls.find((x) => x.address.startsWith('6KDp'));
  assert.equal(c.poster, 'chillz05');
  assert.equal(c.at, 1791613040000);
  assert.equal(c.mcap, 184000);
  assert.equal(c.symbol, 'TM');
  assert.equal(c.group, 'CPT');
  assert.equal(c.callerWin, 44);
  assert.equal(c.snap.liq, 18200);
  assert.equal(c.messageId, A.first_scan.id);
  assert.equal(calls.find((x) => x.address.startsWith('EKfB')).poster, 'rinaut');
});

test('callerUpdates + applyCallerUpdates: a caller is refreshed every time they appear again', () => {
  const ups = C.callerUpdates([A.price_move_13]);
  assert.equal(ups.length, 13);
  let p = C.applyCallerUpdates({}, ups);
  assert.equal(Object.keys(p).length, 10);
  const m = p.mossadsleeper;
  assert.deepEqual([m.name, m.group, m.medal, m.winRate, m.calls, m.updatedAt], ['mossadsleeper', 'PST', 'silver', 50, 4, 1791610245000]);
  assert.deepEqual([p.nonstopnuke.medal, p.nonstopnuke.winRate], ['new', null]);
  // a newer sighting with a new win rate replaces the old one
  const newer = [{ caller: 'mossadsleeper', group: 'PST', medal: 'gold', winRate: 61, ts: 1791620000000 }];
  p = C.applyCallerUpdates(p, newer);
  assert.deepEqual([p.mossadsleeper.winRate, p.mossadsleeper.medal, p.mossadsleeper.calls], [61, 'gold', 5]);
  // an older sighting (the same mentions listed again later) changes nothing and is not counted twice
  p = C.applyCallerUpdates(p, ups);
  assert.deepEqual([p.mossadsleeper.winRate, p.mossadsleeper.calls], [61, 5]);
  // a seedling mention never erases a known win rate
  p = C.applyCallerUpdates(p, [{ caller: 'mossadsleeper', medal: 'new', winRate: null, ts: 1791630000000 }]);
  assert.equal(p.mossadsleeper.winRate, 61);
  // first-scan stats add the 7 day rate, the sample size and the median multiple
  p = C.applyCallerUpdates(p, C.callerUpdates([A.first_scan]));
  assert.deepEqual([p.chillz05.winRate, p.chillz05.hit7, p.chillz05.calls30, p.chillz05.median], [44, 30, 250, 1.36]);
});

test('applyCallerUpdates keeps the newest 3000 callers', () => {
  const ups = Array.from({ length: 3100 }, (_, i) => ({ caller: 'c' + i, medal: 'silver', winRate: 50, ts: 1000 + i }));
  const p = C.applyCallerUpdates({}, ups);
  assert.equal(Object.keys(p).length, 3000);
  assert.ok(p.c3099 && !p.c0);
});

test('addToQueue keeps the first call market cap and the newest alert snapshot', () => {
  const calls = C.fromDiscordMessages([A.group_traction, A.first_scan]);
  const q = C.addToQueue({}, calls.concat([Object.assign({}, calls[0], { at: calls[0].at + 60000, mcap: 99999, snap: Object.assign({}, calls[0].snap, { liq: 1 }), messageId: 'x' })]));
  const e = q[calls[0].address];
  assert.equal(e.callMcap, 47000, 'the earliest mention in the alert sets the entry market cap');
  assert.equal(e.firstPoster, 'shredzwins1', 'and gets the credit');
  assert.ok(e.posters.includes('rinaut') && e.posters.includes('shredzwins1'));
  assert.equal(e.snap.liq, 1, 'the latest alert gives the current snapshot');
  assert.equal(e.symbol, calls[0].symbol);
});

test('fromDiscordMessages: addresses inside wallet and pool links are not coins', () => {
  const wallet = 'CzU8MaRcwvwUoNkwJFLbvtFWJugcEXAhDDQqNFE4ybb';
  const coin = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr';
  const calls = C.fromDiscordMessages([
    { id: '1', timestamp: '2026-10-10T05:00:00Z', author: { username: 'bot' }, content: `moved [3.4](https://solscan.io/account/${wallet}) see https://dexscreener.com/solana/arcvd2givsmz7or2ozpe3kzvbadsvreav5ddnvj8sjhk`, embeds: [] },
    { id: '2', timestamp: '2026-10-10T05:00:00Z', author: { username: 'bot' }, content: `ape ${coin} chart https://dexscreener.com/solana/arcvd2givsmz7or2ozpe3kzvbadsvreav5ddnvj8sjhk`, embeds: [] },
  ]);
  assert.deepEqual(calls.map((c) => c.address), [coin]);
});
