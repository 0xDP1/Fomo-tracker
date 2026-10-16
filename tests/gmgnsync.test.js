// docs/features/gmgn-home.md: the owner's GMGN wallet from an address or link, GMGN activity paired into trades, the stats tiles.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../gmgnsync.js');
const Stats = require('../stats.js');

const W = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const T0 = 1791700000;
const act = (type, token, minutes, usd, amount, extra) => Object.assign({ event_type: type, token: { address: token, symbol: token.slice(0, 4).toUpperCase() }, timestamp: T0 + minutes * 60, price_usd: 0.001, cost_usd: usd, token_amount: amount, tx_hash: `${type}-${token.slice(0, 3)}-${minutes}` }, extra);

test('parseWalletInput: a bare address or a GMGN wallet link', () => {
  assert.equal(G.parseWalletInput(W), W);
  assert.equal(G.parseWalletInput(`  https://gmgn.ai/sol/address/${W}?tab=activity `), W);
  assert.equal(G.parseWalletInput(`gmgn.ai/sol/wallet/${W}`), W);
  assert.equal(G.parseWalletInput('alice'), null);
  assert.equal(G.parseWalletInput('https://gmgn.ai/sol/token/' + W), null, 'a coin page is not a wallet');
  assert.equal(G.parseWalletInput('0xb0fea7be600c85e2f4fe90821f304bc1578d4444'), null, 'Solana only');
});

test('trades: buys and sells of one token pair into a closed trade in USD; a token only bought is open', () => {
  const rows = [act('buy', 'aaaa1', 0, 100, 1000), act('buy', 'aaaa1', 5, 50, 500), act('sell', 'aaaa1', 30, 240, 1500), act('buy', 'bbbb2', 40, 80, 10)];
  const { closed, open } = G.trades(rows);
  assert.equal(closed.length, 1);
  const t = closed[0];
  assert.deepEqual([t.id, t.token, t.address, t.chain, t.cost, t.proceeds, t.fills, t.source, t.notes, t.tags], ['g_sell-aaa-30', 'AAAA', 'aaaa1', 'Solana', 150, 240, 3, 'gmgn', '', []]);
  assert.deepEqual([t.openedAt, t.closedAt], [new Date((T0) * 1000).toISOString(), new Date((T0 + 1800) * 1000).toISOString()]);
  assert.equal(Stats.enrich(t).pnl, 90, 'the Stats tab reads it like any other trade');
  assert.deepEqual(open.map((p) => [p.token, p.cost, p.qty, p.source]), [['BBBB', 80, 10, 'gmgn']]);
});

test('trades: a sell before any buy is ignored; a later buy after a full exit starts a new trip; notes are kept by id', () => {
  const rows = [act('sell', 'aaaa1', 0, 70, 700), act('buy', 'aaaa1', 10, 100, 1000), act('sell', 'aaaa1', 20, 130, 1000), act('buy', 'aaaa1', 30, 60, 600), act('sell', 'aaaa1', 40, 30, 600)];
  const { closed, open } = G.trades(rows, { 'g_sell-aaa-20': { notes: 'took profit', tags: ['KOL call'] } });
  assert.deepEqual(closed.map((t) => [t.id, t.cost, t.proceeds, t.notes, t.tags]), [['g_sell-aaa-20', 100, 130, 'took profit', ['KOL call']], ['g_sell-aaa-40', 60, 30, '', []]]);
  assert.deepEqual(open, []);
});

test('trades: a partial sell keeps the rest open; a sell-down to 5% or less closes; without amounts a sell run closes at the next buy', () => {
  // 60% sold: open with the remaining 40% of its cost, and the realized proceeds so far
  let r = G.trades([act('buy', 'aaaa1', 0, 100, 1000), act('sell', 'aaaa1', 10, 90, 600)]);
  assert.deepEqual(r.closed, []);
  assert.deepEqual(r.open.map((p) => [p.cost, p.qty, p.realized]), [[40, 400, 90]]);
  // 97% sold: closed
  r = G.trades([act('buy', 'aaaa1', 0, 100, 1000), act('sell', 'aaaa1', 10, 150, 970)]);
  assert.deepEqual(r.closed.map((t) => [t.cost, t.proceeds]), [[100, 150]]);
  assert.deepEqual(r.open, []);
  // no amounts from GMGN: buy, sell, buy = one closed trip and one open
  r = G.trades([act('buy', 'aaaa1', 0, 100, undefined), act('sell', 'aaaa1', 10, 120, undefined), act('buy', 'aaaa1', 20, 50, undefined)]);
  assert.deepEqual(r.closed.map((t) => [t.cost, t.proceeds]), [[100, 120]]);
  assert.deepEqual(r.open.map((p) => [p.cost, p.qty]), [[50, null]]);
  // junk rows and transfers are left out
  r = G.trades([{ event_type: 'transferIn', token: { address: 'aaaa1' }, timestamp: T0, cost_usd: 5 }, act('buy', 'aaaa1', 0, 0, 1), null]);
  assert.deepEqual([r.closed, r.open], [[], []]);
  assert.deepEqual(G.trades(null), { closed: [], open: [] });
});

test('stats: the Home tile numbers from GMGN wallet stats', () => {
  const s = G.stats({ realized_profit: 840, unrealized_profit: 120, bought_cost: 4200, buy: 31, sell: 29, pnl_stat: { token_num: 12, winrate: 0.58 } }, { list: [{ realized_profit: 3100, realized_profit_pnl: 0.2067 }] });
  assert.deepEqual(s, { realized7: 840, roi7: 0.2, unrealized: 120, winRate: 58, tokens: 12, buys: 31, sells: 29, realized30: 3100, roi30: 0.2067 });
  assert.equal(G.stats(null, null), null);
  assert.deepEqual([G.stats([{ realized_profit: '5' }]).realized7, G.stats([{ realized_profit: '5' }]).realized30], [5, null]);
});
