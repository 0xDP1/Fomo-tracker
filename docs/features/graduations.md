# pump.fun graduations, checked and alerted

**Status:** approved 2026-10-13.

**Problem.** A pump.fun coin only reached the app once a caller posted it or the Scanner's GeckoTerminal lists caught it, which lags. A **Graduations** section on the Calls tab keeps one connection to PumpPortal's free feed (`wss://pumpportal.fun/api/data`, `subscribeMigration`) while the app is open and hears every pump.fun coin the moment it graduates to PumpSwap (about one every 1–2 minutes). Each graduate waits **3 minutes** (so DexScreener has its pool and some trades), then gets the app's checks, cheapest first: (1) the market check on DexScreener (one request per 30 coins; the Scanner's liquidity, volume, market cap and trade cuts); (2) for coins that pass, the holder and rug check (RugCheck and TrenchBot, the Check tab's own checks; the Scanner's holder cut: top wallet 5% or less, top 10 at 60% or less, 80+ holders, creator under 10%, mint and freeze authority closed, and no "High risk" or "Walk away" verdict). A coin that passes gets a **🎓 alert** (the call alerts' banner, vibration and phone notification) and Check, FOMO, GMGN and **Add to Call queue** buttons. Every graduate is listed (the last 50) with where it was cut and why. An on/off switch, on by default, is remembered on the device. We know it works when unit tests cover reading PumpPortal's messages (a real one), the 3-minute wait, each cut and its reason, and a browser test with a fake feed and three graduates shows one cut on the market check, one cut on holders and one passing with an alert, and the switch closing the connection.

## Rules

- Logic in `grad.js` (`Grad.parse`, `add`, `due`, `marketCut`, `holderCut`, `setResult`), reusing `Scanner.freeCut`, `Scanner.tradeCut` and `Scanner.chainCut`.
- One connection only. If it drops, it reconnects after 5 s, then 10, 20, 40, up to 2 minutes; never one connection per coin (PumpPortal bans that for an hour).
- Each coin is checked once, at 3 minutes; a coin DexScreener has not indexed yet gets one more look 5 minutes later. The market check treats every graduate as at least 3 minutes old (DexScreener dates the pool a few seconds after the graduation, which tripped the Scanner's "too new" rule; seen live). Holder checks run one coin at a time (about one RugCheck call a minute).
- Only while the app is open (phones don't run web apps in the background).
