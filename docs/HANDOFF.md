# Handoff for the next session

Read this with CLAUDE.md and ROADMAP.md. Last updated 2026-10-12 (app v87).

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
- Since v66 the Worker can bring in Telegram groups through the owner's **Telegram reader** on Vercel (`telegram-proxy/`, free tier; it holds the Telegram login `TG_SESSION`, `TG_API_ID`, `TG_API_HASH`, plus `TG_CHAT` and `TG_PROXY_KEY`). Worker vars: `TG_PROXY_URL`, `TG_CHAT`, secret `TG_PROXY_KEY`. The reader is not in Cloudflare because a Telegram read needs 20–30 ms of CPU (free plan: 10 ms).
- Deploy: after changing `calls.js` or `worker/*`, run `node worker/bundle.js`, then upload `worker/discord-feed.js` with the Cloudflare API (the session environment has a Cloudflare API token as a network secret for api.cloudflare.com; it expires 2026-11-01). Read the current bindings first (`GET …/workers/scripts/fomo-discord-feed/settings`) and send them back with `keep_bindings: ["secret_text"]` so the secrets survive. The owner can also paste `worker/discord-feed.js` into the dashboard editor.
- GMGN bans Cloudflare's shared addresses at times ("IP is temporarily banned…"); the app then falls back to the GMGN key stored on the owner's phone (Settings → Advanced).

## Shipped since v49 (all with specs in `docs/features/`)

v50 GMGN chart · v51 holder labels · v52 Helius saver · v53 call score + Best view · v54 wallet memory · v55 short time filters · v56 "What people are saying" (chatter, Claude Haiku) · v57 UI clean-up (Calls tab, Trades tab removed, folded Check result) · v58 faster feed · v59 paper trades (copy a wallet) · v60 Scanner judges young coins on pace · v61 AI paper trader (Claude Sonnet, full evidence, compared with fixed exits) · v66 Telegram feed · v67 LP lock on launchpad pools + 3% wallet rule · v68 coin Strength score · v69 recent calls, alerts and win rate · v70 Recent calls keep updating after a hung DexScreener read · v71 Strength counts linked wallets as one holder and scores the top holders' SOL balances (Wallets part, red / green flags) · v72 updates install themselves on open (bar while busy). The wallet tracker (v65) is still on its own branch, `step-8-wallet-tracker`. · v73 Scanner creator cut + LP unlock date on Check + creator share from RugCheck's creator balance + GMGN request pacing, watchlist wallets, wallet report, Recent calls peak from candle highs, Recent calls sort and filter. · v74 Call lessons (snapshot at the call, candle outcomes at 1 h / 4 h, runners vs the rest, Haiku read, like-runners pill). · v76 FOMO and GMGN buttons on every Calls-tab coin. · v77 fix: Call queue rows show the live move since the call (bug 9). · v78 fix: FOMO and GMGN buttons for alert coins on BNB, Ethereum and Robinhood (bug 10). · v79 fix: no false "2× while you were away" when the call price was read late (bug 11); move and volume alerts; no call alert under a $10k market cap. · v80 fix: Telegram calls from Rick get the call market cap, caller and snapshot (bug 12). · v81 trench index (tehcscreener) on Market pulse and in the AI prompts. · v82 Market pulse on the Dashboard. · v83 trench section in tehcscreener's look. · v84 Paper tab: $5,000 account, copy a wallet with your size, its entry and its exits. · v85 market cap at the call on every Calls-tab coin. · v86 pump.fun graduations, checked and alerted (PumpPortal feed while the app is open). · v87 adjustable graduation filters.

Merging: the owner approved (2026-10-12) that Claude merges its own app PRs once GitHub's checks pass, after the owner approved the plan or spec; Worker and Vercel deploys still need a yes each time.

## Not yet confirmed with real data on the owner's phone

GMGN field names for holder labels and wallet activity (tests use GMGN's documented fields); the live chatter search (feed key changed, so it was never run from the build machine); Helius's out-of-credits reply; whether the GMGN chart embed loads; the Best list's top picks feeling right; wallet memory filling up (needs days); GMGN's total-fee field (Strength); the Wallets part's SOL thresholds (0.1 / 1 / 5) and look-alike tolerances against real coins.

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
