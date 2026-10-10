# GMGN data via the Worker

**Status:** approved 2026-10-10.

**Problem.** The app could not see who had already taken profit on a coin, and its creator history needed a Helius key and paging through wallet transactions. The Discord feed Worker now holds a `GMGN_API_KEY` secret and offers a `/gmgn/...` route behind the feed key that forwards only five GMGN read endpoints (token info, token security, top holders, top traders, a dev's created tokens) with only their parameters; trading and wallet endpoints are never forwarded, the key never reaches the app, answers are cached for 5 minutes, and a GMGN rate limit pauses all GMGN calls for a minute (GMGN lengthens bans when asked during one). The Check tab gets an **Early traders** block: of the first 10 wallets in (among GMGN's top 100 traders by profit, pools left out), how many sold half or more, how many are fully out, the profit they took and what they still hold; 8 or more of 10 is a medium finding. The **Dev dossier** uses GMGN's created-tokens list when the Worker has the key (launch counts, graduated vs stuck on the bonding curve, the newest launches with market cap now), otherwise Helius as before. We know it works when Worker tests cover the allowlist, the key staying in the Worker, caching, the rate-limit pause and the not-configured case, unit tests cover the parsing and finding, and browser tests with mocked GMGN answers show both blocks and the quiet fallback without a key.

## Unsure

- GMGN's API does not support IPv6; whether Cloudflare reaches it over IPv4 is only known after the live test.
- Field names come from GMGN's published skill docs, not live responses; the first live call may need small fixes.
- "Early" means earliest among GMGN's top 100 traders by profit, not every wallet; GMGN's list has no sort by entry time.
- From GMGN data a launch is "dead" when its market cap is under $5k now (no pool reading), which can misjudge a coin with a different supply.

## Live test (2026-10-10)

The request format works (GMGN's public demo key returns data from a normal IP), but from the Worker GMGN answered "IP is temporarily banned due to repeated rate limit violations": Cloudflare Workers send requests from IP addresses shared with other Cloudflare users, and GMGN bans those addresses when others overload it. The Worker now passes GMGN's reason back (never the key). GMGN allows browser calls (CORS `*`), so calling it from the phone is the fallback to decide on.

## Revision: the phone as fallback (approved 2026-10-10)

Because GMGN bans Cloudflare's shared addresses, the app asks the Worker first and, when GMGN refuses the Worker (or no Worker is set up), calls GMGN straight from the device with a **GMGN API key** entered in Settings → Advanced. The user approved keeping that key on the device: it is stored only in this browser like the Helius and Anthropic keys, left out of backups, and read-only (it cannot trade). After a Worker refusal the Worker is skipped for 10 minutes; a GMGN rate limit on the device pauses device calls for a minute. Only the five read endpoints can be called either way. A 401/403 on mobile data may be IPv6, which GMGN does not support; the message suggests Wi-Fi. Browser tests cover the four cases: Worker answers (no device calls), no key anywhere (blocks hidden), Worker banned (device key used, Worker skipped afterwards), device key only.
