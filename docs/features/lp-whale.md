# LP lock on launchpad pools, and the 3% wallet rule

**Status:** approved 2026-10-12. The owner's correction, from a Check result (a PumpSwap coin marked "Walk away").

**Problem.** The rug check called any pool with under 50% of its liquidity locked or burned "LP in a wallet that can pull it" (critical, so always "Walk away"). On launchpad pools (pump.fun's curve and PumpSwap, Meteora's launch pools, Raydium LaunchLab / bonk.fun, Moonshot, Believe, Boop) the launchpad's own program holds the liquidity, so nobody can pull it, but RugCheck still reports it as unlocked: a false alarm on most new Solana coins. What matters more is how much supply one wallet holds. **Now:** on a launchpad pool (recognised from DexScreener's pool type) the LP finding is skipped and a ✓ note says the launchpad holds the LP; ordinary pools keep the old rule. The largest real wallet (pools and burn addresses left out) is judged against 3%: under 3% is a ✓ good sign worth +5 (the score never goes over 100), 3–5% medium, 5–10% high, 10%+ critical. We know it works from a test that reproduces the owner's coin (written first, failing before the fix), tests for each 3/5/10% edge and for an ordinary pool still being flagged, and a browser test of the Check card for both cases.

## Unsure

- DexScreener's exact pool-type names for some launchpads (`meteoradbc`, `launchlab`, `moonit`…) are not confirmed on live coins; an unrecognised launchpad simply keeps the old LP rule.
- With the LP warning gone, a coin whose only warning is "brand new" now reads **Looks OK** (about 96).
