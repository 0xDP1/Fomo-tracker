const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../thesis.js');

const pos = (a) => ({ address: a, token: a.slice(0, 4), chain: 'Solana', cost: 100 });

test('planDrafts: first run records positions without drafting; later only new ones, at most 5', () => {
  const first = T.planDrafts([pos('AAAA1'), pos('BBBB1')], null);
  assert.deepEqual(first.toDraft, []);
  assert.deepEqual(first.seen.sort(), ['AAAA1', 'BBBB1']);
  const next = T.planDrafts([pos('AAAA1'), pos('BBBB1'), pos('CCCC1')], first.seen);
  assert.deepEqual(next.toDraft.map((p) => p.address), ['CCCC1']);
  assert.ok(next.seen.includes('CCCC1'));
  const again = T.planDrafts([pos('AAAA1'), pos('CCCC1')], next.seen);
  assert.deepEqual(again.toDraft, [], 'a position already drafted is not drafted again');
  const many = T.planDrafts(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((x) => pos(x + 'xxxx')), []);
  assert.equal(many.toDraft.length, 5);
  assert.equal(many.seen.length, 5, 'positions over the cap stay unseen so the next sync drafts them');
});

const got = (verdict = 'Looks OK', findings = []) => ({
  dex: { symbol: 'PEPE', chainId: 'solana', mcap: 500000, liq: 60000, vol5m: 3000, vol1h: 20000, vol24h: 300000, buys1h: 120, sells1h: 80, change1h: 12, change24h: 40, createdAt: new Date(Date.now() - 5 * 3600e3), socials: ['https://x.com/pepe'] },
  facts: { topHolderPct: 3.2, top10Pct: 22, holders: 1500, insiderPct: 4, bundleLaunchPct: 12, creatorPct: 1, lpLockedPct: 100, _holders: [1, 2, 3] },
  risk: { verdict, score: verdict === 'Looks OK' ? 90 : 30, findings, unknown: ['honeypot'] },
});

test('evidence carries the check results, the position and the market mood', () => {
  const e = T.evidence(got('Caution', [{ sev: 'high', title: 'Thin liquidity', detail: 'x' }]), { cost: 100, unit: 'USD' }, 'Heating up');
  assert.equal(e.token.symbol, 'PEPE');
  assert.equal(e.token.marketCapUsd, 500000);
  assert.equal(e.holders.top10Pct, 22);
  assert.equal(e.holders.bundledStillHeldPct, 4);
  assert.equal(e.riskCheck.verdict, 'Caution');
  assert.deepEqual(e.riskCheck.findings, ['high: Thin liquidity']);
  assert.equal(e.position.size, 100);
  assert.equal(e.marketMood, 'Heating up');
  assert.equal(e.token.hasSocialLinks, true);
  assert.ok(!('_holders' in e.holders), 'raw holder lists are not sent');
});

