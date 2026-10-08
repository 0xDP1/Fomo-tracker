# Operator check (Helius)

**Status:** approved 2026-10-08. Idea and signal names credit CrawlScan (crawlscan.fun, MIT); the code is written for this app.

**Problem.** Bundle detectors miss operators who fund many wallets separately. **Analyze top wallets** also traces who first funded each of the top 15 holders through your Helius key; wallets funded by the same source are merged into one operator. The block shows each operator's combined share and how far the price would drop if the biggest operator sold into the current pool (standard x·y=k pool math). If one operator spanning two or more wallets could crash it 50%+ that is a critical finding, 25%+ high. Received-by-transfer and virgin-wallet shares are shown as extra lines. We know it works when tests on sample wallet and funding data merge the right wallets and compute the drop correctly, and a browser test shows the block and the finding.

## Rules

- **Funder:** the first wallet that sent SOL to the holder, from the holder's oldest transactions. Up to 2 pages (200 transactions) are read per holder; a holder with more history is treated as an established wallet with no funder link.
- **Merge** two holders when: they share a funder (not a known exchange hot wallet) and were funded within 72 hours of each other; or one holder funded the other; or one holder sent the coin to the other.
- **Dump drop** for an operator holding p% of supply: with R = liquidity / 2 (USD per side) and x = p% × market cap, drop = 1 − (R / (R + x))². Bonding-curve and concentrated pools differ, so it is an estimate.
- **Received by transfer:** the holder got the coin in a transaction it did not pay for that was not a swap.
- **Virgin:** the holder's whole history is loaded and it never moved another token before this one.
- The biggest operator (wallets and drop) is saved in holder snapshots, and Holder lessons gains the sign "Hidden operator could drop it 25%+".
