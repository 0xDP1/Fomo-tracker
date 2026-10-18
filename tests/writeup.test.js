const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../writeup.js');

const cs = () => ({
  ca: 'Mint111111111111111111111111111111111111111',
  dex: { symbol: 'PEPE', name: 'Pepe Classic', chainId: 'solana', mcap: 330000, liq: 60000, socials: ['https://x.com/pepe'] },
  facts: { holders: 1480, top10Pct: 19.5, topHolderPct: 4.1, insiderPct: 2.2, ageHours: 5.5 },
  risk: { verdict: 'Caution', score: 60, findings: [{ sev: 'medium', title: 'Thin liquidity', detail: 'x' }] },
  bundle: { b: { scanned: true, bundledPct: 12.4, firstSecondPct: 3, devBoughtPct: 1.5, insidersHoldPct: 0.8, wallets: 9, proxima: false, sumo: false } },
  holderLabels: { s: { wallets: 100, riskPct: 6.2, riskN: 3, byLabel: { sniper: { n: 2, heldPct: 3.1 }, insider: { n: 1, heldPct: 3.1 } }, smart: { n: 4, heldPct: 5.5, soldHalf: 1 }, kol: { n: 1, heldPct: 0.9, soldHalf: 0 }, risky: [{ address: 'W1', labels: ['sniper'], heldPct: 2, soldPct: 0.5 }] } },
  early: { s: { n: 10, soldHalf: 8, exited: 6, heldPct: 1.2 } },
  operators: { analyzedPct: 22.5, transferPct: 1, virginPct: 4, top: { pct: 4.2, wallets: ['a', 'b', 'c'], drop: 0.18 } },
  holderDeep: [
    { addr: 'a', pct: 2, funder: '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9' }, // Binance
    { addr: 'b', pct: 1.5, funder: 'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS' }, // Coinbase
    { addr: 'c', pct: 1.5, funder: 'SomeoneElse' },
    { addr: 'd', pct: 5, funder: null },
    { addr: 'e', pct: 9, error: 'timeout' },
  ],
  crawl: { s: { score: 61, band: 'OK', topShare: 3.3, sniper: 1, virgin: 20, transfer: 2 } },
  position: { cost: 150 },
});

test('exchangeFunded: the share of the analysed wallets first funded from an exchange, by exchange; null when nothing analysed', () => {
  const x = W.exchangeFunded(cs().holderDeep);
  assert.equal(x.analyzed, 4, 'the errored row is skipped');
  assert.equal(x.analyzedPct, 10);
  assert.equal(x.fundedN, 2);
  assert.equal(x.sharePct, 35, '3.5 of 10 points of supply');
  assert.deepEqual(x.byExchange, { Binance: 2, Coinbase: 1.5 });
  assert.match(x.note, /analysed top wallets/);
  assert.equal(W.exchangeFunded(null), null);
  assert.equal(W.exchangeFunded([{ addr: 'z', error: 'x' }]), null);
});

test('holders evidence: every block the Check tab read, with its source, and the average bag', () => {
  const e = W.evidence('holders', cs(), { base: true }, null, null);
  assert.equal(e.token.symbol, 'PEPE'); assert.equal(e.token.address, 'Mint111111111111111111111111111111111111111');
  assert.equal(e.token.holders, 1480); assert.equal(e.token.top10Pct, 19.5); assert.equal(e.token.avgBagUsd, 223);
  assert.equal(e.bundleCheck.source, 'isitbundled.com'); assert.equal(e.bundleCheck.bundledAtLaunchPct, 12.4); assert.equal(e.bundleCheck.stillHeldPct, 2.2);
  assert.equal(e.gmgnLabels.source, 'GMGN'); assert.deepEqual(e.gmgnLabels.byLabel.sniper, { wallets: 2, heldPct: 3.1 }); assert.equal(e.gmgnLabels.smartMoney.wallets, 4);
  assert.deepEqual(e.gmgnLabels.named[0], { address: 'W1', labels: ['sniper'], heldPct: 2, soldPct: 50 });
  assert.deepEqual(e.earlyTraders, { source: 'GMGN', first: 10, soldHalf: 8, exited: 6, stillHeldPct: 1.2 });
  assert.equal(e.operators.biggestClusterPct, 4.2); assert.equal(e.operators.biggestClusterWallets, 3); assert.equal(e.operators.biggestClusterDropPct, 18);
  assert.equal(e.exchangeFunded.sharePct, 35);
  assert.equal(e.crawlScan.band, 'OK');
  assert.deepEqual(e.riskCheck.findings, ['medium: Thin liquidity']);
  assert.ok(!('base' in e), 'the verdict evidence is not sent for the holder read');
});

