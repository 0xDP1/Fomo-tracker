# Helius saver

**Status:** approved 2026-10-10.

**Problem.** The owner is at Helius's free 1M-credit limit. Each Helius transaction read costs 100 credits, and the automatic Flow read on every Solana check made up to 5 reads of the coin's swaps plus one read for each of the 8 biggest buyers (fresh-wallet check), so up to about 1,300 credits a coin, again on every re-check. Now: the fresh-wallet check runs only when **Check fresh wallets** is tapped (the button says how many reads it uses); a re-check of the same coin within 10 minutes reuses its Flow (and a fee re-sample reuses its read), with **Refresh** reading again; and every Helius transaction read goes through one gateway (`heliusTx` in `flow-ui.js`) that recognises Helius's out-of-credits answer (402, or 429/403 whose message mentions credits, usage, quota or plan), shows "Helius credits used up" and makes no further Helius calls until the app is reloaded. A plain 429 is still "rate limit, try again in a minute" and does not stop anything. Creator history keeps preferring GMGN, which uses no Helius credits. We know it works from a unit test of the out-of-credits rule and browser tests that count Helius requests: one check makes only the coin's Flow reads with buyers on tap, a re-check within 10 minutes makes none, Refresh makes one, and after an out-of-credits answer no further Helius requests are made by Flow, fee sampling or Analyze top wallets while the message shows.

## Unsure

- The exact body Helius sends when a plan is out of credits was not seen live; the rule matches the common wordings. If the phone shows a different error once credits run out, match it.
- Wallet sync (Settings) also reads Helius (100 credits per page, up to the sync pages setting) and is not changed here.
