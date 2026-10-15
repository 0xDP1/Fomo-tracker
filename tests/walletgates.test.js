// docs/features/wallet-gates.md: four pass / fail gates on a wallet from GMGN's stats and profits, one verdict with its cause.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../walletgates.js');
const R = require('../walletreport.js');
const FIX = require('./fixtures/gmgn-wallet-stats.json');

const T0 = 1791700000;
const act = (type, token, minutes, price, usd) => ({ event_type: type, token: { address: token, symbol: token.slice(0, 4) }, timestamp: T0 + minutes * 60, price_usd: price, cost_usd: usd });
// 10 round trips over 2 days: 6 wins of +20% held 1 minute, 4 losses of −50% held 30 minutes, $100 each
const rows = [];
for (let i = 0; i < 10; i++) { const win = i < 6, t = i * 288; rows.push(act('buy', 'T' + i, t, 1, 100), act('sell', 'T' + i, t + (win ? 1 : 30), win ? 1.2 : 0.5, win ? 120 : 50)); }
const pairs = R.pair(rows);
const s = R.stats(pairs, { costPct: 4 });
const mcaps = {}; for (const p of pairs) mcaps[p.address] = 100000;
const rec = () => G.record(FIX.stats7, FIX.stats30, FIX.profitsAll);
const withRec = (patch, common) => { const r = rec(); Object.assign(r, patch); if (common) Object.assign(r, common); return r; };
const states = (gs) => gs.map((g) => `${g.key}:${g.state}`).join(' ');

test('record: the fields the gates need, from stats (object or one-row list) and all-time profits', () => {
  const r = rec();
  assert.deepEqual([r.tokens, r.winRate, r.buys7, r.sells7, r.realized7, r.roi7, r.realized30, r.realizedAll, r.roiAll, r.createdTokens, r.followers, r.twitter], [120, 58, 310, 290, 8400, 0.2, 31000, 150000, 0.25, 0, 1200, 'cowboy_sol']);
  assert.equal(Math.round(r.roi30 * 10000) / 10000, 0.2067);
  assert.deepEqual(r.buckets, { gt5x: 4, x2to5: 11, x0to2: 55, lt0: 2, ltNeg50: 48 });
  assert.deepEqual(r.tags, ['smart_money', 'kol']);
  assert.equal(G.record([FIX.stats7], null, null).tokens, 120, 'a batch answer is a list');
  assert.equal(G.record({ list: [FIX.stats7] }, null, null).realizedAll, null, 'no profits: all-time unknown');
  assert.equal(G.record(null, FIX.stats30, FIX.profitsAll), null, 'no 7-day stats: no record');
  const noRatio = G.record({ realized_profit: 50, pnl_stat: { token_num: 3 }, common: { tag: 'sniper' } }, null, { list: [{ total_realized_profit: '-20', total_realized_profit_cost: '0' }] });
  assert.deepEqual([noRatio.roi7, noRatio.roiAll, noRatio.tags, noRatio.winRate], [null, null, ['sniper'], null], 'no cost and no ratio: unknown, not 0');
});

test('concentration: the biggest closed gain\'s share, only with enough winners and trades', () => {
  assert.equal(Math.round(G.concentration(pairs) * 1000) / 1000, 0.167, '6 equal wins');
  assert.equal(G.concentration(pairs.slice(0, 7)), null, 'under 8 closed trades: no evidence');
  const one = R.pair([act('buy', 'BIG', 0, 1, 100), act('sell', 'BIG', 5, 10, 1000)].concat(rows.slice(0, 16)));
  assert.ok(G.concentration(one) > 0.75, 'one $900 win among $20 wins');
});

