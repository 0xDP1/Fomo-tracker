# Group tags (which Telegram group posted a coin)

**Status:** approved 2026-10-12.

**Problem.** The owner watches two Telegram groups, The Man Cave and Rob's Thoughts. When a coin comes in, the Call queue row only says **Telegram**, so you can't tell at a glance which group posted it; the group name is only in the small grey "in …" line. On each Call queue row the Telegram tag becomes the group's own name (a leading "The" dropped, e.g. **Man Cave**, **Rob's Thoughts**), each group in its own fixed colour; a coin posted in both groups shows both tags. Recent calls rows get the same tags, and the 🚀 alert and the phone notification name the group ("… · Man Cave"). Discord channels stay as they are. We know it works when unit tests show each group always gets the same colour (the group's place in the Worker's `TG_CHAT` list, so two groups never share one), a coin posted in both groups gets both names, and coins saved before this change still get their group from their channel names; and a browser test with a faked feed shows a Man Cave coin, a Rob's Thoughts coin and a coin in both with the right tags, plus an alert naming its group.

## Notes

- Front end only: the Worker already sends each Telegram call with its group's label as the channel and marks it `source: 'telegram'`. No Worker or Telegram change.
- The group labels from the feed (`telegram.chats[].label`) are remembered on the device, so tags and colours show before the first feed read after opening the app.
- A Telegram coin whose group isn't known (an old entry, labels not yet read) keeps the plain **Telegram** tag.
