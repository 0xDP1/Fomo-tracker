const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../calls.js');

const SOL1 = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr';
const SOL2 = 'HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC';
const PUMP = '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump';
const EVM = '0x4bc1782fafb967834e0e75947ba15113e48fc70e';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const NOW = Date.parse('2026-10-08T15:00:00Z');

test('extractCalls: copied Discord messages keep the poster of each address', () => {
  const text = [
    'alpha_hunter — Today at 2:41 PM',
    `ape this ${SOL1} lfg`,
    `also https://dexscreener.com/solana/${SOL2}`,
    'BigWhale — Today at 2:44 PM',
    `pump.fun/coin/${PUMP}`,
    `base play ${EVM}`,
    `stable ${USDC} ignore`,
    'alpha_hunter — Today at 2:50 PM',
    `${SOL1} again`,
  ].join('\n');
  const calls = C.extractCalls(text, NOW);
  assert.deepEqual(calls.map((c) => [c.address, c.chain, c.poster]), [
    [SOL1, 'solana', 'alpha_hunter'], [SOL2, 'solana', 'alpha_hunter'], [PUMP, 'solana', 'BigWhale'], [EVM, 'evm', 'BigWhale'], [SOL1, 'solana', 'alpha_hunter'],
  ]);
  assert.ok(calls.every((c) => c.at === NOW));
});

test('extractCalls: other copy formats, unknown posters and noise', () => {
  assert.deepEqual(C.extractCalls(`[3:04 PM] Degen Dan: ${SOL1}`, NOW).map((c) => c.poster), ['Degen Dan']);
  assert.deepEqual(C.extractCalls(`just ${SOL2}`, NOW).map((c) => c.poster), ['unknown']);
  assert.deepEqual(C.extractCalls('nothing here, https://example.com/abc and 0x1234', NOW), []);
  assert.deepEqual(C.extractCalls(`${EVM.toUpperCase().replace('0X', '0x')}`, NOW)[0].address, EVM, 'EVM addresses are lowercased');
  assert.deepEqual(C.extractCalls(`(${SOL1}).`, NOW).length, 1, 'brackets and punctuation around an address');
  assert.deepEqual(C.extractCalls(`xx${SOL1}yy`, NOW).length, 0, 'glued to other letters it is not a clean address');
});

test('fromDiscordMessages: API messages including bot embeds', () => {
  const msgs = [
    { id: '1300000000000000002', timestamp: '2026-10-08T14:59:00.000Z', author: { username: 'bob', global_name: 'Bob' }, content: `gm ${SOL1}`, embeds: [] },
    { id: '1300000000000000001', timestamp: '2026-10-08T14:58:00.000Z', author: { username: 'alertbot' }, content: '', embeds: [{ title: 'New call', description: `CA: ${PUMP}`, fields: [{ name: 'Chart', value: `https://dexscreener.com/base/${EVM}` }, { name: 'Token', value: EVM }] }] },
  ];
  const calls = C.fromDiscordMessages(msgs);
  assert.deepEqual(calls.map((c) => [c.address, c.poster, c.messageId]), [[PUMP, 'alertbot', '1300000000000000001'], [EVM, 'alertbot', '1300000000000000001'], [SOL1, 'Bob', '1300000000000000002']], 'oldest first; the chart link holds a pool address and is skipped, the token field is kept');
  assert.equal(calls[2].at, Date.parse('2026-10-08T14:59:00.000Z'));
});

test('addToQueue: one entry per coin with mentions, posters and the first caller', () => {
  let q = {};
  q = C.addToQueue(q, [{ address: SOL1, chain: 'solana', poster: 'a', at: 1 }, { address: SOL1, chain: 'solana', poster: 'b', at: 3 }, { address: SOL2, chain: 'solana', poster: 'b', at: 2 }]);
  q = C.addToQueue(q, [{ address: SOL1, chain: 'solana', poster: 'a', at: 5 }]);
  assert.deepEqual([q[SOL1].mentions, q[SOL1].posters, q[SOL1].firstPoster, q[SOL1].firstAt, q[SOL1].lastAt], [3, ['a', 'b'], 'a', 1, 5]);
  assert.equal(q[SOL2].firstPoster, 'b');
});

test('isFresh and rank: age filter, then safest verdict, then newest', () => {
  const H = 3600000;
  assert.equal(C.isFresh({ launchedAt: NOW - 5 * H }, NOW, 6 * H), true);
  assert.equal(C.isFresh({ launchedAt: NOW - 7 * H }, NOW, 6 * H), false);
  assert.equal(C.isFresh({ launchedAt: null }, NOW, 6 * H), false);
  const items = [
    { address: 'a', verdict: 'Caution', launchedAt: NOW - 1 * H },
    { address: 'b', verdict: 'Looks OK', launchedAt: NOW - 3 * H },
    { address: 'c', verdict: 'Looks OK', launchedAt: NOW - 2 * H },
    { address: 'd', verdict: 'Walk away', launchedAt: NOW - 0.1 * H },
    { address: 'e', verdict: null, launchedAt: NOW - 0.5 * H },
  ];
  assert.deepEqual(C.rank(items).map((x) => x.address), ['c', 'b', 'a', 'e', 'd']);
});

