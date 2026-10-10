# Wallet memory

**Status:** approved 2026-10-10.

**Problem.** There is no way to tell whether the wallets buying a new coin are the same ones that took profit on earlier rugs (bad) or picked earlier runners (good). When a priced call in the Call queue finishes, it is labelled a **rug** (any mark at −80% or worse, known straight away) or a **runner** (a mark at 3× or better, decided once the 24-hour mark is in); everything else is ignored. For each rug or runner the app asks GMGN once for the top 100 traders by profit (`market/token_top_traders`, already used by Early traders) and remembers the real wallets that took $500+ profit and bought no later than 10 minutes after the call was seen, with a per-wallet record (rugs and runners profited on, profit, last seen; on the device only, at most 5,000 wallets, oldest dropped). A wallet is graded **rug** with 2+ rugs and at least twice as many rugs as runners, **runner** the mirror, **bot** when it profits on both, and not graded after one coin. On the Check tab a **Wallet memory** block compares the coin's GMGN top holders and traders (the same requests Holder labels and Early traders make, shared, so no extra calls) with the graded wallets; 2+ rug wallets is a high finding. In the Call queue, once some wallets are graded, the 5 best-scoring coins per refresh are matched against their GMGN top holders, re-matched every 30 minutes or when the memory learns more; 2+ rug wallets takes 25 points off the call score and 2+ runner wallets adds 10. A line under the queue says how many rugs, runners and wallets it has learned from. We know it works from unit tests (labelling, picking profitable early wallets, grading, matching, the 5,000 cap, the score and finding) and a browser test that learns from two rugs and two runners and then flags a queued coin and a new coin on the Check tab, with the Check tab's GMGN requests shared; after two weeks the Signal scorecard shows whether coins flagged with rug wallets did worse.

## Unsure

- The cut-offs (−80%, 3×, $500, 10 minutes, 2 coins) are first guesses.
- Rug devs usually use fresh wallets, so most matches will be bots and insider groups.
- Prices are only read while the app is open, so a coin whose marks were missed is never labelled; the memory grows slowly for the first weeks.
- The memory lives on one device; sharing it through the Worker would be a later step.
- There is no "good" severity for findings, so runner wallets show in the block and the call score, not as a finding.
