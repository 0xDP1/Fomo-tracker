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

// Read every listed channel (read-only), paging forward through anything missed. Saves only when something changed.
async function poll(env) {
  const channels = Feed.parseChannels(env.CHANNEL_ID);
  let store = await load(env);
  // Progress saved by the single-channel version belongs to the first channel listed.
  if (store.lastId && !store.lastIds && channels[0]) store = Object.assign({}, store, { lastIds: { [channels[0].id]: store.lastId } });
  const before = store;
  const now = Date.now();
  let callers = await loadCallers(env);
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
  const changed = store !== before || JSON.stringify(state) !== JSON.stringify({ status: before.status, channels: before.channels }) || !before.checkedAt;
  if (changed) await env.CALLS.put(KEY, JSON.stringify(next));
  if (callers !== callersBefore) await env.CALLS.put('callers', JSON.stringify(callers));
  return { store: next, callers };
}

// Read Discord for this request unless this instance read it moments ago (or force: the schedule, if you add one).
async function refresh(env, force) {
  const gap = env.MIN_GAP_MS === undefined ? 30000 : Number(env.MIN_GAP_MS) || 0;
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
  if (r.status === 429) { gmgnPausedUntil = now + 60000; return json({ error: 'rate_limited', retryAt: gmgnPausedUntil }, 429, headers); }
  if (!r.ok || !j || (j.code !== undefined && j.code !== 0)) return json({ error: (j && (j.message || j.msg)) || 'gmgn_http_' + r.status }, 502, headers);
  const body = { data: j.data !== undefined ? j.data : j };
  gmgnCache.set(key, { at: now, body });
  if (gmgnCache.size > 300) gmgnCache.delete(gmgnCache.keys().next().value);
  return json(body, 200, headers);
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
    if (request.method !== 'GET' || (url.pathname !== '/calls' && !isGmgn)) return json({ error: 'not_found' }, 404, headers);
    if (!Feed.authorized(request.headers.get('x-feed-key') || '', env.FEED_KEY || '')) return json({ error: 'unauthorized' }, 401, headers);
    if (isGmgn) return gmgn(url, env, headers);
    const polled = await refresh(env, false);
    const store = polled ? polled.store : await load(env);
    const since = Number(url.searchParams.get('since')) || 0;
    const csince = Number(url.searchParams.get('csince')) || 0;
    const callers = polled ? polled.callers : await loadCallers(env);
    const changed = {};
    for (const k of Object.keys(callers)) if ((callers[k].touched || 0) > csince) changed[k] = callers[k];
    return json({ status: store.status, checkedAt: store.checkedAt, now: Date.now(), channels: store.channels || [], calls: Feed.callsSince(store, since), callers: changed }, 200, headers);
  },
};
