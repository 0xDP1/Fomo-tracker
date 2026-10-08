# Bugs

Each fixed bug has a test that failed before the fix and passes after. Browser-level reproductions live outside the repo suite (Playwright is not a project dependency); the repo test named below guards the logic.

| # | Bug | How it was found | Guarded by |
|---|-----|------------------|------------|
| 1 | The FOMO connection check printed "app version 23" as fixed text, whatever version was running. It led to the wrong advice that the phone was not updating. | User's report on 2026-10-08 still said 23 after several releases; `grep` found the literal. | `tests/fomo-budget.test.js`: "connection check report hard-coded…" (static check on `app.js`) |
| 2 | A fomoapi.io 402 (credits used up) was shown as "FOMO API HTTP 402" and every timer kept calling, spending nothing but adding failures. | User's report on 2026-10-08: every endpoint returned 402. | `tests/fomo-budget.test.js`: "a 402 … paused nothing"; app pauses all fomoapi.io calls for an hour and explains why |
| 3 | The app spent fomoapi.io credits fast: balance every 60 s (2 calls), Following every 2 min per handle, auto-sync every 5 min. About 5 hours of open app used a free month (250 credits per call, 250,000 a month). | Worked out from fomoapi.io's pricing after bug 2. | `tests/fomo-budget.test.js`: refresh cadence test; balance 10 min, Following 10 min and only on the Dashboard, sync 15 min |
| 4 | Every sync re-ran the paging probe (about 19 calls) even after learning no paging parameter works. | User's report on 2026-10-03: "paging none · 19 requests · 12.4s". | `tests/fomo-budget.test.js`: "every sync re-probed…"; probe skipped for 24 h after a "none" result |
| 5 | Each FOMO sync replaced saved trades with only the newest page (about 25 closed), so history never grew and streaks, Holder lessons and stats covered only the latest trades. | Read `syncFomo` after the 2026-10-03 report showed 630 closed trades but only 25 arriving. | `tests/fomo-budget.test.js`: "each FOMO sync replaced saved trades…"; sync merges by trade id and keeps deletions |

## Suspected, not reproduced

- The token "checker doesn't work" report (2026-10-03). Could not reproduce on a fresh v28 load, with mixed old/new cached files, or with TrenchBot/GeckoTerminal blocked. Possibly the credit exhaustion above if it was a FOMO-backed checker. Waiting on details.
