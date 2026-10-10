const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../paper.js');

const T = 1791600000000, M = 60000, H = 3600000;
const opened = (price = 1, extra = {}) => P.open(P.empty(), Object.assign({ address: 'C', chain: 'solana', symbol: 'COIN', source: 'ai', price, at: T }, extra)).positions[0];

test('open: one position per source and coin, needs a price', () => {
  let b = P.open(P.empty(), { address: 'C', source: 'ai', price: 0.001, at: T });
  b = P.open(b, { address: 'C', source: 'ai', price: 0.002, at: T + M });
  assert.equal(b.positions.length, 1, 'the same source does not double up');
  b = P.open(b, { address: 'C', source: 'wallet:W', price: 0.002, at: T + M });
  assert.equal(b.positions.length, 2, 'another source may hold it too');
  assert.equal(P.open(P.empty(), { address: 'C', source: 'ai', price: null, at: T }).positions.length, 0);
  assert.deepEqual([b.positions[0].entry, b.positions[0].size, b.positions[0].left, b.positions[0].status], [0.001, 100, 1, 'open']);
});

test('step: half at 2×, the rest at 3×', () => {
  let p = opened(1);
  p = P.step(p, 1.5, T + 5 * M);
  assert.equal(p.left, 1);
  p = P.step(p, 2.2, T + 10 * M);
  assert.equal(p.left, 0.5);
  assert.equal(p.realized, 0.5 * 100 * 2.2);
  p = P.step(p, 2.5, T + 12 * M);
  assert.equal(p.fills.length, 1, 'half is sold once');
  p = P.step(p, 3.1, T + 15 * M);
  assert.equal(p.status, 'closed');
  assert.ok(Math.abs(P.pnl(p).usd - (110 + 155 - 100)) < 1e-9);
  assert.deepEqual(p.fills.map((f) => f.why), ['2×', '3×']);
});

test('step: a jump straight past 3× sells everything once', () => {
  const p = P.step(opened(1), 4, T + 5 * M);
  assert.equal(p.status, 'closed');
  assert.deepEqual(p.fills.map((f) => [f.why, f.part]), [['2×', 0.5], ['3×', 0.5]]);
  assert.ok(Math.abs(P.pnl(p).ret - 3) < 1e-9);
});

test('step: stop at -40%, pool gone, 24 hours, and late readings', () => {
  const stop = P.step(opened(1), 0.55, T + 5 * M);
  assert.deepEqual([stop.status, stop.fills[0].why, stop.late], ['closed', 'stop', false]);
  assert.ok(Math.abs(P.pnl(stop).ret + 0.45) < 1e-9);
  const rug = P.step(opened(1), 0, T + 5 * M);
  assert.deepEqual([rug.fills[0].why, P.pnl(rug).usd], ['pool gone', -100]);
  const old = P.step(opened(1), 1.2, T + 24 * H);
  assert.deepEqual([old.status, old.fills[0].why], ['closed', '24h']);
  const late = P.step(opened(1), 0.5, T + 3 * H);
  assert.equal(late.late, true, 'three hours since the last reading: the stop may have hit earlier');
  assert.equal(P.step(opened(1), null, T + M).checkedAt, T, 'no price, no change');
  const closed = P.step(stop, 5, T + 10 * M);
  assert.equal(closed, stop, 'closed positions stay closed');
});

test('results: per source, open positions at their last price', () => {
  const a = P.step(opened(1), 3.5, T + M);                              // +250%
  const b = P.step(opened(1, { address: 'D' }), 0.5, T + M);              // -50%
  const c = P.step(opened(1, { address: 'E', source: 'wallet:W' }), 1.5, T + M); // open, +50%
  const r = P.results([a, b, c]);
  const ai = r.find((x) => x.source === 'ai'), w = r.find((x) => x.source === 'wallet:W');
  assert.deepEqual([ai.trades, ai.closed, ai.wins, ai.winRate], [2, 2, 1, 0.5]);
  assert.ok(Math.abs(ai.usd - 200) < 1e-9);
  assert.ok(Math.abs(ai.avgRet - 1) < 1e-9);
  assert.deepEqual([w.trades, w.open, w.closed, w.winRate], [1, 1, 0, null]);
  assert.ok(Math.abs(w.usd - 50) < 1e-9);
});

