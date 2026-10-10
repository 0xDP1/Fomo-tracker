# Signal scorecard

**Status:** approved 2026-10-10.

**Problem.** Every Call queue threshold (bundled %, caller win rate, liquidity) is a guess. Each call the app prices (the paper book: price when first seen, then 1, 6 and 24 hours later) now carries the signals it had: bundle bucket (30%+, 15–30%, under 15%, not scanned), the first caller's 30-day win rate (50%+, 40–49%, under 40%, no record), the rug verdict, the channel(s) and liquidity (under $10k, $10–30k, $30k+). A **Signal scorecard** under the Call queue shows, for each group, how many calls were priced, the share that were up and the average return after 1, 6 and 24 hours; groups with fewer than 5 priced calls say "too few calls". We know it works when unit tests on sample books give the right groups, counts and averages, and a browser test shows the table.

## Notes

- Signals are filled in as they become known (the bundle check and rug check run after the call is first priced) and are then kept, so a caller's later win rate does not rewrite history.
- Prices are read only while the app is open; missed marks don't count. The table fills slowly.