test('callerStats: hit rate and average return per first caller, priced marks only', () => {
  const book = [
    { poster: 'a', ret: { '1h': 0.5, '6h': 1.0, '24h': 2.0 } },
    { poster: 'a', ret: { '1h': -0.2, '6h': -0.5, '24h': 'missed' } },
    { poster: 'b', ret: { '1h': -0.1 } },
    { poster: 'b', ret: {} },
  ];
  const s = C.callerStats(book);
  assert.deepEqual(s.map((r) => r.poster), ['a', 'b']);
  assert.deepEqual([s[0].calls, s[0].h6.n, s[0].h6.up, s[0].h6.avg, s[0].h24.n, s[0].h24.avg], [2, 2, 1, 0.25, 1, 2.0]);
  assert.deepEqual([s[1].calls, s[1].h1.n, s[1].h1.up, s[1].h6.n, s[1].h6.avg], [2, 1, 0, 0, null]);
});

test('addToQueue: remembers which channels a coin was posted in', () => {
  const q = C.addToQueue({}, [
    { address: 'AAA', chain: 'solana', poster: 'x', at: 1, channel: 'first scan' },
    { address: 'AAA', chain: 'solana', poster: 'y', at: 2, channel: 'price move' },
    { address: 'AAA', chain: 'solana', poster: 'z', at: 3, channel: 'first scan' },
    { address: 'BBB', chain: 'solana', poster: 'x', at: 1 },
  ]);
  assert.deepEqual(q.AAA.channels, ['first scan', 'price move']);
  assert.equal(q.AAA.mentions, 3);
  assert.deepEqual(q.BBB.channels, []);
  const later = C.addToQueue(q, [{ address: 'AAA', chain: 'solana', poster: 'w', at: 4, channel: 'group traction' }]);
  assert.deepEqual(later.AAA.channels, ['first scan', 'price move', 'group traction']);
  assert.deepEqual(q.AAA.channels, ['first scan', 'price move'], 'the old queue is not changed');
});

test('addToQueue: remembers whether a coin came from Discord, Telegram or both', () => {
  let q = C.addToQueue({}, [
    { address: 'AAA', chain: 'solana', poster: 'x', at: 1, channel: 'first scan' },
    { address: 'BBB', chain: 'solana', poster: 'y', at: 2, channel: 'Alpha calls', source: 'telegram' },
    { address: 'CCC', chain: 'solana', poster: 'z', at: 3 },
  ]);
  assert.deepEqual([q.AAA.sources, q.BBB.sources, q.CCC.sources], [['discord'], ['telegram'], []], 'pasted calls have no source');
  q = C.addToQueue(q, [{ address: 'AAA', chain: 'solana', poster: 'w', at: 4, channel: 'Alpha calls', source: 'telegram' }]);
  assert.deepEqual(q.AAA.sources, ['discord', 'telegram']);
  // saved before sources were kept
  assert.deepEqual(C.sourcesOf({ channels: ['first scan'] }), ['discord']);
  assert.deepEqual(C.sourcesOf({ channels: [] }), []);
  const old = C.addToQueue({ DDD: { address: 'DDD', chain: 'solana', mentions: 1, posters: ['a'], channels: ['first scan'], firstPoster: 'a', firstAt: 1, lastAt: 1 } }, [{ address: 'DDD', chain: 'solana', poster: 'b', at: 2, channel: 'Alpha calls', source: 'telegram' }]);
  assert.deepEqual(old.DDD.sources, ['discord', 'telegram']);
});

// Bug 9: the Call queue's move since the call compared against a stale market cap and hid small moves.
test('moveSince: the newest reading against the call, as percent and multiple', () => {
  const NOW = 1791600000000;
  const base = { callMcap: 120000, mcap: 130000, dexAt: NOW - 30 * 60000 };
  assert.deepEqual(C.moveSince(Object.assign({}, base, { live: { mcap: 310000, at: NOW - 60000 } })), { from: 120000, to: 310000, pct: 158.33333333333331, x: 2.5833333333333335, at: NOW - 60000 });
  // Falls back to the first lookup when there is no live reading yet; a small move is still reported.
  const m = C.moveSince(Object.assign({}, base, { mcap: 122400 }));
  assert.equal(m.to, 122400); assert.equal(m.at, NOW - 30 * 60000); assert.equal(Math.round(m.pct), 2);
  // A drop.
  assert.equal(Math.round(C.moveSince(Object.assign({}, base, { live: { mcap: 44400, at: NOW } })).pct), -63);
  // An alert newer than the live reading wins; its time is the alert's.
  const al = C.moveSince(Object.assign({}, base, { fromAlert: true, snapAt: NOW, mcap: 200000, live: { mcap: 310000, at: NOW - 60000 } }));
  assert.equal(al.to, 200000); assert.equal(al.at, NOW);
  assert.equal(C.moveSince({ mcap: 100 }), null, 'no call market cap');
  assert.equal(C.moveSince({ callMcap: 100 }), null, 'no reading');
});

test('liveMcap: FDV first, the same basis as the alert and the caller mention', () => {
  assert.equal(C.liveMcap({ fdv: 500, marketCap: 400 }), 500);
  assert.equal(C.liveMcap({ marketCap: 400 }), 400);
  assert.equal(C.liveMcap(null), null);
});
