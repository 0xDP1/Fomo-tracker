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
  const kv = new Map([['store3', JSON.stringify({ calls: [], lastId: '900000', status: 'ok' })]]);
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

test('Worker: keeps a directory of callers from alerts and serves only the ones changed since', async () => {
  const W = (await import('../worker/index.mjs')).default;
  const alerts = require('./fixtures/alerts.json');
  const kv = new Map();
  const env = { DISCORD_TOKEN: 't', FEED_KEY: 'k', CHANNEL_ID: '777777:price move', ALLOWED_ORIGIN: 'https://app.example', CALLS: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } } };
  const realFetch = globalThis.fetch;
  let batch = [alerts.price_move_13, alerts.first_scan];
  globalThis.fetch = async () => new Response(JSON.stringify(batch), { status: 200 });
  const ask = async (qs) => (await W.fetch(new Request('https://w.example/calls?' + qs, { headers: { 'x-feed-key': 'k', Origin: 'https://app.example' } }), env)).json();
  try {
    const waits = [];
    await W.scheduled({}, env, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits);
    let j = await ask('since=0&csince=0');
    assert.deepEqual(j.calls.map((c) => [c.poster, c.address.slice(0, 4)]).sort(), [['chillz05', '6KDp'], ['mossadsleeper', '8vYJ']], 'callers, not the bot, and only the real contracts');
    assert.equal(Object.keys(j.callers).length, 11);
    assert.deepEqual([j.callers.mossadsleeper.winRate, j.callers.mossadsleeper.medal, j.callers.chillz05.winRate], [50, 'silver', 44]);
    assert.ok(j.now > 0);
    // nothing changed since the last answer
    assert.deepEqual(Object.keys((await ask('since=0&csince=' + j.now)).callers), []);
    // the same caller appears again later with a new win rate: only the profiles that changed come back
    await new Promise((r) => setTimeout(r, 5));
    const later = JSON.parse(JSON.stringify(alerts.group_traction)); later.id = '1558400000000000000';
    later.embeds[1].description = later.embeds[1].description.replace('[rinaut]', '[mossadsleeper]').replace('<t:1791609206:R>', '<t:1791700000:R>').replace('· 🥈· 50% · 30d', '· 🥇· 66% · 30d');
    batch = [later];
    await W.scheduled({}, env, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits);
    j = await ask('since=0&csince=' + j.now);
    assert.deepEqual(Object.keys(j.callers).sort(), ['mossadsleeper', 'shredzwins1'], 'the returning caller plus a caller seen for the first time; nobody else');
    assert.deepEqual([j.callers.mossadsleeper.winRate, j.callers.mossadsleeper.medal, j.callers.mossadsleeper.calls], [66, 'gold', 5]);
  } finally { globalThis.fetch = realFetch; }
});

// ---- on-demand mode: no schedule, Discord is read when the app asks ----
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const addrFor = (i) => { let s = ''; let n = i + 12345; for (let k = 0; k < 44; k++) { s += B58[(n * (k + 7) + k * k) % 58]; n = (n * 31 + 17) % 1000003; } return s; };
const mkKv = () => { const m = new Map(); const kv = { puts: 0, get: async (k) => m.get(k) ?? null, put: async (k, v) => { kv.puts++; m.set(k, v); } }; return kv; };
const mkMsg = (n) => ({ id: String(1300000000000000000n + BigInt(n)), timestamp: '2026-10-08T14:58:00.000Z', author: { username: 'u' + (n % 3) }, content: 'ape ' + addrFor(n), embeds: [] });

test('on-demand: a request reads Discord, is reused for 30 seconds, and writes nothing when nothing changed', async () => {
  const W = (await import('../worker/index.mjs')).default;
  const kv = mkKv();
  const env = { DISCORD_TOKEN: 't', FEED_KEY: 'k', CHANNEL_ID: '111111:a', ALLOWED_ORIGIN: 'https://app.example', CALLS: kv };
  let reads = 0, page = [mkMsg(1)];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { reads++; return new Response(JSON.stringify(page), { status: 200 }); };
  const ask = async () => (await W.fetch(new Request('https://w.example/calls?since=0', { headers: { 'x-feed-key': 'k', Origin: 'https://app.example' } }), env)).json();
  try {
    let j = await ask();
    assert.equal(reads, 1, 'the first request reads Discord');
    assert.equal(j.calls.length, 1);
    await ask();
    assert.equal(reads, 1, 'a second request within 30 seconds reuses the answer');
    env.MIN_GAP_MS = '0';
    page = [];
    const putsBefore = kv.puts;
    j = await ask();
    assert.equal(reads, 2, 'after the gap it reads again');
    assert.equal(kv.puts, putsBefore, 'nothing new, nothing saved');
    assert.equal(j.calls.length, 1);
    page = [mkMsg(2)];
    j = await ask();
    assert.equal(j.calls.length, 2);
    assert.ok(kv.puts > putsBefore, 'new messages are saved');
  } finally { globalThis.fetch = realFetch; }
});

