// Discord feed Worker. When the app asks GET /calls?since=<ms> (with the feed key) it reads new messages in each listed channel
// (read-only, with the token stored as a Cloudflare secret), catches up on anything missed, and keeps the contract addresses it finds.
// With TG_PROXY_URL, TG_PROXY_KEY and TG_CHAT set it also reads private Telegram groups, through the owner's Telegram reader
// on Vercel (telegram-proxy/), which holds the Telegram login.
import Calls from '../calls.js';
import Feed from './feed-core.js';
import Recent from '../recent.js';
import AlertsCore from './alerts-core.js';
import CrawlCore from '../crawlscan.js';

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

// ---- Telegram: listed groups only, read by the Telegram reader on Vercel (telegram-proxy/), at most once per TG_GAP_MS ----
// The Worker never holds the Telegram login: it asks the reader for new messages since the last one it saw.
const TG_STEP_MS = 15000;    // a stuck reader must never hold up the Discord reply
const tgRun = new WeakMap(); // storage binding -> { lastAt, pausedUntil }

async function askReader(env, chats, store, probe = false) {
  const url = String(env.TG_PROXY_URL).replace(/\/+$/, '') + '/api/telegram?chats=' + chats.map((c) => `${c.id}:${probe ? 0 : (store.lastIds || {})[c.key] || 0}`).join(',');
  const ms = env.TG_STEP_MS === undefined ? TG_STEP_MS : Number(env.TG_STEP_MS) || TG_STEP_MS;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'x-proxy-key': env.TG_PROXY_KEY }, signal: ctrl.signal });
    const j = await r.json().catch(() => null);
    if (r.status === 401) throw new Error('the Telegram reader rejected TG_PROXY_KEY');
    if (!j || (!r.ok && !j.error)) throw new Error('the Telegram reader answered HTTP ' + r.status);
    if (j.error) throw Object.assign(new Error(j.error), { errorMessage: j.error, seconds: j.seconds });
    return j.chats || {};
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('the Telegram reader timed out', { cause: e });
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// Returns null when it is not time to read (the last state stays), else the new store, callers and Telegram state.
async function pollTelegram(env, store, callers, now) {
  const chats = Feed.parseTelegramChats(env.TG_CHAT);
  if (!chats.length || !env.TG_PROXY_URL || !env.TG_PROXY_KEY) return null;
  const run = tgRun.get(env.CALLS) || { lastAt: 0, pausedUntil: 0 };
  const gap = env.TG_GAP_MS === undefined ? 20000 : Number(env.TG_GAP_MS) || 0;
  if (now < run.pausedUntil || now - run.lastAt < gap) return null;
  run.lastAt = now;
  tgRun.set(env.CALLS, run);
  const result = {};
  const fail = (e) => { const st = Feed.telegramStatus(e); if (st.waitS) run.pausedUntil = now + st.waitS * 1000; return Object.assign({ status: st.status }, st.detail ? { detail: st.detail } : {}); };
  // bug 25: every 15 minutes read each group's latest page with no pointer as well (newest message time, stuck pointer).
  const prev = Object.fromEntries((((store.telegram || {}).chats) || []).map((c) => [String(c.id), c]));
  // Only once a pointer exists (a first read takes the latest page anyway), and only after a clean normal read (never
  // during a flood wait or with a dead login).
  const probe = Feed.probeDue(store.telegram, now, env.TG_PROBE_MS === undefined ? undefined : Number(env.TG_PROBE_MS) || 0) && chats.some((c) => (store.lastIds || {})[c.key]);
  const newest = {};
  const take = (got) => {
    for (const chat of chats) {
      const reply = got[chat.id];
      if (!reply) { result[chat.id] = { status: 'telegram_error', detail: 'not read' }; continue; }
      if (reply.error) { result[chat.id] = fail({ errorMessage: reply.error, seconds: reply.seconds }); continue; }
      result[chat.id] = { status: 'ok' };
      const n = Feed.newestOf(reply);
      if (n && (!newest[chat.id] || Number(n.latestId) > Number(newest[chat.id].latestId))) newest[chat.id] = n;
      const list = Feed.telegramToMessages(reply, chat);
      if (!list.length) continue;
      const calls = Calls.fromDiscordMessages(list).map((c) => Object.assign(c, { channel: chat.label, source: 'telegram', messageId: chat.key + ':' + c.messageId }));
      store = Feed.mergeStore(store, calls, list.map((m) => m.id), now, chat.key);
      callers = touch(callers, Calls.applyCallerUpdates(callers, Calls.callerUpdates(list)), now);
    }
  };
  let got = null;
  try { got = await askReader(env, chats, store); } catch (e) { const st = fail(e); for (const c of chats) result[c.id] = st; }
  if (got) take(got);
  if (got && probe && chats.every((c) => result[c.id] && result[c.id].status === 'ok')) {
    let latest = null;
    try { latest = await askReader(env, chats, store, true); } catch (e) { /* the normal read stands; the probe tries again next time */ }
    if (latest) take(latest);
  }
  const list = chats.map((c) => {
    const p = prev[String(c.id)] || {};
    const n = newest[c.id] || (p.latestId ? { latestId: p.latestId, latestAt: p.latestAt } : {});
    return Object.assign({ id: c.id, label: c.label }, n, result[c.id]);
  });
  const probedAt = got && probe && chats.every((c) => result[c.id] && result[c.id].status === 'ok') ? now : (store.telegram && store.telegram.probedAt) || 0;
  return { store, callers, telegram: { status: Feed.rollup(list.map((c) => c.status)), checkedAt: now, probedAt, chats: list } };
}

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
  const tgOut = await pollTelegram(env, store, callers, now);
  if (tgOut) { store = tgOut.store; callers = tgOut.callers; }
  const telegram = tgOut ? tgOut.telegram : before.telegram;
  const state = { status: Feed.rollup(channels.map((c) => statuses[c.id])), channels: channels.map((c) => ({ id: c.id, label: c.label, status: statuses[c.id] })) };
  const next = Object.assign({}, store, state, telegram ? { telegram } : {}, { checkedAt: now });
  const tgKey = (t) => (t ? { status: t.status, chats: t.chats } : null);
  const statusChanged = JSON.stringify([state, tgKey(telegram)]) !== JSON.stringify([{ status: before.status, channels: before.channels }, tgKey(before.telegram)]) || !before.checkedAt;
  const dirty = !!mem.dirty || store !== before || statusChanged;
  const callersDirty = !!mem.callersDirty || callers !== callersBefore;
  const gapMs = env.SAVE_GAP_MS === undefined ? 60000 : Number(env.SAVE_GAP_MS) || 0;
  const save = Feed.shouldSave({ dirty: dirty || callersDirty, statusChanged, lastSaveAt: mem.savedAt || 0, now, gapMs });
  if (save && dirty) await env.CALLS.put(KEY, JSON.stringify(next));
  if (save && callersDirty) await env.CALLS.put('callers', JSON.stringify(callers));
  memory.set(env.CALLS, { store: next, callers, savedAt: save ? now : mem.savedAt || 0, dirty: save ? false : dirty, callersDirty: save ? false : callersDirty });
  return { store: next, callers };
}

