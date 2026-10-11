const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../watchlist.js');
const C = require('../check.js');

const SOL1 = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const SOL2 = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const EVM1 = '0x4bc1782fafb967834e0e75947ba15113e48fc70e';

test('parse: messy pasted list, names, tags, duplicates, skipped lines', () => {
  const text = `${SOL1}  Ansem smart\n\n${SOL2} #rug dev wallet,  ${EVM1.toUpperCase().replace('0X', '0x')} [kol] Base guy\nnot a wallet\n${SOL1} again`;
  const r = W.parse(text);
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.wallets, [
    { address: SOL1, name: 'Ansem', tag: 'smart' },
    { address: SOL2, name: 'dev wallet', tag: 'rug' },
    { address: EVM1, name: 'Base guy', tag: 'kol' },
  ]);
  assert.deepEqual(W.parse('').wallets, []);
  assert.equal(W.parse(`${SOL1} ${'x'.repeat(50)}`).wallets[0].name.length, 30);
  assert.equal(W.parse(W.toText(r.wallets)).wallets.length, 3, 'the saved list reads back the same');
  assert.deepEqual(W.parse(W.toText(r.wallets)).wallets, r.wallets);
});

test('match: listed wallets among GMGN top holders and traders, with holding and sold status', () => {
  const list = W.parse(`${SOL1} Ansem smart\n${SOL2} dev rug\n${EVM1} base`).wallets;
  const holders = [{ address: SOL1, amount_percentage: 0.034, addr_type: 0 }, { address: 'Other', amount_percentage: 0.2 }];
  const traders = [
    { address: SOL1, sell_amount_percentage: 0.25, amount_percentage: 0.034 },
    { address: SOL2, sell_amount_percentage: 1, amount_percentage: 0 },
    { address: EVM1.toUpperCase().replace('0X', '0x'), sell_amount_percentage: 0.6, amount_percentage: 0.01 },
  ];
  const m = W.match(list, holders, traders);
  assert.deepEqual(m.map((x) => [x.name, x.status]), [['Ansem', 'holds 3.4%, sold 25%'], ['dev', 'sold'], ['base', 'holds 1.0%, sold 60%']]);
  assert.equal(m[1].tag, 'rug');
  assert.deepEqual(W.match([], holders, traders), []);
  assert.deepEqual(W.match(list, null, undefined), []);
  assert.equal(W.match(list, holders, []).length, 1, 'holders alone (Call queue scan)');
});

test('assessRisk: a rug-tagged watchlist wallet in the coin is a high finding', () => {
  const f = C.assessRisk({ wlRug: 1, wlRugNames: 'dev' }).findings.find((x) => x.key === 'watchrug');
  assert.equal(f.sev, 'high');
  assert.match(f.title, /1 of your rug-tagged wallets is in/);
  assert.equal(C.assessRisk({ wlRug: 0 }).findings.find((x) => x.key === 'watchrug'), undefined);
});
