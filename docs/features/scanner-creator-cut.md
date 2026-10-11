# Scanner: creator holdings cut

**Status:** approved 2026-10-11.

**Problem.** The Scanner can put a coin on the shortlist even when its creator still holds a big bag. The on-chain cut (`chainCut` in `scanner.js`) checks the top wallet, the top 10, holder count, mint and freeze authority, but not the creator's share. Creator holdings only reach the Claude judge as a soft score (`dev_still_loaded`), so a loaded dev can get through if the judge is generous. The Check tab already treats a creator holding 10% or more as high risk. The Scanner should drop those coins the same way, before the judge runs, which also saves a Claude call per dropped coin. We know it works when unit tests show `chainCut` drops a Solana coin whose creator holds 10% or more with the reason "creator holds X%, 10% or more", keeps one at 9.9%, and lists "creator" as unchecked (never cut) when the creator's share is unknown.

## Rules

- Threshold: `creatorPct >= 10`, the same number as Check's high-risk line (`check.js`). Kept as one shared number so the two can't drift apart.
- Solana only, like the other on-chain cuts. EVM chains keep the honeypot cut only.
- An unknown creator share (RugCheck down and the GoPlus fallback has no creator %) goes on the "unchecked" list and never drops the coin, the same as the other cuts.
- Nothing else changes: the soft `dev_still_loaded` score stays, and coins already on the shortlist are not scored again.
