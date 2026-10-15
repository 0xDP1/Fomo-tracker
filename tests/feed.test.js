const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../worker/feed-core.js');

const NOW = Date.parse('2026-10-08T15:00:00Z');
// Messages the Worker reads must be recent: it keeps calls for 3 days, counted from the real clock.
const RECENT = new Date(Date.now() - 2 * 60000).toISOString();
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
  let reply = { status: 200, body: [{ id: '1300000000000000001', timestamp: RECENT, author: { username: 'alice' }, content: 'ape 7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', embeds: [] }] };
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
  const msg = (id, text) => ({ id, timestamp: RECENT, author: { username: 'bot' }, content: text, embeds: [] });
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
  const realFetch = globalThis.fetch, realNow = Date.now;
  // The saved alerts are from 2026-10-10 and the Worker keeps 3 days of calls: run on that day's clock (still ticking),
  // or the test starts failing once the alerts are 3 days old.
  const shift = Date.parse('2026-10-10T07:00:00Z') - realNow();
  Date.now = () => realNow() + shift;
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
  } finally { globalThis.fetch = realFetch; Date.now = realNow; }
});

// ---- on-demand mode: no schedule, Discord is read when the app asks ----
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const addrFor = (i) => { let s = ''; let n = i + 12345; for (let k = 0; k < 44; k++) { s += B58[(n * (k + 7) + k * k) % 58]; n = (n * 31 + 17) % 1000003; } return s; };
const mkKv = () => { const m = new Map(); const kv = { puts: 0, get: async (k) => m.get(k) ?? null, put: async (k, v) => { kv.puts++; m.set(k, v); } }; return kv; };
const mkMsg = (n) => ({ id: String(1300000000000000000n + BigInt(n)), timestamp: RECENT, author: { username: 'u' + (n % 3) }, content: 'ape ' + addrFor(n), embeds: [] });

test('on-demand: a request reads Discord, is reused for 10 seconds, writes nothing when nothing changed and saves at most once a minute', async () => {
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
    assert.equal(reads, 1, 'a second request within 10 seconds reuses the answer');
    env.MIN_GAP_MS = '0';
    page = [];
    const putsBefore = kv.puts;
    j = await ask();
    assert.equal(reads, 2, 'after the gap it reads again');
    assert.equal(kv.puts, putsBefore, 'nothing new, nothing saved');
    assert.equal(j.calls.length, 1);
    page = [mkMsg(2)];
    j = await ask();
    assert.equal(j.calls.length, 2, 'new calls reach the app at once');
    assert.equal(kv.puts, putsBefore, '...but storage is written at most once a minute');
    env.SAVE_GAP_MS = '0';
    page = [];
    await ask();
    assert.ok(kv.puts > putsBefore, 'once the gap has passed the held calls are saved');
    const saved = JSON.parse(await kv.get('store3'));
    assert.equal(saved.calls.length, 2);
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

test('shouldSave: at most one storage write per gap, sooner for a first save or a status change', () => {
  const F = require('../worker/feed-core.js');
  const base = { dirty: true, statusChanged: false, lastSaveAt: 1000, now: 1000 + 30000, gapMs: 60000 };
  assert.equal(F.shouldSave(base), false, 'inside the gap: keep it in memory');
  assert.equal(F.shouldSave(Object.assign({}, base, { now: 1000 + 60000 })), true, 'gap passed');
  assert.equal(F.shouldSave(Object.assign({}, base, { statusChanged: true })), true, 'a channel status change is saved at once');
  assert.equal(F.shouldSave(Object.assign({}, base, { lastSaveAt: 0 })), true, 'first save');
  assert.equal(F.shouldSave(Object.assign({}, base, { dirty: false, statusChanged: true })), false, 'nothing new, nothing written');
});

test('gmgnRequest: a wallet\'s activity is allowed, read-only and checked', () => {
  const F = require('../worker/feed-core.js');
  const q = (o) => new URLSearchParams(o);
  const W = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1';
  assert.deepEqual(F.gmgnRequest('/gmgn/user/wallet_activity', q({ chain: 'sol', wallet_address: W, type: 'buy', limit: '20', secret: 'x' })), { endpoint: 'user/wallet_activity', params: { chain: 'sol', wallet_address: W, type: 'buy', limit: '20' } });
  assert.equal(F.gmgnRequest('/gmgn/user/wallet_activity', q({ chain: 'sol', wallet_address: 'bad!' })), null);
  assert.equal(F.gmgnRequest('/gmgn/trade/swap', q({ chain: 'sol', wallet_address: W })), null, 'trading is never forwarded');
});

test('Worker alerts: on the schedule it prices the last day\'s calls, messages the Telegram bot once per level, and serves its track', async () => {
  const W = (await import('../worker/index.mjs')).default;
  const A = require('../worker/alerts-core.js');
  const kv = new Map();
  const now = Date.now();
  const COIN = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr';
  kv.set('store3', JSON.stringify({ calls: [{ address: COIN, chain: 'solana', poster: 'Rick', at: now - 20 * 60000, messageId: 'tg:1:1', symbol: 'RUN', mcap: 50000, channel: 'Man Cave', source: 'telegram' }], lastId: null, status: 'ok', checkedAt: now, lastIds: {} }));
  const env = { DISCORD_TOKEN: 't', FEED_KEY: 'k', CHANNEL_ID: '555', ALLOWED_ORIGIN: 'https://app.example', TG_BOT_TOKEN: 'bot-secret', CALLS: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } } };
  const sent = [];
  let mcap = 60000;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('discord.com')) return new Response('[]', { status: 200 });
    if (u.includes('api.dexscreener.com')) return new Response(JSON.stringify({ pairs: [{ chainId: 'solana', baseToken: { address: COIN, symbol: 'RUN' }, marketCap: mcap, liquidity: { usd: 30000 }, volume: { m5: 100, h1: 5000 }, priceChange: { m5: 1 } }] }), { status: 200 });
    if (u.includes('api.telegram.org')) {
      assert.ok(!u.includes('bot-secret/') || u.startsWith('https://api.telegram.org/botbot-secret/'), 'the token only ever goes to Telegram');
      if (u.endsWith('getUpdates?limit=100')) return new Response(JSON.stringify({ ok: true, result: [{ message: { chat: { id: 4242, type: 'private' } } }] }), { status: 200 });
      sent.push(JSON.parse(opts.body)); return new Response('{"ok":true}', { status: 200 });
    }
    throw new Error('unexpected ' + u);
  };
  try {
    const run = async () => { const waits = []; await W.scheduled({}, env, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits); };
    await run();
    assert.deepEqual(sent, [], 'first round: a base, no alert');
    let st = JSON.parse(kv.get('store3'));
    assert.deepEqual([st.alerts.chatId, st.alerts.track[COIN].base, st.alerts.track[COIN].last], ['4242', 50000, 60000], 'chat learned, the alert price is the base');
    mcap = 110000; await run();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].chat_id, '4242');
    assert.match(sent[0].text, /^🚀 RUN 2× since the call \(\$50\.0k → \$110\.0k\) · Rick in Man Cave, called 2\dm ago\n7GCihg/);
    mcap = 130000; await run();
    assert.equal(sent.length, 1, 'no second message for the same level');
    mcap = 210000; await run();
    assert.equal(sent.length, 2); assert.match(sent[1].text, /4× since the call/);
    st = JSON.parse(kv.get('store3'));
    assert.deepEqual(st.alerts.track[COIN].alerted, [2, 4]);
    assert.equal(st.alerts.sent.length, 2);
    // the app's request carries the Worker's track and what it sent
    const r = await W.fetch(new Request('https://w.example/calls?since=0', { headers: { 'x-feed-key': 'k', Origin: 'https://app.example' } }), env);
    const j = await r.json();
    assert.deepEqual([j.alerts.on, j.alerts.chat, j.alerts.track[COIN].peak, j.alerts.sent.length], [true, true, 210000, 2]);
    assert.equal(JSON.stringify(j).includes('bot-secret'), false, 'the token never reaches the app');
    assert.equal(A.changed(st.alerts.track, st.alerts.track), false);
  } finally { globalThis.fetch = realFetch; }
});

