# FOMO Tracker

A static web app (no build step, no backend) that does four things:

- watches the balance of your FOMO (Solana) wallet
- logs and syncs your trades
- shows performance stats
- suggests how much to put into each trade.

## Run it

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

Type a **FOMO username** in the box at the top and press **Go**:

- **First time:** the app asks for that user's Solana wallet address, then remembers it. FOMO doesn't publish usernames or the wallets behind them, so this one-time step is needed. Your own address is on the deposit/receive screen in the FOMO app.
- **After that:** typing the username loads its balance and stats straight away. Bookmark `index.html?user=<username>` to jump straight to it.
- **Several users:** each username keeps its own trades and balance history, so you can track a few traders and switch between them.
- **Address instead:** pasting a Solana address into the box works too.

Optional settings:

- **Helius API key** (free at helius.dev). It turns on **Sync from wallet**, which pulls your recent swaps and turns them into trades automatically. It also gives you a faster RPC than the public one. With a key set, the first load of a new username syncs automatically.
- **FOMO API (fomoapi.io) key.** Paste a `fapi_…` key into **Lookup API key** in Settings and save. This turns on **all-chain mode**, covering Solana, Base, BNB, Ethereum, Monad and Robinhood Chain:
  - usernames are looked up automatically
  - the dashboard shows your FOMO balance across all chains, a per-chain breakdown, and FOMO's own PnL for 24h, 7d, 30d and all time
  - **Sync trades** pulls your positions from every chain
  - all amounts are in USD, and Analytics adds a by-chain table.

  If fomoapi.io can't be reached, the app falls back to the Solana wallet.

  fomoapi.io bills about 250 credits per call (free plan: 250,000 a month). To stay inside that, the app refreshes FOMO data at most every 10 minutes, syncs trades every 15, refreshes Following every 10 minutes only while the Dashboard is open, and skips the paging probe for a day once it knows none works. Each sync keeps every trade seen before, so your history builds up over time even though fomoapi.io only returns the newest page. Settings shows this month's calls and credits. If the credits run out (HTTP 402), the app says so and pauses fomoapi.io calls for an hour; tapping Refresh or saving Settings tries again straight away.
- **Anthropic API key** (optional). Enables the AI write-up on the Check tab. Calls go straight from your browser to Anthropic; the key is stored only in this browser.
- **Username lookup API.** Some unofficial third-party services map FOMO usernames to wallets. Put the endpoint in Settings (use `{handle}` where the username goes), plus its API key if it needs one. Unknown usernames are then resolved automatically: the app takes the Solana address from the response.

Everything stays in your browser's localStorage. Known bugs and their fixes are listed in `docs/BUGS.md`. Use **Export JSON backup** to keep a copy.

**On a phone:** open the site in Safari, then Share → **Add to Home Screen**. It runs full-screen with its own icon and a bottom tab bar, and offers a one-tap update when a new version is published. Rarely used settings (Solana wallet, Helius, custom lookup providers) are under **Advanced** on the Settings tab.

## Features

