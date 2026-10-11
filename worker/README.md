# Discord feed Worker and key proxy

This one Worker does two jobs: it keeps every API key the app needs (fomoapi.io, Helius, Anthropic, GMGN) as a Cloudflare secret and makes those calls for the app, and it reads your Discord channels for the Call queue. The app only ever holds the Worker's URL and your feed key. See [Key proxy](#key-proxy) below.

Reads up to 10 Discord channels with **your own account token**, only when the app asks (every minute while it is open, and straight away when you open it) and keeps the contract addresses people post (last 3 days, up to 1000). The app's Call queue fetches them from here. The Worker only ever sends `GET` requests to Discord; it never posts, reacts or marks anything read.

> **Risk:** using a user token outside the Discord app breaks Discord's terms. Discord can lock or ban the account. Use an account you can afford to lose.

The token lives only as a Cloudflare secret. Never paste it into the app, a chat, or git.

## Setup in the Cloudflare dashboard (no install, works from a phone)

1. Sign up at dash.cloudflare.com (free plan is enough).
2. **Storage & Databases → KV → Create** a namespace called `fomo-calls`.
3. **Workers & Pages → Create → Worker**, name it `fomo-discord-feed`, Deploy, then **Edit code**. Replace everything with the contents of [`discord-feed.js`](discord-feed.js) and Deploy.
4. In the Worker's **Settings**:
   - **Bindings → Add → KV namespace**: variable name `CALLS`, namespace `fomo-calls`.
   - **Variables and Secrets → Add**:
     - `CHANNEL_ID` (text): the channel ID (Discord: Developer Mode on, long-press the channel → Copy Channel ID). For several channels, list them separated by commas, each with an optional label: `111111:first scan,222222:price move`. Progress from a single-channel setup carries over to the first channel listed.
     - `ALLOWED_ORIGIN` (text): `https://0xdp1.github.io`
     - `DISCORD_TOKEN` (**secret**): your Discord token.
     - `GMGN_API_KEY` (**secret**, optional): your GMGN API key. Turns on Early traders and GMGN creator history in the app. Only six read endpoints are forwarded (the sixth, a wallet's recent buys, feeds Paper trades); trading never is.
     - `CHATTER_CHANNEL` (text, optional): the channel ID that **What people are saying** searches on request (Discord's own search, last 24 hours; nothing is stored). Leave it out to turn the feature off.
     - `FEED_KEY` (**secret**): a long random password you make up (20+ characters). The app sends it to prove it's you.
     - `HELIUS_API_KEY` (**secret**, optional): wallet sync, Flow, fees, top wallets and creator history.
     - `FOMO_API_KEY` (**secret**, optional): your `fapi_…` key from fomoapi.io. All-chain mode, username lookup, Following and Find a trader.
     - `ANTHROPIC_API_KEY` (**secret**, optional): every Claude feature in the app.
   - No Cron Trigger needed. The Worker reads Discord when the app asks, and catches up on anything posted while the app was closed (up to 500 messages per channel). A Cron Trigger would read all day and use up the free 1,000 storage writes a day.
5. Copy the Worker URL (like `https://fomo-discord-feed.<you>.workers.dev`).
6. In the app: **Settings → Your Worker**, paste the URL and the feed key, Save.

Within seconds the line under the fields shows which keys the Worker has, the Call queue shows "Discord feed: ok" and new calls appear.

## What the statuses mean

With several channels the app shows the worst state and names the channel that has it.

| Status | Fix |
| --- | --- |
| `token_invalid` | Token expired or you logged out everywhere. Put a new `DISCORD_TOKEN` in Cloudflare. |
| `no_access` | The account can't read that channel. |
| `channel_not_found` | Wrong channel ID in `CHANNEL_ID`. |
| `rate_limited` | Discord slowed the Worker; it retries next minute. |
| `discord_error` | Discord or network trouble; it retries next minute. |

## Setup with the CLI instead

```sh
cd worker
npx wrangler kv namespace create CALLS   # put the id in wrangler.toml
# set CHANNEL_ID in wrangler.toml
npx wrangler secret put DISCORD_TOKEN
npx wrangler secret put FEED_KEY
npx wrangler secret put HELIUS_API_KEY      # optional
npx wrangler secret put FOMO_API_KEY        # optional
npx wrangler secret put ANTHROPIC_API_KEY   # optional
npx wrangler deploy
```

Each `secret put` asks for the value in the terminal, so the key never lands in a file, the shell history or git.

## Key proxy

The app calls these routes with its feed key (`x-feed-key`); each adds the key from the Worker's secrets and passes the service's answer back unchanged, with the key scrubbed out if a service ever echoes it.

| Route | Service | What is allowed |
| --- | --- | --- |
| `GET /services` | none | Which secrets are set (yes or no only), shown in Settings. |
| `POST /helius/rpc` | Helius RPC | `getBalance`, `getTokenAccountsByOwner`, `getAssetBatch` only. |
| `GET /helius/tx/<address>` | Helius parsed transactions | `before`, `type=SWAP`, `limit` up to 100. |
| `GET /fomo/users/<handle>[/balances\|/trades\|/positions]` | fomoapi.io | Read-only; short paging parameters. `x-credits-remaining` is passed on. |
| `GET /jup/price?ids=…`, `GET /jup/tokens?query=…` | Jupiter (no key) | Up to 100 mints; answers cached for 30 seconds. |
| `POST /claude/messages` | Anthropic Messages | Models `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`; `max_tokens` up to 4000; no streaming or tools; 2 MB body. |

Guards:

- **Feed key** on every route, compared in constant time.
- **CORS** answers only `ALLOWED_ORIGIN` (`https://0xdp1.github.io`). CORS stops other websites from using the Worker through a visitor's browser; it does not stop scripts, which is what the feed key is for.
- **Per-address limit** each minute (by `CF-Connecting-IP`): Helius 300, fomoapi.io 60, Jupiter 120, Claude 30. Each Worker instance counts on its own, so this is a backstop if the feed key leaks, not an exact quota. Refusals answer 429 `rate_limited`.
- A route whose secret is missing answers 503 `not_configured` with the secret's name, and the app says which secret to add.

The Worker's own refusals carry an `x-proxy-error: 1` header so the app can tell them from the service's answers (Helius running out of credits, fomoapi.io's 402).

## Deploying a new version

After changing `../calls.js`, `feed-core.js` or `index.mjs`, run `node worker/bundle.js` to rebuild `discord-feed.js`, then either paste `discord-feed.js` into the dashboard editor and Deploy, or upload it with the Cloudflare API. With the API, read the Worker's current bindings first (`GET /accounts/<account>/workers/scripts/fomo-discord-feed/settings`) and send them back with `keep_bindings: ["secret_text"]`, so the secrets survive the upload. Set new secrets in the dashboard (Settings → Variables and Secrets, type **Secret**) or with `npx wrangler secret put`; never put a key in `wrangler.toml` or in the app.

Order for a change that needs a new secret: set the secret, deploy the Worker, check **Settings → Your Worker** shows it, then publish the app.

## Changing the code

Edit `../calls.js`, `feed-core.js` or `index.mjs`, then run `node worker/bundle.js` to rebuild `discord-feed.js`. The tests fail if you forget.
