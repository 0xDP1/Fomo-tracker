const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../worker/feed-core.js');

// Telegram replies are built from teleproto's own classes and round-tripped through Telegram's binary encoding, so the
// tests read exactly what the Worker decodes. Names, ids and hashes are made up.
const CA_SOL = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr';
const CA_PUMP = 'FrogXKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRpump';
const CA_GMGN = 'Bonk1XKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRbonk';
const CA_BASE = '0x4ed4e862860bed51a9570b96d89af5e1b0efefed';
const T0 = Math.floor(Date.parse('2026-10-08T14:50:00Z') / 1000);
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

test('telegramToMessages: text, hidden links and bot buttons become Discord-shaped messages, oldest first, service messages skipped', async () => {
  const msgs = F.telegramToMessages(await sample(), CHAT);
  assert.deepEqual(msgs.map((m) => m.id), ['101', '102', '103', '105', '106']);
  assert.deepEqual(msgs.map((m) => m.author.username), ['alice', 'bob', 'AlertBot', 'Carol D', 'alice']);
  assert.equal(msgs[0].timestamp, new Date((T0 + 101) * 1000).toISOString());
  assert.match(msgs[1].content, new RegExp(CA_PUMP), 'the link behind the words');
  assert.match(msgs[2].content, new RegExp(CA_GMGN), 'the bot\'s button');
  // through the same parser as Discord
  const Calls = require('../calls.js');
  const calls = Calls.fromDiscordMessages(msgs);
  assert.deepEqual(calls.map((c) => [c.address, c.poster, c.messageId]), [[CA_SOL, 'alice', '101'], [CA_PUMP, 'bob', '102'], [CA_GMGN, 'AlertBot', '103'], [CA_BASE, 'Carol D', '105']]);
  assert.deepEqual(F.telegramToMessages(null, CHAT), []);
});

test('telegramStatus: flood waits pause, a dead session and lost access are named, with Telegram\'s own code', () => {
  assert.deepEqual(F.telegramStatus({ errorMessage: 'FLOOD_WAIT', seconds: 42 }), { status: 'rate_limited', waitS: 42, detail: 'FLOOD_WAIT' });
  assert.equal(F.telegramStatus(new Error('A wait of 30 seconds is required (caused by FLOOD_WAIT_30)')).waitS, 30);
  assert.deepEqual(F.telegramStatus({ errorMessage: 'AUTH_KEY_UNREGISTERED' }), { status: 'session_invalid', detail: 'AUTH_KEY_UNREGISTERED' });
  assert.equal(F.telegramStatus({ errorMessage: 'SESSION_REVOKED' }).status, 'session_invalid');
  assert.equal(F.telegramStatus({ errorMessage: 'CHANNEL_PRIVATE' }).status, 'no_access');
  assert.equal(F.telegramStatus(new Error('Telegram read timed out')).status, 'telegram_error');
  assert.equal(F.telegramStatus(new Error('bad\nsecond line <b>')).detail, 'bad', 'one short line, no markup');
});

test('openTelegram: the only request it can send is messages.GetHistory for the listed group', async () => {
  const { openTelegram, ALLOWED, peerOf } = await import('../worker/telegram.mjs');
  assert.deepEqual(ALLOWED, ['messages.GetHistory']);
  const sent = [];
  const fake = { connected: false, connect: async () => { fake.connected = true; }, invoke: async (r) => { sent.push(r); return { messages: [] }; }, destroy: async () => { fake.destroyed = true; } };
  const tg = await openTelegram({}, fake);
  assert.equal(fake.connected, true);
  assert.deepEqual(Object.keys(tg).sort(), ['close', 'history'], 'nothing else is exposed');
  await tg.history(CHAT, { minId: 100, offsetId: 0, limit: 100 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].className, 'messages.GetHistory');
  assert.equal(sent[0].minId, 100);
  assert.equal(sent[0].limit, 100);
  assert.equal(String(sent[0].peer.channelId), CHAT.id);
  assert.equal(String(sent[0].peer.accessHash), CHAT.hash);
  assert.equal(peerOf({ kind: 'chat', id: '4242' }).className, 'InputPeerChat');
  await tg.close();
  assert.equal(fake.destroyed, true);
});

// ---- The Worker with Telegram faked ----
const H = 'x-feed-key';
function kvEnv(extra) {
  const kv = new Map();
  return Object.assign({ FEED_KEY: 'k', ALLOWED_ORIGIN: 'https://app.example', CHANNEL_ID: '', SAVE_GAP_MS: '0', MIN_GAP_MS: '0', TG_GAP_MS: '0', TG_SESSION: 'session', TG_API_ID: '1', TG_API_HASH: 'h', TG_CHAT: 'channel:1987654321:-5550001112223334445:Alpha calls', CALLS: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } } }, extra);
}
// A fake Telegram: answers each history call with the next reply, records what was asked.
function fakeTelegram(replies) {
  const asked = [];
  let opened = 0, closed = 0;
  return { asked, get opened() { return opened; }, get closed() { return closed; }, open: async () => { opened++; return { history: async (chat, o) => { asked.push(Object.assign({ chat: chat.id }, o)); const r = replies.shift(); if (r instanceof Error) throw r; return typeof r === 'function' ? r() : r || { messages: [] }; }, close: async () => { closed++; } }; } };
}
const ask = async (W, env, q = '') => { const r = await W.fetch(new Request('https://w.example/calls' + q, { headers: { [H]: 'k' } }), env); return { status: r.status, body: await r.json() }; };

