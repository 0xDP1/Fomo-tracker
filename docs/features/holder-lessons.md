# Holder lessons

**Status:** approved 2026-10-03.

**Problem.** You lose money on coins whose holder setup was a warning sign, but you can't see which setups keep costing you. Every time a coin is checked, the app saves a snapshot of its holders: top wallet %, top 10 %, bundles still held, bundles at launch, creator %, fresh wallets among top holders, holder count, LP lock, liquidity, market cap, age and risk verdict. It also takes a snapshot automatically whenever a new position appears after a sync. For past trades with no snapshot, a button runs the holder checks now and marks the results "checked after you exited". A Holder lessons card on Analytics compares your trades with and without each warning sign, ranked by money lost. On the Check tab, if a coin matches a pattern that has cost you, a "Your history" warning appears at the top of the verdict, and the AI write-up is told about it. We know it works when tests on sample trades and snapshots produce the right pattern stats and trigger the warning only for patterns that really lost money, and a browser test shows the card and the warning.

## Warning signs

Bundles still held 10%+; 25%+ bundled at launch; one wallet 10%+; top 10 hold 40%+; creator 5%+; 3+ fresh wallets among top holders; LP not locked or burned (under 90%); under 300 holders; under 1 hour old; under $20k liquidity; risk verdict Caution, High risk or Walk away.

## Rules

- A pattern is shown once at least 5 closed trades have it.
- The Check-tab warning fires only when the pattern's win rate is at least 15 points below the trader's overall win rate and its total PnL is negative.
- A snapshot counts as "at entry" when taken from 24 hours before to 6 hours after the trade opened. Otherwise it is "checked after you exited" and labelled as such.

## Implementation note

The backfill button checks recent closed trades, winners and losers, not only losers. Comparing with and without a warning sign needs both, otherwise every pattern would look like a losing one.
