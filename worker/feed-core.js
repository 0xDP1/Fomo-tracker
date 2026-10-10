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

  const api = { emptyStore, mergeStore, callsSince, statusFor, authorized, cors, parseChannels, rollup, KEEP_MS, MAX_CALLS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FeedCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
