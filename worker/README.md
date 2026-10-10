# Discord feed Worker

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
     - `GMGN_API_KEY` (**secret**, optional): your GMGN API key. Turns on Early traders and GMGN creator history in the app. Only five read endpoints are forwarded; trading never is.
     - `FEED_KEY` (**secret**): a long random password you make up (20+ characters). The app sends it to prove it's you.
   - No Cron Trigger needed. The Worker reads Discord when the app asks, and catches up on anything posted while the app was closed (up to 500 messages per channel). A Cron Trigger would read all day and use up the free 1,000 storage writes a day.
5. Copy the Worker URL (like `https://fomo-discord-feed.<you>.workers.dev`).
6. In the app: **Settings → Advanced → Discord feed**, paste the URL and the feed key, Save.

Within seconds the Call queue shows "Discord feed: ok" and new calls appear.

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
npx wrangler deploy
```

## Changing the code

Edit `../calls.js`, `feed-core.js` or `index.mjs`, then run `node worker/bundle.js` to rebuild `discord-feed.js`. The tests fail if you forget.
