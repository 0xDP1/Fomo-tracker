const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../check.js');

const SOL = '8vYJgiQPkpDtbWkDy1wyYDcUq3D9fUXVJUtt6aNEpump';
const EVM = '0x4ED4E862860beD51a9570b96d89aF5E1B0Efefed';

test('fomoUrl: every chain FOMO trades on, with FOMO chain names', () => {
  assert.equal(C.fomoUrl('solana', SOL), `https://fomo.family/tokens/solana/${SOL}`);
  for (const [chain, slug] of [['base', 'base'], ['bsc', 'bnb'], ['BNB', 'bnb'], ['BNB Chain', 'bnb'], ['ethereum', 'ethereum'], ['eth', 'ethereum'], ['monad', 'monad'], ['hyperliquid', 'hyperliquid'], ['hyperevm', 'hyperliquid'], ['robinhood', 'robinhood'], ['Robinhood Chain', 'robinhood'], ['arc', 'arc'], ['Base', 'base']]) {
    assert.equal(C.fomoUrl(chain, EVM), `https://fomo.family/tokens/${slug}/${EVM.toLowerCase()}`, chain);
  }
  assert.equal(C.fomoUrl('Solana', SOL), `https://fomo.family/tokens/solana/${SOL}`, 'display names work too');
});

test('fomoUrl: no link when the chain is unknown, unsupported, or does not match the address', () => {
  assert.equal(C.fomoUrl('evm', EVM), null, 'a 0x address whose chain is not known yet');
  assert.equal(C.fomoUrl('arbitrum', EVM), null, 'FOMO does not trade it');
  assert.equal(C.fomoUrl('', SOL), null);
  assert.equal(C.fomoUrl('solana', EVM), null);
  assert.equal(C.fomoUrl('base', SOL), null);
  assert.equal(C.fomoUrl('solana', ''), null);
});
