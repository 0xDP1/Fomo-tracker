# ROADMAP

Static vanilla-JS app, no build step. One step per branch (`step-N-short-name`). Do exactly one unchecked step per session: plan first, wait for approval, implement, run `node --test tests/*.test.js`, tick the step, summarize.

**Test baseline (Step 0, 2026-10-03):** `node --test tests/*.test.js` → 24 tests, 24 pass, 0 fail.

- [x] **Step 0: Set up the guardrails**
  Goal: Get the repo ready so every later session starts from the same rules.
  Done when: CLAUDE.md and ROADMAP.md exist, tests pass, and nothing else changed.

- [ ] **Step 1: Move API keys off the browser**
  Goal: No secret ever reaches the front end. Add a Cloudflare Worker in `/worker` that proxies Helius RPC and transactions, fomoapi.io user lookups, Jupiter prices and the Anthropic messages call. Keys as Worker secrets (`wrangler secret put`), CORS locked to the app's origin, per-IP rate limiting, ~30 s cache for price calls. Point the front end at the Worker; remove key fields from Settings or keep them only behind an explicit "local mode". Document deploy steps in `worker/README.md`.
  Done when: Searching the front-end code finds no `api-key=`, `x-api-key` or `Authorization` values, and every feature still works through the Worker.

- [ ] **Step 2: Break up app.js and add types**
  Goal: Small modules that can be read, tested and changed alone. Split into native ES modules (still no build step): `src/api/` (rpc, helius, fomo, jupiter, claude), `src/data/store.js`, `src/sync/`, `src/ui/` (dashboard, trades, analytics, sizing, check), `src/main.js`. Add JSDoc types for Trade, Fill, Position and Settings, `// @ts-check`, and a dev-only type check with `tsc --noEmit --checkJs`. Move pieces one at a time, running tests after each move.
  Done when: app.js is gone or under 150 lines, the type check is clean, tests pass, and the app behaves exactly as before.

- [ ] **Step 3: Make PnL bulletproof**
  Goal: Every swap is accounted for, and the numbers are provably right. Handle token-to-token swaps (value both legs in SOL/USD at swap time), multi-token swaps and partial sells. Treat wallet transfers in and out as transfers, not trades. Positions opened before the synced history are shown as "unknown cost basis" instead of skipped silently. Pick and document one cost-basis method (average cost is current; keep it unless there is a reason to change). Save real Helius and fomoapi.io responses (wallet addresses anonymized) in `tests/fixtures/` and add golden tests for each case.
  Done when: A fixture test exists for every swap type listed, and none are dropped without being reported in the UI.

- [ ] **Step 4: Replace localStorage with IndexedDB**
  Goal: Trade history survives updates and can't be corrupted by a format change. Small IndexedDB wrapper (no dependency unless approved) with a schema version number. One-time migration from existing localStorage data on first load, keeping the old copy until the user confirms. JSON export and import keep working and include the schema version.
  Done when: A test migrates sample localStorage data and gets identical trades back.

- [ ] **Step 5: Add CI**
  Goal: Nothing broken can be merged. GitHub Actions workflow on every push and pull request: tests, ESLint and the type check. Add a status badge to the README.
  Done when: A pull request with a failing test is blocked by the workflow.
  Progress (2026-10-10): `.github/workflows/tests.yml` runs ESLint, the type check (`jsconfig.json`, shared logic modules), the unit and Worker tests, and the 18 browser tests on every push and pull request, with a README badge. Left: branch protection on `main` requiring the Tests checks (a repo setting the owner turns on), then this step can be ticked.

- [ ] **Step 6: Write down the decisions**
  Goal: The next person (or the next Claude session) understands why it's built this way. `docs/ARCHITECTURE.md`: modules, data flow from wallet to stats, where keys live. `docs/DECISIONS.md`: short records for no build step, the Worker proxy, IndexedDB and the cost-basis method, each with the tradeoff. Update the README: setup, Worker deploy, known limits.
  Done when: A new developer can set up, deploy and find any feature from the docs alone.

- [ ] **Step 7: Bug hunt**
  Goal: Find and fix real bugs, and prove each fix with a test. Audit the sync, PnL and stats code against real wallet data (Step 3 fixtures plus a few live wallets). Look hardest at: wrong PnL on edge cases, duplicate or missing trades after repeated syncs, pagination gaps, timezone and timestamp mistakes, rounding, stale prices, and race conditions when sync and refresh run at the same time. For each bug: failing test, fix, confirm; one bug per commit. Keep `docs/BUGS.md`: what was wrong, how it was found, the test that guards it, plus suspected bugs that could not be reproduced.
  Done when: Every fixed bug has a test that failed before the fix and passes after, and BUGS.md lists them.

