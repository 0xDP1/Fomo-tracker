# Move and volume alerts, and a $10k floor on call alerts

**Status:** approved 2026-10-12.

**Problem.** A 🚀 alert only came once a recent call was already 2× or 4× up, often too late to act on, and a dead coin could still alert (SOLA at $3.2k, bug 11). Every recent call (the last 50) now also alerts when it **moves** (price up 30% or more in the last 5 minutes with at least $5k traded in those 5 minutes) or has **big volume** ($15k or more traded in 5 minutes, and at least 3× its average 5 minutes over the past hour). No alert of any kind, 2× and 4× included, fires while the coin's market cap is under $10k. A coin gets at most one move or volume alert every 30 minutes. They use the same banner, vibration and phone notification as the 2× alerts, e.g. "SOLA moving: +45% in 5 min, $12k traded · Man Cave". We know it works when unit tests show each rule and the floor on sample DexScreener numbers, and a browser test shows the banner for a mocked $40k coin that is moving and none for a $3k coin moving the same way.

## Rules

- Logic in `Recent.moves(track, pairs, now)` (`recent.js`), on the DexScreener pairs already read every minute for Recent calls: `priceChange.m5`, `volume.m5`, `volume.h1`, market cap (else FDV).
- **Moving:** `priceChange.m5 ≥ 30` and `volume.m5 ≥ $5,000`. **Big volume:** `volume.m5 ≥ $15,000` and `volume.m5 ≥ 3 × volume.h1 / 12`. When both hold, it is a move alert.
- **Floor:** market cap now under $10,000: no move, volume, 2× or 4× alert. A 2× / 4× level held back by the floor is not marked as alerted, so it can still alert once the coin is above the floor.
- **Limit:** one move or volume alert per coin per 30 minutes (`moveAlertAt` on the call's record). A 2× / 4× alert in the same minute wins over it.
- Only while the app is open (phones don't run web apps in the background).
