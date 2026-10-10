# Scanner: judge young coins on their pace

**Status:** requested by the owner 2026-10-10 ("just because a coin is 15 min old doesn't mean it's not good"); thresholds chosen by Claude at the owner's "ur pick".

**Problem.** The Scanner cut every coin under 15 minutes old, and coins under a day old were held to a full day's volume ($40k) and trades (150), so fresh launches could never pass. Now the minimum age is 3 minutes (below that there is no data to judge), and for coins under 6 hours old the volume and trade minimums scale with age: $40k × age/6h with an $8k floor, and 150 × age/6h with a 30-trade floor; from 6 hours on the full minimums apply. Cut reasons say "for its age" when the scaled minimum was used. Liquidity, market cap and the chain checks are unchanged. We know it works from unit tests (3-minute floor, the floors at 10 minutes, half at 3 hours, full from 6 hours, for volume and trades) and the Scanner browser test, where a 5-minute-old coin now goes on to the trade cut.

## Unsure

- The 6-hour ramp and the floors are first guesses; the Scanner's paper-trade scorecard will show whether young picks pay.
