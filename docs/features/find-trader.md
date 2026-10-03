# Find a trader

**Status:** approved 2026-10-03.

**Problem.** You see a good trader on FOMO and want to know whether they're worth following. On the Dashboard, a Find box takes a handle, a fomo.family link, or a profile screenshot (read by Claude with your Anthropic key). The app shows their wallets per chain with explorer links, plus a quick scorecard from their recent trades: win rate, realized PnL, average size, average hold time, and last active. A **Follow** button adds them to Following. We know it works when tests on mocked profile and trade responses produce the right wallets and scorecard, and a browser test confirms a mocked screenshot reply fills in the handle.
