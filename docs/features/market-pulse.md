# Market pulse

**Status:** approved 2026-10-03.

**Problem.** You don't know whether the meme market is heating up or dying before you enter, or which coins are starting to move. A Market pulse card at the top of the Check tab shows total meme volume over the last 5 minutes, 30 minutes and 1 hour on Solana, Base and BNB, with a mood (Heating up, Steady, Cooling) and the market-wide buy/sell split. Below it, a Movers list ranks coins whose volume is suddenly running far above their hourly pace with buyers in control, each with one-tap Check. Your open positions show the same pace reading. It refreshes every 2 minutes while the page is open and keeps a 24-hour trail of readings. We know it works when tests on sample pool data give the right totals, mood and movers, and a browser test with mocked responses shows the card, the movers and the Check tap.

## Data

- GeckoTerminal (keyless): trending pools and top pools by 24h volume for `solana`, `base`, `bsc` (6 calls per refresh). Pools carry volume, buys/sells and price change for m5, m15, m30, h1.
- Fallback when GeckoTerminal fails on every chain: DexScreener top boosted tokens, then their pairs. DexScreener has no 30-minute window, so 30-minute figures show as unavailable and the mood uses the 5-minute pace only.
- Majors and stablecoins (SOL, WETH, USDC, USDT, BNB and similar) are excluded as the base token, so the totals measure memes.

## Rules

- 5-minute pace = 5m volume × 12 / 1h volume. 30-minute pace = 30m volume × 2 / 1h volume.
- Heating up: both paces above 1.3. Cooling: both below 0.7. Otherwise Steady.
- Mover: coin 5-minute pace 3 or more, more buys than sells in 5 minutes, liquidity at least $20k, 1h volume at least $50k. Ranked by pace, top 10.
- Open positions: pace from DexScreener. 3 or more: waking up. Under 0.7: quiet. Otherwise active.
- A volume spike is attention, not direction. The UI never says a coin will pump.
