// The Worker's key proxy: Helius, fomoapi.io, Jupiter and Claude are called with keys that stay in the Worker.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../worker/feed-core.js');

const WALLET = '8vYJgiQPkpDtbWkDy1wyYDcUq3D9fUXVJUtt6aNEpump';
const SIG = '5'.repeat(88);
const q = (o) => new URLSearchParams(o);

test('rpcRequest: only the methods the app calls', () => {
  assert.deepEqual(F.rpcRequest({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [WALLET] }), { jsonrpc: '2.0', id: 1, method: 'getBalance', params: [WALLET] });
  assert.equal(F.rpcRequest({ method: 'getAssetBatch', params: { ids: [WALLET] } }).id, 1);
  assert.ok(F.rpcRequest({ method: 'getTokenAccountsByOwner', params: [WALLET, {}, {}] }));
  assert.equal(F.rpcRequest({ method: 'sendTransaction', params: ['x'] }), null, 'nothing that writes');
  assert.equal(F.rpcRequest({ method: 'getProgramAccounts', params: [] }), null, 'nothing heavy the app does not use');
  assert.equal(F.rpcRequest([{ method: 'getBalance' }]), null, 'no batches');
  assert.equal(F.rpcRequest({ method: 'getBalance', params: 'x' }), null);
  assert.equal(F.rpcRequest(null), null);
});

test('heliusTxRequest: an address, then only before, type=SWAP and limit up to 100', () => {
  assert.deepEqual(F.heliusTxRequest('/helius/tx/' + WALLET, q({})), { address: WALLET, params: { limit: '100' } });
  assert.deepEqual(F.heliusTxRequest('/helius/tx/' + WALLET, q({ type: 'SWAP', limit: '100', before: SIG })), { address: WALLET, params: { type: 'SWAP', limit: '100', before: SIG } });
  assert.equal(F.heliusTxRequest('/helius/tx/not-an-address', q({})), null);
  assert.equal(F.heliusTxRequest('/helius/tx/' + WALLET, q({ type: 'TRANSFER' })), null);
  assert.equal(F.heliusTxRequest('/helius/tx/' + WALLET, q({ limit: '500' })), null);
  assert.equal(F.heliusTxRequest('/helius/tx/' + WALLET, q({ before: 'x&api-key=evil' })), null);
  const url = F.heliusTxUrl(F.heliusTxRequest('/helius/tx/' + WALLET, q({ type: 'SWAP', before: SIG })), 'HK');
  assert.equal(url, `https://api.helius.xyz/v0/addresses/${WALLET}/transactions?api-key=HK&type=SWAP&limit=100&before=${SIG}`);
});

test('fomoRequest: read-only user paths and short paging parameters', () => {
  assert.deepEqual(F.fomoRequest('/fomo/users/trader_1', q({})), { handle: 'trader_1', path: '', params: {} });
  assert.deepEqual(F.fomoRequest('/fomo/users/trader_1/trades', q({ limit: '100', cursor: 'abc' })), { handle: 'trader_1', path: '/trades', params: { limit: '100', cursor: 'abc' } });
  assert.equal(F.fomoUrl(F.fomoRequest('/fomo/users/trader_1/trades', q({ limit: '5' }))), 'https://api.fomoapi.io/v2/users/trader_1/trades?limit=5');
  assert.equal(F.fomoUrl(F.fomoRequest('/fomo/users/trader_1', q({}))), 'https://api.fomoapi.io/v2/users/trader_1');
  assert.equal(F.fomoRequest('/fomo/users/trader_1/settings', q({})), null);
  assert.equal(F.fomoRequest('/fomo/users/../admin', q({})), null);
  assert.equal(F.fomoRequest('/fomo/users/a', q({ 'bad-key': '1' })), null);
  assert.equal(F.fomoAuth('fapi_x'), 'Bearer fapi_x');
  assert.equal(F.fomoAuth('Bearer fapi_x'), 'Bearer fapi_x');
});

