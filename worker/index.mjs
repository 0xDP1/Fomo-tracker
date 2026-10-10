// Discord feed Worker. Every minute it reads new messages in each listed channel (read-only, with the token stored as a
// Cloudflare secret) and keeps the contract addresses it finds. The app asks GET /calls?since=<ms> with the feed key.
import Calls from '../calls.js';
import Feed from './feed-core.js';

const KEY = 'store';

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

async function poll(env) {
  const channels = Feed.parseChannels(env.CHANNEL_ID);
  let store = await load(env);
  // Progress saved by the single-channel version belongs to the first channel listed.
  if (store.lastId && !store.lastIds && channels[0]) store = Object.assign({}, store, { lastIds: { [channels[0].id]: store.lastId } });
  const now = Date.now();
  let callers = await loadCallers(env);
  const callersBefore = callers;
  const statuses = {};
  let stop = false;
  for (const ch of channels) {
    if (stop) { statuses[ch.id] = 'token_invalid'; continue; }
    let url = `https://discord.com/api/v10/channels/${ch.id}/messages?limit=50`;
    const last = (store.lastIds || {})[ch.id];
    if (last) url += `&after=${last}`;
    try {
      const r = await fetch(url, { method: 'GET', headers: { Authorization: env.DISCORD_TOKEN } });
      const status = Feed.statusFor(r.status);
      statuses[ch.id] = status;
      if (status === 'ok') {
        const messages = await r.json();
        const list = Array.isArray(messages) ? messages : [];
        const calls = Calls.fromDiscordMessages(list).map((c) => Object.assign(c, { channel: ch.label }));
        store = Feed.mergeStore(store, calls, list.map((m) => String(m.id)), now, ch.id);
        callers = touch(callers, Calls.applyCallerUpdates(callers, Calls.callerUpdates(list)), now);
      } else if (status === 'token_invalid') stop = true; // the token is rejected everywhere; don't keep asking
    } catch (e) {
      statuses[ch.id] = 'discord_error';
    }
  }
  const next = Object.assign({}, store, { status: Feed.rollup(channels.map((c) => statuses[c.id])), checkedAt: now, channels: channels.map((c) => ({ id: c.id, label: c.label, status: statuses[c.id] })) });
  await env.CALLS.put(KEY, JSON.stringify(next));
  if (callers !== callersBefore) await env.CALLS.put('callers', JSON.stringify(callers));
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, headers) });
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(poll(env));
  },
  async fetch(request, env) {
    const headers = Feed.cors(request.headers.get('Origin'), env.ALLOWED_ORIGIN);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.pathname !== '/calls') return json({ error: 'not_found' }, 404, headers);
    if (!Feed.authorized(request.headers.get('x-feed-key') || '', env.FEED_KEY || '')) return json({ error: 'unauthorized' }, 401, headers);
    const store = await load(env);
    const since = Number(url.searchParams.get('since')) || 0;
    const csince = Number(url.searchParams.get('csince')) || 0;
    const callers = await loadCallers(env);
    const changed = {};
    for (const k of Object.keys(callers)) if ((callers[k].touched || 0) > csince) changed[k] = callers[k];
    return json({ status: store.status, checkedAt: store.checkedAt, now: Date.now(), channels: store.channels || [], calls: Feed.callsSince(store, since), callers: changed }, 200, headers);
  },
};
