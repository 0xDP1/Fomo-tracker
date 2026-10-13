# Trench index (tehcscreener) on Market pulse, and as AI context

**Status:** approved 2026-10-13 (both parts).

**Problem.** Market pulse shows the last 5 minutes to an hour, but not whether the trenches as a whole are hot or dead this week, or which launchpads the money is on. tehcscreener.com publishes a free daily **trench index** (0 = dead, 100 = peak euphoria; launchpad volume, new launches, trading-bot volume and fees against the last 90 days and year) and launchpad volumes, with no key and open CORS. The Market pulse card gets a **Trenches** line ("Trenches 47 · active", the day it covers, and the four parts as percentiles), a 30-day sparkline of the score, and the 3 launchpads with the most volume that day. Read every 3 hours while the app is open (the data changes once a day), kept on the device, left out when the site doesn't answer. The score, band and day also go to the Scanner's AI verdict, the thesis drafts and the AI paper trader as one line of market context next to the live mood. We know it works when unit tests read sample `/api/v1/trench` and `/api/v1/launchpads` answers correctly (score, band, history, top pads, the context line, nothing for a broken answer), and a browser test with mocked answers shows the line, sparkline and top launchpads, and the card still works when the site is down.

## Rules

- Source: `https://tehcscreener.com/api/v1/trench` and `/api/v1/launchpads?window=1d` (120 requests a minute per IP; we use 2 every 3 hours).
- Logic in `market.js`: `Market.trench(json)` -> `{ day, score, band, parts: { padVolume, launches, botVolume, botFees } (percentiles), history (last 30 days) }` or null; `Market.topPads(json, 3)`; `Market.trenchLine(t)` for the AI.
- Stored as `trench` with the time it was read; read again after 3 hours.
- Bands are the site's: ded 0-19, cold 20-39, active 40-59, hot 60-79, euphoric 80-100.
- AI context line: "Trench index (tehcscreener, daily, <day>): <score>/100, <band>; launchpad volume <p>th percentile, new launches <p>th, bot volume <p>th." The AI prompts are otherwise unchanged.
