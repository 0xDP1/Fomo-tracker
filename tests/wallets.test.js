const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../wallets.js');
const fx = (name) => require('./fixtures/' + name + '.json');

const NOW = 1791600000000;
const MIN = 60000, H = 3600000, D = 24 * H;
const pad = (s) => (s + '1'.repeat(44)).slice(0, 44);

test('candidates: drops pools, exchanges, bundlers, insiders, snipers, dev wallets, bots and losers; keeps the top 8 by profit', () => {
  const memBots = new Set([pad('MemBot')]);
  const c = W.candidates(fx('gmgn-top-traders').list, (a) => memBots.has(a));
  assert.deepEqual(c.map((x) => x.address), ['Good1', 'Good2', 'Good3', 'Good4', 'Good5', 'Good6', 'Good7', 'Good8'].map(pad));
  assert.equal(c[0].profit, 15000);
  assert.equal(W.candidates(fx('gmgn-top-traders').list).some((x) => x.address === pad('MemBot')), true, 'only a known bot is dropped');
  assert.deepEqual(W.candidates(null), []);
});

test('fromStats: GMGN numbers (strings too), and the profit ratio worked out when pnl is missing', () => {
  assert.deepEqual(W.fromStats(fx('gmgn-wallet-stats-30d')), { profit: 4200.5, unrealized: 300, winRate: 0.52, spent: 18000, buys: 140, sells: 120, pnl: 0.2334 });
  assert.equal(W.fromStats([{ realized_profit: 500, total_cost: 1000 }]).pnl, 0.5, 'batch reply, pnl from profit / cost');
  assert.equal(W.fromStats({ data: { winrate: 0.4 } }).winRate, 0.4, 'wrapped in data');
  assert.equal(W.fromStats(null), null);
});

test('fromActivity: 1 d and 3 d profit and win rate from sells, transfers left out, hold time and last 5 trades', () => {
  const a = W.fromActivity(fx('gmgn-wallet-activity'), NOW, 100);
  // 1 d: BONK +120, POPCAT -60. 3 d adds MEW +500 (a row with `type` instead of `event_type`). OLD is 4 days ago.
  assert.deepEqual(a.d1, { profit: 60, sells: 2, wins: 1, winRate: 0.5, partial: false });
  assert.deepEqual(a.d3, { profit: 560, sells: 3, wins: 2, winRate: 2 / 3, partial: false });
  assert.equal(a.trades, 9, 'the transfer is not a trade');
  // holds: OLD 3m, POPCAT 10m, MEW 1h, BONK 21h -> median of 10m and 1h
  assert.equal(a.holdMs, 35 * MIN);
  assert.equal(a.holdN, 4);
  assert.deepEqual(a.last.map((t) => `${t.type} ${t.symbol}${t.profit != null ? ' ' + t.profit : ''}`), ['buy WIF', 'sell BONK 120', 'sell POPCAT -60', 'buy POPCAT', 'buy BONK']);
  assert.equal(a.lastAt, NOW - 2 * H);
  assert.equal(a.complete, true);
});

test('fromActivity: a full page that does not reach back 3 days marks the 3 d figure partial', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ event_type: i % 2 ? 'buy' : 'sell', token: { address: 'T' + Math.floor(i / 2) }, timestamp: (NOW - (i + 1) * 2 * H) / 1000, cost_usd: 100, buy_cost_usd: 80 }));
  const a = W.fromActivity({ activities: rows, next: 'cursor' }, NOW, 20);
  assert.equal(a.d1.partial, false, '40 hours read covers the last day');
  assert.equal(a.d3.partial, true);
  assert.equal(a.reachMs, 40 * H);
  assert.equal(a.complete, false);
  const short = W.fromActivity({ activities: rows.slice(0, 5) }, NOW, 20);
  assert.equal(short.d3.partial, false, 'a page that is not full is the whole history');
  assert.equal(W.fromActivity({ activities: [] }, NOW, 20).holdMs, null);
});

test('fromHoldings: sums the value held', () => {
  assert.deepEqual(W.fromHoldings(fx('gmgn-wallet-holdings')), { usd: 1500.5, n: 2 });
  assert.equal(W.fromHoldings({}), null);
});

const good = () => ({
  chain: 'sol', now: NOW, sol: 3,
  s7: W.fromStats(fx('gmgn-wallet-stats-7d')),
  s30: W.fromStats(fx('gmgn-wallet-stats-30d')),
  act: W.fromActivity(fx('gmgn-wallet-activity'), NOW, 100),
  heldUsd: 1500,
});
const status = (card) => Object.fromEntries(W.checklist(card).checks.map((c) => [c.key, c.status]));
const with30 = (o) => { const c = good(); c.s30 = Object.assign({}, c.s30, o); return c; };

test('checklist: a good wallet passes every check', () => {
  const r = W.checklist(good());
  assert.equal(r.pass, true, JSON.stringify(r.checks.filter((c) => c.status !== 'pass')));
  assert.equal(r.failed, 0);
  assert.equal(r.checks.length, 9);
});