test('jupRequest: prices and token search for up to 100 mints', () => {
  assert.deepEqual(F.jupRequest('/jup/price', q({ ids: WALLET + ',' + WALLET })), { kind: 'price', url: `https://lite-api.jup.ag/price/v3?ids=${WALLET},${WALLET}` });
  assert.deepEqual(F.jupRequest('/jup/tokens', q({ query: WALLET })), { kind: 'tokens', url: 'https://lite-api.jup.ag/tokens/v2/search?query=' + WALLET });
  assert.equal(F.jupRequest('/jup/price', q({ ids: '' })), null);
  assert.equal(F.jupRequest('/jup/price', q({ ids: 'abc' })), null);
  assert.equal(F.jupRequest('/jup/swap', q({ ids: WALLET })), null);
});

test('claudeRequest: the app\'s models, capped length, no streaming or tools', () => {
  const ok = { model: 'claude-haiku-5-5', max_tokens: 2000, messages: [{ role: 'user', content: 'hi' }] };
  assert.equal(F.claudeRequest(ok), null);
  assert.equal(F.claudeRequest(Object.assign({}, ok, { model: 'claude-opus-5-5', max_tokens: 4000 })), null);
  assert.equal(F.claudeRequest(Object.assign({}, ok, { model: 'some-other-model' })), 'model_not_allowed');
  assert.equal(F.claudeRequest(Object.assign({}, ok, { max_tokens: 64000 })), 'max_tokens_not_allowed');
  assert.equal(F.claudeRequest(Object.assign({}, ok, { stream: true })), 'bad_request');
  assert.equal(F.claudeRequest(Object.assign({}, ok, { tools: [{ type: 'web_search_20250305', name: 'web_search' }] })), 'bad_request');
  assert.equal(F.claudeRequest(Object.assign({}, ok, { messages: [] })), 'bad_request');
  assert.equal(F.claudeHeaders('AK', ok)['anthropic-beta'], undefined);
  assert.equal(F.claudeHeaders('AK', Object.assign({ fallbacks: 'default' }, ok))['anthropic-beta'], 'server-side-fallback-2026-07-01');
});

test('rateLimit: per IP and service per minute, then the next minute starts fresh', () => {
  const t = new Map();
  const limits = { claude: 2 };
  const now = 1_000_000_020_000;
  assert.ok(F.rateLimit(t, '1.1.1.1', 'claude', now, limits).ok);
  assert.ok(F.rateLimit(t, '1.1.1.1', 'claude', now + 1, limits).ok);
  const stop = F.rateLimit(t, '1.1.1.1', 'claude', now + 2, limits);
  assert.equal(stop.ok, false);
  assert.equal(stop.retryAt, now - (now % 60000) + 60000);
  assert.ok(F.rateLimit(t, '2.2.2.2', 'claude', now + 3, limits).ok, 'another address has its own count');
  assert.ok(F.rateLimit(t, '1.1.1.1', 'other', now + 3, limits).ok, 'a service without a limit is not counted');
  assert.ok(F.rateLimit(t, '1.1.1.1', 'claude', now + 60000, limits).ok, 'next minute');
});

test('scrub: a key echoed by a service never goes back to the app', () => {
  assert.equal(F.scrub('bad key abcdefgh123 here', ['abcdefgh123']), 'bad key [key] here');
  assert.equal(F.scrub('short', ['']), 'short');
});

// ---- the Worker itself ----
const ENV = { FEED_KEY: 'k', ALLOWED_ORIGIN: 'https://app.example', CHANNEL_ID: '', CALLS: { get: async () => null, put: async () => {} },
  HELIUS_API_KEY: 'secret-helius-key', FOMO_API_KEY: 'fapi_secret-fomo-key', ANTHROPIC_API_KEY: 'sk-ant-secret-key', GMGN_API_KEY: '' };

async function withFetch(reply, fn) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body });
    const r = typeof reply === 'function' ? reply(String(url), opts) : reply;
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status || 200, headers: r.headers || {} });
  };
  try { await fn(calls); } finally { globalThis.fetch = realFetch; }
}

