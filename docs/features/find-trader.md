# Find a trader

**Status:** approved 2026-10-03.

**Problem.** You see a good trader on FOMO and want to know whether they're worth following. On the Dashboard, a Find box takes a handle, a fomo.family link, or a profile screenshot (read by Claude with your Anthropic key). The app shows their wallets per chain with explorer links, plus a quick scorecard from their recent trades: win rate, realized PnL, average size, average hold time, and last active. A **Follow** button adds them to Following. We know it works when tests on mocked profile and trade responses produce the right wallets and scorecard, and a browser test confirms a mocked screenshot reply fills in the handle.

## Revision (approved 2026-10-03): win rate and trading style

The user found the wallets list noisy and only wants to know a trader's win rate and style. The card now shows the handle, followers and Follow; win rate large with wins and losses; and a trading style read from their latest closed trades. Wallets, explorer links, realized PnL, total trades and last active were removed.

| Trait | Rule |
| --- | --- |
| Hold style | Median hold under 15 min: scalper. 15 min to 6 h: day trader. 6 h to 3 days: swing trader. Over 3 days: holder. |
| Activity | Profile trades per day over account age (sample span if missing). 20+: very active. 5 to 20: active. Under 5: selective. |
| Win profile | Win rate under 45% and payoff (avg win % / avg loss %) at least 2: lottery hunter. Win rate 60%+ and payoff under 1: quick profit taker. Otherwise balanced. |
| Size and chain | Average position size in USD; "mostly X" when one chain has 60%+ of trades, else multi-chain. |

Fewer than 5 closed trades: no style read, only the win rate. Unit tests cover every label edge and the small-sample case.
