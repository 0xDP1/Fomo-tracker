# Thesis drafts

**Status:** approved 2026-10-08.

**Problem.** Writing a thesis every time you buy takes time you don't have mid-trade, so you skip it and your FOMO profile gets less attention. When a new position appears after a sync, the app researches the coin automatically (the full token check: market cap, liquidity, age, volume, buy/sell flow, bundles, top holders, socials, risk verdict, plus the market mood) and Claude writes a short thesis in your voice: why you're in, what would make it run, and the main risk, ready to paste into FOMO. Drafts appear in a Thesis drafts card on the Check tab, newest first, with Copy, Regenerate and Dismiss. A Write thesis button on any Check result does the same for coins you haven't bought. We know it works when tests confirm a new position triggers exactly one draft, the evidence sent to Claude contains the check results, and a coin flagged High risk or Walk away gets its red flag written into the draft; a browser test with a mocked Claude reply shows the card and Copy.

## Rules

- Only facts from the checks. No invented data, no price promises, no guarantees.
- Every draft ends with a "Risk:" line. For coins the risk check rates High risk or Walk away, the app writes that line itself from the verdict and the top finding, and the card shows a warning above the draft.
- Length limit (default 280 characters, adjustable on the card). The thesis part is trimmed at a word boundary; the risk line is never cut.
- Optional style notes on the card are passed to Claude so drafts match your voice.
- The first sync after this ships records your current positions without drafting them; only positions that appear afterwards get drafts. At most 5 drafts per sync.
- FOMO has no write API, so drafts are copied and pasted by hand.
