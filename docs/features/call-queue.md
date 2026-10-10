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

## Revision: several channels and the contract address on each row (approved 2026-10-10)

`CHANNEL_ID` takes a comma-separated list (up to 10), each entry `id` or `id:label`, for example `111:first scan,222:group traction`. The Worker reads each channel in turn and remembers its own last message, so nothing is skipped or repeated. Progress saved by the single-channel version carries over to the first channel listed. Each call records its channel label; a coin posted in several channels counts every post as a mention. If Discord rejects the token the Worker stops that round instead of trying every channel. The feed status is the worst state across channels, and the app names the failing channel. Each Call queue row shows the shortened contract address with a Copy button (full address) and the channels the coin was seen in.

## Revision: alert data, caller records and fewer lookups (approved 2026-10-10)

The channels are alert-bot feeds, not people posting addresses. Each alert has a market snapshot (price, FDV, liquidity, volume, age, buys and sells, holders, top 5 wallet share) with the real contract in backticks, and a mentions embed (`Last mentions` or `First scan`): `time · group · caller @ market cap · medal · win % · 30d`, the arrow line being the mention that triggered the alert. First scan alerts also carry caller stats (1.5x+ hit rate over 7 and 30 days, number of calls, median multiple).

- **Real caller and contract.** The Worker credits the caller on the arrow line (not the bot that posted) and takes only the contract from the snapshot, so wallet and pair links inside the alert are no longer treated as coins.
- **Caller directory.** The Worker keeps one profile per caller (lowercase name): group, medal, 30 day win rate, and for first scan alerts the 7 day rate, call count and median. Every mention line is a fresh look: the newest sighting overwrites the win rate, a mention already counted changes nothing, and a seedling (no data) never erases a known rate. The app asks only for profiles changed since its last visit.
- **Fewer lookups.** Coins from alerts take age, market cap, liquidity and price from the snapshot, so they need no DexScreener lookup. Only the best 10 (caller win rate, then mentions) that pass the filters get the rug and holder check, and coins whose alert shows the top 5 wallets over 45% are not auto-checked. Min liquidity (default $5,000) and min caller win % (default off) are in the card.
- **Channels.** Chips filter the queue by channel; each row lists the channels the coin was in.
- **First caller.** The earliest mention in an alert is the first caller; the row shows their record and `called at X → now Y (n×)`.