- [ ] **Step 8: Feature loop** (repeat for each new feature; this step is never ticked off)
  Goal: Ship new features fast without breaking anything else. Before any code, write a one-paragraph spec in `docs/features/<name>.md` (problem it solves, what the user sees, how we'll know it works) and wait for approval. Pick features by value: what would change a trading decision or save real time. Write tests for the new behavior, then build it in the right module (not in main.js). One feature per branch, CI must pass, update README and ARCHITECTURE.md if the feature changes how the app works. Add each feature as its own line below.
  Done when: Each shipped feature has an approved spec, its own tests, a green CI run, and updated docs.
  - [x] Followed traders: follow FOMO handles and see their latest buys and sells on the Dashboard, with one-tap Check (spec: `docs/features/followed-traders.md`). Shipped in v24 with unit and browser tests; CI pending Step 5.
  - [x] Find a trader: handle, link or profile screenshot to their wallets per chain and a scorecard, with Follow (spec: `docs/features/find-trader.md`). Shipped in v25 with unit and browser tests; CI pending Step 5.
  - [x] Find a trader revision: win rate and trading style instead of wallets (spec revision in `docs/features/find-trader.md`). Shipped in v26.
  - [x] Holder lessons: snapshot holders at entry, compare wins and losses by warning sign on Analytics, warn on Check when a coin matches a pattern that cost you (spec: `docs/features/holder-lessons.md`). Shipped in v27 with unit and browser tests; CI pending Step 5.
  - [x] Market pulse: meme market volume over 5m / 30m / 1h with a mood, Movers list and pace on open positions (spec: `docs/features/market-pulse.md`). Shipped in v28 with unit and browser tests; CI pending Step 5.
  - [x] Scanner: new launches through free, trade and chain cuts and a Claude judge, shortlist with reasons, paper-trade scorecard (spec: `docs/features/scanner.md`). Shipped in v29 with unit and browser tests; CI pending Step 5.
  - [x] Thesis drafts: auto-researched, honest thesis drafts for new positions and on demand from Check, ready to paste into FOMO (spec: `docs/features/thesis-drafts.md`). Shipped in v30 with unit and browser tests; CI pending Step 5.
  - [x] Flow check: Helius read of a coin's last hour of swaps (volume, unique buyers vs sellers, top wallet share, fresh buyers) with a Real demand / Thin / One wallet label (spec: `docs/features/flow-check.md`). Shipped in v32 with unit and browser tests; CI pending Step 5.
  - [x] CrawlScan link: "Look deeper" link to crawlscan.fun for Solana and Robinhood Chain coins (spec: `docs/features/crawlscan-link.md`). Shipped in v33 with unit and browser tests.
  - [x] Operator check: Analyze top wallets traces funders of the top 15 holders, merges linked wallets into operators, estimates the dump drop of the biggest one (spec: `docs/features/operator-check.md`). Shipped in v34 with unit and browser tests; CI pending Step 5.
  - [x] Coin age at entry: Analytics table of your results by how old the coin was when you bought (spec: `docs/features/coin-age.md`). Shipped in v35 with unit and browser tests; CI pending Step 5.
  - [x] Fee drag: Analytics card with trades per day, estimated monthly trading costs and break-even win rate with and without costs (spec: `docs/features/fee-drag.md`). Shipped in v35 with unit and browser tests; CI pending Step 5.
  - [x] UI cleanup: main actions first on every tab, foldable sections that remember their state, empty panels hidden, trade log and tables fit phones (approved plan, 2026-10-08). Shipped in v36 with a layout browser test.
  - [x] Call queue and Discord feed: paste / screenshot / share-link / Worker feed of Discord calls, new-coin filter, rug checks, ranking and a Callers scorecard (spec: `docs/features/call-queue.md`). Shipped in v37 with unit, Worker and browser tests; CI pending Step 5.
  - [x] Dev dossier: creator wallet's earlier launches and how each stands now, with a serial-rugger finding (spec: `docs/features/dev-dossier.md`). Shipped in v38 with unit and browser tests; CI pending Step 5.
  - [x] Call queue: several Discord channels and the contract address on each row (spec revision in `docs/features/call-queue.md`). Shipped in v40 with unit, Worker and browser tests.
  - [x] Call queue: alert parsing, caller win-rate directory, channel chips and filters, fewer API calls (spec revision in `docs/features/call-queue.md`). Shipped in v41-42 with unit, Worker and browser tests.
  - [x] Call queue: read Discord only when the app is open, with catch-up and Pause feed (spec revision in `docs/features/call-queue.md`). Shipped in v43.
  - [x] Bundle check: isitbundled.com block on Check, bundle tags, auto-check skip and filter in the Call queue (spec: `docs/features/bundle-check.md`). Shipped in v44 with unit and browser tests.
  - [x] Signal scorecard and callers leaderboard (specs: `docs/features/signal-scorecard.md`, `docs/features/callers-leaderboard.md`). Shipped in v45 with unit and browser tests.
  - [x] Open in FOMO: a FOMO button on every coin, for all eight chains FOMO trades (spec: `docs/features/open-in-fomo.md`). Shipped in v47 with unit and browser tests.
  - [x] GMGN data via the Worker: Early traders block and GMGN creator history (spec: `docs/features/gmgn-data.md`). Shipped in v48 with Worker, unit and browser tests. Live test: GMGN bans the Worker's shared Cloudflare address, so v49 adds the device as fallback (GMGN key in Settings).
  - [x] GMGN price chart on Check: collapsed Chart panel with GMGN's embedded candles and interval buttons (spec: `docs/features/gmgn-chart.md`). Shipped in v50 with unit and browser tests; whether GMGN allows the embed is checked on the phone.
  - [x] GMGN holder labels on Check: bundler, insider, sniper and dev-wallet share of supply plus smart money and KOLs from GMGN's top holders, with findings (spec: `docs/features/gmgn-holder-labels.md`). Shipped in v51 with unit and browser tests; field names to confirm live on the phone.
  - [x] Helius saver: fresh-wallet check on tap, 10-minute reuse of Flow and fee reads, and a clear stop when Helius credits run out (spec: `docs/features/helius-saver.md`). Shipped in v52 with unit and browser tests.
  - [x] Call score and Best view in the Call queue (spec: `docs/features/call-score.md`). Shipped in v53 with unit and browser tests; point values to retune from the Signal scorecard.
  - [x] Wallet memory: learn the wallets that profited on rugs and runners from the Call queue and flag them on new coins (spec: `docs/features/wallet-memory.md`). Shipped in v54 with unit and browser tests; cut-offs to retune.
  - [x] Short time filters in the Call queue: Launched within 15m/30m and Called within 15m/30m/1h (spec: `docs/features/time-filters.md`). Shipped in v55 with a browser test.