test('gates: the good case passes three and fails Cuts losses on the heavy-loss share', () => {
  const gs = G.gates(rec(), s, pairs, mcaps);
  assert.equal(states(gs), 'record:pass current:pass reach:pass cuts:fail');
  assert.equal(gs[0].why, '120 tokens traded, biggest win 17% of gains');
  assert.equal(gs[1].why, '+20% over 7 days, +21% over 30, +25% all-time');
  assert.equal(gs[2].why, 'median hold 1 min, entry mcap $100k, average buy $100, 11 trades a day');
  assert.equal(gs[3].why, '40% of its tokens down more than 50% (48 of 120): it does not cut');
  assert.deepEqual(G.verdict(gs), { level: 'warn', label: 'Copy the buys, not the exits', cause: 'it does not cut losses', text: 'Copy the buys, not the exits · it does not cut losses' });
  const clean = G.gates(withRec({ buckets: Object.assign({}, rec().buckets, { ltNeg50: 20 }) }), s, pairs, mcaps);
  assert.equal(states(clean), 'record:pass current:pass reach:pass cuts:pass');
  assert.equal(G.verdict(clean).text, 'Copyable at small size · all four pass');
});

test('gates: Real record fails on a launcher or a one-coin record, is unmeasured on a thin sample or a wash flag', () => {
  let gs = G.gates(withRec({ createdTokens: 70 }), s, pairs, mcaps);
  assert.equal(gs[0].state, 'fail');
  assert.equal(G.verdict(gs).text, 'Do not copy · it is a launcher trading its own coins');
  assert.equal(G.gates(withRec({ createdTokens: 50 }), s, pairs, mcaps)[0].state, 'pass', 'under half its tokens: a trader who also launched');
  const one = R.pair([act('buy', 'BIG', 0, 1, 100), act('sell', 'BIG', 5, 10, 1000)].concat(rows.slice(0, 16)));
  gs = G.gates(rec(), R.stats(one, { costPct: 4 }), one, mcaps);
  assert.equal(G.verdict(gs).text, 'Do not copy · one coin made all the money');
  gs = G.gates(withRec({ tokens: 4 }), s, pairs, mcaps);
  assert.equal(states(gs), 'record:none current:pass reach:pass cuts:none');
  assert.equal(G.verdict(gs).text, 'No read · only 4 tokens traded', 'thin is unmeasured, not bad');
  gs = G.gates(withRec({ tags: ['wash_trader'] }), s, pairs, mcaps);
  assert.equal(gs[0].state, 'none');
  assert.equal(G.verdict(gs).text, 'Hold off · a wash-trading flag this app cannot check');
  gs = G.gates(null, s, pairs, mcaps);
  assert.equal(states(gs), 'record:none current:none reach:pass cuts:none');
  assert.equal(G.verdict(gs).text, 'Hold off · its record was not measured');
});

test('gates: Still working fails on a cooled star, a losing month, or a record that never worked; needs all-time', () => {
  let gs = G.gates(withRec({ roi7: -0.27, realized7: -9000 }), s, pairs, mcaps);
  assert.equal(gs[1].why, '−27% over 7 days after +25% all-time: was good, not any more');
  assert.equal(G.verdict(gs).text, 'Do not copy · it has stopped making money');
  gs = G.gates(withRec({ roi7: -0.05, realized7: -500, realized30: -2000 }), s, pairs, mcaps);
  assert.equal(gs[1].why, 'lost −$500 over 7 days and −$2k over 30');
  gs = G.gates(withRec({ roi7: -0.05, realized7: -500, realized30: 100, roiAll: -0.1, realizedAll: -60000 }), s, pairs, mcaps);
  assert.equal(G.verdict(gs).text, 'Do not copy · it has never made money');
  gs = G.gates(withRec({ roiAll: null, realizedAll: null }), s, pairs, mcaps);
  assert.equal(gs[1].state, 'none');
  assert.equal(G.verdict(gs).text, 'Hold off · its all-time record was not read');
  gs = G.gates(withRec({ buys7: 0, sells7: 0 }), s, pairs, mcaps);
  assert.equal(G.verdict(gs).text, 'No read · no trades in 7 days');
  assert.equal(G.gates(withRec({ roi7: -0.05, realized7: -500 }), s, pairs, mcaps)[1].state, 'pass', 'a small down week on a good record still passes');
});

