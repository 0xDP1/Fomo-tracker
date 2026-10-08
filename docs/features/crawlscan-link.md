# CrawlScan link

**Status:** approved 2026-10-08.

**Problem.** CrawlScan (crawlscan.fun) reports operator clusters for pump.fun and Robinhood Chain coins, including Robinhood coins the app's own contract checks can't cover. The Check tab's "Look deeper" links add CrawlScan for Solana and Robinhood Chain coins, opening crawlscan.fun with the contract address filled in. We know it works when a test confirms the link and its address for those chains and its absence elsewhere. CrawlScan has no public API, so the app links to it rather than calling it.
