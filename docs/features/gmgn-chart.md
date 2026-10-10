# GMGN price chart on Check

**Status:** approved 2026-10-10.

**Problem.** The Check tab has no price chart, so judging a coin's momentum means leaving the app. A folding **Chart** card on the Check tab embeds GMGN's free chart (`https://www.gmgn.cc/kline/<chain>/<contract>?theme=dark&interval=<n>`, from GMGN's integration docs; no key) with interval buttons 1s, 1m, 5m, 15m, 1h (1m default). It loads only when opened (and remembers that), sits outside the Check tab's 20-second re-render so the chart is not reloaded, uses GMGN's chain names, and is left out for chains GMGN doesn't cover. An "Open on GMGN" link sits under it in case the embed does not load. We know it works when unit tests cover the chart address per chain and interval, and a browser test shows nothing loaded until opened, the right address for the coin and interval, the interval switch, and no reload when the Check tab re-renders.

## Unsure

- Whether gmgn.cc allows being embedded could not be checked from the build machine (its bot protection refused the test); if it shows blank on the phone, the link still works and the embed should be removed.
