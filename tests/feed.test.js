const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../worker/feed-core.js');

const NOW = Date.parse('2026-10-08T15:00:00Z');
const D = 86400000;
const call = (addr, at, id) => ({ address: addr, chain: 'solana', poster: 'p', at, messageId: id });

test('mergeStore: dedupes by message and address, keeps 3 days, caps at 1000, tracks the last message id', () => {
  let s = F.emptyStore();
  s = F.mergeStore(s, [call('A', NOW - 4 * D, '100'), call('B', NOW - D, '200'), call('B', NOW - D, '200')], ['100', '200'], NOW);
  assert.deepEqual(s.calls.map((c) => c.address), ['B'], 'older than 3 days dropped, duplicate dropped');
  assert.equal(s.lastId, '200');
  s = F.mergeStore(s, [call('C', NOW, '1000')], ['999', '1000'], NOW);
  assert.equal(s.lastId, '1000', 'snowflakes compare by length first');
  const many = Array.from({ length: 1200 }, (_, i) => call('X' + i, NOW, String(2000 + i)));
  assert.equal(F.mergeStore(s, many, many.map((c) => c.messageId), NOW).calls.length, 1000);
  assert.equal(F.mergeStore(s, [], [], NOW).lastId, '1000', 'no new messages keeps the last id');
});

test('callsSince returns calls after a time, oldest first', () => {
  const s = F.mergeStore(F.emptyStore(), [call('B', NOW - 10, '2'), call('A', NOW - 20, '1')], ['1', '2'], NOW);
  assert.deepEqual(F.callsSince(s, NOW - 15).map((c) => c.address), ['B']);
  assert.deepEqual(F.callsSince(s, 0).map((c) => c.address), ['A', 'B']);
});

test('statusFor: Discord answers become feed states', () => {
  assert.equal(F.statusFor(200), 'ok');
  assert.equal(F.statusFor(401), 'token_invalid');
  assert.equal(F.statusFor(403), 'no_access');
  assert.equal(F.statusFor(404), 'channel_not_found');
  assert.equal(F.statusFor(429), 'rate_limited');
  assert.equal(F.statusFor(500), 'discord_error');
});

test('authorized: needs the right key and the app origin', () => {
  assert.equal(F.authorized('secret-key-123', 'secret-key-123'), true);
  assert.equal(F.authorized('secret-key-124', 'secret-key-123'), false);
  assert.equal(F.authorized('', 'secret-key-123'), false);
  assert.equal(F.authorized('x', ''), false, 'a Worker without FEED_KEY serves nobody');
  assert.deepEqual(F.cors('https://0xdp1.github.io', 'https://0xdp1.github.io')['Access-Control-Allow-Origin'], 'https://0xdp1.github.io');
  assert.equal(F.cors('https://evil.example', 'https://0xdp1.github.io')['Access-Control-Allow-Origin'], undefined);
});

test('Worker: polls Discord read-only, stores calls, serves them with the key', async () => {
  const W = (await import('../worker/index.mjs')).default;
  const kv = new Map();
  const env = { DISCORD_TOKEN: 'user-token', FEED_KEY: 'k3y', CHANNEL_ID: '555', ALLOWED_ORIGIN: 'https://app.example', CALLS: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } } };
  const seen = [];
  const realFetch = globalThis.fetch;
  let reply = { status: 200, body: [{ id: '1300000000000000001', timestamp: '2026-10-08T14:58:00.000Z', author: { username: 'alice' }, content: 'ape 7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', embeds: [] }] };
  globalThis.fetch = async (url, opts) => { seen.push({ url: String(url), method: (opts && opts.method) || 'GET', auth: opts && opts.headers && opts.headers.Authorization }); return new Response(JSON.stringify(reply.body), { status: reply.status }); };
  try {
    const waits = [];
    await W.scheduled({}, env, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, 'https://discord.com/api/v10/channels/555/messages?limit=50');
    assert.equal(seen[0].method, 'GET', 'read-only');
    assert.equal(seen[0].auth, 'user-token');
    // second poll asks only for newer messages
    reply = { status: 200, body: [] };
    await W.scheduled({}, env, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits);
    assert.match(seen[1].url, /after=1300000000000000001$/);
    // serving: wrong key refused, right key gets the call
    const ask = (key, origin = 'https://app.example') => W.fetch(new Request('https://w.example/calls?since=0', { headers: { 'x-feed-key': key, Origin: origin } }), env);
    assert.equal((await ask('nope')).status, 401);
    const ok = await ask('k3y');
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://app.example');
    const j = await ok.json();
    assert.equal(j.status, 'ok');
    assert.deepEqual(j.calls.map((c) => [c.address, c.poster]), [['7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', 'alice']]);
    // preflight
    const pre = await W.fetch(new Request('https://w.example/calls', { method: 'OPTIONS', headers: { Origin: 'https://app.example' } }), env);
    assert.equal(pre.status, 204);
    // token rejected by Discord is reported, not thrown
    reply = { status: 401, body: { message: '401: Unauthorized' } };
    await W.scheduled({}, env, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits);
    assert.equal((await (await ask('k3y')).json()).status, 'token_invalid');
  } finally { globalThis.fetch = realFetch; }
});

