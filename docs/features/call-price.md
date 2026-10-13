# Market cap at the call on every Calls-tab coin

**Status:** approved 2026-10-13.

**Problem.** A Call queue row only showed "called at $X → now $Y" when the call came with a market cap (Discord alert bots, Rick on Telegram since v80). Coins posted by a person (a plain address) showed nothing, and Recent calls showed theirs in small text without saying how it was found. Every Call queue and Recent calls coin now shows the market cap at the moment it was called on its own bold line, e.g. **Called at $886.7K** → now $1.2M (+35%). Where the number comes from, in order: (1) the call itself (the alert's or Rick's "first @" price); (2) the price at the moment of the call from GeckoTerminal's 5-minute candles, which Recent calls already read (bug 11), or a first read within 5 minutes of the call; (3) otherwise the first price the app saw, labelled honestly: "First seen at $1.1M, 12 min after the call". We know it works when unit tests cover that order and the label, and a browser test with an alert coin, a person's post with candles and a coin with neither shows the right line on each Call queue and Recent calls row.

## Rules

- Logic in `Calls.callPrice(entry, recentRecord)` -> `{ mcap, late, lateMin }` or null. A Recent calls base counts as the call's price when it came from the candles or was read within 5 minutes of the call; otherwise it is "first seen", late by the minutes between the call and the read.
- The "now" figure and move are the Call queue's live reading (v77), against whichever price at the call is shown.
- Recent calls' basis is the market cap (else FDV) and the Call queue's is FDV (else market cap), as before; they agree for most launchpad coins.
