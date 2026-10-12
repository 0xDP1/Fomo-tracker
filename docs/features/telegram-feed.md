# Telegram feed (read a private Telegram group into the Call queue)

**Status:** approved 2026-10-11; revised and approved the same day to run the Telegram reading on Vercel's free tier instead of Workers Paid (see **Revision: free reader on Vercel** below, which replaces "How it reads Telegram" where they differ). The owner's idea. The group is private (no invite link) and the owner can't add a bot, so the Bot API is out; this reads the group as the owner's own Telegram account.

**Problem.** A private Telegram group the owner is in posts contract addresses, but the app only reads Discord, so those calls have to be copied over by hand (Paste calls or the share link) and most never get checked or scored. With this feature the Discord feed Worker also reads that Telegram group, as the owner's account, only when the app asks (the same rhythm as Discord: every 15 seconds on the Calls tab, every minute otherwise, catching up on up to 500 messages missed while the app was closed). Every Solana or 0x address in a message (typed by people or posted by an alert bot; an account sees both) goes into the same Call queue with the group's name as its channel chip and the sender as the caller, so the rug check, call score, Best view, Callers table, leaderboard and Signal scorecard all work on Telegram calls exactly as on Discord ones. Settings gains nothing: the Telegram login lives only on the Worker. **Pause feed** pauses Telegram too. We know it works from unit tests on saved, anonymized Telegram replies (text with addresses, alert-bot cards, replies and forwards, edited messages counted once, the catch-up limit), a Worker test with Telegram faked (only the one group is read, nothing is ever sent, the login never reaches the app, a Telegram flood-wait pauses reads), a browser test showing a Telegram call in the queue with its chip and score, and after a week the Callers table showing whether this group's calls do better or worse than Discord's.

## How it reads Telegram

- Telegram's official user API (MTProto) with the owner's own account: an `api_id` and `api_hash` from my.telegram.org and a **session** made by logging in once.
- The login is a small script the owner runs once on a computer (`node worker/telegram-login.mjs`): it asks for the phone number and the code Telegram sends, lists the owner's groups so the right one can be picked, and prints the session and the group id. Nothing is saved to the repo.
- Worker secrets (never in the app or git): `TG_API_ID`, `TG_API_HASH`, `TG_SESSION`. Plain var: `TG_CHAT` (`<group id>:<label>`, more than one allowed, comma-separated like `CHANNEL_ID`).
- Read-only by design: the Worker only calls "get new messages since the last one seen" for the listed groups. It never sends, reacts, marks read, joins or leaves. A test fails if any other Telegram method is called.
- At most one Telegram read every 20 seconds whatever the app asks; between reads the Worker answers from memory. A flood-wait from Telegram pauses reads for as long as Telegram says. Saves to storage follow the existing once-a-minute rule (no new KV writes).

## Proof first (before building the rest)

The Worker is on Cloudflare's free plan: a script of at most 3 MB compressed and **10 ms of CPU per request**. The usual Telegram client library (GramJS, npm `telegram`, about 2 MB plus 14 dependencies) may not fit either limit, and each read opens a fresh connection. So step one is a throwaway check: a bundled GramJS read of one group in a test Worker, measuring size and CPU. Then one of:

1. **It fits:** build as above.
2. **Too big or too slow:** either Workers Paid ($5 a month: 30 s CPU, 10 MB scripts), or a small hand-written MTProto reader (only the few calls needed; more work, no dependency), whichever the owner picks then.

Running the Telegram login in the app on the phone instead is ruled out: it would put a full-access account key in the front end.

## New dependency and build step (needs approval)

`teleproto` (MIT, the maintained fork of GramJS) for the Worker only, bundled into `worker/discord-feed.js` by `node worker/bundle.js` with esbuild; both are pinned dev dependencies. The app itself stays without a build step and gains no dependency. (Written before the proof, which showed GramJS is archived.)

## Risks

