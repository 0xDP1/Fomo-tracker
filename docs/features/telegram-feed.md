# Telegram feed (read a private Telegram group into the Call queue)

**Status:** draft for approval, 2026-10-11. The owner's idea. The group is private (no invite link) and the owner can't add a bot, so the Bot API is out; this reads the group as the owner's own Telegram account.

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

GramJS (MIT) for the Worker only, bundled into `worker/discord-feed.js` by `node worker/bundle.js` with esbuild (a dev dependency). The app itself stays without a build step and gains no dependency.

## Risks

- `TG_SESSION` is full access to the owner's Telegram account. It sits only in the Worker's secrets; anyone with the Cloudflare account can use it. Log out of the session from Telegram (Settings → Devices) to cut it off at any time.
- Telegram sometimes restricts accounts that use third-party clients, more often new accounts or heavy use. Read-only, one group, a read every 20 s or slower keeps this low but not zero. A spare account that is a member of the group is the safer choice if the owner has one.
- Alert bots' card formats in this group are unknown; addresses are found either way, but market cap and caller stats only if the card matches a format `parseAlert` knows (or one added later from saved samples).

## Unsure

- Whether GramJS runs inside a Cloudflare Worker at all (it needs WebSockets and some Node APIs; the proof step answers this).
- Whether a new connection every 20 seconds draws Telegram's attention; the read gap may need to be longer.
- Merging with Step 1 (`claude/exciting-keller-2z8ybf`), which also changes `worker/index.mjs` and `worker/feed-core.js`.
