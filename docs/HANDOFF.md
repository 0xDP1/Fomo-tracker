# Handoff for the next session

Read this with CLAUDE.md and ROADMAP.md. Last updated 2026-10-11 (app v62, Step 1 done).

## Repos and deploys

- **0xDP1/Fomo-tracker** (public), branch `main`: the live app on GitHub Pages, https://0xdp1.github.io/Fomo-tracker/. GitHub Actions (`.github/workflows/tests.yml`) runs lint, type check, unit and browser tests on every push.
- **0xDP1/eBay-** (private), branch `fomo-tracker`: a mirror. Work so far was done here on `step-…` branches, fast-forwarded into `fomo-tracker`, then cherry-picked onto Fomo-tracker `main`. Keep the two identical (`diff -rq` excluding `.git`, `node_modules`, `tests/e2e/out`).
- Before every commit, check the diff never contains the owner's FOMO handle, wallet address or any API key (the owner can tell you the handle and wallet; keys stay in Cloudflare and on the owner's phone).
- Every release bumps `APP_VERSION` in app.js, `version.json` and every `?v=N` in index.html together (a test checks they agree).

## Checks

`npm ci` once, then `npm run check` (ESLint, type check, 177 unit and Worker tests) and `npm run e2e` (28 browser test files, Playwright, all outside services mocked). In a cloud session Chromium is at `/opt/pw-browsers/chromium`; the helpers find it.

## The Cloudflare Worker (`worker/`)

- Name `fomo-discord-feed`, URL https://fomo-discord-feed.daviddphan.workers.dev, on the owner's Cloudflare account.
- Reads Discord only when the app asks (no cron), plus a read-only GMGN proxy at `/gmgn/…`.
- Since v62 (Step 1) it is also the app's **key proxy**: the app calls fomoapi.io, Helius and Claude only through it (routes, limits and guards in `worker/README.md`), via `proxy.js`. The app holds only the Worker URL and feed key; `GET /services` tells it which secrets are set.
- Secrets on the Worker (values never in chat, git or the app): `DISCORD_TOKEN`, `FEED_KEY`, `GMGN_API_KEY`, and from v62 `HELIUS_API_KEY`, `FOMO_API_KEY`, `ANTHROPIC_API_KEY`. Plain vars: `CHANNEL_ID` (three channels: first scan, group traction, price move), `CHATTER_CHANNEL` (the "on chain feed" channel, searched on request by `/chatter`), `ALLOWED_ORIGIN`. KV binding `CALLS`. The Worker answers from memory and writes KV at most once a minute (free plan: 1,000 writes a day). GMGN allowlist: six read endpoints incl. `user/wallet_activity`.
- Deploy: after changing `calls.js` or `worker/*`, run `node worker/bundle.js`, then upload `worker/discord-feed.js` with the Cloudflare API (the session environment has a Cloudflare API token as a network secret for api.cloudflare.com; it expires 2026-11-01). Read the current bindings first (`GET …/workers/scripts/fomo-discord-feed/settings`) and send them back with `keep_bindings: ["secret_text"]` so the secrets survive. The owner can also paste `worker/discord-feed.js` into the dashboard editor.
- GMGN bans Cloudflare's shared addresses at times ("IP is temporarily banned…"); the app then falls back to the GMGN key stored on the owner's phone (Settings → Advanced).

## Shipped since v49 (all with specs in `docs/features/`)

v50 GMGN chart · v51 holder labels · v52 Helius saver · v53 call score + Best view · v54 wallet memory · v55 short time filters · v56 "What people are saying" (chatter, Claude Haiku) · v57 UI clean-up (Calls tab, Trades tab removed, folded Check result) · v58 faster feed · v59 paper trades (copy a wallet) · v60 Scanner judges young coins on pace · v61 AI paper trader (Claude Sonnet, full evidence, compared with fixed exits).

## Not yet confirmed with real data on the owner's phone

