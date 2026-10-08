// Discord feed Worker. Every minute it reads new messages in one channel (read-only, with the token stored as a
// Cloudflare secret) and keeps the contract addresses it finds. The app asks GET /calls?since=<ms> with the feed key.
import Calls from '../calls.js';
import Feed from './feed-core.js';

const KEY = 'store';

async function load(env) {
  const raw = await env.CALLS.get(KEY);
  try { return raw ? JSON.parse(raw) : Feed.emptyStore(); } catch (e) { return Feed.emptyStore(); }
}

async function poll(env) {
  const store = await load(env);
  const now = Date.now();
  let url = `https://discord.com/api/v10/channels/${env.CHANNEL_ID}/messages?limit=50`;
  if (store.lastId) url += `&after=${store.lastId}`;
  let next;
  try {
    const r = await fetch(url, { method: 'GET', headers: { Authorization: env.DISCORD_TOKEN } });
    const status = Feed.statusFor(r.status);
    if (status === 'ok') {
      const messages = await r.json();
      const list = Array.isArray(messages) ? messages : [];
      next = Feed.mergeStore(store, Calls.fromDiscordMessages(list), list.map((m) => String(m.id)), now);
      next.status = 'ok';
    } else {
      next = Object.assign({}, store, { status });
    }
  } catch (e) {
    next = Object.assign({}, store, { status: 'discord_error' });
  }
  next.checkedAt = now;
  await env.CALLS.put(KEY, JSON.stringify(next));
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
    return json({ status: store.status, checkedAt: store.checkedAt, calls: Feed.callsSince(store, since) }, 200, headers);
  },
};
