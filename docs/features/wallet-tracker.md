# Wallet tracker (find good wallets on a coin, track them, see them on other coins)

**Status:** approved 2026-10-11. The owner's idea; GMGN endpoints and fields from GMGN's own `gmgn-portfolio` skill docs (github.com/GMGNAI/gmgn-skills).

**Problem.** When a coin is checked, the wallets that made the most on it are visible (Early traders), but there is no way to tell a good trader from an insider who got in first, no way to keep the good ones, and no signal when they turn up on the next coin. On the Check tab a **Wallets worth tracking** block takes the coin's top profit-takers (GMGN top traders, already read), drops dev, bundler, insider and sniper wallets (GMGN tags) and bots, and for up to 8 of the rest shows a **wallet card**: profit and win rate over **1 day, 3 days, 7 days and 30 days**, trade volume (spent buying, buys and sells) over 7 and 30 days, its **last 5 trades** (coin, buy or sell, size, profit on sells, how long ago), typical hold time, and **balance** (SOL in the wallet and the value of its holdings). Each card shows a checklist of what makes a wallet good, with a **Track** button that turns on when it passes (and **Track anyway** with a warning when it doesn't). Tracked wallets go into one **Wallet tracker** list (with a label you can edit), shared with Paper trades → Copy a wallet. On every later Check and Call queue coin, tracked wallets among its top holders or traders show up ("2 tracked wallets in this · both bought in the last hour, still holding 80%"); tracked wallets **buying** add to the call score and tracked wallets **selling** take away. We know it works from unit tests on saved GMGN replies (the filter, the 1 d and 3 d figures worked out from recent trades, the checklist and its edge cases, matching tracked wallets on a coin with buy or sell direction, the call score change) and a browser test with GMGN faked: a coin's cards with one passing and one failing wallet, tracking one, then checking a second coin it is buying and seeing the conviction line and the score change; and after a couple of weeks the Signal scorecard row **Tracked wallet in it** shows whether those coins did better.

## What makes a wallet good (first guesses, to retune from the scorecard)

| Check | Pass when | Why |
| --- | --- | --- |
| Enough trades | 20+ buys in 30 days | win rate means nothing on a handful of trades |
| Wins often | 30-day win rate 45%+ | |
| Makes money | 30-day realized profit $1,000+ and profit ratio above 1× | a high win rate can still lose overall |
| Steady | profitable in at least 3 of the 4 ranges (1 d, 3 d, 7 d, 30 d) | not one lucky week |
| Active | traded in the last 3 days | a dormant wallet tells you nothing now |
| Real size | 30-day spent buying $2,000+ | not a dust wallet |
| Has a balance | 1+ SOL (or $200+ held on other chains) | drained throwaway wallets are a bait sign |
| Copyable | typical hold 5 minutes or longer | sub-minute flippers can't be followed by hand |
| Not a bot | under 300 trades a day on average | |

A wallet tagged dev, bundler, insider or sniper on this coin is never offered, whatever its record.

## Data and cost

- **7 and 30 days:** GMGN `user/wallet_stats` (`realized_profit`, `unrealized_profit`, `winrate`, `total_cost`, `buy_count`, `sell_count`, `pnl`), one call per range.
- **1 and 3 days, last trades, hold time:** GMGN `user/wallet_activity` (already allowed; sells carry `buy_cost_usd`, so each exit's profit is known). GMGN has no 1 d or 3 d stats, so these are worked out from the wallet's recent trades and say so when the trades read don't reach back far enough.
- **Balance:** SOL via `getBalance` through the Worker's Helius route; holdings value via GMGN `user/wallet_holdings`.
- **Worker:** `user/wallet_stats` and `user/wallet_holdings` are added to the read-only GMGN allowlist (still never trading); the phone's GMGN key fallback gets the same two.
- **Calls:** cards load only when the block is opened, top 8 wallets, each wallet's card cached for an hour; tracked wallets are refreshed at most once a day. Spotting tracked wallets on a new coin uses the top holders and traders the Check already reads, so it costs nothing extra.

## Call score

+10 for each tracked wallet that bought this coin in the last hour and still holds most of it (at most +20); −15 if a tracked wallet sold most of it. First guesses.

## Unsure

- GMGN's field names come from its docs and are not yet confirmed on a live reply.
- Good wallets get copied and sometimes sold to on purpose; the scorecard row is what tells whether tracking pays.
- Chains: GMGN covers Solana, BSC, Base and Ethereum (and more); SOL balance is Solana only, other chains use the holdings value.
