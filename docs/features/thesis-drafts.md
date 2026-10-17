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

## Revision: narrative first (v112)

**Status:** approved 2026-10-17 (owner: "make it more so about why the token is good, the narrative behind it not stats").

**Problem.** A thesis read like a stats dump ("top 10 hold 22%, liquidity $60k") because the only evidence Claude got was the Check numbers, and the prompt asked it to say why the coin is interesting from those. A thesis people actually post is about the story: what the coin is, why that idea catches on right now, who is already talking about it and why it fits the moment. The evidence sent to Claude gains a `story` block: the token's name and ticker, its website and social links as given on DexScreener, and, when What people are saying has loaded for that coin, Claude Haiku's summary of the chat, its mood, the claims and red flags people made, each group's take and the mention count (null when it has not loaded, so nothing is invented). The system prompt leads with the narrative: what the coin is about, why the idea has legs, what the crowd is saying and what would make it run, in the trader's voice; numbers only when one proves the story, at most one number in the thesis, never a list of stats; the risk line stays as it was (one biggest risk, still written by the app for High risk or Walk away). Style notes keep working on top. **Write thesis** on the Check tab reads What people are saying first when the Worker is set up and the chat has not been read yet (one Haiku call, a few seconds, "Reading what people are saying…" on the card); drafts for new positions after a sync use the chat only when it was already read. Same card, same length limit, same triggers.

## Rules (v112)

- `Thesis.story(dex, chat)` builds the block; `Thesis.evidence(got, position, mood, trench, chat)` puts it first; `Thesis.system(limit, style)` holds the prompt (moved out of `thesis-ui.js` so a test can read it). `chat` is the Check tab's `chatState[address]` entry (`{ prep, summary }`) or null.
- A chat that was read but had no messages gives `chat: { summary: null, messages: 0, … }`, not null: the prompt then says nothing about what people are saying.
- After a draft the Check tab re-renders so the Write thesis button is enabled again (reading the chat re-renders it disabled meanwhile).
- Tests: `tests/thesis.test.js` (the story block with and without a chat, the prompt's narrative lines and length rule) and `tests/e2e/thesis.e2e.js` (the request to Claude carries the story block and the narrative instruction for a synced position with no chat; Write thesis with the Worker set up makes one Haiku chat call and then the thesis, whose evidence carries the summary, group takes, claims and mention counts; the draft shown is the mocked narrative reply).
