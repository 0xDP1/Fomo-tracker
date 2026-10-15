# Discord feed Worker

Reads up to 10 Discord channels with **your own account token**, only when the app asks (every minute while it is open, and straight away when you open it) and keeps the contract addresses people post (last 3 days, up to 1000). The app's Call queue fetches them from here. The Worker only ever sends `GET` requests to Discord; it never posts, reacts or marks anything read.

> **Risk:** using a user token outside the Discord app breaks Discord's terms. Discord can lock or ban the account. Use an account you can afford to lose.

The token lives only as a Cloudflare secret. Never paste it into the app, a chat, or git.

It can also bring in calls from **private Telegram groups** you are in, through your own Telegram reader on Vercel (see [Telegram groups](#telegram-groups-optional) below).

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

Calls from up to 5 Telegram groups or channels, read **as your own Telegram account** (so private groups and alert bots' posts work). The Telegram login doesn't live here: a Telegram read needs 20–30 ms of CPU and the free plan allows 10 ms, so a small **Telegram reader** on Vercel's free tier does the reading ([`../telegram-proxy/`](../telegram-proxy/README.md)). This Worker asks it for new messages since the last one it saw, at most once every 20 seconds, and turns them into calls with the group's name as the channel.

Set up the reader first (its README), then add here:

- `TG_PROXY_URL` (text): the reader's address, like `https://fomo-telegram.vercel.app`.
- `TG_PROXY_KEY` (**secret**): the same key you gave the reader.
- `TG_CHAT` (text): the same groups list the login script printed.

| Telegram status | Fix |
| --- | --- |
| `session_invalid` | The login ended (logged out in Telegram, or the session was ended under Devices). Run the login again and replace `TG_SESSION` in Vercel. |
| `no_access` | The account can no longer read that group (left or removed). |
| `rate_limited` | Telegram asked to slow down; the Worker waits as long as Telegram says. |
| (a group reads "ok" but nothing arrives) | Every 15 minutes the Worker also reads the group's latest page with no pointer, so a stuck pointer heals itself; the Calls tab shows "newest message N ago" per group. If that time is hours old while the group is busy, the reader itself is stuck: check its Vercel logs and redeploy it. |
| `telegram_error` | The reader or Telegram didn't answer (the app shows why, e.g. a wrong `TG_PROXY_KEY`); it tries again on the next refresh. |

## CrawlScan (no setup)

The app's **Run CrawlScan** and **CrawlScan** buttons go through this Worker (`GET /crawl?ca=`, with the feed key), because crawlscan.fun's API doesn't allow calls from another website. The Worker starts their scan, waits for the result and remembers it for 30 minutes per coin. Nothing to configure.

## Alerts while the app is closed (optional)

The app only prices calls while it is open. With a Telegram bot the Worker does it on a schedule: every 5 minutes it reads the last day's calls, prices them on DexScreener and messages you on **2×**, **4×** and the app's move / volume rule (one per coin per level, never under a $10k market cap). When you open the app again, its Recent calls show the peaks the Worker saw.

1. In Telegram, talk to **@BotFather**, send `/newbot`, pick a name, and copy the token it gives you.
2. Add it here as a **secret** named `TG_BOT_TOKEN` (Settings → Variables and Secrets).
3. Open your new bot in Telegram and send it any message (it can only message chats that wrote to it first).
4. The Calls tab's feed line shows "Alerts while closed: Telegram bot on" after the next 5-minute run.

The bot can only send you messages; it never reads your groups and has nothing to do with the Telegram reader above. The token stays in Cloudflare and is never sent to the app.

## Setup with the CLI instead

```sh
cd worker
npx wrangler kv namespace create CALLS   # put the id in wrangler.toml
# set CHANNEL_ID in wrangler.toml
npx wrangler secret put DISCORD_TOKEN
npx wrangler secret put FEED_KEY
# Telegram (optional): npx wrangler secret put TG_PROXY_KEY, and TG_PROXY_URL / TG_CHAT in wrangler.toml
npx wrangler deploy
```

## Changing the code

Edit `../calls.js`, `../recent.js`, `feed-core.js`, `alerts-core.js` or `index.mjs`, then run `node worker/bundle.js` to rebuild `discord-feed.js`. The tests fail if you forget.
