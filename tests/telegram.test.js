const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../worker/feed-core.js');

// Telegram replies are built from teleproto's own classes and round-tripped through Telegram's binary encoding, so the
// tests read exactly what the Telegram reader decodes. Names, ids and hashes are made up.
const CA_SOL = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr';
const CA_PUMP = 'FrogXKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRpump';
const CA_GMGN = 'Bonk1XKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRbonk';
const CA_BASE = '0x4ed4e862860bed51a9570b96d89af5e1b0efefed';
const T0 = Math.floor(Date.now() / 1000) - 600; // recent: the Worker keeps calls for 3 days, counted from the real clock
const CHAT = { kind: 'channel', id: '1987654321', hash: '-5550001112223334445', key: 'tg:1987654321', label: 'Alpha calls' };

async function tl() {
  const { Api } = await import('teleproto');
  const { BinaryReader } = await import('teleproto/extensions/index.js');
  const bigInt = (await import('big-integer')).default;
  const peer = new Api.PeerChannel({ channelId: bigInt(CHAT.id) });
  const user = (id, o) => new Api.User(Object.assign({ id: bigInt(id), accessHash: bigInt(1) }, o));
  const msg = (id, from, text, o) => new Api.Message(Object.assign({ id, peerId: peer, fromId: new Api.PeerUser({ userId: bigInt(from) }), date: T0 + id, message: text }, o));
  // A reply: messages newest first (as Telegram sends them), the senders in users.
  const reply = (messages, users) => {
    const r = new Api.messages.ChannelMessages({ pts: 1, count: messages.length, messages: messages.slice().sort((a, b) => b.id - a.id), topics: [], chats: [], users });
    return new BinaryReader(r.getBytes()).tgReadObject(); // what Telegram's bytes decode to
  };
  return { Api, bigInt, user, msg, reply };
}

async function sample() {
  const { Api, user, msg, reply } = await tl();
  return reply([
    msg(101, 11, `ape this ${CA_SOL}`),
    msg(102, 12, 'chart looks good', { entities: [new Api.MessageEntityTextUrl({ offset: 0, length: 5, url: `https://pump.fun/coin/${CA_PUMP}` })] }),
    msg(103, 13, 'New call: $BONK1, mc 120k', { replyMarkup: new Api.ReplyInlineMarkup({ rows: [new Api.KeyboardButtonRow({ buttons: [new Api.KeyboardButton({ text: 'GMGN', type: new Api.InlineButtonTypeUrl({ url: `https://gmgn.ai/sol/token/${CA_GMGN}` }) })] })] }) }),
    new Api.MessageService({ id: 104, peerId: new Api.PeerChannel({ channelId: (msg(1, 1, '').peerId.channelId) }), date: T0 + 104, action: new Api.MessageActionPinMessage() }),
    msg(105, 14, `base play ${CA_BASE}`),
    msg(106, 11, 'gm, no coin here'),
  ], [user(11, { username: 'alice' }), user(12, { username: 'bob' }), user(13, { username: 'AlertBot', bot: true, botInfoVersion: 1 }), user(14, { firstName: 'Carol', lastName: 'D' })]);
}

test('parseTelegramChats: supergroups with their access hash, small groups, labels, junk and repeats dropped, at most 5', () => {
  assert.deepEqual(F.parseTelegramChats('channel:1987654321:-5550001112223334445:Alpha calls, chat:4242:Small group'), [
    { kind: 'channel', id: '1987654321', hash: '-5550001112223334445', key: 'tg:1987654321', label: 'Alpha calls' },
    { kind: 'chat', id: '4242', hash: '', key: 'tg:4242', label: 'Small group' },
  ]);
  assert.equal(F.parseTelegramChats('channel:123:Alpha')[0], undefined, 'a channel needs its access hash');
  assert.equal(F.parseTelegramChats('channel:12a:5:x,user:5:x,chat:x').length, 0);
  assert.equal(F.parseTelegramChats('chat:7').map((c) => c.label)[0], 'Telegram 7', 'a missing label gets a name');
  assert.equal(F.parseTelegramChats('chat:1:a,chat:1:b').length, 1, 'no repeats');
  assert.equal(F.parseTelegramChats('chat:1,chat:2,chat:3,chat:4,chat:5,chat:6').length, 5);
  assert.deepEqual(F.parseTelegramChats(''), []);
});

