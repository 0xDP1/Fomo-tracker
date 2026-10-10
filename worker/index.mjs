// Discord feed Worker. When the app asks GET /calls?since=<ms> (with the feed key) it reads new messages in each listed channel
// (read-only, with the token stored as a Cloudflare secret), catches up on anything missed, and keeps the contract addresses it finds.
import Calls from '../calls.js';
import Feed from './feed-core.js';

const KEY = 'store3'; // a new key drops stored calls that were read before the parser ignored wallet and pool links

async function load(env) {
  const raw = await env.CALLS.get(KEY);
  try { return raw ? JSON.parse(raw) : Feed.emptyStore(); } catch (e) { return Feed.emptyStore(); }
}

async function loadCallers(env) {
  const raw = await env.CALLS.get('callers');
  try { return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}

// Mark the profiles that changed so the app can ask for only those.
function touch(before, after, now) {
  const out = {};
  for (const k of Object.keys(after)) out[k] = after[k] === before[k] ? after[k] : Object.assign({}, after[k], { touched: now });
  return out;
}

const MAX_PAGES = 10;        // pages of 50 messages per channel and request (500 messages)
const PAGE = 50;
const lastRun = new WeakMap(); // this Worker instance's last read, per storage binding
// This instance's latest read, kept in memory so the app gets new calls at once while storage is written at most once
// a minute (the free plan allows 1,000 writes a day). Losing it only means re-reading: calls are de-duplicated by message.
const memory = new WeakMap(); // storage binding -> { store, callers, savedAt, dirty, callersDirty }

// Read every listed channel (read-only), paging forward through anything missed. Saves only when something changed.
async function poll(env) {
  const channels = Feed.parseChannels(env.CHANNEL_ID);
  const mem = memory.get(env.CALLS) || {};
  let store = mem.store || await load(env);
  // Progress saved by the single-channel version belongs to the first channel listed.
  if (store.lastId && !store.lastIds && channels[0]) store = Object.assign({}, store, { lastIds: { [channels[0].id]: store.lastId } });
  const before = store;
  const now = Date.now();
  let callers = mem.callers || await loadCallers(env);
  const callersBefore = callers;
  const statuses = {};
  let stop = false;
  for (const ch of channels) {
    if (stop) { statuses[ch.id] = 'token_invalid'; continue; }
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        let url = `https://discord.com/api/v10/channels/${ch.id}/messages?limit=${PAGE}`;
        const last = (store.lastIds || {})[ch.id];
        if (last) url += `&after=${last}`;
        const r = await fetch(url, { method: 'GET', headers: { Authorization: env.DISCORD_TOKEN } });
        const status = Feed.statusFor(r.status);
        statuses[ch.id] = status;
        if (status !== 'ok') { if (status === 'token_invalid') stop = true; break; } // a rejected token fails everywhere; don't keep asking
        const messages = await r.json();
        const list = Array.isArray(messages) ? messages : [];
        if (!list.length) break;
        const calls = Calls.fromDiscordMessages(list).map((c) => Object.assign(c, { channel: ch.label }));
        store = Feed.mergeStore(store, calls, list.map((m) => String(m.id)), now, ch.id);
        callers = touch(callers, Calls.applyCallerUpdates(callers, Calls.callerUpdates(list)), now);
        // The very first read takes only the latest messages; after that a full page means there may be more.
        if (!last || list.length < PAGE) break;
      }
    } catch (e) {
      statuses[ch.id] = 'discord_error';
    }
  }
  const state = { status: Feed.rollup(channels.map((c) => statuses[c.id])), channels: channels.map((c) => ({ id: c.id, label: c.label, status: statuses[c.id] })) };
  const next = Object.assign({}, store, state, { checkedAt: now });
  const statusChanged = JSON.stringify(state) !== JSON.stringify({ status: before.status, channels: before.channels }) || !before.checkedAt;
  const dirty = !!mem.dirty || store !== before || statusChanged;
  const callersDirty = !!mem.callersDirty || callers !== callersBefore;
  const gapMs = env.SAVE_GAP_MS === undefined ? 60000 : Number(env.SAVE_GAP_MS) || 0;
  const save = Feed.shouldSave({ dirty: dirty || callersDirty, statusChanged, lastSaveAt: mem.savedAt || 0, now, gapMs });
  if (save && dirty) await env.CALLS.put(KEY, JSON.stringify(next));
  if (save && callersDirty) await env.CALLS.put('callers', JSON.stringify(callers));
  memory.set(env.CALLS, { store: next, callers, savedAt: save ? now : mem.savedAt || 0, dirty: save ? false : dirty, callersDirty: save ? false : callersDirty });
  return { store: next, callers };
}

