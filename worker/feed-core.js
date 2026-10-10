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
    const h = { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'x-feed-key', Vary: 'Origin' };
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

  const api = { shouldSave, chatterRequest, snowflakeAt, searchHits, trimMessage, emptyStore, mergeStore, callsSince, statusFor, authorized, cors, parseChannels, rollup, gmgnRequest, gmgnUrl, KEEP_MS, MAX_CALLS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FeedCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