test('Worker alerts: without TG_BOT_TOKEN the schedule prices nothing and the app is told the alerts are off', async () => {
  const W = (await import('../worker/index.mjs')).default;
  const kv = new Map();
  const env = { DISCORD_TOKEN: 't', FEED_KEY: 'k', CHANNEL_ID: '555', ALLOWED_ORIGIN: 'https://app.example', CALLS: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } } };
  const realFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => { urls.push(String(url)); return new Response('[]', { status: 200 }); };
  try {
    const waits = []; await W.scheduled({}, env, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits);
    assert.ok(urls.every((u) => u.includes('discord.com')), urls.join(' '));
    const j = await (await W.fetch(new Request('https://w.example/calls?since=0', { headers: { 'x-feed-key': 'k', Origin: 'https://app.example' } }), env)).json();
    assert.deepEqual(j.alerts, { on: false });
  } finally { globalThis.fetch = realFetch; }
});

test('the dashboard copy loads as a module (a shadowed name or a stray require would break the deploy)', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fomo-bundle-')), 'discord-feed.mjs');
  fs.copyFileSync(path.join(__dirname, '..', 'worker', 'discord-feed.js'), tmp);
  const W = (await import('file://' + tmp)).default;
  assert.equal(typeof W.fetch, 'function');
  assert.equal(typeof W.scheduled, 'function');
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
});

