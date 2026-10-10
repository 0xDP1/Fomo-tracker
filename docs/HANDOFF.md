# Handoff for the next session

Read this with CLAUDE.md and ROADMAP.md. Last updated 2026-10-10 (app v49).

## Repos and deploys

- **0xDP1/Fomo-tracker** (public), branch `main`: the live app on GitHub Pages, https://0xdp1.github.io/Fomo-tracker/. GitHub Actions (`.github/workflows/tests.yml`) runs lint, type check, unit and browser tests on every push.
- **0xDP1/eBay-** (private), branch `fomo-tracker`: a mirror. Work so far was done here on `step-…` branches, fast-forwarded into `fomo-tracker`, then cherry-picked onto Fomo-tracker `main`. Keep the two identical (`diff -rq` excluding `.git`, `node_modules`, `tests/e2e/out`).
- Before every commit: `git grep -n -i "kynggg\|9eGhh\|fapi_a3"` must be empty (the owner's handle, wallet and an old leaked key prefix must never be committed).
- Every release bumps `APP_VERSION` in app.js, `version.json` and every `?v=N` in index.html together (a test checks they agree).

## Checks

`npm ci` once, then `npm run check` (ESLint, type check, 140 unit and Worker tests) and `npm run e2e` (19 browser tests, Playwright, all outside services mocked). In a cloud session Chromium is at `/opt/pw-browsers/chromium`; the helpers find it.

## The Cloudflare Worker (`worker/`)

- Name `fomo-discord-feed`, URL https://fomo-discord-feed.daviddphan.workers.dev, on the owner's Cloudflare account.
- Reads Discord only when the app asks (no cron), plus a read-only GMGN proxy at `/gmgn/…`.
- Secrets on the Worker (values never in chat, git or the app): `DISCORD_TOKEN`, `FEED_KEY`, `GMGN_API_KEY`. Plain vars: `CHANNEL_ID` (three channels: first scan, group traction, price move), `ALLOWED_ORIGIN`. KV binding `CALLS`.
- Deploy: after changing `calls.js` or `worker/*`, run `node worker/bundle.js`, then upload `worker/discord-feed.js` with the Cloudflare API (the session environment has a Cloudflare API token as a network secret for api.cloudflare.com; it expires 2026-11-01). Read the current bindings first (`GET …/workers/scripts/fomo-discord-feed/settings`) and send them back with `keep_bindings: ["secret_text"]` so the secrets survive. The owner can also paste `worker/discord-feed.js` into the dashboard editor.
- GMGN bans Cloudflare's shared addresses at times ("IP is temporarily banned…"); the app then falls back to the GMGN key stored on the owner's phone (Settings → Advanced).

## Open items

1. **Helius saver** (spec proposed, waiting for approval): the fresh-wallet check in Flow on tap only, a 10-minute reuse of Flow and fee results, and a clear "Helius credits used up" message that stops further calls. The owner is at the free 1M-credit limit.
2. **Helius Parsed Events**: move off the Enhanced Transactions API (100 credits a read, maintenance mode) to Parsed Events (10 credits) once its data is confirmed to match.
3. **Step 5**: tick it once the owner turns on branch protection for `main` requiring both Tests checks.
4. **Roadmap Steps 1–4, 6, 7** are still unchecked; Step 1 (move keys into the Worker) and Step 2 (split app.js) come next.
5. Unconfirmed on the owner's phone: Open in FOMO links on non-Solana chains; whether FOMO links open the app from the home-screen version.
6. Signal scorecard numbers need a week or two of the app being open to fill in.