// Read Discord for this request unless this instance read it moments ago (or force: the schedule, if you add one).
async function refresh(env, force) {
  const gap = env.MIN_GAP_MS === undefined ? 10000 : Number(env.MIN_GAP_MS) || 0;
  const last = lastRun.get(env.CALLS) || 0;
  if (!force && Date.now() - last < gap) return null;
  lastRun.set(env.CALLS, Date.now());
  try { return await poll(env); } catch (e) { return null; }
}

// ---- GMGN read-only proxy (the key stays here as a Worker secret) ----
const GMGN_TTL = 5 * 60000;
const gmgnCache = new Map(); // request -> { at, body }
let gmgnPausedUntil = 0;

async function gmgn(url, env, headers) {
  if (!env.GMGN_API_KEY) return json({ error: 'not_configured' }, 503, headers);
  const req = Feed.gmgnRequest(url.pathname, url.searchParams);
  if (!req) return json({ error: 'not_allowed' }, 400, headers);
  const now = Date.now();
  if (now < gmgnPausedUntil) return json({ error: 'rate_limited', retryAt: gmgnPausedUntil }, 429, headers);
  const key = req.endpoint + '?' + new URLSearchParams(req.params);
  const hit = gmgnCache.get(key);
  if (hit && now - hit.at < GMGN_TTL) return json(hit.body, 200, headers);
  let r, j;
  try {
    r = await fetch(Feed.gmgnUrl(req.endpoint, req.params, Math.floor(now / 1000), crypto.randomUUID()), { headers: { 'X-APIKEY': env.GMGN_API_KEY, 'User-Agent': 'fomo-tracker-worker' } });
    j = await r.json().catch(() => null);
  } catch (e) {
    return json({ error: 'gmgn_unreachable' }, 502, headers);
  }
  // GMGN lengthens a ban when it keeps being asked during one, so stop asking for a minute.
  // GMGN's own reason (never the key) helps tell a busy key from a blocked network.
  const detail = j && (j.message || j.msg || j.reason) ? String(j.message || j.msg || j.reason).slice(0, 200) : '';
  if (r.status === 429) { gmgnPausedUntil = now + 60000; return json({ error: 'rate_limited', detail, gmgnCode: j && j.code, retryAt: gmgnPausedUntil }, 429, headers); }
  if (!r.ok || !j || (j.code !== undefined && j.code !== 0)) return json({ error: detail || 'gmgn_http_' + r.status, gmgnStatus: r.status, gmgnCode: j && j.code }, 502, headers);
  const body = { data: j.data !== undefined ? j.data : j };
  gmgnCache.set(key, { at: now, body });
  if (gmgnCache.size > 300) gmgnCache.delete(gmgnCache.keys().next().value);
  return json(body, 200, headers);
}

// ---- Chatter: Discord's own search over the on chain feed channel, on request only. Nothing is stored. ----
const CHATTER_TTL = 15 * 60000;
const CHATTER_HOURS = 24;
const CHATTER_CONTEXT = 3;   // hits that also get the messages around them (replies often skip the address)
const CHATTER_MAX = 150;
const chatterCache = new Map(); // ca|sym -> { at, body }
let chatterGuild = '';

