# Scanner

**Status:** approved 2026-10-08.

**Problem.** You find coins by scrolling, and you can't tell whether a filter would have made money. The Scanner pulls new launches on Solana, Base and BNB, applies a free cut, a trade cut and a chain cut, then asks Claude a set of judge questions for the survivors. It shows a shortlist with scores, reasons and one-tap Check, plus the cut list with why each coin failed. Picks are logged as paper trades and priced 1, 6 and 24 hours later, so a scorecard shows the hit rate and average return before you trust it. We know it works when tests on sample pool and holder data cut exactly the coins the rules say, the judge thresholds gate correctly, and paper trades score right; a browser test with mocked data shows the shortlist, the cut reasons and the scorecard.

## Source

Thresholds come from @savipww's "Megabrain (Jev) & Six Grok Bots" guide as published in the open-source `lobster-shrimp/jev-desk` README. That repository has no license, so no code is reused; only the published thresholds are, and they are unvalidated.

## Pipeline

1. **Universe:** GeckoTerminal `new_pools` pages 1-2 for `solana`, `base`, `bsc` (6 calls).
2. **Free cut:** age 15 min to 72 h; liquidity ≥ $12k; 24h volume ≥ $40k; market cap $60k to $8M. Missing figures are cut.
3. **Trade cut (DexScreener, 30 tokens per call):** a pair must exist; ≥ 150 trades in 24h; more than 20 buys in the last hour requires at least one sell.
4. **Chain cut (existing Check fetchers, top 8 by 24h volume):** Solana top real wallet ≤ 5%, top 10 ≤ 60%, holders ≥ 80, mint and freeze authority closed; EVM not a honeypot. A fact that could not be checked is noted, not cut.
5. **Judge (Claude, structured JSON, at most 5 finalists, one call each):** scores 0–1 for concentration_is_exit_risk (≤ 0.55), momentum_already_spent (≤ 0.60), liquidity_fits_ticket (≥ 0.60), dev_still_loaded (≤ 0.55), crowd (≥ 0.55), shape not "fading" or "one_buyer", plus worth_trading_at_all, confidence and a one-line reason. The guide's X-account questions are skipped because the app has no X data; the card says so.
6. **Pick:** among judge passes, worth ≥ 0.60 and confidence ≥ 0.55; highest worth × confidence; at most one per scan.

## Paper trades

Each pick is logged with its price. Later scans and app opens fetch prices 1, 6 and 24 hours after the pick. The scorecard shows picks, share up at each horizon, and average return. No trades are ever placed.

## Not included

Auto-buying, and FOMO's private API (the open-source version reads a login token out of Chrome).