const PROXY = '../telegram-proxy/api/telegram.mjs';

test('telegramToMessages: text, hidden links and bot buttons become Discord-shaped messages, oldest first, service messages skipped', async () => {
  const { plainReply } = await import(PROXY);
  const decoded = await sample();
  // the same result from Telegram's decoded objects and from the reader's plain JSON (what crosses to the Worker)
  for (const reply of [decoded, JSON.parse(JSON.stringify(plainReply(decoded)))]) {
    const msgs = F.telegramToMessages(reply, CHAT);
    assert.deepEqual(msgs.map((m) => m.id), ['101', '102', '103', '105', '106']);
    assert.deepEqual(msgs.map((m) => m.author.username), ['alice', 'bob', 'AlertBot', 'Carol D', 'alice']);
    assert.equal(msgs[0].timestamp, new Date((T0 + 101) * 1000).toISOString());
    assert.match(msgs[1].content, new RegExp(CA_PUMP), 'the link behind the words');
    assert.match(msgs[2].content, new RegExp(CA_GMGN), 'the bot\'s button');
    const Calls = require('../calls.js');
    assert.deepEqual(Calls.fromDiscordMessages(msgs).map((c) => [c.address, c.poster, c.messageId]), [[CA_SOL, 'alice', '101'], [CA_PUMP, 'bob', '102'], [CA_GMGN, 'AlertBot', '103'], [CA_BASE, 'Carol D', '105']]);
  }
  assert.deepEqual(F.telegramToMessages(null, CHAT), []);
});

test('telegramStatus: flood waits pause, a dead session and lost access are named, with Telegram\'s own code', () => {
  assert.deepEqual(F.telegramStatus({ errorMessage: 'FLOOD_WAIT', seconds: 42 }), { status: 'rate_limited', waitS: 42, detail: 'FLOOD_WAIT' });
  assert.equal(F.telegramStatus(new Error('A wait of 30 seconds is required (caused by FLOOD_WAIT_30)')).waitS, 30);
  assert.deepEqual(F.telegramStatus({ errorMessage: 'AUTH_KEY_UNREGISTERED' }), { status: 'session_invalid', detail: 'AUTH_KEY_UNREGISTERED' });
  assert.equal(F.telegramStatus({ errorMessage: 'SESSION_REVOKED' }).status, 'session_invalid');
  assert.equal(F.telegramStatus({ errorMessage: 'CHANNEL_PRIVATE' }).status, 'no_access');
  assert.equal(F.telegramStatus(new Error('the Telegram reader timed out')).status, 'telegram_error');
  assert.equal(F.telegramStatus(new Error('bad\nsecond line <b>')).detail, 'bad', 'one short line, no markup');
});

// ---- The Telegram reader (Vercel function) ----
test('reader: the only request it can send is messages.GetHistory, for the group asked', async () => {
  const { openTelegram, ALLOWED, peerOf } = await import(PROXY);
  assert.deepEqual(ALLOWED, ['messages.GetHistory']);
  const sent = [];
  const fake = { connect: async () => { fake.connected = true; }, invoke: async (r) => { sent.push(r); return { messages: [] }; }, destroy: async () => { fake.destroyed = true; } };
  const tg = await openTelegram({}, fake);
  assert.equal(fake.connected, true);
  assert.deepEqual(Object.keys(tg).sort(), ['close', 'history'], 'nothing else is exposed');
  await tg.history(CHAT, { minId: 100, offsetId: 0, limit: 100 });
  assert.equal(sent[0].className, 'messages.GetHistory');
  assert.deepEqual([sent[0].minId, sent[0].limit, String(sent[0].peer.channelId), String(sent[0].peer.accessHash)], [100, 100, CHAT.id, CHAT.hash]);
  assert.equal(peerOf({ kind: 'chat', id: '4242' }).className, 'InputPeerChat');
  await tg.close();
  assert.equal(fake.destroyed, true);
});

