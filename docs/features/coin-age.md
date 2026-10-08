# Coin age at entry

**Status:** approved 2026-10-08.

**Problem.** You don't know if new launches are costing you. Analytics gets a "By coin age when you bought" table splitting your closed trades into bands (under 1 hour, 1 to 24 hours, 1 to 7 days, over 7 days) with trades, win rate, PnL and average return for each. Launch times come from DexScreener (30 coins per free request). We know it works when tests on sample trades and launch times put each trade in the right band with the right totals, and a browser test shows the table.

## Rules

- Launch time = the earliest `pairCreatedAt` among the coin's DexScreener pairs (the pump.fun pool predates its migrated pool).
- Age at entry = trade opened − launch time. Negative ages (only a later pool is listed) and coins DexScreener doesn't know count as unknown and are listed separately.
- Launch times never change, so they are cached in the browser; each Analytics visit looks up at most 300 new coins (10 requests).
- The table uses the same trade window as the rest of Analytics.