test('Worker + Telegram: reads the listed group when the app asks, puts its calls in the feed with the group as channel', async () => {
  const W = (await import('../worker/index.mjs')).default;
  const tg = fakeTelegram([await sample()]);
  const env = kvEnv({ __tgOpen: tg.open });
  const r = await ask(W, env);
  assert.equal(r.status, 200);
  assert.deepEqual(tg.asked, [{ chat: '1987654321', minId: 0, offsetId: 0, limit: 50 }], 'the first read takes only the latest 50');
  assert.equal(tg.closed, 1, 'the connection is closed after the read');
  assert.deepEqual(r.body.calls.map((c) => [c.address, c.poster, c.channel]), [[CA_SOL, 'alice', 'Alpha calls'], [CA_PUMP, 'bob', 'Alpha calls'], [CA_GMGN, 'AlertBot', 'Alpha calls'], [CA_BASE, 'Carol D', 'Alpha calls']]);
  assert.equal(r.body.calls[0].messageId, 'tg:1987654321:101', 'Telegram ids can\'t collide with Discord ones');
  assert.deepEqual(r.body.telegram.chats, [{ id: '1987654321', label: 'Alpha calls', status: 'ok' }]);
  assert.equal(r.body.telegram.status, 'ok');
  assert.ok(!JSON.stringify(r.body).includes('session'), 'the session never reaches the app');
  const saved = JSON.parse(await env.CALLS.get('store3'));
  assert.equal(saved.lastIds['tg:1987654321'], '106', 'progress is the newest message seen');
});

test('Worker + Telegram: catches up page by page after a gap, and reads at most once per TG_GAP_MS', async () => {
  const W = (await import('../worker/index.mjs')).default;
  const { msg, reply, user } = await tl();
  const u = [user(11, { username: 'alice' })];
  const page = (from, to, ca) => reply(Array.from({ length: to - from + 1 }, (_, i) => msg(from + i, 11, ca && i === 0 ? `new ${ca}` : 'chat')), u);
  const tg = fakeTelegram([page(1, 3), page(204, 303), page(104, 203), page(4, 103, CA_SOL)]);
  const env = kvEnv({ __tgOpen: tg.open });
  await ask(W, env);
  const r = await ask(W, env);
  // 300 new messages: 100 newest, then back from the oldest of each page until a page is short
  assert.deepEqual(tg.asked.slice(1).map((a) => [a.minId, a.offsetId, a.limit]), [[3, 0, 100], [3, 204, 100], [3, 104, 100], [3, 4, 100]]);
  assert.equal(JSON.parse(await env.CALLS.get('store3')).lastIds['tg:1987654321'], '303');
  assert.deepEqual(r.body.calls.map((c) => c.messageId), ['tg:1987654321:4'], 'found on the oldest page of the catch-up');
  // a slower gap: the next asks within it don't read Telegram
  const slow = kvEnv({ __tgOpen: tg.open, TG_GAP_MS: '60000' });
  const before = tg.asked.length;
  await ask(W, slow); await ask(W, slow);
  assert.equal(tg.asked.length, before + 1, 'one read within the gap');
});

test('Worker + Telegram: a flood wait pauses reads, a dead session says so, Discord keeps working, a stuck read times out', async () => {
  const W = (await import('../worker/index.mjs')).default;
  const flood = Object.assign(new Error('FLOOD_WAIT'), { errorMessage: 'FLOOD_WAIT', seconds: 120 });
  let tg = fakeTelegram([flood]);
  let env = kvEnv({ __tgOpen: tg.open });
  let r = await ask(W, env);
  assert.equal(r.body.telegram.status, 'rate_limited');
  await ask(W, env);
  assert.equal(tg.asked.length, 1, 'no reads during the wait');

  tg = fakeTelegram([]);
  env = kvEnv({ __tgOpen: async () => { throw Object.assign(new Error('AUTH_KEY_UNREGISTERED'), { errorMessage: 'AUTH_KEY_UNREGISTERED' }); } });
  r = await ask(W, env);
  assert.deepEqual(r.body.telegram.chats, [{ id: '1987654321', label: 'Alpha calls', status: 'session_invalid', detail: 'AUTH_KEY_UNREGISTERED' }]);

  // Discord still read and served alongside a broken Telegram
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([{ id: '1300000000000000001', timestamp: '2026-10-08T14:58:00.000Z', author: { username: 'dana' }, content: `ape ${CA_SOL}`, embeds: [] }]), { status: 200 });
  try {
    r = await ask(W, kvEnv({ DISCORD_TOKEN: 't', CHANNEL_ID: '555:first scan', __tgOpen: async () => { throw new Error('boom'); } }));
    assert.equal(r.body.status, 'ok');
    assert.deepEqual(r.body.calls.map((c) => [c.poster, c.channel]), [['dana', 'first scan']]);
    assert.equal(r.body.telegram.status, 'telegram_error');
  } finally { globalThis.fetch = realFetch; }

  const t0 = Date.now();
  r = await ask(W, kvEnv({ TG_STEP_MS: '60', __tgOpen: async () => ({ history: () => new Promise(() => {}), close: () => new Promise(() => {}) }) }));
  assert.equal(r.body.telegram.chats[0].detail, 'Telegram read timed out');
  assert.ok(Date.now() - t0 < 3000, 'a stuck Telegram doesn\'t hold up the reply');
});

test('Worker without Telegram settings: no Telegram, nothing loaded', async () => {
  const W = (await import('../worker/index.mjs')).default;
  let opened = 0;
  const r = await ask(W, kvEnv({ TG_SESSION: '', __tgOpen: async () => { opened++; return {}; } }));
  assert.equal(opened, 0);
  assert.equal(r.body.telegram, null);
});