| Tab | What it does |
| --- | --- |
| **Dashboard** | **Find a trader:** type a FOMO handle or fomo.family link, or upload a profile screenshot (read by Claude with your Anthropic key), to see their win rate and trading style from their latest closed trades: hold style (scalper, day trader, swing trader, holder), activity, win profile (lottery hunter, quick profit taker, balanced), average size and main chain. **Follow** adds them to Following. SOL balance, token holdings priced in USD (Jupiter), total portfolio value, balance-history chart, auto-refresh, and headline stats with the equity curve and recent trades. **Following:** add FOMO handles (needs the fomoapi.io key) to see their latest buys and sells across chains in one feed, with size, realized PnL on sells, and a **Check** button that opens the token on the Check tab; it refreshes every 2 minutes while the page is open, up to 10 traders. |
| **Check** | **Market pulse** (top of the tab): total meme volume over the last 5 minutes, 30 minutes and hour on Solana, Base and BNB (top trending and highest-volume meme pools from GeckoTerminal, majors and stablecoins left out; DexScreener as a fallback without the 30-minute window), a mood of Heating up, Steady or Cooling from how recent volume compares with the hour's pace, the buy/sell split, a trend line of your readings over 24 hours, a **Movers** list of coins whose 5-minute volume is running 3× or more above their hourly pace with buyers ahead, and the same pace reading on your open positions. Refreshes every 2 minutes while open. Volume spikes show attention, not direction. **Scanner** (below Market pulse): pulls new launches on Solana, Base and BNB from GeckoTerminal and cuts them in cost order: free cut (15 min to 72 h old, $12k+ liquidity, $40k+ 24h volume, $60k to $8M market cap), trade cut (150+ trades a day, sells present after 20+ buys in an hour), chain cut (top wallet 5% or less, top 10 at 60% or less, 80+ holders, mint and freeze authority closed, no honeypot). Up to 5 finalists are judged by Claude with your Anthropic key (exit risk, momentum spent, liquidity fit, dev still loaded, crowd, chart shape, worth trading, confidence) and at most one is picked. The card lists every cut coin with its reason. Each pick is logged as a paper trade and priced 1, 6 and 24 hours later, so the scorecard shows whether the picks would have made money. Thresholds come from @savipww's published guide and are unvalidated; no trades are placed. Optional auto-scan every 15 minutes while open. **Thesis drafts:** when a new position appears after a sync (or when you tap **Write thesis** on any check), the app runs the full token check and Claude writes a short first-person thesis for FOMO from those facts only, ending with a Risk line. For coins rated High risk or Walk away the app writes the red flag itself and shows a warning above the draft. Copy, Regenerate and Dismiss; adjustable length limit (default 280) and style notes. FOMO has no write API, so you paste it yourself. **Flow, last hour (Helius):** Solana coins get a read of their actual swaps from the last hour through your Helius key: bought and sold over 5, 30 and 60 minutes, unique buyers vs sellers, the top wallet's share of volume and how many of the 8 biggest buyers are fresh wallets. It labels the coin **Real demand** (20+ buyers, buyers and buy volume at least matching sellers), **Thin**, or **One wallet is the volume** (one wallet 30%+ of the hour, which also becomes a risk finding, high at 50%+). Movers and your open positions in Market pulse get a **Flow** button for the same read. Values use the current price, so they are approximate; busy coins may only be covered for part of the hour. Paste a contract address (or a DexScreener link). The app pulls the pool from DexScreener and the contract and holder checks from RugCheck (Solana) or GoPlus (EVM chains), then gives a rug-risk score and verdict with findings such as *bundled supply sitting unsold over your head*, *LP in a wallet that can pull it* and *one whale who is the chart*, plus mint/freeze authority, honeypot, taxes, thin liquidity and age. **Plan:** pick a target market cap and a size (prefilled from Sizing) and it builds a three-trim ladder, a runner and a stop, marking the trim that returns your initial. **Watch:** re-checks every 20 s while the page is open; a trim call fires when a level is hit, a blow-off top or distribution flips the verdict to *Trim into strength*, and a liquidity pull or stop hit says *Walk away*. Tap **Took it** on a trim to record it: exits taken on plan are celebrated and counted in an **Exit discipline** stat. **Fees paid on this coin:** estimated trading fees from volume × the pool's fee rate, and (Solana, Helius key) a sample of the coin's latest transactions giving average and maximum fee per trade, the share paying bot-level tips, an estimated 24h total and the biggest fee payers; heavy fees become a finding. **Analyze top wallets** (Solana, Helius key): balance, 24h/7d swap flow, fees paid and wallet age for the largest real holders; several fresh wallets among them adds a finding. **AI write-up** (optional): with an Anthropic API key in Settings, Claude turns the evidence into a short plain-English verdict. **AI review of your live trades:** in the open-positions panel, Claude gives a hold / trim (with %) / exit call per position with a reason, plus an overall read on exposure and your daily limit; an auto switch repeats it every 10 minutes while the page is open. |
| **Trades** | Sync swaps from your wallet (Helius), add/edit/delete trades by hand, add notes and **setup tags** (tap a preset or type your own), filter by setup, filter wins/losses, sort columns, and import/export CSV. Also lists open positions. |
| **Analytics** | A **PnL calendar** (each day colored green or red by realized PnL; tap a day to see its trades), PnL **by day of week** and **by hold time**, win rate, net PnL, profit factor, expectancy, avg win/loss, payoff ratio, max drawdown, streaks, hold time, PnL per trade, return distribution, win rate by entry hour, per-token breakdown, a **By setup** table (win rate and PnL for each tag you add to trades, e.g. KOL call, dip buy), and written insights (break-even win rate, holding losers too long, outlier dependence, and more). **Holder lessons:** every token check (and every new position after a sync) saves a snapshot of the coin's holders. The card compares your wins and losses with and without each warning sign (bundles still holding 10%+, 25%+ bundled at launch, one wallet 10%+, top 10 at 40%+, creator 5%+, fresh wallets, unlocked LP, under 300 holders, under 1 hour old, under $20k liquidity, a Caution-or-worse verdict), ranked by money lost, and says which to size down on or skip once 5 trades have a sign. **Check my recent trades** fills in holder data for your last 30 closed trades, marked as checked later. When a coin you check matches a sign that has cost you, the Check tab shows **Your history with coins like this** and the AI write-up mentions it. Can look at the last 10/25/50/100 trades. |
| **Sizing** | Risk-based size, Kelly (¼ / ½ / full) from your own win rate and payoff ratio, and a size that uses your real average loss as the stop, capped by a max position %. **Risk rules:** a daily loss limit and a stop-after-N-losses-in-a-row rule. The dashboard warns you as you get close and tells you to stop when a rule is broken, and the suggested size is halved when close and drops to zero once a rule is broken. **Auto-tune from my stats** sets all of these from your last 50 trades (rules, refined by Claude when an Anthropic key is set), and **Keep tuned after every sync** re-runs it at most once an hour. |

### How synced trades are built

Each swap that trades SOL (or wrapped SOL) for a token counts as a buy or a sell of that token. Buys of the same token are averaged together. A trade **closes** once the position is fully sold:

- cost = all SOL put in
- proceeds = all SOL taken out
- fees are included because the app uses the wallet's real SOL balance change.

Not counted:

- token↔token swaps and swaps with several tokens
- sells of tokens bought before the synced history starts.

### CSV format

```
token,openedAt,closedAt,cost,proceeds,notes
BONK,2026-09-30T14:00:00Z,2026-09-30T16:30:00Z,0.5,0.82,breakout
```

`cost` and `proceeds` are in SOL.

## Tests

```sh
node --test tests/*.test.js
```

*These stats are math on your own trade history, not financial advice.*
