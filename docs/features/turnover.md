# Turnover: volume against market cap

**Status:** approved 2026-10-15. Credit: @bigwarzeth's "smol hack 2" (volume should be well above market cap on new pairs) and "hack 1" (skip teams that promise to pay for DEX only at a market cap).

**Problem.** Volume under market cap on a new pair means mostly buys and few sells: the supply hasn't changed hands, which is the bundle or team-launch pattern. The Strength score already counts 24h turnover, but the ratio was never shown and nothing filtered on it. Now volume ÷ market cap ("turnover") is a first-class number: Call queue rows show `vol $45k · 2.3× mcap` (green at 2× and up, amber between 1× and 2×, red under 1×) and get a **Min turnover** filter (× market cap, default off, remembered) with a one-tap **Hide volume < mcap** box, the post's workflow of hiding first and researching what's left; the Graduations filters get the same field (**Volume at least N× mcap**, default off); the Check tab's Volume tile shows the ratio and the rug check raises a medium finding when a coin at least an hour old has 24h volume under its market cap, skipped when the creator holds 50%+ (the post's own exception), with a good note at 2× and up. The Call score is unchanged (Strength already counts turnover), so no ranking moves. Hack 1 goes into the Chatter read: its prompt asks for "paying DEX at $X" promises as a red flag. No new data, requests or dependencies. We know it works when unit tests pin the ratio, the bands, the Graduations cut, the finding and its two exceptions, and a browser test shows the row text and colours, the box hiding a low-turnover coin and being remembered, the tile, both findings and the Graduations field.

## Rules

- `Calls.turnover(vol24h, mcap)` -> `{ x, band: good | ok | low, text }` or null when a number is missing (`TURNOVER = { good: 2, ok: 1 }`).
- Queue filter: `callState.minTurn` (`callMinTurn` in storage); the box sets it to 1 (or keeps a higher value) and clears it to 0. Coins without a volume figure are not hidden.
- Graduations: `filters.turnover` (default 0 = off, range 0–100); the cut reads `volume 0.6× market cap, under 1×`.
- Finding `turnover` (medium): `vol24hUsd / mcapUsd < 1` with `ageHours >= 1` and not `creatorPct >= 50`; good note at 2×+. Younger coins are not judged (the post: fresh pairs are different).
