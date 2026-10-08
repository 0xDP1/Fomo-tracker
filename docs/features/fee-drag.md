# Fee drag

**Status:** approved 2026-10-08.

**Problem.** As a frequent trader, costs may eat your edge without showing up anywhere. Analytics gets a Fee drag card: your trades per day and average size over the last 30 days, an editable round-trip cost (default 4%), the estimated monthly cost in your trade unit, and the win rate you need to break even once those costs are included next to your actual win rate. We know it works when tests confirm the cost and break-even math, and a browser test shows the card updating when you change the cost.

## Rules

- Window: closed trades in the last 30 days.
- Trades per day = trades / 30. Average size = average cost. Monthly cost = trades × average size × cost%.
- FOMO and wallet data already have costs inside realized PnL, so the card treats your average win (W) and loss (L), as fractions of size, as after costs.
- Break-even win rate with costs = L / (W + L). Without costs = max(0, L − c) / (W + L), where c is the cost per round trip. The gap shows how much harder costs make it.
- Costs vs gross profit = monthly cost / (net PnL + monthly cost), when gross profit is positive.
- Needs at least 5 closed trades in the window with at least one win and one loss.
