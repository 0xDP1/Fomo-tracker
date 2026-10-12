# Telegram reader (Vercel)

Reads up to 5 Telegram groups or channels **as your own Telegram account** for the Fomo Tracker feed, so private groups and alert bots' posts work. It runs as one small function on Vercel's free tier; your feed Worker on Cloudflare asks it for new messages, at most once every 20 seconds and only while the app is open. It lives here and not in the Worker because a Telegram read needs 20–30 ms of CPU and Cloudflare's free plan allows 10 ms.

**Read-only:** the only request it can send to Telegram is "messages in this group since message N" (`messages.GetHistory`), and only for the groups in its own `TG_CHAT` list. It never sends, reacts, marks read, joins or leaves. Tests check this.

> **Risk:** `TG_SESSION` is full access to your Telegram account. It lives only in Vercel's environment variables; anyone with your Vercel account could use it. End it any time in Telegram → **Settings → Devices**. Telegram sometimes restricts accounts used from third-party clients; a spare account that is in the group is safer.

## Setup (once)

1. **Telegram app keys:** at [my.telegram.org](https://my.telegram.org) → **API development tools**, create an app (any name). Note the `api_id` and `api_hash`.
2. **Log in** on your own computer (Node 22+), in this repo:
   ```sh
   cd telegram-proxy
   npm ci
   node login.mjs
   ```
   It asks for the api_id and api_hash, your phone number, the code Telegram sends you and your two-step password if you have one, lists your groups to pick from, and prints the values for steps 3 and 4. It saves nothing.
3. **Vercel** (free Hobby plan): sign up at vercel.com with GitHub, **Add New → Project**, import this repository, set **Root Directory** to `telegram-proxy`, and add the five environment variables the script printed (`TG_API_ID`, `TG_API_HASH`, `TG_SESSION`, `TG_CHAT`, `TG_PROXY_KEY`; mark them Sensitive). Deploy. Note the address, like `https://fomo-telegram.vercel.app`.
4. **Cloudflare** → your feed Worker → **Settings → Variables and Secrets**: `TG_PROXY_URL` (that address), `TG_PROXY_KEY` (secret, the same key) and `TG_CHAT` (the same list).

Within a minute the app's Calls tab shows **Telegram: ok** under the Discord line, and calls from the group appear with its name as the channel.

## Check it

`curl -H "x-proxy-key: <TG_PROXY_KEY>" "https://<your project>.vercel.app/api/telegram?chats=<group id>:0"` returns the group's latest messages. Without the key it answers 401; a group not in `TG_CHAT` gets 400.

## Cost

Free. With the app open 8 hours a day that is about 1,500 calls a day (Hobby includes 1M a month); each takes about 1–2 seconds, mostly waiting on Telegram. Vercel's Hobby plan is for personal, non-commercial use.

## Changing it

`api/telegram.mjs` is the function, `login.mjs` the login. Tests are in `../tests/telegram.test.js` (run `node --test tests/*.test.js` from the repo root). If you change the `TG_CHAT` format, change `parseTelegramChats` in `../worker/feed-core.js` too; a test checks they agree.