test('v112 story: name, ticker, links and the chat summary ride along; null chat when not read; the prompt leads with the narrative', () => {
  const g = got();
  g.dex.name = 'Pepe Classic'; g.dex.socials = ['https://x.com/pepe', 'https://pepe.wtf'];
  const chat = { prep: { mentions: 7, mentioners: 4, mentionGroups: 2, talk: 19 }, summary: { mood: 'Bullish', summary: 'Three groups say the dev is a known builder.', claims: ['dev doxxed on X'], redFlags: [], groups: [{ code: 'PTN', take: 'calling it the next frog' }] } };
  const e = T.evidence(g, null, null, null, chat);
  assert.equal(e.story.name, 'Pepe Classic');
  assert.equal(e.story.ticker, 'PEPE');
  assert.deepEqual(e.story.links, ['https://x.com/pepe', 'https://pepe.wtf']);
  assert.equal(e.story.chat.summary, 'Three groups say the dev is a known builder.');
  assert.deepEqual(e.story.chat.claims, ['dev doxxed on X']);
  assert.deepEqual(e.story.chat.groupTakes, ['[PTN] calling it the next frog']);
  assert.equal(e.story.chat.mentions, 7); assert.equal(e.story.chat.people, 4); assert.equal(e.story.chat.groups, 2);
  assert.equal(e.token.marketCapUsd, 500000, 'the numbers still ride along for the risk line');
  const none = T.evidence(got(), null, null, null, null);
  assert.equal(none.story.chat, null, 'no chat read means null, never an empty story');
  const read = T.evidence(got(), null, null, null, { prep: { mentions: 0, mentioners: 0, mentionGroups: 0, talk: 0 }, summary: null });
  assert.equal(read.story.chat.summary, null); assert.equal(read.story.chat.messages, 0);
  const sys = T.system(280, 'lowercase');
  assert.match(sys, /Lead with the narrative, not the stats/);
  assert.match(sys, /At most one number in the thesis/);
  assert.match(sys, /at most 210 characters/);
  assert.match(sys, /style notes: lowercase$/);
  assert.match(T.system(0, ''), /two or three sentences/);
  assert.ok(!/style notes/.test(T.system(0, '')));
});

test('compose: thesis plus a Risk line, flagged coins get the red flag written by the app', () => {
  const ok = T.compose({ thesis: 'Clean holders and steady buys.', risk_line: 'Volume could fade fast.' }, got().risk, 280);
  assert.equal(ok.text, 'Clean holders and steady buys.\nRisk: Volume could fade fast.');
  assert.equal(ok.flagged, false);
  const bad = T.compose({ thesis: 'Strong chart.', risk_line: 'Minor risk.' }, got('Walk away', [{ sev: 'critical', title: 'Bundled supply sitting unsold over your head' }, { sev: 'low', title: 'Young' }]).risk, 280);
  assert.equal(bad.flagged, true);
  assert.equal(bad.text, 'Strong chart.\nRisk: Walk away. Bundled supply sitting unsold over your head.');
  assert.equal(T.compose({ thesis: 'x', risk_line: 'y' }, got('High risk', []).risk, 280).text, 'x\nRisk: High risk on the token check.');
});

test('compose: trims the thesis at a word boundary to fit the limit, never the risk line', () => {
  const long = 'Buyers keep stepping in on every dip and holders are spread wide across hundreds of wallets with no whale';
  const c = T.compose({ thesis: long, risk_line: 'Thin liquidity.' }, got().risk, 80);
  assert.ok(c.text.length <= 80, c.text.length);
  assert.ok(c.text.endsWith('\nRisk: Thin liquidity.'));
  assert.ok(/… ?\nRisk/.test(c.text) || /…\nRisk/.test(c.text));
  assert.ok(!/\w…/.test(c.text.split('\n')[0].replace(/…$/, '')), 'cut lands between words');
  assert.equal(T.compose({ thesis: 'short', risk_line: 'r' }, got().risk, 0).text, 'short\nRisk: r', 'limit 0 means no limit');
});

test('addDraft keeps the newest 30, newest first, and replaces a regenerated draft', () => {
  let ds = [];
  for (let i = 0; i < 32; i++) ds = T.addDraft(ds, { id: 'd' + i, address: 'A' + i, text: 't' });
  assert.equal(ds.length, 30);
  assert.equal(ds[0].id, 'd31');
  ds = T.addDraft(ds, { id: 'd31', address: 'A31', text: 'new' });
  assert.equal(ds.length, 30);
  assert.equal(ds[0].text, 'new');
});

test('evidence carries the trench index line when there is one (docs/features/trench-index.md)', () => {
  const line = 'Trench index (tehcscreener, daily, 2026-10-11): 47/100, active; launchpad volume 28th percentile, new launches 71st, bot volume 42nd.';
  assert.equal(T.evidence(got('Caution', []), null, 'Steady', line).trenchIndex, line);
  assert.equal(T.evidence(got('Caution', []), null, 'Steady').trenchIndex, null);
});
