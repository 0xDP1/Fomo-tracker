# Random baseline for Paper trades

**Status:** proposed 2026-10-11, waiting for approval. Idea from the BeeBrain post (@h100envy: picks race a random baseline behind the same filters, and nothing graduates until it beats random); its code was not used.

**Problem.** Paper trades shows **AI trader** against **Same entries, fixed exits**, which tells whether Claude's *exits* beat the fixed rules. Nothing tells whether its *entries* beat luck: if most Best-list coins pump or dump together, the AI can look good or bad without picking anything. With the AI trader on, every Best-list coin the AI is shown also feeds two baselines that cost nothing extra (no AI calls, prices from the same DexScreener reads): **Every Best coin** opens a $100 paper trade in every coin the AI saw, and **Random pick** opens one in each coin with the same chance the AI has been entering lately (so it trades about as often as the AI, just without judgement). Both use the fixed exits, so the fair comparison is **Same entries, fixed exits** (the AI's picks) against **Random pick** and **Every Best coin** (no picks), on average return per trade. Below the results table a verdict line reads "Too few trades yet (12 of 30)" until each of the three has 30 closed trades, then "The AI's picks beat random: +14% vs +3% average per trade" or "do not beat random". We know it works from unit tests (the entry chance from the AI's recent decisions, a random draw made once per coin and stored so a reload doesn't redraw it, both baselines opening and closing under the fixed rules, the verdict and its 30-trade minimum, nothing opened while the AI trader is off) and a browser test with faked services showing the two new rows, a coin the AI skipped that random entered, and the verdict going from "too few" to an answer.

## Rules

- **Shown coins:** every coin the AI trader makes an entry decision on (enter or skip), once per coin, the same moment and price.
- **Every Best coin:** always enters. $100, fixed exits (half at 2×, rest at 3×, stop −40%, close after 24 hours).
- **Random pick:** enters with probability = the AI's entry share over its last 50 decisions (10% until it has made 10). Drawn once per coin when the AI decides, and the draw is stored. $100, fixed exits.
- **Comparison:** average return per closed trade (not dollars, since the AI sizes $50 to $200). The verdict needs 30 closed trades in each of **Same entries, fixed exits**, **Random pick** and **Every Best coin**. It says "beat" only when the AI's average is higher than both baselines; otherwise "do not beat random" with the three numbers.
- Nothing is opened when the AI trader is off. Old results are kept; the new rows start empty.

## Unsure

- 30 trades is a low bar for memecoin returns, which swing hard; the verdict line says how many trades it is based on. The bar can be raised later.
