# Check: LP unlock date

**Status:** draft, waiting for approval.

**Problem.** Check tells you what share of a coin's liquidity is locked or burned, but not when the lock ends. A lock that opens tomorrow counts as "safe" today, and that is exactly when the team can pull the pool. Check gets a new warning when locked liquidity unlocks within 60 days: "LP unlocks in N days" (high), or "LP lock has expired" (high) when the date has already passed. Burned LP never unlocks and is never flagged. We know it works when unit tests on saved RugCheck and GoPlus responses give the right unlock date and warning (unlocks in 3 days: warning; in 200 days: none; expired: warning; burned only: none; no lock data: none and "LP unlock date" listed as not checked), and a browser test shows the warning on Check.

## Rules

- Solana: RugCheck's report has a `lockers` map. Each locker has an `unlockDate` (Unix seconds) and `usdcLocked`. We use the earliest `unlockDate` among lockers holding more than $100, so dust locks are ignored. A missing or zero `unlockDate` counts as unknown, not permanent. Confirmed on a live RugCheck report (BONK).
- EVM: GoPlus lists LP holders with `is_locked`, and its docs describe a `locked_detail` list with an `end_time` for locked holders. The live sample I checked had no locked holders, so the build step first confirms this field on a coin with a real lock. If GoPlus doesn't give dates, EVM shows "LP unlock date" as not checked and only the Solana half ships.
- The 60-day line follows "liquidity locked for less than a couple of months". It is one number in `check.js`.
- The unlock date becomes a new fact (`lpUnlockAt`) next to `lpLockedPct`. Holder lessons, the Scanner and thesis drafts don't use it in this feature.
- No new API calls and no new dependencies: both responses are already fetched.