GMGN field names for holder labels and wallet activity (tests use GMGN's documented fields); the live chatter search (feed key changed, so it was never run from the build machine); Helius's out-of-credits reply; whether the GMGN chart embed loads; the Best list's top picks feeling right; wallet memory filling up (needs days).

## Ideas parked (owner agreed: validate and do foundation steps first)

- From GMGN's `skillmarket-demos`: a **copy-tradeability score** before copying a wallet (great trader vs. capturable with your delay), and **"missing data is not good news"**: cap the rug verdict when key checks (RugCheck/GoPlus, honeypot) fail.
- Trending across GMGN timeframes (official `market/rank`) as a Scanner / call-score signal.
- KOL bought before tweeting (needs tweet times).
- **Copy check** (original or copy under the same ticker or name): spec approved 2026-10-11 (`docs/features/copy-check.md`), to build after Step 2. Idea from the NOVAMP post; its code was not seen.
- **Verdict track record**: of coins our Check called Walk away vs Looks OK, the share that fell 90%+ (or went 2×+) within 24h, with counts and misses shown. Benchmark: CrawlScan's own `/api/replay` stats (7 days, 2026-10-11) were DANGER 80 of 168 fell 90%+ (47.6%) vs CLEAN 72 of 189 (38.1%), so their verdict barely separates.
- **Narrative radar** (words in new coin names that are rising, from the Moth-radar post): tag Call queue coins that fit a rising word and let the Signal scorecard show whether it pays before building more. Low priority.
- **Random baseline for Paper trades**: spec approved 2026-10-11 (`docs/features/random-baseline.md`), being built in its own session. Idea from BeeBrain (@h100envy), whose own results lost money on 522 real pools: its value is the discipline (beat random behind the same filters before trusting picks).
- **Wallet tracker**: spec proposed in `docs/features/wallet-tracker.md`, waiting for approval (the owner's idea: good wallets from a checked coin, tracked, then seen on other coins for conviction).
- **No trades means dead**: in Plan/Watch and Paper trades, a coin with no trades for hours is dead, not "holding a base" (lesson from Second Wave, `github.com/davangrind/secondwave`). A few lines.
- **Second-wave watch**: coins in the call book that pumped, pulled back, built a base with real trading and see buyers return get flagged, with target, invalidation and deadline frozen when the setup starts (from Second Wave's lifecycle: migration, first rise, pullback, base, active, then impulse / invalidated / expired). Candles from GeckoTerminal (no key). Bigger; needs a spec. Their published base rate: of 76,827 launches 1.12% migrated; their top 10% ranked 4.59%.

## Open items

0. **Step 1 rollout (v62)**: the owner sets `HELIUS_API_KEY`, `FOMO_API_KEY` and `ANTHROPIC_API_KEY` on the Worker, the Worker is redeployed from `worker/discord-feed.js` (keep the secret bindings), Settings → Your Worker shows all three ✓, and only then v62 goes to `main`. v62 deletes the keys stored on the phone, so publishing it first would switch FOMO, Helius and Claude features off until the secrets are set. Confirm on the phone that fomoapi.io and Helius answer calls from Cloudflare (GMGN does not always).

1. **Helius saver**: shipped in v52 (`docs/features/helius-saver.md`). Confirm the out-of-credits message on the phone once Helius runs out.
2. **Helius Parsed Events**: move off the Enhanced Transactions API (100 credits a read, maintenance mode) to Parsed Events (10 credits) once its data is confirmed to match.
3. **Step 5**: tick it once the owner turns on branch protection for `main` requiring both Tests checks.
4. **Roadmap Steps 2–4, 6, 7** are still unchecked; Step 2 (split app.js) comes next.
5. Unconfirmed on the owner's phone: Open in FOMO links on non-Solana chains; whether FOMO links open the app from the home-screen version.
6. Signal scorecard numbers need a week or two of the app being open to fill in.