test('gates: Reachable fails on pre-graduation entries, a big crowd, a bot pace, tiny buys, sub-minute holds or an MEV tag', () => {
  const low = {}; for (const p of pairs) low[p.address] = 12000;
  const cuts = withRec({ buckets: Object.assign({}, rec().buckets, { ltNeg50: 20 }) }); // a wallet that cuts, so only reach speaks
  let gs = G.gates(cuts, s, pairs, low);
  assert.equal(gs[2].why, 'median entry market cap $12k: it buys before graduation, you would enter at several times its cost');
  assert.equal(G.verdict(gs).text, 'Watch, do not copy · you cannot get its fills');
  gs = G.gates(withRec({ followers: 41319 }), s, pairs, mcaps);
  assert.equal(gs[2].why, '41k followers trading small caps: its crowd moves the price before your order lands');
  assert.equal(G.gates(withRec({ followers: 41319 }), s, pairs, { a: 2e6 })[2].state, 'pass', 'a crowd on big caps is fine');
  gs = G.gates(rec(), Object.assign({}, s, { tradesPerDay: 292 }), pairs, mcaps);
  assert.equal(gs[2].why, '292 trades a day: a bot you would always trail');
  gs = G.gates(rec(), Object.assign({}, s, { avgSizeUsd: 20 }), pairs, mcaps);
  assert.equal(gs[2].state, 'fail');
  gs = G.gates(rec(), Object.assign({}, s, { medianHoldMin: 0 }), pairs, mcaps);
  assert.equal(gs[2].why, 'median hold under a minute: a latency race');
  gs = G.gates(withRec({ tags: ['mev_bot'] }), s, pairs, mcaps);
  assert.equal(gs[2].state, 'fail');
  assert.equal(G.gates(rec(), { tokens: 0, closed: 0 }, [], {})[2].state, 'none');
  // both reach and cuts failing is said in full
  gs = G.gates(rec(), Object.assign({}, s, { tradesPerDay: 292 }), pairs, mcaps);
  assert.equal(G.verdict(gs).text, 'Watch, do not copy · you cannot get its fills, and it never cuts');
  gs = G.gates(rec(), { tokens: 0, closed: 0 }, [], {});
  assert.equal(G.verdict(gs).text, 'Copy the buys, not the exits · it does not cut losses', 'a failed gate speaks before an unmeasured one');
  gs = G.gates(withRec({ buckets: Object.assign({}, rec().buckets, { ltNeg50: 20 }) }), { tokens: 0, closed: 0 }, [], {});
  assert.equal(G.verdict(gs).text, 'Hold off · 1 of the four gates not measured');
});

test('size cap, record and identity lines, prompt lines', () => {
  assert.equal(G.sizeCap(s), 50, 'half the average buy');
  assert.equal(G.sizeCap(null), null);
  assert.equal(G.recordLine(rec()), '120 tokens · 58% won · realized $8k in 7 days, $150k all-time · 4 over 5×');
  assert.equal(G.identityLine(rec()), 'smart money, KOL · @cowboy_sol · 1.2k followers');
  assert.equal(G.identityLine(withRec({ tags: ['some_new_tag'], twitter: '', followers: 41319 })), 'some new tag · 41k followers');
  const gs = G.gates(rec(), s, pairs, mcaps);
  const lines = G.promptLines(gs, G.verdict(gs), rec());
  assert.equal(lines[0], 'Copy gates from GMGN wallet stats (pass / fail / not measured):');
  assert.equal(lines[4], '- Cuts losses: fail (40% of its tokens down more than 50% (48 of 120): it does not cut)');
  assert.equal(lines[5], 'Rule verdict: Copy the buys, not the exits · it does not cut losses.');
  assert.match(lines[6], /^Record: 120 tokens · 58% won/);
  assert.deepEqual(G.promptLines([], null, null), []);
  // the Wallet report's prompt carries them
  const prompt = R.prompt('Wa11et', s, pairs, mcaps, lines);
  assert.match(prompt, /Rule verdict: Copy the buys, not the exits/);
  assert.ok(prompt.indexOf('Copy gates') < prompt.indexOf('Sample closed trades'));
});
