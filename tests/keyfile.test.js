// docs/features/key-file.md
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../keyfile.js');

const SETTINGS = { feedUrl: 'https://feed.example.workers.dev', feedKey: 'feed-secret-123', anthropicKey: 'sk-ant-abc', heliusKey: 'helius-xyz', lookupKey: '', gmgnKey: 'gmgn-777', refreshSec: 60 };
const FAST = { iterations: 1000 }; // tests only; real exports use 600,000

test('pick: only the API keys, empty ones left out', () => {
  assert.deepEqual(K.pick(SETTINGS), { feedKey: 'feed-secret-123', anthropicKey: 'sk-ant-abc', heliusKey: 'helius-xyz', gmgnKey: 'gmgn-777' });
  assert.deepEqual(K.FIELDS, ['feedKey', 'anthropicKey', 'heliusKey', 'lookupKey', 'gmgnKey']);
});

test('lock then unlock gives the keys back; no key is readable in the file', async () => {
  const file = await K.lock(K.pick(SETTINGS), 'correct horse', FAST);
  assert.deepEqual([file.app, file.kind, file.v, file.kdf, file.iterations], ['fomo-tracker', 'keys', 1, 'PBKDF2-SHA256', 1000]);
  const text = JSON.stringify(file);
  for (const v of Object.values(K.pick(SETTINGS))) assert.ok(!text.includes(v), 'key readable in the file: ' + v);
  assert.deepEqual(await K.unlock(JSON.parse(text), 'correct horse'), K.pick(SETTINGS));
  const again = await K.lock(K.pick(SETTINGS), 'correct horse', FAST);
  assert.notEqual(again.salt, file.salt, 'a new salt every export');
  assert.notEqual(again.iv, file.iv, 'a new IV every export');
  assert.equal((await K.lock({ feedKey: 'x' }, 'correct horse')).iterations, 600000, 'the real default');
});

test('unlock: a wrong password or a damaged or foreign file fails without keys', async () => {
  const file = await K.lock(K.pick(SETTINGS), 'correct horse', FAST);
  await assert.rejects(K.unlock(file, 'wrong horse'), /wrong password or damaged file/);
  await assert.rejects(K.unlock(Object.assign({}, file, { data: file.data.slice(0, -4) + 'AAAA' }), 'correct horse'), /wrong password or damaged file/);
  await assert.rejects(K.unlock({ app: 'other', kind: 'keys' }, 'correct horse'), /not a Fomo Tracker key file/);
  await assert.rejects(K.unlock(null, 'x'), /not a Fomo Tracker key file/);
});

test('unlock keeps only known key fields', async () => {
  const file = await K.lock({ feedKey: 'a', rpc: 'https://evil.example', anthropicKey: 'b' }, 'correct horse', FAST);
  assert.deepEqual(await K.unlock(file, 'correct horse'), { feedKey: 'a', anthropicKey: 'b' });
});

test('checkPassword: at least 8 characters and the two entries match', () => {
  assert.equal(K.checkPassword('short', 'short'), 'Use at least 8 characters.');
  assert.equal(K.checkPassword('long enough', 'long enougH'), 'The two passwords don\'t match.');
  assert.equal(K.checkPassword('long enough', 'long enough'), null);
});
