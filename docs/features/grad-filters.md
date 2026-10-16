# Adjustable filters for graduations

**Status:** approved 2026-10-13.

**Problem.** The Graduations section (v86) checks every pump.fun graduate with fixed numbers borrowed from the Scanner, and most are cut; the owner wants to set their own. A **Filters** panel in the Graduations section, saved on the device, with today's numbers as the defaults and **Reset**: the wait before checking (3 min, 1–30); the market check (liquidity at least $12k, market cap $60k to $8M, volume at least $8k and trades at least 30 by the check); the holder and rug check (top wallet at most 5%, top 10 at most 60%, holders at least 80, creator under 10%, and cutting "High risk" and "Walk away", each switchable). Mint and freeze authority must be closed, always (an open one lets the dev print coins or freeze yours). New numbers apply to coins checked from then on; cut reasons quote them ("liquidity $9k under $15k"); the header says "custom filters" when any number differs from the default. The Scanner keeps its own filters. We know it works when unit tests show each filter moving the result at its edge, the defaults equal to the old numbers and bad input clamped, and a browser test shows a coin cut for liquidity with the defaults passing after the liquidity minimum is lowered, and Reset restoring the defaults.

## Rules

- Logic in `grad.js`: `DEFAULTS`, `clampFilters`, `isDefault`; `add`, `marketCut` and `holderCut` take the filters.
- Volume and trades are flat minimums "by the check" (at 3 minutes they equal the Scanner's young-coin floors, $8k and 30, which is what graduations used before). The "buys and no sells in the last hour" cut stays.
- Ranges: wait 1–30 min; percentages 0–100; dollar amounts 0–$100M (market cap to $1B); a maximum market cap below the minimum is raised to it.
- Stored as `gradFilters`.
- Since v98 the market section also has **Fees paid at least N SOL** (default 1), read from GMGN after the market check (`docs/features/grad-fees.md`).
