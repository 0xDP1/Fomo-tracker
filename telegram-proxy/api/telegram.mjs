// Telegram reader for the Fomo Tracker feed: a Vercel function (free tier) that reads the owner's listed Telegram groups
// as their own account and hands the new messages to the feed Worker. Lives here, not in the Worker, because a Telegram
// read takes 20-30 ms of CPU and Cloudflare's free plan allows 10 ms.
//
//   GET /api/telegram?chats=<id>:<last id seen>,<id>:<last id seen>   header x-proxy-key: <TG_PROXY_KEY>
//   -> { chats: { "<id>": { messages: [...], users: [...] } | { error: "TELEGRAM_CODE", seconds? } } }
//
// Read-only by design: the only Telegram request it can send is messages.GetHistory, and only for groups in its own
// TG_CHAT list (so a stolen proxy key can't read your other chats). Settings (Vercel → Environment Variables):
// TG_API_ID, TG_API_HASH, TG_SESSION, TG_CHAT, TG_PROXY_KEY. Set them with: node login.mjs
import { TelegramClient, Api } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import { PromisedWebSockets, Logger } from 'teleproto/extensions/index.js';
import bigInt from 'big-integer';
import { timingSafeEqual } from 'node:crypto';

export const ALLOWED = ['messages.GetHistory'];
export const PAGES = 5;      // pages of 100 messages per group and read (500 messages)
export const PAGE = 100;
export const FIRST = 50;     // the very first read of a group takes only the latest messages

export function makeClient(session, apiId, apiHash) {
  return new TelegramClient(new StringSession(session || ''), Number(apiId), String(apiHash || ''), {
    connectionRetries: 2, // at least one: with 0 the client never tries
    networkSocket: PromisedWebSockets,
    autoReconnect: false,
    baseLogger: new Logger('none'),
  });
}

// The same TG_CHAT format as the Worker: "channel:<id>:<access hash>:<label>" or "chat:<id>:<label>", comma-separated.
export function parseChats(text) {
  const out = new Map();
  for (const part of String(text || '').split(',')) {
    const [kind, id, hash] = part.trim().split(':');
    if (kind === 'channel' && /^\d{1,20}$/.test(id || '') && /^-?\d{1,20}$/.test(hash || '')) out.set(id, { kind, id, hash });
    else if (kind === 'chat' && /^\d{1,20}$/.test(id || '')) out.set(id, { kind, id, hash: '' });
    if (out.size >= 5) break;
  }
  return out;
}

export function peerOf(chat) {
  return chat.kind === 'channel'
    ? new Api.InputPeerChannel({ channelId: bigInt(chat.id), accessHash: bigInt(chat.hash) })
    : new Api.InputPeerChat({ chatId: bigInt(chat.id) });
}

// client: for tests, a stand-in with connect / invoke / destroy.
export async function openTelegram(env, client = makeClient(env.TG_SESSION, env.TG_API_ID, env.TG_API_HASH)) {
  const send = (request) => {
    if (!ALLOWED.includes(request.className)) throw new Error('not allowed: ' + request.className);
    return client.invoke(request);
  };
  await client.connect();
  return {
    history: (chat, { minId = 0, offsetId = 0, limit = PAGE } = {}) => send(new Api.messages.GetHistory({ peer: peerOf(chat), offsetId, offsetDate: 0, addOffset: 0, limit, maxId: 0, minId, hash: bigInt(0) })),
    close: async () => { try { await client.destroy(); } catch (e) { /* already gone */ } },
  };
}

// A decoded Telegram reply -> only what the feed reads, as plain JSON (ids as strings).
export function plainReply(reply) {
  const r = reply || {};
  const s = (v) => (v == null ? undefined : String(v));
  return {
    messages: (r.messages || []).map((m) => (m.className !== 'Message' ? { className: m.className, id: m.id } : {
      className: 'Message', id: m.id, date: m.date, message: m.message || '', postAuthor: m.postAuthor || undefined,
      fromId: m.fromId && m.fromId.userId != null ? { userId: s(m.fromId.userId) } : undefined,
      entities: (m.entities || []).filter((e) => e && e.url).map((e) => ({ url: e.url })),
      media: m.media && m.media.webpage && m.media.webpage.url ? { webpage: { url: m.media.webpage.url } } : undefined,
      replyMarkup: m.replyMarkup && m.replyMarkup.rows ? { rows: m.replyMarkup.rows.map((row) => ({ buttons: (row.buttons || []).map((b) => ({ url: b.url || (b.type && b.type.url) || undefined })) })) } : undefined,
    })),
    users: (r.users || []).map((u) => ({ id: s(u.id), username: u.username || undefined, firstName: u.firstName || undefined, lastName: u.lastName || undefined })),
  };
}

// New messages in one group since lastId: the latest page, then back page by page until it reaches lastId (at most PAGES).
export async function readChat(tg, chat, lastId) {
  const out = { messages: [], users: [] };
  let offsetId = 0;
  for (let page = 0; page < PAGES; page++) {
    const p = plainReply(await tg.history(chat, { minId: lastId, offsetId, limit: lastId ? PAGE : FIRST }));
    out.messages.push(...p.messages);
    out.users.push(...p.users);
    const ids = p.messages.map((m) => Number(m.id)).filter((id) => id > 0);
    if (!lastId || ids.length < PAGE) break;
    offsetId = Math.min(...ids);
  }
  return out;
}

const keyOk = (given, key) => {
  if (!given || !key) return false;
  const a = Buffer.from(String(given)), b = Buffer.from(String(key));
  return a.length === b.length && timingSafeEqual(a, b);
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const codeOf = (e) => String((e && (e.errorMessage || e.message)) || e || 'error').split('\n')[0].slice(0, 120);

export async function handle(request, env, open = openTelegram) {
  if (request.method !== 'GET') return json({ error: 'not_found' }, 404);
  if (!keyOk(request.headers.get('x-proxy-key'), env.TG_PROXY_KEY)) return json({ error: 'unauthorized' }, 401);
  if (!env.TG_SESSION || !env.TG_API_ID || !env.TG_API_HASH) return json({ error: 'not_configured' }, 503);
  const listed = parseChats(env.TG_CHAT);
  const want = [];
  for (const part of String(new URL(request.url).searchParams.get('chats') || '').split(',')) {
    const [id, last] = part.split(':');
    if (listed.has(id) && /^\d{0,12}$/.test(last || '')) want.push({ chat: listed.get(id), lastId: Number(last) || 0 });
  }
  if (!want.length) return json({ error: 'no_listed_chats' }, 400);
  let tg;
  try { tg = await open(env); } catch (e) { return json({ error: codeOf(e), seconds: e && e.seconds }, 502); }
  const chats = {};
  try {
    for (const w of want) {
      try { chats[w.chat.id] = await readChat(tg, w.chat, w.lastId); } catch (e) {
        chats[w.chat.id] = { error: codeOf(e), seconds: e && e.seconds };
        if (/FLOOD|AUTH_KEY|SESSION_/.test(chats[w.chat.id].error)) { for (const r of want) if (!chats[r.chat.id]) chats[r.chat.id] = chats[w.chat.id]; break; }
      }
    }
  } finally {
    await Promise.race([tg.close(), new Promise((r) => setTimeout(r, 2000))]);
  }
  return json({ chats });
}

// Vercel's Node.js runtime calls this with a standard Request.
export function GET(request) {
  return handle(request, process.env);
}
