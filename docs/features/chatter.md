# What people are saying (chatter DD)

**Status:** approved 2026-10-10.

**Problem.** The on chain feed channel merges 5+ group chats that don't interact, so reading what everyone says about one coin means scrolling hundreds of mixed messages. On tap (**Read the chat** on the Check tab, or **Chatter** on a Call queue row), the Discord feed Worker's new `/chatter` endpoint uses Discord's own search on that channel (`CHATTER_CHANNEL`) for the contract address and the $ticker over the last 24 hours, adds the 10 messages around the 3 newest hits so replies are included, and returns at most 150 trimmed messages; nothing is stored and results are reused for 15 minutes. The app sorts them by the group code at the start of each poster's name ("[PRO] Rick"), counts bot cards as scans without sending their text, and has Claude Haiku 5.5 (`claude-haiku-5-5`, the cheapest current model, about 0.2¢ a coin) return a fixed-format summary with the owner's Anthropic key: mood (bullish, mixed, bearish, quiet), one sentence, one line per group, claims, and red flags people mention. The chat is fenced as data and the model is told never to follow it. No AI call is made when nobody talked or without a key (counts still show). We know it works from unit tests (group codes, sorting and counting, the prompt, reading the answer, the Worker's request check, snowflake, search hits and trimming) and a browser test with a faked Worker and Claude answer covering the tap-only rule, the request, the summary, reuse and Refresh, a quiet coin, no key, an older Worker, and the queue's Chatter button; then the owner tries it on 3 coins.

## Unsure

- The live search was not run from the build machine (the feed key changed since it was last available there); the first real test is on the phone.
- Messages that mention neither the address nor the $ticker are missed unless they sit next to a hit.
- Haiku has no automatic fallback model; a decline shows as a message.

## Mention count (v104)

**Status:** approved 2026-10-16.

**Problem.** The block said how many messages came back, not how many times the coin was named: the Worker adds the messages around each hit so replies come along, so one person arguing for 20 messages looked like five groups calling it out. `Chatter.prepare(messages, { ca, sym, total })` counts a message as a mention when its text has the contract address or the $ticker (any case, whole word); messages that only sit next to a hit count as talk, not mentions; bot cards never count. The block shows **"Mentioned 7 times by 5 people in 3 groups, last 24 hours"** under the heading, each group row gains its own count ("[PRO] 3 mentions · 2 people · 6 msgs"), and when Discord's own hit total (the Worker's `total`) is higher than what came back it adds "(Discord counts 11 in all)". The prompt tells Claude how often the coin itself was named. Quiet coins keep the "Nobody talked about it" line. No Worker change, no cost. Unit tests: address hit, $ticker in either case, a context message that names neither, a longer ticker (`$LOUDER`) that does not match, per-group counts, Discord's higher total, the prompt line, `mentionLine`; the chatter browser test asserts the line and the group rows.
