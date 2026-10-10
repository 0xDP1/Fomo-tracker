# Bundle check (isitbundled.com)

**Status:** approved 2026-10-10. Thresholds adjusted after testing against 96 coins from the user's Discord feed (94 scanned; 38 bundled; 10 at 30%+; 3 at 40%+; 11 made with Proxima; 3 serial-bundler devs).

**Problem.** Bundled launches are the biggest rug signal in the Discord alerts, and the Call queue only learned about them after a slow rug check per coin. isitbundled.com has a free API (no key, 60 requests a minute per IP, browser-friendly) that says how much supply was bought together at launch, whether a bundling tool (Proxima, Sumo) made the coin, and the dev's launches in the last 7 days. **Check tab:** a Bundle check block for Solana coins with status, bundled %, wallets, first-second share, dev buy, risk, the dev's 7-day launches and how many were bundled, and a link to the full report. **Call queue:** one request per 100 coins gives every Solana row a tag (`bundled 27%`, `Proxima · bundled 54%`, `no bundle`, `not scanned`), coins over 40% bundled are skipped for the automatic rug check, and a **Max bundled %** filter joins the other two. We know it works when tests on real API responses give the right readings, labels, batches and findings, and browser tests with mocked responses show the block, the tags, the skip, the filter and the unscanned case.

## Rules

- Findings: 30%+ bundled at launch is high, 15%+ medium (`launchbundle`); skipped when RugCheck/TrenchBot already flagged a bundle still held, so the same supply is not counted twice. A dev whose 3+ launches in 7 days were all bundled is high (`serialbundler`).
- Unscanned coins say "not scanned", never clean, and add no finding.
- Results are reused for 10 minutes; the Check tab reuses what the queue fetched.
- Solana only (the API rejects a batch containing an EVM address).
- Their numbers are their own reading of on-chain data; the app does not verify them. Shown with "Data: isitbundled.com".
