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
- **Anthropic API key** (optional). Enables the AI write-up on the Check tab. Calls go straight from your browser to Anthropic; the key is stored only in this browser.
- **Username lookup API.** Some unofficial third-party services map FOMO usernames to wallets. Put the endpoint in Settings (use `{handle}` where the username goes), plus its API key if it needs one. Unknown usernames are then resolved automatically: the app takes the Solana address from the response.

Everything stays in your browser's localStorage. Use **Export JSON backup** to keep a copy.

**On a phone:** open the site in Safari, then Share → **Add to Home Screen**. It runs full-screen with its own icon and a bottom tab bar, and offers a one-tap update when a new version is published. Rarely used settings (Solana wallet, Helius, custom lookup providers) are under **Advanced** on the Settings tab.

## Features

| Tab | What it does |
| --- | --- |
| **Dashboard** | SOL balance, token holdings priced in USD (Jupiter), total portfolio value, balance-history chart, auto-refresh, and headline stats with the equity curve and recent trades. |
| **Check** | Paste a contract address (or a DexScreener link). The app pulls the pool from DexScreener and the contract and holder checks from RugCheck (Solana) or GoPlus (EVM chains), then gives a rug-risk score and verdict with findings such as *bundled supply sitting unsold over your head*, *LP in a wallet that can pull it* and *one whale who is the chart*, plus mint/freeze authority, honeypot, taxes, thin liquidity and age. **Plan:** pick a target market cap and a size (prefilled from Sizing) and it builds a three-trim ladder, a runner and a stop, marking the trim that returns your initial. **Watch:** re-checks every 20 s while the page is open; a trim call fires when a level is hit, a blow-off top or distribution flips the verdict to *Trim into strength*, and a liquidity pull or stop hit says *Walk away*. Tap **Took it** on a trim to record it: exits taken on plan are celebrated and counted in an **Exit discipline** stat. **AI write-up** (optional): with an Anthropic API key in Settings, Claude turns the evidence into a short plain-English verdict. |
| **Trades** | Sync swaps from your wallet (Helius), add/edit/delete trades by hand, add notes and **setup tags** (tap a preset or type your own), filter by setup, filter wins/losses, sort columns, and import/export CSV. Also lists open positions. |
| **Analytics** | A **PnL calendar** (each day colored green or red by realized PnL; tap a day to see its trades), PnL **by day of week** and **by hold time**, win rate, net PnL, profit factor, expectancy, avg win/loss, payoff ratio, max drawdown, streaks, hold time, PnL per trade, return distribution, win rate by entry hour, per-token breakdown, a **By setup** table (win rate and PnL for each tag you add to trades, e.g. KOL call, dip buy), and written insights (break-even win rate, holding losers too long, outlier dependence, and more). Can look at the last 10/25/50/100 trades. |
| **Sizing** | Risk-based size, Kelly (¼ / ½ / full) from your own win rate and payoff ratio, and a size that uses your real average loss as the stop, capped by a max position %. **Risk rules:** a daily loss limit and a stop-after-N-losses-in-a-row rule. The dashboard warns you as you get close and tells you to stop when a rule is broken, and the suggested size is halved when close and drops to zero once a rule is broken. |

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
node --test tests/stats.test.js
```

*These stats are math on your own trade history, not financial advice.*
