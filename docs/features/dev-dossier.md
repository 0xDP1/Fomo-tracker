# Dev dossier (creator history)

**Status:** approved 2026-10-09. Idea from the "Dev Dossier" browser extension post; no code was taken from it.

**Problem.** Tracing a token creator's wallet by hand (copy the deployer, open Solscan, scroll, work out which of their other coins died) takes minutes, so it gets skipped. On the Check tab, Solana coins get a **Creator history** block: with your Helius key the app reads the creator wallet's recent transactions, finds the coins that wallet launched, looks each up on DexScreener, and lists them as alive, quiet or dead with a summary like "9 of 12 dead". A creator with 3 or more dead launches (and most of their launches dead) becomes a high risk finding. We know it works when tests on sample Helius transactions give the right launches and on sample DexScreener pairs give the right outcomes and the rugger rule, and browser tests with mocked Helius and DexScreener show a clean creator, a serial rugger, no history and the no-key case.

## Rules

- **Creator wallet:** from RugCheck (or GoPlus). If neither names one, the block says so.
- **Launch:** a transaction the creator wallet paid for that Helius types as a token creation, with the new coin's mint taken from the transaction's token movements. The coin being checked is left out. Up to 20 launches, newest first. Reads up to 5 pages (500 transactions) of the wallet's history and says how far back that reached.
- **Outcome**, from the coin's best DexScreener pool now:
  - **Dead:** no pool found, or liquidity under $1,000.
  - **Quiet:** a pool exists but 24h volume is under $500.
  - **Alive:** anything else.
  - A launch under 6 hours old is **Too new** and not counted either way.
  - We have no launch price, so "price down 90%" is not used. Dead means the market is gone, not necessarily a rug.
- **Serial rugger finding (high):** 3 or more dead launches AND at least 60% of the counted launches dead.
- No Helius key, no creator wallet, or a wallet with no launches found: the block says so and never reads as "clean". Solana only.
- Creators who use a fresh wallet per launch show no history.

## Unsure

- Whether Helius labels every launch route (pump.fun, bonding-curve clones, Raydium launchpads) as a token creation. This was not checked against the live API; the block says "no launches found in the last N transactions" rather than "no launches".
