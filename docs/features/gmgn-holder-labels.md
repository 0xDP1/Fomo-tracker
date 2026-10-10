# GMGN holder labels on Check

**Status:** approved 2026-10-10.

**Problem.** The Check tab can't say whether insiders, snipers and bundlers hold a big share of a coin, or whether smart money and KOLs are in, without spending Helius credits on the top-wallet scan. With GMGN available (through the Worker or the phone's GMGN key), Check fetches GMGN's top 100 holders once (`market/token_top_holders`, already forwarded by the Worker) and reads GMGN's own wallet labels. A **Holder labels** block shows the share of supply held by wallets labelled bundler, rat trader (shown as insider), sniper or dev team (`dev_team`, `creator`), with counts, plus how many smart-money (`smart_degen`, `pump_smart`) and KOL (`renowned`, `kol`) wallets hold and how many have sold more than half. Pools and burn addresses are left out, and shares are floors because only the top 100 come back. Findings: high when labelled wallets hold 30%+ of supply, medium at 15%+ (first guesses, like the other thresholds); medium "smart money is selling" when 3 or more smart-money wallets hold and more than half of them have sold more than half. If GMGN returns no holders, the block says it couldn't check instead of showing 0%. We know it works from unit tests on a holders sample, a browser test of the block and findings through the Worker, the phone fallback and with GMGN not set up, and a live check on a coin on the phone. No new dependency, no Worker change, no new key.

## Unsure

- The test sample (`tests/fixtures/gmgn-holders.json`) follows the field list in GMGN's own skills docs (github.com/GMGNAI/gmgn-skills); it is not a captured live response, because GMGN refuses the Worker and there is no key on the build machine. The live check on the phone confirms the field names.
- The 15% / 30% thresholds and the "3 smart wallets" minimum are guesses to tune with the Signal scorecard later.
