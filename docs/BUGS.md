# Bugs

Each fixed bug has a test that failed before the fix and passes after. Browser-level reproductions live outside the repo suite (Playwright is not a project dependency); the repo test named below guards the logic.

| # | Bug | How it was found | Guarded by |
|---|-----|------------------|------------|
| 1 | The FOMO connection check printed "app version 23" as fixed text, whatever version was running. It led to the wrong advice that the phone was not updating. | User's report on 2026-10-08 still said 23 after several releases; `grep` found the literal. | `tests/fomo-budget.test.js`: "connection check report hard-coded…" (static check on `app.js`) |
| 2 | A fomoapi.io 402 (credits used up) was shown as "FOMO API HTTP 402" and every timer kept calling, spending nothing but adding failures. | User's report on 2026-10-08: every endpoint returned 402. | `tests/fomo-budget.test.js`: "a 402 … paused nothing"; app pauses all fomoapi.io calls for an hour and explains why |
| 3 | The app spent fomoapi.io credits fast: balance every 60 s (2 calls), Following every 2 min per handle, auto-sync every 5 min. About 5 hours of open app used a free month (250 credits per call, 250,000 a month). | Worked out from fomoapi.io's pricing after bug 2. | `tests/fomo-budget.test.js`: refresh cadence test; balance 10 min, Following 10 min and only on the Dashboard, sync 15 min |
| 4 | Every sync re-ran the paging probe (about 19 calls) even after learning no paging parameter works. | User's report on 2026-10-03: "paging none · 19 requests · 12.4s". | `tests/fomo-budget.test.js`: "every sync re-probed…"; probe skipped for 24 h after a "none" result |
| 5 | Each FOMO sync replaced saved trades with only the newest page (about 25 closed), so history never grew and streaks, Holder lessons and stats covered only the latest trades. | Read `syncFomo` after the 2026-10-03 report showed 630 closed trades but only 25 arriving. | `tests/fomo-budget.test.js`: "each FOMO sync replaced saved trades…"; sync merges by trade id and keeps deletions |
| 6 | Check took a long time to show a coin. The result waited for both RugCheck and TrenchBot, and requests had no time limit; TrenchBot's API stopped answering (no reply in 45 s, twice, on 2026-10-11), so the card stayed hidden until the browser gave up. The Call queue's auto-checks waited the same way. | User's report on 2026-10-11 ("takes awhile to load"); timed each source with curl: DexScreener 0.2-0.4 s, RugCheck about 1 s, TrenchBot no reply. | `tests/e2e/check-speed.e2e.js`: TrenchBot never answers, the result still shows within 10 s with RugCheck's data and "TrenchBot timed out". Fix (v63): time limits in `getJson`, 6 s for TrenchBot and the GoPlus fallback, 15 s for DexScreener, RugCheck and GoPlus on EVM chains. |
| 7 | Check showed "GMGN rate limit hit, try again in a minute" on its GMGN blocks. A Check sent three GMGN requests at once (early traders, holder labels, creator launches), and paper-trade wallet polling and wallet memory sent more in the background with no pacing, so GMGN refused most of them; nothing retried. | User's report on 2026-10-11 (phone GMGN key). | `tests/e2e/gmgnpace.e2e.js`: a fake GMGN that refuses a second request within a second, a Check plus a followed wallet; all three blocks must fill in with no refusals. `tests/gmgn.test.js`: the queue's order, gap and pause. Fix (v64): one paced queue for every GMGN request (1 s apart, Check first; background work skips its turn while a Check waits or GMGN is paused), and a Check asks once more after a rate-limit pause instead of showing the error. |

## Suspected, not reproduced

- The token "checker doesn't work" report (2026-10-03). Could not reproduce on a fresh v28 load, with mixed old/new cached files, or with TrenchBot/GeckoTerminal blocked. Possibly the credit exhaustion above if it was a FOMO-backed checker. Waiting on details.

## Settings heading showed "version 23" (fixed)

The version label next to the Settings heading was typed into index.html as "version 23" and never updated, so it stayed at 23 on every release. It now shows the real number from `APP_VERSION`. A test fails if a version number is hard-coded in the page again.

## Call queue panels snapped shut after a quick change (fixed)

Opening the Leaderboard or Signal scorecard and changing a setting straight away (for example Min calls) re-drew the card before the browser's toggle event had recorded the panel as open, so it closed again. Seen first on GitHub's slower test machine. The card now reads which panels are open from the screen each time it re-draws. A browser test opens the panel and changes the setting with no pause.

## Check tab browser test failed once in CI (test race, app unaffected)

- **Seen:** GitHub run for v60, `checktab.e2e.js` timed out waiting for the AI write-up button.
- **Cause:** the test wrote the Anthropic key into storage while the app was running and then reloaded; the app saves its own settings at startup (e.g. auto-tuned sizing), which can overwrite that write just before the reload, so the page came back without a key.
- **Fix:** the test now sets its settings in an init script before the app starts, like the other browser tests. App code unchanged.
