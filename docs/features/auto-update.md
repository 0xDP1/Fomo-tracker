# Updates install themselves

**Status:** approved 2026-10-12. The owner's ask: keep the app up to date without opening GitHub or remembering to tap the update bar (they stayed on v63 after newer versions shipped).

**Problem.** A new version only reached the phone when the owner noticed and tapped the update bar. **What changes:** when the app opens, or comes back after 2+ minutes away, and a newer version is published and reachable, it reloads into it by itself and shows a short "Updated to vN" note. It never reloads in the middle of something: while a text box is focused, a check is running or an AI request is in flight (screenshot read, paper-trade decision, write-up), and for the 30-minute check while you're on screen, it shows today's update bar instead. Each version is tried automatically once, so a phone that keeps serving the old files gets the bar ("didn't load on its own", **Try again**) instead of a reload loop. Stored data is untouched; what a reload loses is the on-screen Check result, which is why it waits for a natural moment. We know it works from a browser test: a newer version installs on open with the note; typing, a running check and an AI request in flight each give the bar and no reload; a stuck phone gets one try, then the bar; the on-screen check only offers the bar; the bar's button still installs.

## Unsure

- 2 minutes away is a guess for "a natural moment"; an iPhone often reloads a home-screen app itself after longer breaks, which also picks up the new version.