test('Worker /crawl: starts a crawlscan.fun scan, waits for the result, serves the summary and remembers it', async () => {
  const W = (await import('../worker/index.mjs')).default;
  const FIX = require('./fixtures/crawlscan.json');
  const CA = FIX.result.token;
  const kv = new Map();
  const env = { DISCORD_TOKEN: 't', FEED_KEY: 'k', CHANNEL_ID: '555', ALLOWED_ORIGIN: 'https://app.example', CALLS: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } } };
  const calls = [];
  let polls = 0, mode = 'ok';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    calls.push(u.replace(/job=.*/, 'job=…') + (opts && opts.method ? ' ' + opts.method : ''));
    if (u.endsWith('/api/scan')) {
      assert.deepEqual(JSON.parse(opts.body), { token: CA });
      if (mode === 'paused') return new Response(JSON.stringify({ error: 'SOON' }), { status: 503 });
      return new Response(JSON.stringify({ job: 'job1' }), { status: 200 });
    }
    if (u.includes('/api/result?job=job1')) { polls++; return new Response(JSON.stringify(polls >= 2 ? FIX : { done: false }), { status: 200 }); }
    throw new Error('unexpected ' + u);
  };
  const ask = (q) => W.fetch(new Request('https://w.example/crawl?' + q, { headers: { 'x-feed-key': 'k', Origin: 'https://app.example' } }), env);
  try {
    let r = await ask('ca=' + CA);
    assert.equal(r.status, 200);
    let j = await r.json();
    assert.deepEqual([j.cached, j.data.score, j.data.band, j.data.parts.length, j.data.operators.length], [false, 90, 'CLEAN', 5, 5]);
    assert.ok(calls[0].endsWith('/api/scan POST') && polls === 2, calls.join(' | '));
    assert.ok(kv.has('crawl:' + CA), 'kept in storage for other instances');
    // the second ask within 30 minutes costs crawlscan.fun nothing
    r = await ask('ca=' + CA); j = await r.json();
    assert.deepEqual([j.cached, j.data.score, calls.filter((c) => c.endsWith('POST')).length], [true, 90, 1]);
    // not a Solana address, no key, paused
    assert.equal((await ask('ca=0x1234567890abcdef1234567890abcdef12345678')).status, 400);
    assert.equal((await W.fetch(new Request('https://w.example/crawl?ca=' + CA, { headers: { Origin: 'https://app.example' } }), env)).status, 401);
    mode = 'paused';
    r = await ask('ca=' + CA + '&fresh=1');
    assert.deepEqual([r.status, (await r.json()).error], [503, 'paused']);
  } finally { globalThis.fetch = realFetch; }
});

test('bug 25: the Telegram read probes each group\'s latest page every 15 minutes, so a stuck pointer heals and the newest message time shows', async () => {
  const W = (await import('../worker/index.mjs')).default;
  const kv = new Map();
  const now = Date.now();
  const COIN = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr';
  // the pointer says 560774; the reader answers nothing for "newer than 560774" but the latest page has 560800
  kv.set('store3', JSON.stringify({ calls: [], lastId: null, status: 'ok', checkedAt: now - 60000, lastIds: { 'tg:2738176435': '560774' }, telegram: { status: 'ok', checkedAt: now - 60000, probedAt: now - 20 * 60000, chats: [{ id: '2738176435', label: 'Man Cave', status: 'ok' }] } }));
  const env = { FEED_KEY: 'k', CHANNEL_ID: '', ALLOWED_ORIGIN: 'https://app.example', TG_PROXY_URL: 'https://reader.example', TG_PROXY_KEY: 'pk', TG_CHAT: 'channel:2738176435:123:Man Cave', TG_GAP_MS: '0', CALLS: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } } };
  const asked = [];
  const realFetch = globalThis.fetch;
  const msgDate = Math.floor(now / 1000) - 180;
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    asked.push(u.searchParams.get('chats'));
    const last = Number((u.searchParams.get('chats') || '').split(':')[1]);
    const messages = last ? [] : [{ className: 'Message', id: 560800, date: msgDate, message: 'ape ' + COIN, fromId: { userId: '7' }, entities: [] }, { className: 'Message', id: 560799, date: msgDate - 60, message: 'gm', fromId: { userId: '7' }, entities: [] }];
    return new Response(JSON.stringify({ chats: { 2738176435: { messages, users: [{ id: '7', username: 'alice' }] } } }), { status: 200 });
  };
  try {
    const run = async () => { const waits = []; await W.scheduled({}, env, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits); };
    await run();
    assert.deepEqual(asked, ['2738176435:560774', '2738176435:0'], 'the normal read, then the probe (last probe was 20 minutes ago)');
    const st = JSON.parse(kv.get('store3'));
    assert.equal(st.lastIds['tg:2738176435'], '560800', 'the pointer moved to the newest message');
    assert.deepEqual(st.calls.map((c) => [c.address, c.source, c.poster]), [[COIN, 'telegram', 'alice']], 'the call the pointer was hiding');
    assert.equal(st.telegram.chats[0].latestId, '560800');
    assert.equal(st.telegram.chats[0].latestAt, msgDate * 1000, 'newest message time per group');
    assert.ok(st.telegram.probedAt >= now, 'probe time recorded');
    asked.length = 0;
    await run();
    assert.deepEqual(asked, ['2738176435:560800'], 'no probe within 15 minutes');
    const j = await (await W.fetch(new Request('https://w.example/calls?since=0', { headers: { 'x-feed-key': 'k', Origin: 'https://app.example' } }), env)).json();
    assert.equal(j.telegram.chats[0].latestAt, msgDate * 1000, 'the app gets it');
  } finally { globalThis.fetch = realFetch; }
});