test('on-demand: catches up on everything posted while the app was closed, page by page', async () => {
  const W = (await import('../worker/index.mjs')).default;
  const kv = mkKv();
  const env = { DISCORD_TOKEN: 't', FEED_KEY: 'k', CHANNEL_ID: '111111:a', ALLOWED_ORIGIN: 'https://app.example', MIN_GAP_MS: '0', CALLS: kv };
  let newest = 120;
  const urls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    const after = (String(url).match(/after=(\d+)/) || [])[1];
    const from = after ? Number(BigInt(after) - 1300000000000000000n) + 1 : Math.max(1, newest - 49);
    const to = Math.min(newest, from + 49);
    const out = []; for (let n = to; n >= from; n--) out.push(mkMsg(n)); // newest first, like Discord
    return new Response(JSON.stringify(out), { status: 200 });
  };
  const ask = async () => (await W.fetch(new Request('https://w.example/calls?since=0', { headers: { 'x-feed-key': 'k', Origin: 'https://app.example' } }), env)).json();
  try {
    let j = await ask();
    assert.equal(j.calls.length, 50, 'the first read takes the latest 50 and does not page back');
    assert.equal(urls.length, 1);
    newest = 250; urls.length = 0;
    j = await ask();
    assert.equal(urls.length, 3, 'three pages: 121-170, 171-220, 221-250');
    assert.equal(j.calls.length, 50 + 130, 'every message posted while closed is kept');
    assert.match(urls[1], /after=1300000000000000170$/);
    // a huge gap stops at 10 pages instead of reading forever
    newest = 2000; urls.length = 0;
    await ask();
    assert.equal(urls.length, 10);
  } finally { globalThis.fetch = realFetch; }
});

// ---- GMGN read-only proxy ----
test('gmgnRequest: only the five read endpoints, only their parameters, valid chains and addresses', () => {
  const A = '8vYJgiQPkpDtbWkDy1wyYDcUq3D9fUXVJUtt6aNEpump';
  const q = (o) => new URLSearchParams(o);
  assert.deepEqual(F.gmgnRequest('/gmgn/market/token_top_traders', q({ chain: 'sol', address: A, limit: '50', order_by: 'profit', evil: 'x' })), { endpoint: 'market/token_top_traders', params: { chain: 'sol', address: A, limit: '50', order_by: 'profit' } });
  assert.ok(F.gmgnRequest('/gmgn/user/created_tokens', q({ chain: 'sol', wallet_address: A })));
  assert.ok(F.gmgnRequest('/gmgn/token/info', q({ chain: 'base', address: '0x4ed4e862860bed51a9570b96d89af5e1b0efefed' })));
  assert.equal(F.gmgnRequest('/gmgn/trade/swap', q({ chain: 'sol', address: A })), null, 'trading is never proxied');
  assert.equal(F.gmgnRequest('/gmgn/user/wallet_holdings', q({ chain: 'sol', wallet_address: A })), null);
  assert.equal(F.gmgnRequest('/gmgn/token/info', q({ chain: 'dogechain', address: A })), null, 'unknown chain');
  assert.equal(F.gmgnRequest('/gmgn/token/info', q({ chain: 'sol', address: 'x"&y' })), null, 'bad address');
  assert.equal(F.gmgnRequest('/gmgn/token/info', q({ chain: 'sol' })), null, 'address required');
  assert.equal(F.gmgnRequest('/gmgn/../token/info', q({ chain: 'sol', address: A })), null);
  const url = F.gmgnUrl('token/info', { chain: 'sol', address: A }, 1791600000, 'cid-1');
  assert.equal(url, `https://openapi.gmgn.ai/v1/token/info?chain=sol&address=${A}&timestamp=1791600000&client_id=cid-1`);
});