async function discord(path, env) {
  const r = await fetch('https://discord.com/api/v9' + path, { headers: { Authorization: env.DISCORD_TOKEN } });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function chatter(url, env, headers) {
  const channel = String(env.CHATTER_CHANNEL || '').trim();
  if (!channel || !env.DISCORD_TOKEN) return json({ error: 'not_configured' }, 503, headers);
  const req = Feed.chatterRequest(url.searchParams);
  if (!req) return json({ error: 'bad_request' }, 400, headers);
  const key = req.ca + '|' + req.sym;
  const now = Date.now();
  const hit = chatterCache.get(key);
  if (hit && now - hit.at < CHATTER_TTL) return json(hit.body, 200, headers);
  try {
    if (!chatterGuild) {
      const c = await discord(`/channels/${channel}`, env);
      if (c.status !== 200 || !c.body || !c.body.guild_id) return json({ error: Feed.statusFor(c.status) }, 502, headers);
      chatterGuild = String(c.body.guild_id);
    }
    const after = Feed.snowflakeAt(now - CHATTER_HOURS * 3600000);
    const found = new Map();
    let total = 0;
    for (const term of [req.ca, req.sym ? '$' + req.sym : ''].filter(Boolean)) {
      const s = await discord(`/guilds/${chatterGuild}/messages/search?channel_id=${channel}&min_id=${after}&content=${encodeURIComponent(term)}`, env);
      // Discord answers 202 while it is still indexing the channel.
      if (s.status === 202) return json({ error: 'indexing', retryAfter: (s.body && s.body.retry_after) || 5 }, 503, headers);
      if (s.status !== 200) return json({ error: Feed.statusFor(s.status) }, 502, headers);
      total += Number(s.body && s.body.total_results) || 0;
      for (const m of Feed.searchHits(s.body)) found.set(String(m.id), Object.assign(Feed.trimMessage(m), { hit: true }));
    }
    const newest = [...found.values()].sort((a, b) => b.ts - a.ts).slice(0, CHATTER_CONTEXT);
    for (const h of newest) {
      const around = await discord(`/channels/${channel}/messages?around=${h.id}&limit=10`, env);
      if (around.status === 200 && Array.isArray(around.body)) for (const m of around.body) if (!found.has(String(m.id))) found.set(String(m.id), Feed.trimMessage(m));
    }
    const messages = [...found.values()].sort((a, b) => a.ts - b.ts).slice(-CHATTER_MAX);
    const body = { ca: req.ca, sym: req.sym, total, hours: CHATTER_HOURS, messages, at: now };
    chatterCache.set(key, { at: now, body });
    if (chatterCache.size > 100) chatterCache.delete(chatterCache.keys().next().value);
    return json(body, 200, headers);
  } catch (e) {
    return json({ error: 'discord_error' }, 502, headers);
  }
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, headers) });
}

export default {
  // Optional: a Cron Trigger works too, but it reads around the clock and uses up the free storage writes.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refresh(env, true));
  },
  async fetch(request, env) {
    const headers = Feed.cors(request.headers.get('Origin'), env.ALLOWED_ORIGIN);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    const isGmgn = url.pathname.startsWith('/gmgn/');
    const isChatter = url.pathname === '/chatter';
    if (request.method !== 'GET' || (url.pathname !== '/calls' && !isGmgn && !isChatter)) return json({ error: 'not_found' }, 404, headers);
    if (!Feed.authorized(request.headers.get('x-feed-key') || '', env.FEED_KEY || '')) return json({ error: 'unauthorized' }, 401, headers);
    if (isGmgn) return gmgn(url, env, headers);
    if (isChatter) return chatter(url, env, headers);
    const polled = await refresh(env, false);
    const mem = memory.get(env.CALLS);
    const store = polled ? polled.store : mem ? mem.store : await load(env);
    const since = Number(url.searchParams.get('since')) || 0;
    const csince = Number(url.searchParams.get('csince')) || 0;
    const callers = polled ? polled.callers : mem ? mem.callers : await loadCallers(env);
    const changed = {};
    for (const k of Object.keys(callers)) if ((callers[k].touched || 0) > csince) changed[k] = callers[k];
    return json({ status: store.status, checkedAt: store.checkedAt, now: Date.now(), channels: store.channels || [], calls: Feed.callsSince(store, since), callers: changed }, 200, headers);
  },
};
