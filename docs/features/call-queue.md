# Call queue and Discord feed

**Status:** approved 2026-10-08. The user chose the account-token feed knowing it breaks Discord's self-bot rule and risks a ban.

**Problem.** Contract addresses arrive from many people in a Discord channel faster than you can check them, and most aren't new enough to matter. The **Call queue** on the Check tab takes calls from four places: pasted text (a copied run of Discord messages), a screenshot read by Claude, an iPhone share-sheet link (`?calls=`), and an automatic feed from a Cloudflare Worker that reads the channel once a minute with your account. It pulls out every Solana and EVM address, keeps who posted it, looks each coin up on DexScreener, keeps only coins younger than your age filter (1 h, 6 h, 24 h default, 3 days), runs the rug and holder check on those, and ranks them safest and newest first with age, market cap, liquidity, verdict, top warning, mentions, posters and one-tap Check. Each call is logged with its price and priced again 1, 6 and 24 hours later; a **Callers** table shows each person's hit rate and average return, crediting the first person to post a coin. We know it works when tests on sample Discord text and Discord API messages give the right addresses and posters, the age filter, ranking and caller scores are right, and the Worker serves only to the app with the right key; browser tests with mocked data show the queue, the screenshot path, the share link, the feed and the Callers table.

## Worker (worker/)

- Runs on the user's own Cloudflare account. Secrets set by the user with `wrangler secret put`: `DISCORD_TOKEN` (their account token) and `FEED_KEY` (a random string the app also stores). Vars: `CHANNEL_ID`, `ALLOWED_ORIGIN`.
- Cron every minute: reads up to 50 new messages after the last one seen, read-only. It never posts, reacts or touches other channels.
- Keeps only addresses, poster names, times and message ids, for 3 days, at most 1,000 calls.
- `GET /calls?since=<ms>` with header `x-feed-key` returns new calls and the feed status; CORS only for the app's origin.
- If Discord rejects the token the status says so and the app shows "paste a new token in Cloudflare".

## Limits

- Screenshots cost one Claude call each. Rug checks cost a few free requests per new coin, at most 20 per batch.
- Prices are read only while the app is open; a missed 1/6/24 h mark is shown as missed.
