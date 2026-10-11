# Discord feed Worker

Reads up to 10 Discord channels with **your own account token**, only when the app asks (every minute while it is open, and straight away when you open it) and keeps the contract addresses people post (last 3 days, up to 1000). The app's Call queue fetches them from here. The Worker only ever sends `GET` requests to Discord; it never posts, reacts or marks anything read.

> **Risk:** using a user token outside the Discord app breaks Discord's terms. Discord can lock or ban the account. Use an account you can afford to lose.

The token lives only as a Cloudflare secret. Never paste it into the app, a chat, or git.

It can also read **private Telegram groups** you are in, as your own Telegram account (see [Telegram groups](#telegram-groups-optional) below).

> **Needs the `nodejs_compat` compatibility flag** (Settings → Runtime → Compatibility flags), Discord-only setups included: the built file uses Cloudflare's Node modules. Without the flag the Worker fails to start.

## Setup in the Cloudflare dashboard (no install, works from a phone)

1. Sign up at dash.cloudflare.com (the free plan is enough for Discord; Telegram needs Workers Paid, $5 a month, because each Telegram read takes about 20–30 ms of CPU and the free plan allows 10 ms).
2. **Storage & Databases → KV → Create** a namespace called `fomo-calls`.
3. **Workers & Pages → Create → Worker**, name it `fomo-discord-feed`, Deploy, then **Edit code**. Replace everything with the contents of [`discord-feed.js`](discord-feed.js) and Deploy. (It is about 4 MB since the Telegram feed; if the editor struggles, deploy with the CLI below.) Then **Settings → Runtime → Compatibility flags**: add `nodejs_compat`.
4. In the Worker's **Settings**:
   - **Bindings → Add → KV namespace**: variable name `CALLS`, namespace `fomo-calls`.
   - **Variables and Secrets → Add**:
     - `CHANNEL_ID` (text): the channel ID (Discord: Developer Mode on, long-press the channel → Copy Channel ID). For several channels, list them separated by commas, each with an optional label: `111111:first scan,222222:price move`. Progress from a single-channel setup carries over to the first channel listed.
     - `ALLOWED_ORIGIN` (text): `https://0xdp1.github.io`
     - `DISCORD_TOKEN` (**secret**): your Discord token.
     - `GMGN_API_KEY` (**secret**, optional): your GMGN API key. Turns on Early traders and GMGN creator history in the app. Only six read endpoints are forwarded (the sixth, a wallet's recent buys, feeds Paper trades); trading never is.
     - `CHATTER_CHANNEL` (text, optional): the channel ID that **What people are saying** searches on request (Discord's own search, last 24 hours; nothing is stored). Leave it out to turn the feature off.
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

## Telegram groups (optional)

Reads up to 5 Telegram groups or channels **as your own Telegram account**, so private groups work and alert bots' posts are seen too. Same rhythm as Discord: only when the app asks, at most once every 20 seconds, catching up on up to 500 messages per group. Calls go into the same Call queue with the group's name as the channel. The Worker only ever asks Telegram for a group's new messages (`messages.GetHistory`; a test fails if anything else is sent). It never sends, reacts, marks read, joins or leaves.

> **Risk:** the session below is full access to your Telegram account, kept only as a Cloudflare secret. Anyone with your Cloudflare account could use it. End it any time in Telegram → **Settings → Devices**. Telegram sometimes restricts accounts used from third-party clients; a spare account in the group is safer.

1. Switch the Cloudflare account to **Workers Paid** ($5 a month).
2. At [my.telegram.org](https://my.telegram.org) → **API development tools**, create an app (any name) and note the `api_id` and `api_hash`.
3. On your own computer (Node 22+), in this repo: `npm ci`, then `node worker/telegram-login.mjs`. It asks for the api_id, api_hash, your phone number, the code Telegram sends you and your two-step password if you have one, lists your groups, and prints four values. It saves nothing.
4. In the Worker's **Settings → Variables and Secrets**, add `TG_API_ID`, `TG_API_HASH` and `TG_SESSION` as **secrets** and `TG_CHAT` as text (`channel:<id>:<access hash>:<label>` or `chat:<id>:<label>`, comma-separated). The `nodejs_compat` flag must be on.

The Call queue then shows a "Telegram: ok" line under the Discord one.

| Telegram status | Fix |
| --- | --- |
| `session_invalid` | The login ended (logged out in Telegram, or the session was ended under Devices). Run `node worker/telegram-login.mjs` again and replace `TG_SESSION`. |
| `no_access` | The account can no longer read that group (left or removed). |
| `rate_limited` | Telegram asked the Worker to slow down; it waits as long as Telegram says. |
| `telegram_error` | Telegram or network trouble (the app shows Telegram's own code); it tries again on the next refresh. |

## Setup with the CLI instead

```sh
cd worker
npx wrangler kv namespace create CALLS   # put the id in wrangler.toml
# set CHANNEL_ID in wrangler.toml
npx wrangler secret put DISCORD_TOKEN
npx wrangler secret put FEED_KEY
# Telegram (optional): npx wrangler secret put TG_API_ID / TG_API_HASH / TG_SESSION, and TG_CHAT in wrangler.toml
npx wrangler deploy
```

## Changing the code

Edit `../calls.js`, `feed-core.js`, `index.mjs` or `telegram.mjs`, then run `node worker/bundle.js` (after `npm ci`: it uses esbuild and the teleproto Telegram library) to rebuild `discord-feed.js`. The tests fail if you forget. When deploying through Cloudflare's API, send `compatibility_flags: ["nodejs_compat"]` with the upload.
