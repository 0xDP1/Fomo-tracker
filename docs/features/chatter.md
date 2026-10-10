# What people are saying (chatter DD)

**Status:** approved 2026-10-10.

**Problem.** The on chain feed channel merges 5+ group chats that don't interact, so reading what everyone says about one coin means scrolling hundreds of mixed messages. On tap (**Read the chat** on the Check tab, or **Chatter** on a Call queue row), the Discord feed Worker's new `/chatter` endpoint uses Discord's own search on that channel (`CHATTER_CHANNEL`) for the contract address and the $ticker over the last 24 hours, adds the 10 messages around the 3 newest hits so replies are included, and returns at most 150 trimmed messages; nothing is stored and results are reused for 15 minutes. The app sorts them by the group code at the start of each poster's name ("[PRO] Rick"), counts bot cards as scans without sending their text, and has Claude Haiku 5.5 (`claude-haiku-5-5`, the cheapest current model, about 0.2¢ a coin) return a fixed-format summary with the owner's Anthropic key: mood (bullish, mixed, bearish, quiet), one sentence, one line per group, claims, and red flags people mention. The chat is fenced as data and the model is told never to follow it. No AI call is made when nobody talked or without a key (counts still show). We know it works from unit tests (group codes, sorting and counting, the prompt, reading the answer, the Worker's request check, snowflake, search hits and trimming) and a browser test with a faked Worker and Claude answer covering the tap-only rule, the request, the summary, reuse and Refresh, a quiet coin, no key, an older Worker, and the queue's Chatter button; then the owner tries it on 3 coins.

## Unsure

- The live search was not run from the build machine (the feed key changed since it was last available there); the first real test is on the phone.
- Messages that mention neither the address nor the $ticker are missed unless they sit next to a hit.
- Haiku has no automatic fallback model; a decline shows as a message.