test('checklist: each threshold passes at the edge and fails just under it', () => {
  assert.equal(status(with30({ buys: 20 })).trades, 'pass');
  assert.equal(status(with30({ buys: 19 })).trades, 'fail');
  assert.equal(status(with30({ winRate: 0.45 })).wins, 'pass');
  assert.equal(status(with30({ winRate: 0.449 })).wins, 'fail');
  assert.equal(status(with30({ profit: 1000 })).money, 'pass');
  assert.equal(status(with30({ profit: 999 })).money, 'fail');
  assert.equal(status(with30({ pnl: 0 })).money, 'fail', 'got back no more than it spent');
  assert.equal(status(with30({ spent: 2000 })).size, 'pass');
  assert.equal(status(with30({ spent: 1999 })).size, 'fail');
  assert.equal(status(with30({ buys: 4500, sells: 4499 })).bot, 'pass', '299.97 trades a day');
  assert.equal(status(with30({ buys: 4500, sells: 4500 })).bot, 'fail', '300 a day');
  assert.equal(status(Object.assign(good(), { sol: 1 })).balance, 'pass');
  assert.equal(status(Object.assign(good(), { sol: 0.99 })).balance, 'fail');
  const act = (o) => Object.assign(good(), { act: Object.assign({}, good().act, o) });
  assert.equal(status(act({ holdMs: 5 * MIN })).copyable, 'pass');
  assert.equal(status(act({ holdMs: 5 * MIN - 1 })).copyable, 'fail');
  assert.equal(status(act({ lastAt: NOW - 3 * D })).active, 'pass');
  assert.equal(status(act({ lastAt: NOW - 3 * D - 1 })).active, 'fail');
});

test('checklist: steady needs 3 of the 4 ranges in profit; unread ranges are unknown, not good news', () => {
  const c = good();
  c.act = Object.assign({}, c.act, { d1: { profit: -10, sells: 1, partial: false } });
  assert.equal(status(c).steady, 'pass', '3 d, 7 d and 30 d up');
  c.s7 = Object.assign({}, c.s7, { profit: -1 });
  assert.equal(status(c).steady, 'fail', 'only 3 d and 30 d up');
  const quiet = good();
  quiet.act = Object.assign({}, quiet.act, { d1: { profit: 0, sells: 0, partial: false }, d3: { profit: 50, sells: 1, partial: true } });
  assert.equal(status(quiet).steady, 'unknown', 'no sells in a day and a partial 3 d read: 2 up, 2 unknown');
});

test('checklist: missing data is unknown and blocks Track; holdings on other chains are skipped when GMGN refuses them', () => {
  const none = W.checklist({ chain: 'sol', now: NOW, s7: null, s30: null, act: null, sol: null, heldUsd: null });
  assert.equal(none.pass, false);
  assert.equal(none.checks.every((c) => c.status === 'unknown'), true, JSON.stringify(none.checks.map((c) => c.status)));
  const evm = Object.assign(good(), { chain: 'base', sol: null, heldUsd: null });
  assert.equal(status(evm).balance, 'skip');
  assert.equal(W.checklist(evm).pass, true);
  assert.equal(status(Object.assign(good(), { chain: 'bsc', heldUsd: 199 })).balance, 'fail');
  assert.equal(status(Object.assign(good(), { chain: 'bsc', heldUsd: 200 })).balance, 'pass');
  const idle = Object.assign(good(), { act: W.fromActivity({ activities: [] }, NOW, 100) });
  assert.equal(status(idle).active, 'fail', 'the whole history was read and there are no trades');
});

test('matchTracked: tracked wallets on a coin with buy, sell or hold direction and the conviction line', () => {
  const sec = NOW / 1000;
  const tracked = [{ address: 'A', label: 'alpha' }, { address: 'B' }, { address: 'C' }, { address: 'Z' }];
  const holders = [{ address: 'A', start_holding_at: sec - 600, sell_amount_percentage: 0.2 }, { address: 'B', start_holding_at: sec - 1800, sell_amount_percentage: 0 }, { address: 'X' }];
  const m = W.matchTracked(tracked.slice(0, 2), holders, [], NOW);
  assert.equal(m.buying, 2);
  assert.equal(m.line, '2 tracked wallets in this · both bought in the last hour, still holding 90%');
  const traders = [{ address: 'C', start_holding_at: sec - 5 * H / 1000, sell_amount_percentage: 0.8 }, { address: 'A', sell_amount_percentage: 0.9 }];
  const all = W.matchTracked(tracked, holders, traders, NOW);
  assert.deepEqual([all.buying, all.selling, all.holding, all.n], [2, 1, 0, 3], 'a holder row wins over the same wallet\'s trader row');
  assert.equal(all.line, '3 tracked wallets in this · 2 bought in the last hour, still holding 90% · 1 sold most of it');
  assert.equal(W.matchTracked(tracked, [], [], NOW).line, null);
  assert.equal(W.direction({ start_holding_at: sec - 2 * H / 1000, sell_amount_percentage: 0.1 }, NOW).dir, 'holding', 'in from earlier');
  assert.equal(W.direction({ start_holding_at: sec - 60, sell_amount_percentage: 0.5 }, NOW).dir, 'selling', 'sold half: selling even if new');
  assert.equal(W.matchTracked([{ address: 'A' }], [holders[0]], [], NOW).line, '1 tracked wallet in this · bought in the last hour, still holding 80%');
});