test('reader: reads the TG_CHAT setting exactly as the Worker does', async () => {
  const { parseChats } = await import(PROXY);
  for (const text of ['channel:1987654321:-5550001112223334445:Alpha calls, chat:4242:Small group', 'channel:123:Alpha,chat:7,user:5:x', 'chat:1,chat:2,chat:3,chat:4,chat:5,chat:6']) {
    assert.deepEqual([...parseChats(text).values()], F.parseTelegramChats(text).map(({ kind, id, hash }) => ({ kind, id, hash })), text);
  }
});

// A fake Telegram for the reader: answers each history call with the next reply, records what was asked.
function fakeTelegram(replies) {
  const asked = [];
  const t = { asked, opened: 0, closed: 0, open: async () => { t.opened++; return { history: async (chat, o) => { asked.push(Object.assign({ chat: chat.id }, o)); const r = replies.shift(); if (r instanceof Error) throw r; return r || { messages: [] }; }, close: async () => { t.closed++; } }; } };
  return t;
}
const ENV = { TG_PROXY_KEY: 'proxy-key-123', TG_SESSION: 'session', TG_API_ID: '1', TG_API_HASH: 'h', TG_CHAT: 'channel:1987654321:-5550001112223334445:Alpha calls,chat:4242:Small' };
const req = (q, key = 'proxy-key-123') => new Request('https://reader.example/api/telegram' + q, { headers: { 'x-proxy-key': key } });

test('reader: the first read takes the latest 50; after that it pages back to the last message seen (at most 500)', async () => {
  const { handle } = await import(PROXY);
  const { msg, reply, user } = await tl();
  const u = [user(11, { username: 'alice' })];
  const page = (from, to) => reply(Array.from({ length: to - from + 1 }, (_, i) => msg(from + i, 11, 'chat')), u);
  let tg = fakeTelegram([await sample()]);
  let r = await handle(req('?chats=1987654321:0'), ENV, tg.open);
  const body = await r.json();
  assert.deepEqual(tg.asked, [{ chat: '1987654321', minId: 0, offsetId: 0, limit: 50 }]);
  assert.equal(tg.closed, 1, 'the connection is closed after the read');
  assert.deepEqual(body.chats['1987654321'].messages.map((m) => m.id), [106, 105, 104, 103, 102, 101]);
  assert.ok(!JSON.stringify(body).includes('session'), 'the session never leaves the reader');
  // 300 new messages since 3: the newest 100, then back from the oldest of each page until a page is short
  tg = fakeTelegram([page(204, 303), page(104, 203), page(4, 103)]);
  r = await (await handle(req('?chats=1987654321:3'), ENV, tg.open)).json();
  assert.deepEqual(tg.asked.map((a) => [a.minId, a.offsetId, a.limit]), [[3, 0, 100], [3, 204, 100], [3, 104, 100], [3, 4, 100]]);
  assert.equal(r.chats['1987654321'].messages.length, 300);
  tg = fakeTelegram(Array.from({ length: 9 }, (_, i) => page(1000 - 100 * (i + 1) + 1, 1000 - 100 * i)));
  await handle(req('?chats=1987654321:1'), ENV, tg.open);
  assert.equal(tg.asked.length, 5, 'at most 5 pages');
});

