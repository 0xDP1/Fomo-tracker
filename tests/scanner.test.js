const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../scanner.js');

const NOW = Date.parse('2026-10-08T12:00:00Z');
const H = 3600000;
const pool = (sym, o = {}) => ({ id: 'solana_' + sym, chain: 'Solana', symbol: sym, address: sym + 'Mint', liq: 50000, mcap: 500000, vol24: 100000, createdAt: NOW - 5 * H, url: '', ...o });

test('fromGeckoNew parses new pools with age and 24h volume, dropping majors', () => {
  const json = { data: [
    { id: 'solana_p1', attributes: { name: 'NEWT / SOL', address: 'p1', pool_created_at: '2026-10-08T10:00:00Z', reserve_in_usd: '25000', market_cap_usd: null, fdv_usd: '300000', volume_usd: { h24: '90000' } }, relationships: { base_token: { data: { id: 'solana_NewtMint' } } } },
    { id: 'solana_p2', attributes: { name: 'USDC / SOL', address: 'p2', pool_created_at: '2026-10-08T10:00:00Z', volume_usd: {} }, relationships: { base_token: { data: { id: 'solana_USDCMint' } } } },
  ], included: [{ id: 'solana_NewtMint', type: 'token', attributes: { address: 'NewtMint', symbol: 'NEWT' } }] };
  const ps = S.fromGeckoNew(json, 'solana');
  assert.equal(ps.length, 1);
  assert.deepEqual([ps[0].symbol, ps[0].address, ps[0].chain, ps[0].liq, ps[0].mcap, ps[0].vol24, ps[0].createdAt], ['NEWT', 'NewtMint', 'Solana', 25000, 300000, 90000, Date.parse('2026-10-08T10:00:00Z')]);
  assert.equal(S.fromGeckoNew(json, 'bsc')[0].chain, 'BNB');
});

test('freeCut: age 15 min to 72 h, liquidity 12k, volume 40k, mcap 60k to 8M, missing figures cut', () => {
  assert.equal(S.freeCut(pool('OK'), NOW), null);
  assert.match(S.freeCut(pool('A', { createdAt: NOW - 14 * 60000 }), NOW), /too new/);
  assert.equal(S.freeCut(pool('A', { createdAt: NOW - 15 * 60000 }), NOW), null);
  assert.match(S.freeCut(pool('A', { createdAt: NOW - 73 * H }), NOW), /too old/);
  assert.match(S.freeCut(pool('A', { liq: 11999 }), NOW), /liquidity/);
  assert.match(S.freeCut(pool('A', { vol24: 39999 }), NOW), /volume/);
  assert.match(S.freeCut(pool('A', { mcap: 59999 }), NOW), /market cap/);
  assert.match(S.freeCut(pool('A', { mcap: 8000001 }), NOW), /market cap/);
  assert.equal(S.freeCut(pool('A', { mcap: 8000000 }), NOW), null);
  assert.match(S.freeCut(pool('A', { liq: null }), NOW), /no liquidity data/);
});

test('bestPair and tradeCut: 150 trades a day, sells required after 20+ buys in an hour', () => {
  const pair = (addr, liq, h24b, h24s, h1b, h1s) => ({ baseToken: { address: addr }, liquidity: { usd: liq }, priceUsd: '0.01', txns: { h24: { buys: h24b, sells: h24s }, h1: { buys: h1b, sells: h1s } } });
  const j = { pairs: [pair('XMint', 1000, 1, 1, 0, 0), pair('XMint', 9000, 100, 50, 21, 1), pair('YMint', 99999, 1, 1, 1, 1)] };
  const p = S.bestPair(j, 'XMint');
  assert.equal(p.liquidity.usd, 9000);
  assert.equal(S.tradeCut(p), null);
  assert.equal(S.bestPair(j, 'ZMint'), null);
  assert.match(S.tradeCut(null), /no DexScreener pair/);
  assert.match(S.tradeCut(pair('X', 1, 100, 49, 0, 0)), /149 trades/);
  assert.match(S.tradeCut(pair('X', 1, 100, 50, 21, 0)), /no sells/);
  assert.equal(S.tradeCut(pair('X', 1, 100, 50, 20, 0)), null);
  assert.equal(S.bestPair({ pairs: [pair('0xABC', 5, 1, 1, 1, 1)] }, '0xabc').liquidity.usd, 5, 'EVM match ignores case');
});