test('holders evidence: a block that was not run is null, never guessed', () => {
  const c = cs(); c.bundle = null; c.holderLabels = { loading: true }; c.early = { error: 'x' }; c.operators = null; c.holderDeep = null; c.crawl = null;
  const e = W.evidence('holders', c, {}, null, null);
  assert.equal(e.bundleCheck, null); assert.equal(e.gmgnLabels, null); assert.equal(e.earlyTraders, null);
  assert.equal(e.operators, null); assert.equal(e.exchangeFunded, null); assert.equal(e.crawlScan, null);
  const unscanned = cs(); unscanned.bundle = { b: { scanned: false } };
  assert.equal(W.evidence('holders', unscanned, {}, null, null).bundleCheck, null, 'an unscanned coin is not a clean coin');
  const noHolders = cs(); noHolders.facts.holders = 0;
  assert.equal(W.evidence('holders', noHolders, {}, null, null).token.avgBagUsd, null);
});

test('bull evidence: the story block, the chat when read, the risk verdict for the Watch line; no stats', () => {
  const chat = { prep: { talk: 2 }, summary: { summary: 'Two groups call it the frog meta.', claims: ['dev known'], groups: [{ code: 'PTN', take: 'frog is back' }] } };
  const story = { name: 'Pepe Classic', ticker: 'PEPE', links: ['https://x.com/pepe'], chat: { summary: 'Two groups call it the frog meta.' } };
  const e = W.evidence('bull', cs(), { base: true }, chat, story);
  assert.deepEqual(e.story, story, 'the thesis story block is used as is when given');
  assert.deepEqual(e.riskCheck, { verdict: 'Caution', topFinding: 'Thin liquidity' });
  assert.equal(e.position.size, 150);
  assert.equal(e.ageHours, 5.5);
  assert.ok(!('token' in e) && !('base' in e), 'no numbers block');
  const own = W.evidence('bull', cs(), {}, chat, null);
  assert.equal(own.story.ticker, 'PEPE'); assert.equal(own.story.chat.summary, 'Two groups call it the frog meta.'); assert.deepEqual(own.story.chat.groupTakes, ['[PTN] frog is back']);
  assert.equal(W.evidence('bull', cs(), {}, null, null).story.chat, null);
});

test('verdict evidence is the base, unchanged; the prompts carry each style\'s rules', () => {
  const base = { token: { symbol: 'PEPE' }, plan: null };
  assert.equal(W.evidence('verdict', cs(), base, null, null), base);
  assert.match(W.system('verdict'), /^You are a blunt memecoin risk desk/);
  assert.match(W.system('holders'), /3 to 5 short lines/); assert.match(W.system('holders'), /End with "Nfa"/); assert.match(W.system('holders'), /null was not run: leave it out, never guess/);
  assert.match(W.system('bull'), /2 to 3 short paragraphs/); assert.match(W.system('bull'), /No stats/); assert.match(W.system('bull'), /starting "Watch:"/); assert.match(W.system('bull'), /never call the coin safe/);
  assert.deepEqual(W.STYLES.map((s) => s.key), ['verdict', 'holders', 'bull']);
  assert.equal(W.styleOf('nope').key, 'verdict');
  assert.ok(W.maxTokens('bull') > W.maxTokens('holders'));
});