- `TG_SESSION` is full access to the owner's Telegram account. It sits only in the Worker's secrets; anyone with the Cloudflare account can use it. Log out of the session from Telegram (Settings → Devices) to cut it off at any time.
- Telegram sometimes restricts accounts that use third-party clients, more often new accounts or heavy use. Read-only, one group, a read every 20 s or slower keeps this low but not zero. A spare account that is a member of the group is the safer choice if the owner has one.
- Alert bots' card formats in this group are unknown; addresses are found either way, but market cap and caller stats only if the card matches a format `parseAlert` knows (or one added later from saved samples).

## Unsure

- Whether GramJS runs inside a Cloudflare Worker at all (it needs WebSockets and some Node APIs; the proof step answers this).
- Whether a new connection every 20 seconds draws Telegram's attention; the read gap may need to be longer.
- Merging with Step 1 (`claude/exciting-keller-2z8ybf`), which also changes `worker/index.mjs` and `worker/feed-core.js`.

## Proof results (2026-10-11)

Run locally in Cloudflare's Worker runtime (workerd via `wrangler dev`, `nodejs_compat`), nothing deployed:

- **It runs.** Both GramJS (`telegram` 2.26.22, now archived) and its maintained fork `teleproto` (1.230.0, MIT) connected to Telegram from inside the Worker runtime, did the key exchange and got a real answer (`help.GetConfig`). Needed: WebSocket transport, the DC's web hostname (`venus.web.telegram.org`), at least one connection retry. `teleproto` uses the runtime's own WebSocket, so it is the pick.
- **Size fits.** Bundled by wrangler: GramJS 223 KB gzip, teleproto 400 KB gzip (free limit 3 MB).
- **CPU does not fit the free plan.** Measured in Node (same V8; network waits not counted), with a saved session: reconnect + one request ≈ **19 ms CPU** (median of 5, 15–23 ms), decrypting and decoding a 100-message reply ≈ **8 ms** more. A read is about 20–30 ms against the free plan's 10 ms per request. Module load ≈ 460 ms once per cold start (startup limit 1 s), the one-time key exchange ≈ 310 ms (only at login).
- Each read must open a new connection: a Worker can't keep a socket open between requests.

**So:** option 2 applies. Workers Paid ($5/month, 30 s CPU) fits with a wide margin. A hand-written reader might get under 10 ms but is weeks of protocol work with no guarantee.

## Revision: free reader on Vercel (approved 2026-10-11)

The owner wants to stay on free plans. The Telegram reading moves out of the Cloudflare Worker into a small function on Vercel's free tier (`telegram-proxy/`), which holds the Telegram login (`TG_API_ID`, `TG_API_HASH`, `TG_SESSION`) and its own `TG_CHAT` list. When the app asks the Worker for new calls, the Worker (at most once every 20 seconds) asks the reader for each listed group's messages since the last one it saw, with a shared key (`TG_PROXY_URL`, `TG_PROXY_KEY`); the reader reads them (catching up on up to 500 per group) and answers with plain JSON, which the Worker turns into calls as before. The Worker never holds the Telegram login, needs no Telegram library, stays a small file on the free plan and needs no `nodejs_compat`. The reader refuses groups outside its own list, so a stolen key can't read other chats; it still sends nothing but `messages.GetHistory`. Free tier fit: about 1.5k calls a day with the app open 8 hours (Hobby: 1M a month), seconds per call allowed. We know it works from unit tests of the reader with Telegram faked (paging, the guard, the key, the allowlist, errors), a Worker test with the reader faked, the browser test, and a local run of Worker → reader → Telegram. Unsure: Vercel's Hobby plan is for personal, non-commercial use; each refresh with a Telegram read takes about 1–2 s more because the reader reconnects every time.

## Revision: telling Telegram calls apart (approved 2026-10-12)

Telegram and Discord calls looked the same in the Call queue. Now the Worker marks each Telegram call, the queue keeps every source a coin was posted in (older entries count as Discord when they have a channel), each Telegram row gets a **Telegram** tag (and a **Discord** tag too when posted in both), **All · Discord · Telegram** chips show one source at a time, and the Signal scorecard gets a **Source** row (Discord, Telegram, both, pasted) so a week or two of priced calls shows which source does better. We know it works from unit tests (sources kept per coin and from old entries, the scorecard row, the Worker marking Telegram calls only) and the browser test (the tag, the chip counts and filtering by source).