test('reader: key, listed groups only, errors as Telegram\'s own code', async () => {
  const { handle } = await import(PROXY);
  let tg = fakeTelegram([]);
  assert.equal((await handle(req('?chats=1987654321:0', 'wrong'), ENV, tg.open)).status, 401);
  assert.equal((await handle(req('?chats=1987654321:0', ''), ENV, tg.open)).status, 401);
  assert.equal((await handle(req('?chats=1987654321:0'), Object.assign({}, ENV, { TG_PROXY_KEY: '' }), tg.open)).status, 401, 'no key set: serves nobody');
  assert.equal((await handle(req('?chats=999:0'), ENV, tg.open)).status, 400, 'a group not in its own list is refused');
  assert.equal((await handle(new Request('https://reader.example/api/telegram?chats=1987654321:0', { method: 'POST', headers: { 'x-proxy-key': 'proxy-key-123' } }), ENV, tg.open)).status, 404);
  assert.equal(tg.opened, 0, 'none of those touch Telegram');
  // a dead session at connect: one error for the whole read
  let r = await handle(req('?chats=1987654321:0'), ENV, async () => { throw Object.assign(new Error('AUTH_KEY_UNREGISTERED'), { errorMessage: 'AUTH_KEY_UNREGISTERED' }); });
  assert.deepEqual([r.status, await r.json()], [502, { error: 'AUTH_KEY_UNREGISTERED' }]);
  // a flood wait in the first group stops the read and is reported for every group asked
  tg = fakeTelegram([Object.assign(new Error('FLOOD_WAIT'), { errorMessage: 'FLOOD_WAIT', seconds: 120 })]);
  r = await (await handle(req('?chats=1987654321:5,4242:9'), ENV, tg.open)).json();
  assert.deepEqual(r.chats, { 1987654321: { error: 'FLOOD_WAIT', seconds: 120 }, 4242: { error: 'FLOOD_WAIT', seconds: 120 } });
  assert.equal(tg.asked.length, 1);
  // lost access to one group: the other is still read
  tg = fakeTelegram([Object.assign(new Error('CHANNEL_PRIVATE'), { errorMessage: 'CHANNEL_PRIVATE' }), { messages: [] }]);
  r = await (await handle(req('?chats=1987654321:5,4242:9'), ENV, tg.open)).json();
  assert.deepEqual(r.chats, { 1987654321: { error: 'CHANNEL_PRIVATE' }, 4242: { messages: [], users: [] } });
});

// ---- The Worker, with the reader faked ----
function kvEnv(extra) {
  const kv = new Map();
  return Object.assign({ FEED_KEY: 'k', ALLOWED_ORIGIN: 'https://app.example', CHANNEL_ID: '', SAVE_GAP_MS: '0', MIN_GAP_MS: '0', TG_GAP_MS: '0', TG_PROXY_URL: 'https://reader.example/', TG_PROXY_KEY: 'proxy-key-123', TG_CHAT: 'channel:1987654321:-5550001112223334445:Alpha calls', CALLS: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } } }, extra);
}
const ask = async (W, env) => { const r = await W.fetch(new Request('https://w.example/calls', { headers: { 'x-feed-key': 'k' } }), env); return { status: r.status, body: await r.json() }; };
// Replaces fetch: the reader's URL gets `reader(url, headers)`, anything else `other(url)`.
async function withFetch(reader, other, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { const u = String(url); if (u.startsWith('https://reader.example/')) return reader(u, (opts && opts.headers) || {}, opts); return other ? other(u) : new Response('[]'); };
  try { return await fn(); } finally { globalThis.fetch = real; }
}
const ok = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('Worker + reader: asks for new messages since the last seen, puts the calls in the feed with the group as channel', async () => {
  const W = (await import('../worker/index.mjs')).default;
  const { plainReply } = await import(PROXY);
  const sampleJson = JSON.parse(JSON.stringify(plainReply(await sample())));
  const seen = [];
  const env = kvEnv();
  await withFetch((url, h) => { seen.push([url, h['x-proxy-key']]); return ok({ chats: { 1987654321: seen.length === 1 ? sampleJson : { messages: [], users: [] } } }); }, null, async () => {
    const r = await ask(W, env);
    assert.deepEqual(seen[0], ['https://reader.example/api/telegram?chats=1987654321:0', 'proxy-key-123']);
    assert.deepEqual(r.body.calls.map((c) => [c.address, c.poster, c.channel]), [[CA_SOL, 'alice', 'Alpha calls'], [CA_PUMP, 'bob', 'Alpha calls'], [CA_GMGN, 'AlertBot', 'Alpha calls'], [CA_BASE, 'Carol D', 'Alpha calls']]);
    assert.equal(r.body.calls[0].messageId, 'tg:1987654321:101', 'Telegram ids can\'t collide with Discord ones');
    assert.deepEqual([...new Set(r.body.calls.map((c) => c.source))], ['telegram'], 'marked as Telegram calls');
    assert.deepEqual(r.body.telegram.chats, [{ id: '1987654321', label: 'Alpha calls', status: 'ok' }]);
    assert.ok(!JSON.stringify(r.body).includes('proxy-key'), 'the reader key never reaches the app');
    await ask(W, env);
    assert.equal(seen[1][0], 'https://reader.example/api/telegram?chats=1987654321:106', 'the next read starts after the newest message seen');
  });
  // a slower gap: asks within it don't read Telegram
  const slow = kvEnv({ TG_GAP_MS: '60000' });
  let n = 0;
  await withFetch(() => { n++; return ok({ chats: {} }); }, null, async () => { await ask(W, slow); await ask(W, slow); });
  assert.equal(n, 1, 'one read within the gap');
});