test('the dashboard copy (worker/discord-feed.js) is built from the current sources', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { bundle } = require('../worker/bundle.js');
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'worker', 'discord-feed.js'), 'utf8'), bundle(), 'run: node worker/bundle.js');
});

test('parseChannels: ids with optional labels, no repeats, at most 10', () => {
  assert.deepEqual(F.parseChannels('111111:first scan, 222222 ,111111:again,abc,333333:price move'), [{ id: '111111', label: 'first scan' }, { id: '222222', label: '222222' }, { id: '333333', label: 'price move' }]);
  assert.deepEqual(F.parseChannels(''), []);
  assert.equal(F.parseChannels(Array.from({ length: 15 }, (_, i) => String(100000 + i)).join(',')).length, 10);
});

test('rollup: the worst channel state wins', () => {
  assert.equal(F.rollup(['ok', 'ok']), 'ok');
  assert.equal(F.rollup(['ok', 'no_access', 'rate_limited']), 'no_access');
  assert.equal(F.rollup(['ok', 'token_invalid']), 'token_invalid');
  assert.equal(F.rollup([]), 'starting');
});

test('mergeStore with a channel keeps progress per channel', () => {
  let s = F.mergeStore(F.emptyStore(), [call('A', NOW, '10')], ['10'], NOW, 'c1');
  s = F.mergeStore(s, [call('B', NOW, '5')], ['5'], NOW, 'c2');
  assert.deepEqual(s.lastIds, { c1: '10', c2: '5' });
  s = F.mergeStore(s, [], ['7'], NOW, 'c2');
  assert.equal(s.lastIds.c2, '7');
  assert.equal(s.lastIds.c1, '10');
});

test('Worker: reads each channel, tags calls, reports the failing channel, carries over old progress', async () => {
  const W = (await import('../worker/index.mjs')).default;
  const kv = new Map([['store', JSON.stringify({ calls: [], lastId: '900000', status: 'ok' })]]);
  const env = { DISCORD_TOKEN: 't', FEED_KEY: 'k', CHANNEL_ID: '111111:first scan,222222:price move,333333:group traction', ALLOWED_ORIGIN: 'https://app.example', CALLS: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } } };
  const A1 = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', A2 = '5tHXq7rK3Zp9mWvN2cYdLfB8xJgQeR4uTsA6nVhPo1Ck';
  const msg = (id, text) => ({ id, timestamp: '2026-10-08T14:58:00.000Z', author: { username: 'bot' }, content: text, embeds: [] });
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    if (url.includes('/111111/')) return new Response(JSON.stringify([msg('1300000000000000001', 'new ' + A1)]), { status: 200 });
    if (url.includes('/222222/')) return new Response(JSON.stringify({ message: 'Missing Access' }), { status: 403 });
    return new Response(JSON.stringify([msg('1300000000000000009', 'also ' + A1 + ' and ' + A2)]), { status: 200 });
  };
  try {
    const waits = [];
    await W.scheduled({}, env, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits);
    assert.match(seen[0], /channels\/111111\/messages\?limit=50&after=900000$/, 'old progress carried over to the first channel');
    assert.match(seen[1], /channels\/222222\/messages\?limit=50$/);
    assert.equal(seen.length, 3);
    const res = await W.fetch(new Request('https://w.example/calls?since=0', { headers: { 'x-feed-key': 'k', Origin: 'https://app.example' } }), env);
    const j = await res.json();
    assert.equal(j.status, 'no_access', 'worst channel wins');
    assert.deepEqual(j.channels.map((c) => [c.label, c.status]), [['first scan', 'ok'], ['price move', 'no_access'], ['group traction', 'ok']]);
    assert.deepEqual(j.calls.map((c) => [c.channel, c.address.slice(0, 4)]).sort(), [['first scan', '7GCi'], ['group traction', '5tHX'], ['group traction', '7GCi']]);
    // second round: each channel asks only for what is newer than its own last message
    seen.length = 0;
    await W.scheduled({}, env, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits);
    assert.match(seen[0], /111111.*after=1300000000000000001$/);
    assert.match(seen[2], /333333.*after=1300000000000000009$/);
    // a rejected token stops the round after the first channel
    seen.length = 0;
    globalThis.fetch = async (url) => { seen.push(String(url)); return new Response('{}', { status: 401 }); };
    await W.scheduled({}, env, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits);
    assert.equal(seen.length, 1);
    const j2 = await (await W.fetch(new Request('https://w.example/calls?since=0', { headers: { 'x-feed-key': 'k', Origin: 'https://app.example' } }), env)).json();
    assert.equal(j2.status, 'token_invalid');
  } finally { globalThis.fetch = realFetch; }
});