test('chainCut: Solana holder and authority rules, EVM honeypot, unchecked facts noted not cut', () => {
  const ok = { topHolderPct: 5, top10Pct: 60, holders: 80, mintAuthority: false, freezeAuthority: false };
  assert.deepEqual(S.chainCut(ok, 'solana'), { cut: null, unchecked: [] });
  assert.match(S.chainCut({ ...ok, topHolderPct: 5.1 }, 'solana').cut, /top wallet/);
  assert.match(S.chainCut({ ...ok, top10Pct: 61 }, 'solana').cut, /top 10/);
  assert.match(S.chainCut({ ...ok, holders: 79 }, 'solana').cut, /holders/);
  assert.match(S.chainCut({ ...ok, mintAuthority: true }, 'solana').cut, /mint/);
  assert.match(S.chainCut({ ...ok, freezeAuthority: true }, 'solana').cut, /freeze/);
  assert.deepEqual(S.chainCut({ holders: 500 }, 'solana').unchecked.sort(), ['freeze authority', 'mint authority', 'top 10', 'top wallet']);
  assert.equal(S.chainCut({ holders: 500 }, 'solana').cut, null);
  assert.match(S.chainCut({ honeypot: true }, 'base').cut, /honeypot/);
  assert.deepEqual(S.chainCut({}, 'bsc'), { cut: null, unchecked: ['honeypot'] });
});

const judge = (o = {}) => ({ concentration_is_exit_risk: 0.3, momentum_already_spent: 0.4, liquidity_fits_ticket: 0.8, dev_still_loaded: 0.2, crowd: 0.7, shape: 'building', worth_trading_at_all: 0.7, confidence: 0.6, reason: 'ok', ...o });

test('parseJudge reads JSON, clamps scores to 0-1 and rejects bad shapes', () => {
  const j = S.parseJudge(JSON.stringify(judge({ crowd: 1.7, confidence: -2 })));
  assert.equal(j.crowd, 1);
  assert.equal(j.confidence, 0);
  assert.equal(j.shape, 'building');
  assert.equal(S.parseJudge('not json'), null);
  assert.equal(S.parseJudge(JSON.stringify({ reason: 'x' })), null);
});

test('softCut: every threshold at its edge, and shape', () => {
  assert.deepEqual(S.softCut(judge()), []);
  assert.deepEqual(S.softCut(judge({ concentration_is_exit_risk: 0.55, momentum_already_spent: 0.6, liquidity_fits_ticket: 0.6, dev_still_loaded: 0.55, crowd: 0.55 })), []);
  const all = S.softCut(judge({ concentration_is_exit_risk: 0.56, momentum_already_spent: 0.61, liquidity_fits_ticket: 0.59, dev_still_loaded: 0.56, crowd: 0.54, shape: 'fading' }));
  assert.equal(all.length, 6);
  assert.match(S.softCut(judge({ shape: 'one_buyer' }))[0], /one buyer/);
});

test('pick: gate worth 0.60 and confidence 0.55, best worth × confidence, one at most', () => {
  const c = (sym, o) => ({ symbol: sym, judge: judge(o) });
  assert.equal(S.pick([c('A', { worth_trading_at_all: 0.7, confidence: 0.6 }), c('B', { worth_trading_at_all: 0.65, confidence: 0.9 })]).symbol, 'B');
  assert.equal(S.pick([c('A', { worth_trading_at_all: 0.59 }), c('B', { confidence: 0.54 })]), null);
  assert.equal(S.pick([c('A', { worth_trading_at_all: 0.6, confidence: 0.55 })]).symbol, 'A');
  assert.equal(S.pick([c('A', { shape: 'fading' })]), null, 'soft-cut failures are never picked');
  assert.equal(S.pick([]), null);
});

test('paper trades: priced at 1h, 6h and 24h inside their windows, late readings marked missed, scorecard', () => {
  let book = [];
  book = S.addPaper(book, { symbol: 'A', address: 'AMint', chain: 'Solana' }, 1.0, NOW);
  book = S.addPaper(book, { symbol: 'B', address: 'BMint', chain: 'Solana' }, 2.0, NOW);
  book = S.addPaper(book, { symbol: 'A', address: 'AMint', chain: 'Solana' }, 1.1, NOW + 60000);
  assert.equal(book.length, 2, 'the same coin is not logged twice within 24h');
  assert.deepEqual(S.due(book, NOW + 30 * 60000), []);
  assert.deepEqual(S.due(book, NOW + H).sort(), ['AMint', 'BMint']);
  book = S.applyPrices(book, { AMint: 1.5, BMint: 1.0 }, NOW + H);
  assert.deepEqual(book.map((p) => p.ret['1h']), [0.5, -0.5]);
  // app reopened 30 hours later: 6h and 24h windows passed, so they are marked missed rather than priced late
  book = S.applyPrices(book, { AMint: 3, BMint: 3 }, NOW + 31 * H);
  assert.deepEqual([book[0].ret['6h'], book[0].ret['24h']], ['missed', 'missed']);
  const sc = S.scorecard(book);
  assert.deepEqual(sc['1h'], { n: 2, up: 1, avg: 0 });
  assert.deepEqual(sc['24h'], { n: 0, up: 0, avg: null });
  assert.equal(sc.picks, 2);
});
