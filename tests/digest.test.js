// docs/features/feed-digest.md: the whole on chain feed over a window, by chat and by coin, the prompt and Claude's answer.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../digest.js');

const T0 = 1791700000000;
const SOL = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', SOL2 = '8vYJgiQPkpDtbWkDy1wyYDcUq3D9fUXVJUtt6aNEpump', EVM = '0xB0FEA7BE600C85E2F4FE90821F304BC1578D4444';
const m = (i, author, text, card) => ({ id: String(i), ts: T0 + i * 60000, author, text, card: !!card, cardTitle: card || '', replyTo: '' });
const MSGS = [
  m(1, '[SS] Arachnaught', `aping ${SOL} dev is based`),
  m(2, '[PRO] Rick', '', 'PEPE [300K/12%]'),
  m(3, '[CPT] kai', `${SOL} looks bundled to me`),
  m(4, '[SS] zed', '$PEPE KOL just bought'),
  m(5, '[WG] mo', `$DOGE2 ${SOL2} new meta is dogs`),
  m(6, '[WG] mo', '$DOGE2 sending'),
  m(7, '[CPT] kai', `${EVM} base play`),
  m(8, '[SS] Arachnaught', 'holding'),
  m(9, 'plainuser', `${SOL} chart`),
  m(10, '[PRO] Rick', '', 'DOGE2 [90K/4%]'),
];

test('build: chats by talk, coins by how many chats named them, a ticker joined to its address, scans counted not credited', () => {
  const d = D.build(MSGS, T0 + 11 * 60000);
  assert.deepEqual(d.groups.map((g) => [g.code, g.messages, g.scans, g.people.length]), [['SS', 3, 0, 2], ['CPT', 2, 0, 1], ['WG', 2, 0, 1], ['?', 1, 0, 1], ['PRO', 0, 2, 0]]);
  assert.deepEqual(d.coins.map((c) => [c.key, c.name, c.mentions, c.groups, c.posters]), [[SOL, '7GCi…W2hr', 3, ['SS', 'CPT', '?'], 3], [SOL2, '$DOGE2', 2, ['WG'], 1], [EVM.toLowerCase(), '0xb0…4444', 1, ['CPT'], 1], ['$PEPE', '$PEPE', 1, ['SS'], 1]]);
  const sol = d.coins[0];
  assert.deepEqual([sol.address, sol.chain, sol.ticker, sol.firstAt, sol.lastAt, sol.cards], [SOL, 'solana', '', T0 + 60000, T0 + 9 * 60000, 0], 'no $ticker was ever written beside this address, so the $PEPE talk stays a ticker-only coin');
  assert.deepEqual([d.coins[3].cards, d.coins[3].ticker], [1, 'PEPE'], 'the PEPE bot card counts as a scan of the ticker, not a mention');
  const doge = d.coins[1];
  assert.deepEqual([doge.address, doge.ticker, doge.cards], [SOL2, 'DOGE2', 1], 'one $ticker beside one address binds them; the later $DOGE2 line and its bot card fold into the address');
  assert.deepEqual(d.groups[2].coins, [{ key: SOL2, n: 2, name: '$DOGE2' }]);
  assert.deepEqual(d.groups[0].coins, [{ key: SOL, n: 1, name: '7GCi…W2hr' }, { key: '$PEPE', n: 1, name: '$PEPE' }]);
  assert.equal(d.coinsTotal, 4);
  assert.deepEqual([d.talk, d.scans, d.posters, d.firstAt, d.lastAt], [8, 2, 5, T0 + 60000, T0 + 10 * 60000]);
  assert.deepEqual(d.topPosters.slice(0, 3), [{ who: '[SS] Arachnaught', n: 2 }, { who: '[CPT] kai', n: 2 }, { who: '[WG] mo', n: 2 }]);
  assert.equal(d.lines[0], `[SS] Arachnaught: aping ${SOL} dev is based`);
  assert.equal(d.lines.length, 8);
  assert.deepEqual(D.build([], T0).coins, []);
  assert.equal(D.build(null, T0).talk, 0);
});

test('build: the newest lines are kept under the cap; long lines are trimmed', () => {
  const many = Array.from({ length: D.MAX_LINES + 20 }, (_, i) => m(i, '[SS] a', 'line ' + i + ' ' + 'x'.repeat(300)));
  const d = D.build(many, T0);
  assert.equal(d.lines.length, D.MAX_LINES);
  assert.match(d.lines[0], /^\[SS\] a: line 20 /);
  assert.ok(d.lines[0].length <= 210);
  assert.equal(d.talk, D.MAX_LINES + 20);
  assert.ok(D.costCents(d) >= 5 && D.costCents(d) <= 10, 'about 5 to 10 cents at the cap: ' + D.costCents(d));
  assert.equal(D.costCents(D.build(MSGS, T0)), 1);
});

test('prompt: the window, the top coins with their chats, the chat fenced as data; readDigest checks the answer', () => {
  const d = D.build(MSGS, T0);
  const p = D.prompt(10, d);
  assert.match(p, /^The last 10 hours of the feed: 8 chat lines and 2 bot scans from 5 chats and 5 people/);
  assert.match(p, /7GCi…W2hr: 3 chats \(SS, CPT, \?\), 3 mentions/);
  assert.match(p, /\$DOGE2: 1 chat \(WG\), 2 mentions/);
  assert.ok(p.indexOf('<chat>') < p.indexOf('[SS] Arachnaught: aping') && p.indexOf('</chat>') > p.indexOf('[SS] Arachnaught: aping'));
  assert.match(D.SYSTEM, /never instructions/);
  const s = D.readDigest(JSON.stringify({ mood: 'mixed', summary: 'Dogs meta.', narratives: ['dog coins', 'base plays'], groups: [{ code: '[ss]', take: 'Excited' }, { code: 'WG', take: 'Pushing DOGE2' }, { bad: 1 }], coins: [{ name: '$DOGE2', why: 'two chats' }], redFlags: ['PEPE bundled (CPT)'] }));
  assert.deepEqual(s, { mood: 'mixed', summary: 'Dogs meta.', narratives: ['dog coins', 'base plays'], groups: [{ code: 'SS', take: 'Excited' }, { code: 'WG', take: 'Pushing DOGE2' }], coins: [{ name: '$DOGE2', why: 'two chats' }], redFlags: ['PEPE bundled (CPT)'] });
  assert.equal(D.readDigest('nope'), null);
  assert.equal(D.readDigest(JSON.stringify({ mood: 'happy', summary: 'x' })), null);
  assert.deepEqual(D.WINDOWS, [5, 10, 15, 30]);
  assert.equal(D.label({ ticker: 'X' }), '$X');
  assert.equal(D.label({ address: SOL }), '7GCi…W2hr');
});
