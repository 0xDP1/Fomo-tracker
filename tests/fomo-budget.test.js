const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const B = require('../fomo-budget.js');

const NOW = Date.parse('2026-10-08T12:00:00Z');
const MIN = 60000, H = 3600000;

test('bug: the connection check report hard-coded "app version 23" instead of the running version', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(!/app version \d/.test(src), 'report must not contain a literal version number');
  assert.ok(/app version \$\{APP_VERSION\}/.test(src), 'report must print APP_VERSION');
});

test('bug: a 402 (credits used up) paused nothing, so the app kept spending calls every minute', () => {
  assert.equal(B.pauseUntil(402, NOW), NOW + H);
  assert.equal(B.pauseUntil(200, NOW), 0);
  assert.equal(B.pauseUntil(401, NOW), 0);
  assert.equal(B.isPaused(NOW + H, NOW + 59 * MIN), true);
  assert.equal(B.isPaused(NOW + H, NOW + H), false);
  assert.equal(B.isPaused(0, NOW), false);
  assert.match(B.creditsMessage(NOW + H, NOW), /credits are used up.*fomoapi\.io\/pricing.*60 min/);
});

test('usage counter: calls and estimated credits per month, remaining from the API when it is readable', () => {
  let u = B.record(null, NOW);
  u = B.record(u, NOW + MIN, 249750);
  assert.deepEqual([u.month, u.calls, u.credits, u.remaining], ['2026-10', 2, 500, 249750]);
  u = B.record(u, NOW + 2 * MIN);
  assert.equal(u.remaining, 249750, 'an unreadable header keeps the last known figure');
  const next = B.record(u, Date.parse('2026-11-01T00:05:00Z'));
  assert.deepEqual([next.month, next.calls, next.credits], ['2026-11', 1, 250], 'a new month starts a new count');
});

test('bug: every sync re-probed 19 paging requests even after learning that no paging works', () => {
  assert.equal(B.shouldProbe(null, NOW), true);
  assert.equal(B.shouldProbe({ strategy: 'none', at: NOW - 23 * H }, NOW), false);
  assert.equal(B.shouldProbe({ strategy: 'none', at: NOW - 25 * H }, NOW), true, 're-check once a day in case paging is added');
  assert.equal(B.shouldProbe({ strategy: 'offset', at: NOW }, NOW), true, 'a working strategy is still used');
});

test('bug: balance refreshed fomoapi.io every 60 s and Following every 2 min; now 10 min each, sync 15 min', () => {
  assert.equal(B.BALANCE_MS, 10 * MIN);
  assert.equal(B.FOLLOW_MS, 10 * MIN);
  assert.equal(B.SYNC_MS, 15 * MIN);
  assert.equal(B.due(0, NOW, B.BALANCE_MS), true);
  assert.equal(B.due(NOW - 9 * MIN, NOW, B.BALANCE_MS), false);
  assert.equal(B.due(NOW - 10 * MIN, NOW, B.BALANCE_MS), true);
});

const t = (id, extra = {}) => ({ id, token: id, cost: 10, proceeds: 12, closedAt: '2026-10-01T00:00:00Z', source: 'fomo', notes: '', tags: [], ...extra });

test('bug: each FOMO sync replaced saved trades with only the newest page, so history never grew', () => {
  const prev = [t('f_1', { notes: 'kept' }), t('f_2'), t('f_3')];
  const fetched = [t('f_3', { proceeds: 20 }), t('f_4'), t('f_5')];
  const merged = B.mergeClosed(prev, fetched, []);
  assert.deepEqual(merged.map((x) => x.id).sort(), ['f_1', 'f_2', 'f_3', 'f_4', 'f_5']);
  assert.equal(merged.find((x) => x.id === 'f_3').proceeds, 20, 'a trade in both is updated from the new fetch');
  assert.equal(merged.find((x) => x.id === 'f_1').notes, 'kept');
  assert.deepEqual(B.mergeClosed(prev, fetched, ['f_2', 'f_4']).map((x) => x.id).sort(), ['f_1', 'f_3', 'f_5'], 'deleted trades stay deleted');
  assert.deepEqual(B.mergeClosed([], fetched, []).length, 3);
});