test('Worker + reader: a flood wait pauses reads, a dead login and a wrong key say so, Discord keeps working, a stuck reader times out', async () => {
  const W = (await import('../worker/index.mjs')).default;
  let n = 0;
  const env = kvEnv();
  await withFetch(() => { n++; return ok({ chats: { 1987654321: { error: 'FLOOD_WAIT', seconds: 120 } } }); }, null, async () => {
    const r = await ask(W, env);
    assert.equal(r.body.telegram.status, 'rate_limited');
    await ask(W, env);
  });
  assert.equal(n, 1, 'no reads during the wait');

  await withFetch(() => ok({ error: 'AUTH_KEY_UNREGISTERED' }, 502), null, async () => {
    const r = await ask(W, kvEnv());
    assert.deepEqual(r.body.telegram.chats, [{ id: '1987654321', label: 'Alpha calls', status: 'session_invalid', detail: 'AUTH_KEY_UNREGISTERED' }]);
  });
  await withFetch(() => ok({ error: 'unauthorized' }, 401), null, async () => {
    const r = await ask(W, kvEnv());
    assert.equal(r.body.telegram.chats[0].detail, 'the Telegram reader rejected TG_PROXY_KEY');
  });

  // Discord still read and served alongside a broken reader
  await withFetch(() => { throw new Error('reader down'); }, () => ok([{ id: '1300000000000000001', timestamp: new Date(Date.now() - 120000).toISOString(), author: { username: 'dana' }, content: `ape ${CA_SOL}`, embeds: [] }]), async () => {
    const r = await ask(W, kvEnv({ DISCORD_TOKEN: 't', CHANNEL_ID: '555:first scan' }));
    assert.equal(r.body.status, 'ok');
    assert.deepEqual(r.body.calls.map((c) => [c.poster, c.channel, c.source]), [['dana', 'first scan', undefined]], 'Discord calls are not marked');
    assert.equal(r.body.telegram.status, 'telegram_error');
  });

  const t0 = Date.now();
  await withFetch((url, h, opts) => new Promise((_, no) => opts.signal.addEventListener('abort', () => no(Object.assign(new Error('aborted'), { name: 'AbortError' })))), null, async () => {
    const r = await ask(W, kvEnv({ TG_STEP_MS: '60' }));
    assert.equal(r.body.telegram.chats[0].detail, 'the Telegram reader timed out');
  });
  assert.ok(Date.now() - t0 < 3000, 'a stuck reader doesn\'t hold up the reply');
});

test('Worker without Telegram settings: no reader call, no Telegram', async () => {
  const W = (await import('../worker/index.mjs')).default;
  let n = 0;
  await withFetch(() => { n++; return ok({}); }, null, async () => {
    const r = await ask(W, kvEnv({ TG_PROXY_URL: '' }));
    assert.equal(r.body.telegram, null);
  });
  assert.equal(n, 0);
});
