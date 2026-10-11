// Telegram for the feed Worker: the owner's own account (a saved session), over Telegram's WebSocket transport, which is
// what runs inside a Cloudflare Worker. Read-only by design: the only request this file lets through is
// messages.GetHistory for a listed group. Loaded only when TG_SESSION is set (it is large).
import { TelegramClient, Api } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import { PromisedWebSockets, Logger } from 'teleproto/extensions/index.js';
import bigInt from 'big-integer';

export const ALLOWED = ['messages.GetHistory'];

export function makeClient(session, apiId, apiHash) {
  const client = new TelegramClient(new StringSession(session || ''), Number(apiId), String(apiHash || ''), {
    connectionRetries: 2, // at least one: with 0 the client never tries
    networkSocket: PromisedWebSockets,
    autoReconnect: false,
    baseLogger: new Logger('none'), // silent from the start (setLogLevel comes after the version banner)
  });
  return client;
}

// chat: one entry of Feed.parseTelegramChats. A Telegram InputPeer for it.
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
    // Messages newer than minId (newest first, at most limit), below offsetId when paging back.
    history: (chat, { minId = 0, offsetId = 0, limit = 100 } = {}) => send(new Api.messages.GetHistory({ peer: peerOf(chat), offsetId, offsetDate: 0, addOffset: 0, limit, maxId: 0, minId, hash: bigInt(0) })),
    close: async () => { try { await client.destroy(); } catch (e) { /* already gone */ } },
  };
}