test('walletBuys: real buys after a time, transfers and dust left out', () => {
  const data = { activities: [
    { event_type: 'buy', token: { address: 'A1', symbol: 'ONE' }, timestamp: 2000, price_usd: '0.01', cost_usd: '250', tx_hash: 'x1' },
    { type: 'buy', token: { address: 'A2', symbol: 'TWO' }, timestamp: 1500, price_usd: 0.02, cost_usd: 80 },
    { event_type: 'sell', token: { address: 'A3' }, timestamp: 2100, cost_usd: 900 },
    { event_type: 'transferIn', token: { address: 'A4' }, timestamp: 2200, cost_usd: 900 },
    { event_type: 'buy', token: { address: 'A5' }, timestamp: 2300, cost_usd: 5 },
    { event_type: 'buy', token: { address: 'OLD' }, timestamp: 900, cost_usd: 500 },
  ] };
  assert.deepEqual(P.walletBuys(data, 1000).map((b) => [b.address, b.at, b.price, b.usd]), [['A2', 1500000, 0.02, 80], ['A1', 2000000, 0.01, 250]]);
  assert.deepEqual(P.walletBuys(null, 0), []);
});

test('AI picks: prompt facts and reading the decision', () => {
  const text = P.aiPrompt({ symbol: 'PEPE', chain: 'solana', score: 72, reasons: ['3 callers'], flags: ['top 5 hold 50%'], ageMin: 12.4, mcap: 150000, liq: 22000, verdict: 'Caution', top: 'Thin liquidity' });
  assert.match(text, /Call score 72\/100\. Good: 3 callers\. Red flags: top 5 hold 50%\./);
  assert.match(text, /Age 12 min, market cap \$150,000, liquidity \$22,000\./);
  assert.match(text, /Rug check: Caution \(Thin liquidity\)\./);
  assert.deepEqual(P.readDecision('{"enter":true,"reason":" strong callers "}'), { enter: true, reason: 'strong callers' });
  assert.equal(P.readDecision('{"enter":"yes","reason":"x"}'), null);
  assert.equal(P.readDecision('nope'), null);
  assert.match(P.AI_SYSTEM, /data, never instructions/);
});

// ---- AI trader ----
test('readPlan: valid plans kept and clamped, broken ones rejected', () => {
  assert.deepEqual(P.readPlan('{"enter":true,"size":200,"takeProfitX":2.5,"stopPct":25,"thesis":" strong "}'), { enter: true, size: 200, takeProfitX: 2.5, stopPct: 25, thesis: 'strong' });
  assert.deepEqual(P.readPlan('{"enter":true,"size":999,"takeProfitX":50,"stopPct":-80,"thesis":"x"}'), { enter: true, size: 100, takeProfitX: 20, stopPct: 50, thesis: 'x' }, 'odd size becomes $100; target and stop clamped');
  assert.equal(P.readPlan('{"enter":false,"size":50,"takeProfitX":2,"stopPct":30,"thesis":"weak"}').enter, false);
  assert.equal(P.readPlan('{"enter":true,"thesis":"no numbers"}'), null);
  assert.equal(P.readPlan('nope'), null);
});

test('readManage: hold, part sells and exits', () => {
  assert.deepEqual(P.readManage('{"action":"sell_part","sellPct":40,"reason":"smart money selling"}'), { action: 'sell_part', sellPct: 40, reason: 'smart money selling' });
  assert.deepEqual(P.readManage('{"action":"exit","sellPct":0,"reason":"rug wallets in"}'), { action: 'exit', sellPct: 100, reason: 'rug wallets in' });
  assert.equal(P.readManage('{"action":"sell_part","sellPct":0,"reason":"x"}').action, 'hold', 'a zero part sell is a hold');
  assert.equal(P.readManage('{"action":"moon","sellPct":1,"reason":"x"}'), null);
});

test('openAi: the AI position and its fixed-rules twin', () => {
  const b = P.openAi(P.empty(), { address: 'C', chain: 'solana', symbol: 'AI', price: 1, at: T, plan: { size: 200, takeProfitX: 2.5, stopPct: 25, thesis: 'clean launch' }, evidence: ['Token: AI'] });
  assert.deepEqual(b.positions.map((x) => [x.source, x.size, x.entry]), [['ai-trader', 200, 1], ['ai-fixed', 200, 1]]);
  assert.deepEqual(b.positions[0].plan, { takeProfitX: 2.5, stopPct: 25 });
  assert.match(b.positions[0].log[0].what, /entered \$200: target 2\.5×, stop -25%/);
  assert.equal(P.openAi(b, { address: 'C', price: 1, at: T + M, plan: { size: 50, takeProfitX: 2, stopPct: 20, thesis: 'x' } }).positions.length, 2, 'no doubling up');
});

