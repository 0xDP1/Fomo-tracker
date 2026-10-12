# Coin strength score

**Status:** approved 2026-10-12. The owner's idea: score a coin from liquidity, volume, holders' share of supply and the total fees paid on it (GMGN's total fees).

**Problem.** A coin can pass the rug check and still be weak (thin liquidity, fake volume from bots, supply in a few hands), and today that is judged by eye from separate numbers. **What you see:** on the Check tab, next to the rug verdict, a **Strength 0–100** (Strong 70+, Mixed 40–69, Weak under 40) with a line per part, 25 points each: **Liquidity** (10%+ of market cap and $30k+ for full marks), **Volume** (24h volume 0.5–3× market cap and the last hour keeping pace; over 10× reads as wash trading), **Holders** (largest wallet under 3%, top 10 under 20%, 500+ holders), **Total fees** (fees traders paid at least 0.5% of the volume; under 0.1% reads as bot volume). Fees come from GMGN's total fees while the coin is under a day old (GMGN's total covers the coin's whole life), otherwise from the app's own 24h estimate after **Sample fees**; a part with no data shows "not read" and the score is out of the parts read (never counted as good; fewer than 2 parts gives no score). Call queue rows get a small **S** pill from what the queue already knows (liquidity, volume, holder count), and the Signal scorecard a **Strength** row. It is kept separate from the rug score and does not change the call score or Best view until the scorecard shows it predicts winners. One extra GMGN read (coin info) per Check. We know it works from unit tests of every part's edges, the missing-data rescaling and the fee-source rules, and a browser test of the Check card and the queue pill with GMGN faked.

**Revised 2026-10-12 (v70):** the holder check counts linked wallets as one holder and a fifth part, Wallets, scores the top holders' SOL balances; five parts of 20. See `docs/features/strength-wallets.md`.

## Unsure

- GMGN's field name for total fees is not in their docs; the app looks for a `total_fee`-style number in GMGN's coin info. If live replies don't have one, the fees part falls back to the own estimate and this needs a screenshot of a GMGN coin page to match up.
- All thresholds are first guesses, to retune from the Strength scorecard row.
