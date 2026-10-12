# Strength: linked wallets and SOL balances (v71)

**Status:** approved 2026-10-12. The owner's point: a coin whose largest wallet is under 3% can still be rugged by bundled or linked wallets, and how much SOL the top holders keep is a red or green flag.

**Problem.** The Strength card's holder check looks at the single largest wallet, so one person splitting 15% across ten wallets at 1.5% each passes as "largest wallet under 3%". Linked and bundled wallets usually hold almost no SOL (funded just enough to buy and exist only to sell); real buyers usually have SOL left. **What changes:** (1) the holder check uses the **largest wallet or linked group**: the biggest of the top wallet, GMGN's bundler / insider / sniper / dev supply, the bundle still held (RugCheck / TrenchBot) and the biggest operator group after **Analyze top wallets**, and says which; (2) a fifth part, **Wallets**: the SOL balances of the top real holders, read automatically on each Solana check in one `getMultipleAccounts` request (about 1 Helius credit, the public RPC without a key). Each wallet is **empty** (under 0.1 SOL), **low** (0.1–1), or **funded** (5+); the part scores the supply in empty wallets, the share held by funded ones and **look-alikes** (3+ top wallets with nearly the same SOL balance, within 2%, and a similar share of supply, within 10%), and the card lists red and green flags in plain words. (3) Five parts of 20 points instead of four of 25; the score is still out of 100, "not read" parts never count as good, Strong / Mixed / Weak cutoffs unchanged. It stays separate from the rug score. Solana only. We know it works from unit tests (a 2% top wallet with 14% in GMGN-tagged bundlers loses holder points; each SOL threshold; look-alikes fire on 3 and not 2; missing balances give "not read") and a browser test of the Check card with faked balances.

## Unsure

- The SOL thresholds (0.1 / 1 / 5) and the look-alike tolerances are first guesses, to retune from the Signal scorecard.
- The app has the top 15 holders from RugCheck, so the balances cover up to 15 real wallets, not 20.
- GMGN's holder list may carry SOL balances; if a live reply shows it, that can replace the RPC read.