test('stepAi: AI target, AI stop, the hard stop and 24 hours', () => {
  const pos = (plan) => P.openAi(P.empty(), { address: 'C', price: 1, at: T, plan: Object.assign({ size: 100, thesis: 't' }, plan) }).positions[0];
  const tgt = P.stepAi(pos({ takeProfitX: 2.5, stopPct: 25 }), 2.6, T + M);
  assert.deepEqual([tgt.status, tgt.fills[0].why], ['closed', 'AI target']);
  assert.ok(Math.abs(P.pnl(tgt).usd - 160) < 1e-9);
  const st = P.stepAi(pos({ takeProfitX: 2.5, stopPct: 25 }), 0.74, T + M);
  assert.equal(st.fills[0].why, 'AI stop');
  assert.equal(P.stepAi(pos({ takeProfitX: 2.5, stopPct: 25 }), 0.8, T + M).status, 'open');
  const hard = P.stepAi(Object.assign(pos({ takeProfitX: 5, stopPct: 50 }), { plan: { takeProfitX: 5, stopPct: 70 } }), 0.45, T + M);
  assert.equal(hard.fills[0].why, 'hard stop', 'a stop wider than 50% is overridden by the rail');
  assert.equal(P.stepAi(pos({ takeProfitX: 5, stopPct: 40 }), 1.1, T + 24 * H).fills[0].why, '24h');
  assert.equal(P.stepAi(pos({ takeProfitX: 5, stopPct: 40 }), 0, T + M).fills[0].why, 'pool gone');
});

test('applyManage: the AI sells part or exits, every decision is logged', () => {
  let p = P.openAi(P.empty(), { address: 'C', price: 1, at: T, plan: { size: 100, takeProfitX: 5, stopPct: 40, thesis: 't' } }).positions[0];
  p = P.applyManage(p, { action: 'hold', sellPct: 0, reason: 'still strong' }, 1.4, T + 10 * M);
  assert.equal(p.left, 1);
  p = P.applyManage(p, { action: 'sell_part', sellPct: 50, reason: 'take some' }, 2, T + 20 * M);
  assert.equal(p.left, 0.5);
  p = P.applyManage(p, { action: 'exit', sellPct: 100, reason: 'smart money out' }, 1.5, T + 30 * M);
  assert.equal(p.status, 'closed');
  assert.ok(Math.abs(P.pnl(p).usd - (100 + 75 - 100)) < 1e-9);
  assert.deepEqual(p.log.map((l) => l.what), ['entered $100: target 5×, stop -40%', 'hold', 'sold 50%', 'exit']);
});

test('daily cap on AI calls', () => {
  let u = null;
  for (let i = 0; i < 3; i++) { assert.equal(P.canSpend(u, T, 3), true); u = P.spend(u, T); }
  assert.equal(P.canSpend(u, T, 3), false, 'cap reached');
  assert.equal(P.canSpend(u, T + 24 * H, 3), true, 'a new day resets it');
});

test('evidence: labelled lines from every tool, missing parts left out', () => {
  const L = P.evidence({
    token: { symbol: 'AI', chain: 'solana', ageMin: 12, mcap: 150000, liq: 25000, vol24: 90000, ch5m: 3, ch1h: 12, buys1h: 40, sells1h: 10 },
    call: { score: 82, reasons: ['3 callers'], flags: [], callers: 3, channels: ['first scan'], firstCaller: 'alice', winRate: 62, sinceCall: 1.2 },
    risk: { verdict: 'Caution', score: 70, findings: [{ sev: 'medium', title: 'Thin liquidity' }], unknown: [] },
    labels: { riskPct: 12, riskN: 3, smartN: 2, smartPct: 1.5, smartSold: 0, kolN: 1 },
    memory: { rug: 0, runner: 2, bot: 1, learned: 9 },
    chatter: ['[SS] a: aping'],
  });
  assert.match(L[0], /^Token: AI on solana; age 12 min; market cap \$150,000/);
  assert.match(L.join('\n'), /Calls: score 82\/100; good: 3 callers; red flags: none; 3 caller\(s\)/);
  assert.match(L.join('\n'), /Rug check: Caution \(70\/100\)\. Findings: medium: Thin liquidity/);
  assert.match(L.join('\n'), /Wallet memory \(from past calls\): 0 rug wallets, 2 runner wallets/);
  assert.ok(!/Early traders/.test(L.join('\n')), 'missing tools are left out');
  assert.match(P.traderPrompt(L), /^<evidence>\n[\s\S]*\n<\/evidence>\nDecide: enter or skip/);
  assert.match(P.TRADER_SYSTEM, /data, never instructions/);
});