const W = async () => (await import('../worker/index.mjs')).default;
const ask = async (path, { key = 'k', method = 'GET', body, env = ENV, ip = '9.9.9.9' } = {}) => (await W()).fetch(new Request('https://w.example' + path, {
  method, body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  headers: { 'x-feed-key': key, Origin: 'https://app.example', 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' },
}), env);

test('Worker /services: says which keys are set, never the keys', async () => {
  const r = await ask('/services');
  const text = await r.text();
  assert.deepEqual(JSON.parse(text), { helius: true, fomo: true, claude: true, gmgn: false, chatter: false, jupiter: true });
  assert.ok(!/secret/.test(text));
  assert.equal((await ask('/services', { key: 'bad' })).status, 401);
});

test('Worker: the feed key is required and refusals are marked as the Worker\'s own', async () => {
  await withFetch({ body: {} }, async (calls) => {
    for (const [path, method] of [['/helius/rpc', 'POST'], ['/helius/tx/' + WALLET, 'GET'], ['/fomo/users/a', 'GET'], ['/jup/price?ids=' + WALLET, 'GET'], ['/claude/messages', 'POST']]) {
      const r = await ask(path, { key: 'wrong', method, body: method === 'POST' ? {} : undefined });
      assert.equal(r.status, 401, path);
      assert.equal(r.headers.get('x-proxy-error'), '1');
    }
    assert.equal(calls.length, 0);
    const r = await ask('/claude/messages');
    assert.equal(r.status, 404, 'Claude is POST only');
  });
});

test('Worker /helius/rpc and /helius/tx: the key is added in the Worker and never sent back', async () => {
  await withFetch((url) => ({ body: url.includes('/transactions') ? [{ signature: 's1', echo: 'api-key=secret-helius-key' }] : { jsonrpc: '2.0', id: 1, result: { value: 5e9 } } }), async (calls) => {
    let r = await ask('/helius/rpc', { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'getBalance', params: [WALLET] } });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { jsonrpc: '2.0', id: 1, result: { value: 5e9 } });
    assert.equal(calls[0].url, 'https://mainnet.helius-rpc.com/?api-key=secret-helius-key');
    assert.equal(calls[0].method, 'POST');
    r = await ask('/helius/rpc', { method: 'POST', body: { method: 'sendTransaction', params: [] } });
    assert.equal(r.status, 400);
    assert.equal(calls.length, 1, 'refused methods never reach Helius');
    r = await ask(`/helius/tx/${WALLET}?type=SWAP&limit=100`);
    const text = await r.text();
    assert.equal(r.status, 200);
    assert.ok(!text.includes('secret-helius-key'), 'scrubbed');
    assert.equal(calls[1].url, `https://api.helius.xyz/v0/addresses/${WALLET}/transactions?api-key=secret-helius-key&type=SWAP&limit=100`);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://app.example');
  });
  // Helius's own errors (like running out of credits) come through unchanged so the app can explain them
  await withFetch({ status: 429, body: { error: 'max usage reached' } }, async () => {
    const r = await ask(`/helius/tx/${WALLET}`);
    assert.equal(r.status, 429);
    assert.equal(r.headers.get('x-proxy-error'), null);
    assert.deepEqual(await r.json(), { error: 'max usage reached' });
  });
  const r = await ask(`/helius/tx/${WALLET}`, { env: Object.assign({}, ENV, { HELIUS_API_KEY: '' }) });
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: 'not_configured', service: 'helius', secret: 'HELIUS_API_KEY' });
});

