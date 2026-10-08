# Flow check (Helius)

**Status:** approved 2026-10-08.

**Problem.** Rising volume doesn't tell you whether real buyers are arriving or one bot is churning. On the Check tab, Solana coins get a Flow block built from the coin's last hour of swaps read through your Helius key: buy and sell volume over 5, 30 and 60 minutes, unique buyers vs sellers, the top wallet's share of volume, and fresh-wallet buys. It gives a plain read: Real demand, Thin, or One wallet is the volume. Your open positions and the Movers list (Market pulse) get the same read on demand. If one wallet makes up 30% or more of the volume, that becomes a risk finding. We know it works when tests on sample swap lists give the right volumes, unique counts and labels, and a browser test with mocked Helius responses shows the block and the finding.

## Rules

- A swap is read from the fee payer's net change in the coin: more tokens is a buy, fewer is a sell. Value = tokens × the coin's current price (USD), so figures are approximate.
- Pages of 100 transactions are read back until the hour is covered, up to 5 pages; if the hour isn't covered the block says how many minutes it covers.
- **One wallet is the volume:** the top wallet is 30% or more of the hour's volume (also a risk finding: medium, high at 50%+). Needs at least 10 trades.
- **Real demand:** at least 20 unique buyers in the hour, at least as many unique buyers as sellers, and buy volume at least sell volume.
- **Thin:** everything else.
- **Fresh-wallet buys:** of the 8 biggest buyers, how many have a whole history of 30 transactions or fewer (same rule as Analyze top wallets). Costs one Helius request per wallet.
- Base and BNB coins show "not available".
