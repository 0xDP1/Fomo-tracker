// docs/features/worker-alerts.md: the Worker's pricing round, its Telegram messages, and the app folding the Worker's
// track into its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../worker/alerts-core.js');
const R = require('../recent.js');

const NOW = 1791600000000;
const M = 60000;
const call = (address, at, extra) => Object.assign({ address, chain: 'solana', poster: 'alice', at, messageId: 'tg:1:' + at, channel: 'Man Cave', source: 'telegram' }, extra);
const pair = (address, mcap, extra) => Object.assign({ baseToken: { address }, marketCap: mcap, liquidity: { usd: 20000 } }, extra);

test('queueFrom: one entry per address with the first poster, the alert price and the channels; old calls left out', () => {
  const q = A.queueFrom([
    call('A', NOW - 10 * M), // a person's post: no price
    call('A', NOW - 9 * M, { poster: 'Rick', symbol: 'AAA', mcap: 50000, snap: { fdv: 50000 } }),
    call('B', NOW - 30 * 3600000, { symbol: 'OLD', mcap: 1000 }), // yesterday
    call('C', NOW - M, { poster: 'bob', channel: 'Discord', source: 'discord', snap: { fdv: 8000 } }),
  ], NOW);
  assert.deepEqual(Object.keys(q).sort(), ['A', 'C']);
  assert.deepEqual([q.A.firstPoster, q.A.firstAt, q.A.symbol, q.A.callMcap, q.A.channels], ['alice', NOW - 10 * M, 'AAA', 50000, ['Man Cave']]);
  assert.deepEqual([q.C.callMcap, q.C.sources], [8000, ['discord']]);
});

test('bestPairs and batches: the deepest pool per token, 30 addresses a request', () => {
  const best = A.bestPairs([pair('A', 1, { liquidity: { usd: 5 } }), pair('A', 2, { liquidity: { usd: 50 } }), { baseToken: {} }]);
  assert.equal(best.A.marketCap, 2);
  assert.deepEqual(A.batches(Array.from({ length: 61 }, (_, i) => 'x' + i)).map((b) => b.length), [30, 30, 1]);
});

test('round: 2× and 4× once each from the call price, move and volume alerts, nothing under $10k', () => {
  const q = A.queueFrom([call('A', NOW - 10 * M, { symbol: 'AAA', mcap: 50000 }), call('S', NOW - 5 * M, { symbol: 'SMOL', mcap: 2000 })], NOW);
  let r = A.round({}, q, { A: pair('A', 60000), S: pair('S', 6000) }, NOW);
  assert.deepEqual(r.alerts, []);
  assert.deepEqual([r.track.A.base, r.track.A.last, r.track.A.peak], [50000, 60000, 60000]);
  r = A.round(r.track, q, { A: pair('A', 110000), S: pair('S', 9000) }, NOW + 5 * M);
  assert.deepEqual(r.alerts.map((a) => [a.address, a.level]), [['A', 2]]);
  assert.deepEqual(r.alerts, A.round(r.track, q, { A: pair('A', 120000) }, NOW + 10 * M).alerts.length ? [] : r.alerts, 'not again at 2.4×');
  r = A.round(r.track, q, { A: pair('A', 210000, { priceChange: { m5: 45 }, volume: { m5: 9000, h1: 20000 } }) }, NOW + 15 * M);
  assert.deepEqual(r.alerts.map((a) => [a.address, a.level]), [['A', 4]], 'the level alert wins over the move alert on the same coin');
  r = A.round(r.track, q, { A: pair('A', 200000, { priceChange: { m5: 45 }, volume: { m5: 9000, h1: 20000 } }) }, NOW + 20 * M);
  assert.deepEqual(r.alerts.map((a) => [a.address, a.kind]), [['A', 'move']]);
  r = A.round(r.track, q, { A: pair('A', 200000, { priceChange: { m5: 45 }, volume: { m5: 9000, h1: 20000 } }) }, NOW + 25 * M);
  assert.deepEqual(r.alerts, [], 'one move alert per 30 minutes');
});

test('changed: a new peak or alert is worth a storage write, a new "last" is not', () => {
  const a = { A: { base: 1, last: 2, peak: 2, alerted: [] } };
  assert.equal(A.changed(a, { A: { base: 1, last: 3, peak: 2, alerted: [] } }), false);
  assert.equal(A.changed(a, { A: { base: 1, last: 3, peak: 3, alerted: [] } }), true);
  assert.equal(A.changed(a, { A: { base: 1, last: 2, peak: 2, alerted: [2] } }), true);
  assert.equal(A.changed(undefined, {}), false);
});

test('message: plain text with the symbol, the move, who called it and the address', () => {
  const entry = { symbol: 'AAA', firstPoster: 'alice', channels: ['Man Cave'], firstAt: NOW - 40 * M };
  const rec = { base: 50000, last: 104000 };
  assert.equal(A.message({ address: 'MintA', symbol: 'AAA', level: 2 }, rec, entry, NOW), '🚀 AAA 2× since the call ($50.0k → $104.0k) · alice in Man Cave, called 40m ago\nMintA');
  assert.equal(A.message({ address: 'MintA', kind: 'move', change: 45.2, vol5: 9000, mcap: 200000 }, rec, entry, NOW), '📈 AAA +45% in 5 min on $9.0k · mcap $200.0k · alice in Man Cave, called 40m ago\nMintA');
  assert.match(A.message({ address: 'MintA', kind: 'volume', vol5: 20000, pace: 4.04, mcap: 1.5e6 }, rec, null, NOW), /^📊 MintA \$20\.0k traded in 5 min, 4\.0× the hour's pace · mcap \$1\.50M\nMintA$/);
});

test('chatIdFrom: the newest private chat that wrote to the bot; remember keeps the last 50', () => {
  assert.equal(A.chatIdFrom({ result: [{ message: { chat: { id: 11, type: 'private' } } }, { message: { chat: { id: -500, type: 'group' } } }, { message: { chat: { id: 22, type: 'private' } } }] }), '22');
  assert.equal(A.chatIdFrom([]), null);
  assert.equal(A.remember(Array.from({ length: 50 }, (_, i) => ({ at: i })), { at: 99 }).length, 50);
});

test('mergeRemote: the Worker peak wins when higher, sent alerts count as shown, unknown calls come in whole', () => {
  const local = { A: { base: 50000, baseAt: NOW, baseFrom: 'candles', last: 60000, peak: 70000, peakAt: NOW, alerted: [] }, B: { base: null, last: null, peak: null, alerted: [] } };
  const remote = { A: { base: 48000, last: 110000, peak: 120000, peakAt: NOW + M, alerted: [2], moveAlertAt: NOW }, B: { base: 9000, baseAt: NOW - M, last: 9500, peak: 9500, alerted: [] }, C: { base: 1, last: 5, peak: 5, alerted: [2, 4] } };
  const m = R.mergeRemote(local, remote);
  assert.deepEqual([m.A.base, m.A.peak, m.A.peakAt, m.A.alerted, m.A.moveAlertAt, m.A.last], [50000, 120000, NOW + M, [2], NOW, 60000], 'own candle base kept, higher peak taken, last untouched');
  assert.deepEqual([m.B.base, m.B.baseAt], [9000, NOW - M], 'a base this device had none of');
  assert.deepEqual(m.C.alerted, [2, 4]);
  assert.equal(R.mergeRemote(local, null).A.peak, 70000);
});