test('Worker /fomo: Bearer key added in the Worker, credits header passed on', async () => {
  await withFetch({ body: { data: { trades: [] } }, headers: { 'x-credits-remaining': '1234', 'Content-Type': 'application/json' } }, async (calls) => {
    const r = await ask('/fomo/users/trader_1/trades?limit=100&cursor=c1');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-credits-remaining'), '1234');
    assert.match(r.headers.get('Access-Control-Expose-Headers'), /x-credits-remaining/);
    assert.equal(calls[0].url, 'https://api.fomoapi.io/v2/users/trader_1/trades?limit=100&cursor=c1');
    assert.equal(calls[0].headers.Authorization, 'Bearer fapi_secret-fomo-key');
    assert.equal((await ask('/fomo/users/trader_1/wallets')).status, 400);
    assert.equal(calls.length, 1);
  });
  await withFetch({ status: 402, body: { error: 'out of credits' } }, async () => {
    assert.equal((await ask('/fomo/users/trader_1')).status, 402, 'a credits stop reaches the app as before');
  });
});

test('Worker /jup: the same price question within 30 seconds is answered from the cache', async () => {
  await withFetch({ body: { [WALLET]: { usdPrice: 1.5 } } }, async (calls) => {
    const path = '/jup/price?ids=' + WALLET + ',So11111111111111111111111111111111111111112';
    assert.deepEqual(await (await ask(path)).json(), { [WALLET]: { usdPrice: 1.5 } });
    await ask(path);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://lite-api.jup.ag/price/v3?ids=' + WALLET + ',So11111111111111111111111111111111111111112');
    await ask('/jup/tokens?query=' + WALLET);
    assert.equal(calls.length, 2);
  });
});

test('Worker /claude/messages: key and version added in the Worker, body passed on, refusals checked first', async () => {
  const body = { model: 'claude-opus-5-5', max_tokens: 800, fallbacks: 'default', output_config: { effort: 'low' }, system: 's', messages: [{ role: 'user', content: 'Evidence' }] };
  await withFetch({ body: { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' } }, async (calls) => {
    const r = await ask('/claude/messages', { method: 'POST', body });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).content[0].text, 'ok');
    assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
    assert.equal(calls[0].headers['x-api-key'], 'sk-ant-secret-key');
    assert.equal(calls[0].headers['anthropic-version'], '2023-06-01');
    assert.equal(calls[0].headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
    assert.equal(calls[0].headers['anthropic-dangerous-direct-browser-access'], undefined, 'no browser header: the call is made by the Worker');
    assert.deepEqual(JSON.parse(calls[0].body), body);
    let bad = await ask('/claude/messages', { method: 'POST', body: Object.assign({}, body, { model: 'claude-opus-4-1' }) });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, 'model_not_allowed');
    bad = await ask('/claude/messages', { method: 'POST', body: 'not json' });
    assert.equal(bad.status, 400);
    assert.equal(calls.length, 1);
  });
  await withFetch({ status: 401, body: { error: { message: 'invalid x-api-key sk-ant-secret-key' } } }, async () => {
    const r = await ask('/claude/messages', { method: 'POST', body });
    assert.equal(r.status, 401);
    assert.ok(!(await r.text()).includes('sk-ant-secret-key'));
  });
});

test('Worker: too many calls from one address in a minute are refused before reaching the service', async () => {
  const realNow = Date.now;
  Date.now = () => 1_800_000_000_000; // one fixed minute
  try {
    await withFetch({ body: { content: [] } }, async (calls) => {
      const body = { model: 'claude-haiku-5-5', max_tokens: 10, messages: [{ role: 'user', content: 'x' }] };
      for (let i = 0; i < F.RATE_LIMITS.claude; i++) assert.equal((await ask('/claude/messages', { method: 'POST', body, ip: '7.7.7.7' })).status, 200);
      const r = await ask('/claude/messages', { method: 'POST', body, ip: '7.7.7.7' });
      assert.equal(r.status, 429);
      assert.equal(r.headers.get('x-proxy-error'), '1');
      assert.equal((await r.json()).error, 'rate_limited');
      assert.equal(calls.length, F.RATE_LIMITS.claude, 'the refused call never reached Anthropic');
      assert.equal((await ask('/claude/messages', { method: 'POST', body, ip: '7.7.7.8' })).status, 200, 'other addresses are not affected');
    });
  } finally { Date.now = realNow; }
});
