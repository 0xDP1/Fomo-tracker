// Discord feed Worker: pure storage and access helpers (no network). Tested in node, bundled for Cloudflare.
(function (root) {
  'use strict';
  const KEEP_MS = 3 * 86400000;
  const MAX_CALLS = 1000;
  const snowflakeCmp = (a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0);

  const emptyStore = () => ({ calls: [], lastId: null, status: 'starting', checkedAt: 0 });

  // Add new calls, drop duplicates (same message and address) and anything older than 3 days, keep the newest 1000.
  // channelId: remember progress for that channel in lastIds (without it, the single lastId is used).
  function mergeStore(store, calls, messageIds, now, channelId) {
    const s = Object.assign(emptyStore(), store || {});
    const seen = new Set(s.calls.map((c) => c.messageId + '|' + c.address));
    const all = s.calls.slice();
    for (const c of calls || []) {
      const k = c.messageId + '|' + c.address;
      if (seen.has(k)) continue;
      seen.add(k);
      all.push(c);
    }
    const kept = all.filter((c) => now - c.at <= KEEP_MS).sort((a, b) => a.at - b.at);
    let lastId = channelId ? (s.lastIds || {})[channelId] : s.lastId;
    for (const id of messageIds || []) if (lastId == null || snowflakeCmp(String(id), String(lastId)) > 0) lastId = String(id);
    const out = Object.assign({}, s, { calls: kept.slice(-MAX_CALLS) });
    if (channelId) out.lastIds = Object.assign({}, s.lastIds, lastId == null ? {} : { [channelId]: lastId });
    else out.lastId = lastId;
    return out;
  }

  // "111:first scan, 222:price move, 333" -> [{ id, label }], digits-only ids, no repeats, at most 10.
  function parseChannels(text) {
    const out = [], seen = new Set();
    for (const part of String(text || '').split(',')) {
      const i = part.indexOf(':');
      const id = (i < 0 ? part : part.slice(0, i)).trim();
      if (!/^\d{3,25}$/.test(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, label: (i < 0 ? '' : part.slice(i + 1).trim()) || id });
      if (out.length >= 10) break;
    }
    return out;
  }

  // The worst of several channel states, so one bad channel is never hidden by the others being fine.
  const WORST = ['token_invalid', 'no_access', 'channel_not_found', 'discord_error', 'rate_limited', 'ok'];
  const rollup = (statuses) => { const list = (statuses || []).filter(Boolean); return list.length ? WORST.find((w) => list.includes(w)) || 'discord_error' : 'starting'; };

  const callsSince = (store, sinceMs) => ((store && store.calls) || []).filter((c) => c.at > sinceMs).sort((a, b) => a.at - b.at);

  const STATUS = { 200: 'ok', 401: 'token_invalid', 403: 'no_access', 404: 'channel_not_found', 429: 'rate_limited' };
  const statusFor = (code) => STATUS[code] || 'discord_error';

  // Constant-time compare so the key can't be guessed one character at a time.
  function authorized(given, feedKey) {
    if (!given || !feedKey || given.length !== feedKey.length) return false;
    let diff = 0;
    for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ feedKey.charCodeAt(i);
    return diff === 0;
  }

  function cors(origin, allowed) {
    const h = { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'x-feed-key, content-type', 'Access-Control-Expose-Headers': 'x-credits-remaining, x-proxy-error', Vary: 'Origin' };
    if (origin && allowed && origin === allowed) h['Access-Control-Allow-Origin'] = allowed;
    return h;
  }

  // ---- GMGN read-only proxy: the six read endpoints the app uses, and only their parameters. Trading is never proxied. ----
  const GMGN_CHAINS = new Set(['sol', 'bsc', 'base', 'eth', 'arbitrum', 'hyperevm', 'robinhood', 'arc', 'stable']);
  const TOKEN_Q = ['chain', 'address', 'limit', 'order_by', 'direction', 'tag'];
  const GMGN_ENDPOINTS = {
    'token/info': { need: 'address', keys: ['chain', 'address'] },
    'token/security': { need: 'address', keys: ['chain', 'address'] },
    'market/token_top_holders': { need: 'address', keys: TOKEN_Q },
    'market/token_top_traders': { need: 'address', keys: TOKEN_Q },
    'user/created_tokens': { need: 'wallet_address', keys: ['chain', 'wallet_address', 'order_by', 'direction', 'migrate_state', 'limit'] },
    'user/wallet_activity': { need: 'wallet_address', keys: ['chain', 'wallet_address', 'type', 'limit'] },
  };
  function gmgnRequest(pathname, search) {
    const endpoint = String(pathname || '').replace(/^\/gmgn\//, '');
    const spec = Object.prototype.hasOwnProperty.call(GMGN_ENDPOINTS, endpoint) ? GMGN_ENDPOINTS[endpoint] : null;
    if (!spec) return null;
    const params = {};
    for (const k of spec.keys) { const v = search.get(k); if (v != null && v !== '') params[k] = v; }
    if (!GMGN_CHAINS.has(params.chain)) return null;
    if (!/^[A-Za-z0-9]{20,64}$/.test(params[spec.need] || '')) return null;
    for (const k of Object.keys(params)) if (k !== spec.need && k !== 'chain' && !/^[a-z0-9_]{1,30}$/.test(params[k])) return null;
    return { endpoint, params };
  }
  const gmgnUrl = (endpoint, params, nowSec, clientId) => `https://openapi.gmgn.ai/v1/${endpoint}?${new URLSearchParams(Object.assign({}, params, { timestamp: String(nowSec), client_id: clientId }))}`;

  // Storage writes are limited (1,000 a day on the free plan), so the Worker keeps its latest read in memory and saves at
  // most once per gap: right away the first time or when a channel's status changes, otherwise only after the gap.
  function shouldSave({ dirty, statusChanged, lastSaveAt, now, gapMs }) {
    if (!dirty) return false;
    if (statusChanged || !lastSaveAt) return true;
    return now - lastSaveAt >= gapMs;
  }

  // ---- Chatter search: what the on chain feed channel says about one coin (read-only, on request) ----
  // ?ca=<contract address>&sym=<ticker, optional>
  function chatterRequest(search) {
    const ca = String(search.get('ca') || '').trim();
    if (!/^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(ca)) return null;
    const sym = String(search.get('sym') || '').trim().replace(/^\$/, '');
    return { ca, sym: /^[A-Za-z0-9]{2,15}$/.test(sym) ? sym : '' };
  }
  // The Discord snowflake for a moment in time (for "messages after").
  const snowflakeAt = (ms) => String((BigInt(Math.max(0, Math.floor(ms) - 1420070400000))) << 22n);
  // Discord search returns { messages: [[message, ...], ...] }; the hits are the messages themselves.
  function searchHits(j) {
    const out = [];
    for (const group of (j && Array.isArray(j.messages) ? j.messages : [])) for (const m of [].concat(group)) if (m && m.id && (m.hit === undefined || m.hit)) out.push(m);
    return out;
  }
  // Only what the app needs: who (with the group code in the name), when, the words, and whether it is a bot card.
  function trimMessage(m) {
    const a = m.author || {};
    const embed = (m.embeds || [])[0];
    return {
      id: String(m.id), ts: Date.parse(m.timestamp) || 0,
      author: String(a.global_name || a.username || 'unknown').slice(0, 60),
      text: String(m.content || '').slice(0, 500),
      card: !!(embed && !String(m.content || '').replace(/\s+/g, '').length),
      cardTitle: embed && embed.title ? String(embed.title).slice(0, 80) : '',
      replyTo: m.message_reference && m.message_reference.message_id ? String(m.message_reference.message_id) : '',
    };
  }

  // ---- Key proxy: Helius, fomoapi.io, Jupiter and Claude, with the keys kept here as Worker secrets ----
  const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

  // Only the JSON-RPC methods the app calls, so a leaked feed key can't spend Helius credits on anything else.
  const RPC_METHODS = new Set(['getBalance', 'getTokenAccountsByOwner', 'getAssetBatch']);
  function rpcRequest(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || !RPC_METHODS.has(body.method)) return null;
    if (body.params != null && typeof body.params !== 'object') return null;
    return { jsonrpc: '2.0', id: body.id == null ? 1 : body.id, method: body.method, params: body.params == null ? [] : body.params };
  }

  // GET /helius/tx/<address>?before=<signature>&type=SWAP&limit=<1-100>: a wallet's or a coin's parsed transactions.
  function heliusTxRequest(pathname, search) {
    const m = /^\/helius\/tx\/([^/]+)$/.exec(String(pathname || ''));
    if (!m || !BASE58.test(m[1])) return null;
    const params = {};
    const type = search.get('type');
    if (type) { if (type !== 'SWAP') return null; params.type = type; }
    const limit = search.get('limit') || '100';
    if (!/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 100) return null;
    params.limit = limit;
    const before = search.get('before');
    if (before) { if (!SIGNATURE.test(before)) return null; params.before = before; }
    return { address: m[1], params };
  }
  const heliusTxUrl = (req, key) => `https://api.helius.xyz/v0/addresses/${req.address}/transactions?${new URLSearchParams(Object.assign({ 'api-key': key }, req.params))}`;
  const heliusRpcUrl = (key) => 'https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(key);

  // GET /fomo/users/<handle>[/balances|/trades|/positions]?<paging params>: read-only fomoapi.io user calls.
  // The app tries several paging parameters (cursor, page, offset, before…), so short plain ones are passed on.
  const FOMO_PATHS = new Set(['', '/balances', '/trades', '/positions']);
  function fomoRequest(pathname, search) {
    const m = /^\/fomo\/users\/([A-Za-z0-9_][A-Za-z0-9_.-]{0,39})(\/[a-z]+)?$/.exec(String(pathname || ''));
    if (!m || !FOMO_PATHS.has(m[2] || '')) return null;
    const params = {};
    let n = 0;
    for (const [k, v] of search) {
      if (!/^[A-Za-z_]{1,20}$/.test(k) || String(v).length > 100 || ++n > 12) return null;
      params[k] = v;
    }
    return { handle: m[1], path: m[2] || '', params };
  }
  const fomoUrl = (req) => `https://api.fomoapi.io/v2/users/${encodeURIComponent(req.handle)}${req.path}${Object.keys(req.params).length ? '?' + new URLSearchParams(req.params) : ''}`;
  const fomoAuth = (key) => (/^(bearer|basic) /i.test(key) ? key : 'Bearer ' + key);

  // GET /jup/price?ids=<mints> and /jup/tokens?query=<mints>: Jupiter needs no key; the Worker caches answers for 30 s.
  function jupRequest(pathname, search) {
    const kind = pathname === '/jup/price' ? 'price' : pathname === '/jup/tokens' ? 'tokens' : '';
    if (!kind) return null;
    const raw = String(search.get(kind === 'price' ? 'ids' : 'query') || '');
    const list = raw.split(',').filter(Boolean);
    if (!list.length || list.length > 100 || !list.every((x) => BASE58.test(x))) return null;
    return { kind, url: kind === 'price' ? 'https://lite-api.jup.ag/price/v3?ids=' + list.join(',') : 'https://lite-api.jup.ag/tokens/v2/search?query=' + list.join(',') };
  }

  // POST /claude/messages: only the models the app uses, a capped answer length, no streaming and no tools.
  const CLAUDE_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
  const CLAUDE_MAX_TOKENS = 4000;
  const CLAUDE_MAX_BYTES = 2 * 1024 * 1024;
  function claudeRequest(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return 'bad_request';
    if (!CLAUDE_MODELS.has(body.model)) return 'model_not_allowed';
    if (!Number.isInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > CLAUDE_MAX_TOKENS) return 'max_tokens_not_allowed';
    if (body.stream || body.tools || !Array.isArray(body.messages) || !body.messages.length) return 'bad_request';
    return null;
  }
  // The server-side fallback beta header goes along only when the request asks for fallbacks, as the app did before.
  const claudeHeaders = (key, body) => Object.assign({ 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body && body.fallbacks ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {});

  // Per-IP limit per minute and service. Kept in this Worker instance's memory: a backstop if the feed key leaks, not a quota.
  const RATE_LIMITS = { helius: 300, fomo: 60, jup: 120, claude: 30 };
  function rateLimit(table, ip, bucket, now, limits) {
    const limit = (limits || RATE_LIMITS)[bucket];
    if (!limit) return { ok: true };
    const k = bucket + '|' + (ip || 'unknown');
    const windowStart = now - (now % 60000);
    const e = table.get(k);
    if (!e || e.start !== windowStart) { table.set(k, { start: windowStart, n: 1 }); if (table.size > 5000) table.delete(table.keys().next().value); return { ok: true }; }
    if (e.n >= limit) return { ok: false, retryAt: windowStart + 60000 };
    e.n++;
    return { ok: true };
  }

  // Never let a key travel back to the app, even if an upstream service echoes it in an error.
  const scrub = (text, secrets) => (secrets || []).filter((s) => s && s.length >= 8).reduce((t, s) => t.split(s).join('[key]'), String(text));

  const api = { rpcRequest, heliusTxRequest, heliusTxUrl, heliusRpcUrl, fomoRequest, fomoUrl, fomoAuth, jupRequest, claudeRequest, claudeHeaders, rateLimit, scrub, RATE_LIMITS, CLAUDE_MAX_BYTES, shouldSave, chatterRequest, snowflakeAt, searchHits, trimMessage, emptyStore, mergeStore, callsSince, statusFor, authorized, cors, parseChannels, rollup, gmgnRequest, gmgnUrl, KEEP_MS, MAX_CALLS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FeedCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
