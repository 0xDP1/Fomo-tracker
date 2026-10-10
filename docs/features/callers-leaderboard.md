# Callers leaderboard

**Status:** approved 2026-10-10.

**Problem.** The Callers table only lists callers the app priced itself, not the whole directory the Discord feed builds from alerts. A **Leaderboard** lists every caller from the directory, sorted by 30-day win rate: medal, group, number of calls (the alert bot's 30-day count when known, otherwise how many times the app has seen them), 7-day rate, median multiple, the app's own average 6-hour return for their calls when it has one, and when they were last seen. A **min calls** setting (default 10) hides small samples. Tapping a caller filters the queue to coins they called, with a chip to clear it. We know it works when unit tests check the sorting, the min-calls cut and the join with the app's own results, and a browser test shows the table and the tap-to-filter.