// ---- Alerts (docs/features/worker-alerts.md): on the schedule, price the last day's calls and message the Telegram bot ----
// Needs the TG_BOT_TOKEN secret (a bot from @BotFather) and one message from the owner to the bot, so it knows the chat.
// Storage is written only when a base, peak or alert changed, to stay inside the free plan's 1,000 writes a day.
const DEX_TOKENS = 'https://api.dexscreener.com/latest/dex/tokens/';
const TG_API = 'https://api.telegram.org/bot';

async function tgChatId(token) {
  try { const r = await fetch(`${TG_API}${token}/getUpdates?limit=100`); const j = await r.json(); return AlertsCore.chatIdFrom(j && j.result); } catch (e) { return null; }
}
async function tgSend(token, chatId, text) {
  try {
    const r = await fetch(`${TG_API}${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }) });
    return r.ok;
  } catch (e) { return false; }
}
async function dexPairs(addrs) {
  const out = {};
  for (const batch of AlertsCore.batches(addrs)) {
    try { const r = await fetch(DEX_TOKENS + batch.join(',')); const j = await r.json(); Object.assign(out, AlertsCore.bestPairs(j && j.pairs)); } catch (e) { /* this batch waits for the next round */ }
  }
  return out;
}

async function alertRound(env) {
  if (!env.TG_BOT_TOKEN) return null;
  const mem = memory.get(env.CALLS) || {};
  const store = mem.store || await load(env);
  const now = Date.now();
  const before = store.alerts || {};
  const al = { track: before.track || {}, chatId: before.chatId || env.TG_CHAT_ID || null, sent: before.sent || [], at: now, note: '' };
  if (!al.chatId) al.chatId = await tgChatId(env.TG_BOT_TOKEN);
  if (!al.chatId) al.note = 'no chat yet: send the bot any message';
  const queue = AlertsCore.queueFrom(store.calls, now);
  const addrs = Recent.recentAddresses(queue);
  const pairs = addrs.length ? await dexPairs(addrs) : {};
  const r = AlertsCore.round(al.track, queue, pairs, now);
  al.track = r.track;
  for (const a of r.alerts) {
    const text = AlertsCore.message(a, r.track[a.address], queue[a.address], now);
    const ok = al.chatId ? await tgSend(env.TG_BOT_TOKEN, al.chatId, text) : false;
    al.sent = AlertsCore.remember(al.sent, { at: now, address: a.address, symbol: a.symbol, level: a.level || null, kind: a.kind || 'level', ok });
  }
  const next = Object.assign({}, store, { alerts: al });
  const dirty = AlertsCore.changed(before.track, al.track) || r.alerts.length > 0 || al.chatId !== (before.chatId || null) || al.note !== (before.note || '');
  memory.set(env.CALLS, Object.assign({}, mem, { store: next, savedAt: dirty ? now : mem.savedAt || 0, dirty: dirty ? false : mem.dirty }));
  if (dirty) await env.CALLS.put(KEY, JSON.stringify(next));
  return { alerts: r.alerts, al };
}

// The app's view of the alerts: the Worker's track (merged on this device), what was sent, whether the bot is set up.
const alertsOut = (store, env) => Object.assign({ on: !!env.TG_BOT_TOKEN }, store.alerts ? { track: store.alerts.track || {}, sent: (store.alerts.sent || []).slice(-20), at: store.alerts.at || 0, chat: !!store.alerts.chatId, note: store.alerts.note || '' } : {});

// ---- CrawlScan (docs/features/crawlscan.md): crawlscan.fun's scan on demand, through here because their API has no CORS ----
// One scan per coin per 30 minutes (their servers do the work), kept in this instance and in storage. A scan that isn't
// done within WAIT_MS answers { pending: true } and the app asks again; the job id is kept so the wait resumes.
const CRAWL_API = 'https://crawlscan.fun/api/';
const crawlCache = new Map(); // ca -> summary
const crawlJobs = new Map();  // ca -> { job, at }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function crawlResult(job) {
  const r = await fetch(`${CRAWL_API}result?job=${encodeURIComponent(job)}`);
  return r.json().catch(() => null);
}

async function crawl(url, env, headers) {
  const ca = String(url.searchParams.get('ca') || '').trim();
  if (!CrawlCore.isSolana(ca)) return json({ error: 'not_solana' }, 400, headers);
  const now = Date.now();
  const hit = crawlCache.get(ca);
  if (CrawlCore.fresh(hit, now) && !url.searchParams.get('fresh')) return json({ data: hit, cached: true }, 200, headers);
  const stored = hit ? null : await env.CALLS.get('crawl:' + ca).then((raw) => { try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }).catch(() => null);
  if (CrawlCore.fresh(stored, now) && !url.searchParams.get('fresh')) { crawlCache.set(ca, stored); return json({ data: stored, cached: true }, 200, headers); }
  let job = crawlJobs.get(ca);
  if (!job || now - job.at > CrawlCore.JOB_TTL_MS) {
    let r, body;
    try { r = await fetch(CRAWL_API + 'scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: ca }) }); body = await r.json().catch(() => null); }
    catch (e) { return json({ error: 'unreachable' }, 502, headers); }
    const out = CrawlCore.startOutcome(r.status, body);
    if (out.error) return json({ error: out.error }, out.error === 'paused' ? 503 : 502, headers);
    job = { job: out.job, at: now };
    crawlJobs.set(ca, job);
  }
  const deadline = Date.now() + CrawlCore.WAIT_MS;
  let answer = null;
  while (Date.now() < deadline) {
    let d;
    try { d = await crawlResult(job.job); } catch (e) { d = null; }
    if (d && d.done) { answer = d; break; }
    await sleep(CrawlCore.POLL_MS);
  }
  if (!answer) return json({ pending: true, job: job.job }, 202, headers);
  crawlJobs.delete(ca);
  if (answer.error) return json({ error: String(answer.error).slice(0, 160) }, 502, headers);
  const s = CrawlCore.summarize(answer, Date.now());
  if (!s) return json({ error: 'no_result' }, 502, headers);
  crawlCache.set(ca, s);
  try { await env.CALLS.put('crawl:' + ca, JSON.stringify(s), { expirationTtl: Math.ceil(CrawlCore.TTL_MS / 1000) }); } catch (e) { /* storage is a convenience here */ }
  return json({ data: s, cached: false }, 200, headers);
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
    const init = { method: req.method || 'GET', headers: { 'X-APIKEY': env.GMGN_API_KEY, 'User-Agent': 'fomo-tracker-worker' } };
    if (req.body) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(req.body); }
    r = await fetch(Feed.gmgnUrl(req.endpoint, req.params, Math.floor(now / 1000), crypto.randomUUID(), init.method), init);
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
    ctx.waitUntil(refresh(env, true).then(() => alertRound(env)));
  },
  async fetch(request, env) {
    const headers = Feed.cors(request.headers.get('Origin'), env.ALLOWED_ORIGIN);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    const isGmgn = url.pathname.startsWith('/gmgn/');
    const isChatter = url.pathname === '/chatter';
    const isCrawl = url.pathname === '/crawl';
    if (request.method !== 'GET' || (url.pathname !== '/calls' && !isGmgn && !isChatter && !isCrawl)) return json({ error: 'not_found' }, 404, headers);
    if (!Feed.authorized(request.headers.get('x-feed-key') || '', env.FEED_KEY || '')) return json({ error: 'unauthorized' }, 401, headers);
    if (isGmgn) return gmgn(url, env, headers);
    if (isChatter) return chatter(url, env, headers);
    if (isCrawl) return crawl(url, env, headers);
    const polled = await refresh(env, false);
    const mem = memory.get(env.CALLS);
    const store = polled ? polled.store : mem ? mem.store : await load(env);
    const since = Number(url.searchParams.get('since')) || 0;
    const csince = Number(url.searchParams.get('csince')) || 0;
    const callers = polled ? polled.callers : mem ? mem.callers : await loadCallers(env);
    const changed = {};
    for (const k of Object.keys(callers)) if ((callers[k].touched || 0) > csince) changed[k] = callers[k];
    return json({ status: store.status, checkedAt: store.checkedAt, now: Date.now(), channels: store.channels || [], telegram: store.telegram || null, calls: Feed.callsSince(store, since), callers: changed, alerts: alertsOut(store, env) }, 200, headers);
  },
};
