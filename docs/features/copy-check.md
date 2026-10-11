# Copy check (original or copy?)

**Status:** approved 2026-10-11. Idea from the NOVAMP terminal post (@bored2boar); its code was not seen or used.

**Problem.** When a name gets hot, many coins launch with the same ticker or name within minutes, and most of the money lost is on the copies, not the original: CrawlScan's Rug Replay showed three different $FOMO coins and big-name copycats (Apple, Google, Mistral AI) going from about $600K to $2K within an hour. Nothing in the app asks "is this the real one?". On the Check tab, a **Copies** block lists every recent coin sharing this coin's ticker or name (DexScreener search, no key): which one launched first, how many minutes after it each copy came, market cap, liquidity, and the Check verdict where we have one. It labels the checked coin **Original** (first), **Copy** (a later launch while an earlier one is still trading) or **Only one** (no other recent coin under this name), and a copy of a still-trading original becomes a medium risk finding with the original one tap away. Call queue rows get a **copy** tag, and a copy loses points in the call score. We know it works when unit tests on saved DexScreener search results (including real copycat clusters like the $FOMO ones) give the right original, order and labels; name matching catches lookalikes (case, spaces, zero-width characters, Cyrillic letters that look Latin, a `$` prefix, trailing digits like FOMO2); browser tests with mocked DexScreener show an original, a copy, a single coin and a capped search; and after a week or two the Signal scorecard shows whether copies did worse than originals.

## Rules

- **Who counts as the same name:** same chain, and the normalised ticker or the normalised name matches. Normalising: lower case, strip spaces, punctuation, `$`, zero-width characters and trailing digits, and fold Cyrillic and Greek lookalike letters to Latin. Leetspeak and plurals are left for later: they catch more copies but also unrelated coins.
- **Recent:** launched within 7 days of the checked coin. Older coins with the same name are a different story and are not counted.
- **First:** earliest `pairCreatedAt` in the cluster (the pool's start time; on pump.fun this is close to the launch).
- **Labels:** Original, Copy (an earlier coin in the cluster still has a pool with $1,000+ liquidity), Only one. Whether the original itself is safe is left to its own Check verdict.
- **Finding (medium):** the checked coin is a Copy and the original is still trading. Shown with the original's age, market cap and a Check button.
- **Call score:** a Copy loses 15 points (a first guess to retune from the Signal scorecard, like the other points).
- **Limits:** DexScreener's search returns at most 30 pools ranked by relevance, not by time. When it returns 30, the block says "at least N" and that the list may be cut. Coins that never got a pool do not appear. One search per coin, reused for 10 minutes. All chains DexScreener covers.

## Not in this version

- Scanning your own wallet for copies, deployer copy rankings, watchlist alerts and NOVAMP's TAINTED and CONTESTED labels. These may come later; the dev's history already comes from the Dev dossier.

## Unsure

- How well "first pool" tracks "first launch" on launchpads that create the pool later.
- Whether 30 search results are enough for the busiest names (a hot name can get more copies in an hour). If not, a second source (GMGN or PumpPortal) would be a separate decision.
