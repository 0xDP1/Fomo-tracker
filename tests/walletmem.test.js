const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../walletmem.js');

const T = 1791600000000;

test('outcome: rug at -80%, runner at 3× once 24h is in, else nothing', () => {
  assert.equal(W.outcome({ ret: { '1h': -0.85 } }), 'rug', 'a rug is known straight away');
  assert.equal(W.outcome({ ret: { '1h': 2.5, '6h': -0.9 } }), 'rug', 'pumped then dumped is a rug');
  assert.equal(W.outcome({ ret: { '1h': 2.5 } }), 'pending', 'a runner waits for the 24h mark');
  assert.equal(W.outcome({ ret: { '1h': 0.2, '6h': 2.1, '24h': 0.9 } }), 'runner');
  assert.equal(W.outcome({ ret: { '1h': 0.4, '6h': 0.2, '24h': -0.5 } }), null);
  assert.equal(W.outcome({ ret: { '1h': 'missed', '6h': 'missed', '24h': 'missed' } }), null, 'never priced');
  assert.equal(W.outcome({ ret: {} }), 'pending');
});

test('profitable: real wallets in early that made $500+', () => {
  const at = T, sec = (ms) => Math.floor(ms / 1000);
  const list = [
    { address: 'Pool', addr_type: 2, realized_profit: 90000, start_holding_at: sec(at - 3600e3) },
    { address: 'Cex', addr_type: 0, exchange: 'binance', realized_profit: 9000 },
    { address: 'Early', addr_type: 0, realized_profit: 4200, start_holding_at: sec(at - 600e3) },
    { address: 'JustAfter', addr_type: 0, realized_profit: 800, profit: 1200, start_holding_at: sec(at + 5 * 60e3) },
    { address: 'Late', addr_type: 0, realized_profit: 3000, start_holding_at: sec(at + 30 * 60e3) },
    { address: 'Small', addr_type: 0, realized_profit: 300, start_holding_at: sec(at - 600e3) },
    { address: 'NoTime', realized_profit: '700' },
  ];
  assert.deepEqual(W.profitable(list, at), [{ address: 'Early', usd: 4200 }, { address: 'JustAfter', usd: 1200 }, { address: 'NoTime', usd: 700 }]);
  assert.deepEqual(W.profitable(null, at), []);
});

test('learn and grade: rug, runner and bot wallets build up over coins', () => {
  let m = W.empty();
  const ws = (...a) => a.map((address) => ({ address, usd: 1000 }));
  m = W.learn(m, { address: 'R1', symbol: 'RUG1' }, 'rug', ws('Insider', 'Sniper'), T);
  assert.equal(W.grade(m.wallets.Insider), null, 'one coin is not enough');
  m = W.learn(m, { address: 'R1' }, 'rug', ws('Insider'), T + 1);
  assert.equal(m.wallets.Insider.rug, 1, 'the same coin twice changes nothing');
  m = W.learn(m, { address: 'R2' }, 'rug', ws('Insider', 'Sniper'), T + 2);
  m = W.learn(m, { address: 'G1' }, 'runner', ws('Smart', 'Sniper'), T + 3);
  m = W.learn(m, { address: 'G2' }, 'runner', ws('Smart', 'Sniper'), T + 4);
  m = W.learn(m, { address: 'X' }, 'meh', ws('Nobody'), T + 5);
  assert.equal(m.wallets.Nobody, undefined, 'only rugs and runners are learned');
  assert.deepEqual([W.grade(m.wallets.Insider), W.grade(m.wallets.Smart), W.grade(m.wallets.Sniper)], ['rug', 'runner', 'bot']);
  assert.deepEqual(m.wallets.Insider, { rug: 2, run: 0, usd: 2000, last: T + 2 });
  assert.equal(W.grade({ rug: 3, run: 2, usd: 0, last: 0 }), 'bot', 'not clearly one side');
  assert.equal(W.grade({ rug: 4, run: 2, usd: 0, last: 0 }), 'rug', 'twice as many rugs');
  assert.deepEqual(W.stats(m), { rugs: 2, runners: 2, wallets: 3, graded: { rug: 1, runner: 1, bot: 1 } });
  const matched = W.match(m, ['Insider', 'Smart', 'Sniper', 'Stranger', 'Insider']);
  assert.deepEqual([matched.rug.map((x) => x.address), matched.runner.map((x) => x.address), matched.bot.map((x) => x.address)], [['Insider'], ['Smart'], ['Sniper']]);
});

test('learn: keeps at most 5000 wallets, dropping the longest unseen', () => {
  const m = { coins: {}, wallets: {} };
  for (let i = 0; i < W.MAX_WALLETS; i++) m.wallets['W' + i] = { rug: 1, run: 0, usd: 600, last: T + i };
  const out = W.learn(m, { address: 'C' }, 'runner', [{ address: 'New', usd: 900 }], T + 99999);
  assert.equal(Object.keys(out.wallets).length, W.MAX_WALLETS);
  assert.equal(out.wallets.W0, undefined, 'the oldest goes');
  assert.ok(out.wallets.New && out.wallets.W1);
});

test('call score and risk check use wallet memory counts', () => {
  const C = require('../calls.js'), K = require('../check.js');
  const e = { address: 'C', posters: ['a'], channels: [], firstAt: T - 60000, mcap: 200000, liq: 30000, callMcap: 150000 };
  const base = C.callScore(e, null, T).score;
  const bad = C.callScore(Object.assign({ wm: { rug: 3, runner: 0, bot: 1 } }, e), null, T);
  assert.equal(bad.score, base - 25);
  assert.deepEqual(bad.flags, ['3 rug wallets in']);
  const good = C.callScore(Object.assign({ wm: { rug: 0, runner: 2, bot: 0 } }, e), null, T);
  assert.equal(good.score, base + 10);
  assert.deepEqual(good.reasons, ['2 runner wallets in']);
  assert.equal(C.callScore(Object.assign({ wm: { rug: 1, runner: 1, bot: 5 } }, e), null, T).score, base, 'one of each is not a signal');
  const f = K.assessRisk({ wmRug: 2, wmRugCoins: 5 }).findings.find((x) => x.key === 'rugwallets');
  assert.equal(f.sev, 'high');
  assert.match(f.title, /2 wallets that profited on earlier rugs are in/);
  assert.match(f.detail, /took profit on 5 earlier rugs/);
  assert.equal(K.assessRisk({ wmRug: 1, wmRugCoins: 3 }).findings.some((x) => x.key === 'rugwallets'), false);
});
