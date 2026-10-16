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
  const WORST = ['token_invalid', 'session_invalid', 'no_access', 'channel_not_found', 'discord_error', 'telegram_error', 'rate_limited', 'ok'];
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

  // ---- GMGN read-only proxy: the eight read endpoints the app uses, and only their parameters. Trading is never proxied. ----
  const GMGN_CHAINS = new Set(['sol', 'bsc', 'base', 'eth', 'arbitrum', 'hyperevm', 'robinhood', 'arc', 'stable']);
  const TOKEN_Q = ['chain', 'address', 'limit', 'order_by', 'direction', 'tag'];
  const GMGN_ENDPOINTS = {
    'token/info': { need: 'address', keys: ['chain', 'address'] },
    'token/security': { need: 'address', keys: ['chain', 'address'] },
    'market/token_top_holders': { need: 'address', keys: TOKEN_Q },
    'market/token_top_traders': { need: 'address', keys: TOKEN_Q },
    'user/created_tokens': { need: 'wallet_address', keys: ['chain', 'wallet_address', 'order_by', 'direction', 'migrate_state', 'limit'] },
    'user/wallet_activity': { need: 'wallet_address', keys: ['chain', 'wallet_address', 'type', 'limit', 'cursor'] }, // cursor: GMGN's paging token (docs/features/gmgn-home.md)
    'user/wallet_stats': { need: 'wallet_address', keys: ['chain', 'wallet_address', 'period'] },
    'user/wallet_profits': { need: 'wallet_address', keys: ['chain', 'wallet_address', 'period'], post: true },
  };
  // GMGN takes wallet profits as a POST with a JSON body (one wallet here); the app asks the Worker with a plain GET.
  const gmgnBody = (endpoint, params) => (endpoint === 'user/wallet_profits' ? { chain: params.chain, period: params.period || '7d', wallet_addresses: [params.wallet_address] } : null);
  function gmgnRequest(pathname, search) {
    const endpoint = String(pathname || '').replace(/^\/gmgn\//, '');
    const spec = Object.prototype.hasOwnProperty.call(GMGN_ENDPOINTS, endpoint) ? GMGN_ENDPOINTS[endpoint] : null;
    if (!spec) return null;
    const params = {};
    for (const k of spec.keys) { const v = search.get(k); if (v != null && v !== '') params[k] = v; }
    if (!GMGN_CHAINS.has(params.chain)) return null;
    if (!/^[A-Za-z0-9]{20,64}$/.test(params[spec.need] || '')) return null;
    for (const k of Object.keys(params)) if (k !== spec.need && k !== 'chain' && !(k === 'cursor' ? /^[A-Za-z0-9_.:=-]{1,300}$/ : /^[a-z0-9_]{1,30}$/).test(params[k])) return null;
    return spec.post ? { endpoint, params, method: 'POST', body: gmgnBody(endpoint, params) } : { endpoint, params };
  }
  // A POST carries its parameters in the body: only the auth fields go in the query.
  const gmgnUrl = (endpoint, params, nowSec, clientId, method) => `https://openapi.gmgn.ai/v1/${endpoint}?${new URLSearchParams(Object.assign({}, method === 'POST' ? {} : params, { timestamp: String(nowSec), client_id: clientId }))}`;

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
  // ---- Feed digest (docs/features/feed-digest.md): the whole on chain feed channel over a window of minutes ----
  const DIGEST_MAX_MINUTES = 48 * 60, DIGEST_MAX = 3000, DIGEST_PAGE = 100;
  function digestRequest(search) {
    const m = Number(search.get('minutes'));
    if (!Number.isInteger(m) || m < 1 || m > DIGEST_MAX_MINUTES) return null;
    return { minutes: m };
  }

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

  // ---- Telegram feed: a private group read as the owner's own account (read-only, only when the app asks) ----
  // TG_CHAT: "channel:<id>:<access hash>:<label>" for supergroups and channels, "chat:<id>:<label>" for small groups,
  // comma-separated, at most 5. worker/telegram-login.mjs prints the exact value.
  function parseTelegramChats(text) {
    const out = [], seen = new Set();
    for (const part of String(text || '').split(',')) {
      const bits = part.trim().split(':');
      const kind = bits[0];
      let id, hash = '', label;
      if (kind === 'channel' && bits.length >= 3) { id = bits[1]; hash = bits[2]; label = bits.slice(3).join(':'); }
      else if (kind === 'chat' && bits.length >= 2) { id = bits[1]; label = bits.slice(2).join(':'); }
      else continue;
      if (!/^\d{1,20}$/.test(id) || (kind === 'channel' && !/^-?\d{1,20}$/.test(hash)) || seen.has(id)) continue;
      seen.add(id);
      out.push({ kind, id, hash, key: 'tg:' + id, label: String(label || '').trim().slice(0, 40) || 'Telegram ' + id });
      if (out.length >= 5) break;
    }
    return out;
  }

  // A Telegram messages.GetHistory reply -> messages shaped like Discord's (oldest first), so the same parser reads
  // both: text plus the links hidden behind words, link previews and the bot's buttons (alert bots put the coin there).
  function telegramToMessages(reply, chat) {
    const r = reply || {};
    const users = new Map((r.users || []).map((u) => [String(u.id), u]));
    const nameOf = (u) => (u ? u.username || [u.firstName, u.lastName].filter(Boolean).join(' ') || String(u.id) : '');
    const out = [];
    for (const m of r.messages || []) {
      if (!m || m.className !== 'Message' || m.id == null) continue;
      const parts = [m.message || ''];
      for (const e of m.entities || []) if (e && e.url) parts.push(e.url);
      if (m.media && m.media.webpage && m.media.webpage.url) parts.push(m.media.webpage.url);
      for (const row of (m.replyMarkup && m.replyMarkup.rows) || []) for (const b of row.buttons || []) { const url = b && (b.url || (b.type && b.type.url)); if (url) parts.push(url); } // layer 230+: the link is in type
      const from = m.fromId && m.fromId.userId != null ? users.get(String(m.fromId.userId)) : null;
      const name = nameOf(from) || m.postAuthor || chat.label;
      out.push({ id: String(m.id), timestamp: new Date(Number(m.date) * 1000).toISOString(), author: { username: name, global_name: name }, content: parts.filter(Boolean).join('\n'), embeds: [] });
    }
    return out.sort((a, b) => Number(a.id) - Number(b.id));
  }

  // Telegram errors -> a status for the app, and how long to stop reading for a flood wait.
  // The newest message in a reader reply: its id and time (ms). Shown per group and used to move a stuck pointer.
  function newestOf(reply) {
    let best = null;
    for (const m of (reply && reply.messages) || []) {
      const id = Number(m && m.id);
      if (!(id > 0)) continue;
      if (!best || id > best.id) best = { id, at: m.date ? Number(m.date) * 1000 : null };
    }
    return best ? { latestId: String(best.id), latestAt: best.at } : null;
  }
  // bug 25: a pointer that Telegram's history no longer agrees with returns empty pages for ever, with no error. Every
  // TG_PROBE_MS the read asks for each group's latest page with no pointer instead; duplicates are dropped by message id.
  const TG_PROBE_MS = 15 * 60000;
  const probeDue = (telegram, now, everyMs = TG_PROBE_MS) => now - ((telegram && telegram.probedAt) || 0) >= everyMs;

  function telegramStatus(err) {
    const text = String((err && (err.errorMessage || err.message)) || err || '');
    const detail = text.split('\n')[0].replace(/[^\w .:()-]/g, '').slice(0, 80); // Telegram's own short code, e.g. API_ID_INVALID
    const flood = /FLOOD_(?:PREMIUM_)?WAIT_?(\d+)?/.exec(text);
    if (flood) return { status: 'rate_limited', waitS: Number((err && err.seconds) || flood[1] || 60), detail };
    if (/AUTH_KEY_UNREGISTERED|AUTH_KEY_INVALID|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED|AUTH_KEY_DUPLICATED/.test(text)) return { status: 'session_invalid', detail };
    if (/CHANNEL_PRIVATE|CHAT_FORBIDDEN|CHANNEL_INVALID|CHAT_ID_INVALID|PEER_ID_INVALID|USER_BANNED_IN_CHANNEL/.test(text)) return { status: 'no_access', detail };
    return { status: 'telegram_error', detail };
  }

  const api = { digestRequest, DIGEST_MAX_MINUTES, DIGEST_MAX, DIGEST_PAGE, parseTelegramChats, telegramToMessages, telegramStatus, newestOf, probeDue, TG_PROBE_MS, shouldSave, chatterRequest, snowflakeAt, searchHits, trimMessage, emptyStore, mergeStore, callsSince, statusFor, authorized, cors, parseChannels, rollup, gmgnRequest, gmgnUrl, gmgnBody, KEEP_MS, MAX_CALLS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FeedCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
