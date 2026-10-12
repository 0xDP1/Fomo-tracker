# Check: LP unlock date

**Status:** approved 2026-10-11.

**Problem.** Check tells you what share of a coin's liquidity is locked or burned, but not when the lock ends. A lock that opens tomorrow counts as "safe" today, and that is exactly when the team can pull the pool. Check gets a new warning when locked liquidity unlocks within 60 days: "LP unlocks in N days" (high), or "LP lock has expired" (high) when the date has already passed. Burned LP never unlocks and is never flagged. We know it works when unit tests on saved RugCheck and GoPlus responses give the right unlock date and warning (unlocks in 3 days: warning; in 200 days: none; expired: warning; burned only: none; no lock data: none and "LP unlock date" listed as not checked), and a browser test shows the warning on Check.

## Rules

- Solana: RugCheck's report has a `lockers` map. Each locker has an `unlockDate` (Unix seconds) and `usdcLocked`. We use the earliest `unlockDate` among lockers holding more than $100 and at least 10% of the coin's total liquidity (`totalMarketLiquidity`), so dust locks are ignored. A missing or zero `unlockDate` (Raydium's permanent locker reports 0) is not a time-limited lock and is skipped. Confirmed on a live RugCheck report (BONK, saved trimmed in `tests/fixtures/rugcheck-lockers.json`): its dated locks are expired but each holds well under 1% of its $1.75M liquidity, which is why the 10% share was added at build time.
- EVM: GoPlus lists LP holders with `is_locked`, `percent` (share of the LP, 0 to 1) and a `locked_detail` list with an ISO `end_time`. Confirmed on a live token with an UNCX lock (saved trimmed in `tests/fixtures/goplus-lp-locked.json`). We use the earliest `end_time` among locked holders with at least 10% of the LP. The GoPlus Solana fallback reads the same fields when it has them.
- "Not checked" means the source didn't report locks at all. A coin with no dated lock (burned, permanent or none) counts as checked and shows nothing.
- The 60-day line follows "liquidity locked for less than a couple of months". It is one number in `check.js`.
- The unlock date becomes a new fact (`lpUnlockAt`) next to `lpLockedPct`. Holder lessons, the Scanner and thesis drafts don't use it in this feature.
- No new API calls and no new dependencies: both responses are already fetched.
