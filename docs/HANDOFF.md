# Handoff for the next session

Read this with CLAUDE.md and ROADMAP.md. Last updated 2026-10-11 (app v61).

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
- Secrets on the Worker (values never in chat, git or the app): `DISCORD_TOKEN`, `FEED_KEY`, `GMGN_API_KEY`. Plain vars: `CHANNEL_ID` (three channels: first scan, group traction, price move), `CHATTER_CHANNEL` (the "on chain feed" channel, searched on request by `/chatter`), `ALLOWED_ORIGIN`. KV binding `CALLS`. The Worker answers from memory and writes KV at most once a minute (free plan: 1,000 writes a day). GMGN allowlist: six read endpoints incl. `user/wallet_activity`.
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

## Open items

1. **Helius saver**: shipped in v52 (`docs/features/helius-saver.md`). Confirm the out-of-credits message on the phone once Helius runs out.
2. **Helius Parsed Events**: move off the Enhanced Transactions API (100 credits a read, maintenance mode) to Parsed Events (10 credits) once its data is confirmed to match.
3. **Step 5**: tick it once the owner turns on branch protection for `main` requiring both Tests checks.
4. **Roadmap Steps 1–4, 6, 7** are still unchecked; Step 1 (move keys into the Worker) and Step 2 (split app.js) come next.
5. Unconfirmed on the owner's phone: Open in FOMO links on non-Solana chains; whether FOMO links open the app from the home-screen version.
6. Signal scorecard numbers need a week or two of the app being open to fill in.
