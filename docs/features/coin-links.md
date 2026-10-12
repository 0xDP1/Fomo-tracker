# FOMO and GMGN buttons on every Calls-tab coin

**Status:** approved 2026-10-12.

**Problem.** To open a called coin in FOMO or GMGN you have to tap Check first, and Recent calls rows have no link at all. Every coin row on the Calls tab (Call queue, Recent calls, Scanner picks, Paper trades) gets **FOMO** and **GMGN** buttons next to Check. FOMO opens the coin's fomo.family page, which the FOMO app opens on a phone. GMGN opens gmgn.ai/<chain>/token/<address>, which the GMGN app opens if it's installed. Each button only shows for chains that app supports. No extra API calls. We know it works when a browser test finds both buttons with the right links on a Call queue row and a Recent calls row, and none for an unsupported chain.

## Rules

- `coinLinks(chain, ca)` in `check-ui.js` returns the FOMO button (`Check.fomoUrl`, as before) and a GMGN button (`Gmgn.gmgnPage`: Solana, BNB, Base, Ethereum, Arbitrum, HyperEVM, Robinhood, Arc). Either is left out for a chain its app doesn't trade.
- Links open in a new tab (`target="_blank"`), so the app stays where it was.
