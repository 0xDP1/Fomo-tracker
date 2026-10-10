# Faster feed

**Status:** approved 2026-10-10.

**Problem.** New calls felt slow: the app asked the Worker only once a minute, new coins waited behind the slower checks before showing, and asking more often would have used up Cloudflare's free storage writes (1,000 a day), after which the feed silently stops updating. Now the app asks every 15 seconds while the Calls tab is open, once a minute on other tabs, and never while it is hidden; coins that come with an alert snapshot are shown as soon as they arrive, with the rug check filling in afterwards. The Worker reads Discord at most every 10 seconds per instance (was 30), keeps its latest read in memory and returns new calls from it at once, and writes storage at most once a minute (`SAVE_GAP_MS`, default 60000) or straight away when a channel's status changes; a lost in-memory read only means re-reading, since calls are de-duplicated by message. We know it works from a Worker test (new calls returned at once, storage written only after the gap, nothing written when nothing changed), a unit test of the save rule, and a browser test with a fake clock for the 15-second and one-minute asks, no asks while hidden, and a new coin showing straight from the feed.

## Unsure

- Several Worker instances each keep their own memory, so two of them may each save once a minute; still far under the daily limit.