test('Worker /gmgn: key stays in the Worker, results cached, a rate limit pauses asking, not configured is reported', async () => {
  const W = (await import('../worker/index.mjs')).default;
  const A = '8vYJgiQPkpDtbWkDy1wyYDcUq3D9fUXVJUtt6aNEpump';
  const env = { FEED_KEY: 'k', GMGN_API_KEY: 'secret-gmgn-key', ALLOWED_ORIGIN: 'https://app.example', CHANNEL_ID: '', CALLS: { get: async () => null, put: async () => {} } };
  const calls = [];
  let reply = { status: 200, body: { code: 0, data: { list: [{ address: 'W1', realized_profit: 10 }] } } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), headers: (opts && opts.headers) || {} }); return new Response(JSON.stringify(reply.body), { status: reply.status }); };
  const ask = (path, key = 'k') => W.fetch(new Request('https://w.example' + path, { headers: { 'x-feed-key': key, Origin: 'https://app.example' } }), env);
  try {
    assert.equal((await ask(`/gmgn/market/token_top_traders?chain=sol&address=${A}`, 'bad')).status, 401);
    assert.equal(calls.length, 0);
    let r = await ask(`/gmgn/market/token_top_traders?chain=sol&address=${A}&limit=50`);
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.deepEqual(JSON.parse(text), { data: { list: [{ address: 'W1', realized_profit: 10 }] } });
    assert.ok(!text.includes('secret-gmgn-key'), 'the key never reaches the app');
    assert.equal(calls[0].headers['X-APIKEY'], 'secret-gmgn-key');
    assert.match(calls[0].url, /^https:\/\/openapi\.gmgn\.ai\/v1\/market\/token_top_traders\?chain=sol&address=\w+&limit=50&timestamp=\d+&client_id=[\w-]+$/);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://app.example');
    await ask(`/gmgn/market/token_top_traders?chain=sol&address=${A}&limit=50`);
    assert.equal(calls.length, 1, 'the same question within 5 minutes is answered from the cache');
    assert.equal((await ask(`/gmgn/trade/swap?chain=sol&address=${A}`)).status, 400);
    assert.equal(calls.length, 1, 'blocked endpoints never reach GMGN');
    // GMGN error codes come back as errors
    reply = { status: 200, body: { code: 40001, message: 'token not found' } };
    r = await ask(`/gmgn/token/info?chain=sol&address=${A}`);
    assert.equal(r.status, 502);
    assert.equal((await r.json()).error, 'token not found');
    // a rate limit pauses all GMGN calls for a minute
    reply = { status: 429, body: { code: 429, message: 'too many' } };
    r = await ask(`/gmgn/token/security?chain=sol&address=${A}`);
    assert.equal(r.status, 429);
    const n = calls.length;
    r = await ask(`/gmgn/user/created_tokens?chain=sol&wallet_address=${A}`);
    assert.equal(r.status, 429);
    assert.equal(calls.length, n, 'no new request while paused');
    // no key configured
    const r2 = await W.fetch(new Request(`https://w.example/gmgn/token/info?chain=sol&address=${A}`, { headers: { 'x-feed-key': 'k' } }), Object.assign({}, env, { GMGN_API_KEY: '' }));
    assert.equal(r2.status, 503);
    assert.equal((await r2.json()).error, 'not_configured');
  } finally { globalThis.fetch = realFetch; }
});

test('chatter: request, snowflake, search hits and trimmed messages', () => {
  const F = require('../worker/feed-core.js');
  const q = (o) => new URLSearchParams(o);
  assert.deepEqual(F.chatterRequest(q({ ca: '8vYJgiQPkpDtbWkDy1wyYDcUq3D9fUXVJUtt6aNEpump', sym: '$PEPE' })), { ca: '8vYJgiQPkpDtbWkDy1wyYDcUq3D9fUXVJUtt6aNEpump', sym: 'PEPE' });
  assert.deepEqual(F.chatterRequest(q({ ca: '0xb0fea7be600c85e2f4fe90821f304bc1578d4444', sym: 'a b' })), { ca: '0xb0fea7be600c85e2f4fe90821f304bc1578d4444', sym: '' }, 'a bad ticker is dropped');
  assert.equal(F.chatterRequest(q({ ca: 'hello' })), null);
  assert.equal(F.chatterRequest(q({})), null);
  assert.equal(F.snowflakeAt(1420070400000), '0');
  assert.equal(F.snowflakeAt(1420070400000 + 1000), String(1000n << 22n));
  assert.deepEqual(F.searchHits({ messages: [[{ id: '1', hit: true }, { id: '0', hit: false }], [{ id: '2' }]] }).map((m) => m.id), ['1', '2']);
  assert.deepEqual(F.searchHits(null), []);
  const t = F.trimMessage({ id: 5, timestamp: '2026-10-10T12:00:00Z', author: { username: 'relay', global_name: '[SS] Arachnaught' }, content: 'dev is based, aping', message_reference: { message_id: '4' } });
  assert.deepEqual(t, { id: '5', ts: Date.parse('2026-10-10T12:00:00Z'), author: '[SS] Arachnaught', text: 'dev is based, aping', card: false, cardTitle: '', replyTo: '4' });
  const card = F.trimMessage({ id: 6, timestamp: '2026-10-10T12:01:00Z', author: { username: '[PRO] Rick' }, content: '', embeds: [{ title: 'PEPE [300K/12%]' }] });
  assert.equal(card.card, true);
  assert.equal(card.cardTitle, 'PEPE [300K/12%]');
});
