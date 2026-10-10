# Open in FOMO

**Status:** approved 2026-10-10.

**Problem.** Finding a coin in the app meant copying the contract and searching for it in FOMO. A **FOMO** button next to each coin links to `https://fomo.family/tokens/<chain>/<contract>`, which the FOMO app has registered as a universal link, so on a phone it opens the coin in FOMO (the web page otherwise). The chain comes from the coin's own data and is translated to FOMO's chain names (solana, base, bnb, ethereum, monad, hyperliquid, robinhood, arc, read from FOMO's site code); EVM contracts are lowercased as FOMO does. The button is on Call queue rows, the Check tab (Open in FOMO on the coin card, plus FOMO under Look deeper), the Scanner pick and finalists, and Market pulse Movers. A coin on a chain FOMO doesn't trade, or a 0x address whose chain isn't known yet, gets no button. We know it works when unit tests cover all eight chains, the name translation, lowercasing and the no-button cases, and browser tests check the button and its address in each place.

## Unsure

- Only the Solana link format is confirmed by FOMO's own alert links; the other chains use the chain names from FOMO's code.
- From the home-screen version of this app, iPhone may open FOMO's web page first with an "Open in app" banner instead of jumping straight into the app.
