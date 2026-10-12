# Creator share from RugCheck's creator balance

**Status:** approved 2026-10-11.

**Problem.** When the creator isn't among RugCheck's top 20 holders, the app records their share as unknown. The Scanner then shows "not checked: creator" on most coins, and Check can't see a dev who still holds 3–9%. RugCheck's report already has `creatorBalance`, so creator share = `creatorBalance ÷ token.supply × 100`, used whenever RugCheck names a creator. The top-holder match stays as a cross-check. A creator who has sold everything counts as 0%, which is checked, not unknown. TrenchBot's figure is still only used when RugCheck gives nothing. We know it works when unit tests on saved RugCheck reports give the right share for a creator outside the top 20, 0% for a creator who sold out, and unknown when the report names no creator. Fewer Scanner coins should show "not checked: creator", and a browser test should show Check's "Creator holds 6%" finding for a creator outside the top 20.

## Rules

- Units: `creatorBalance` and `token.supply` are both raw token units. Checked on live reports: wherever the creator is also a top holder, `creatorBalance ÷ supply` equals RugCheck's own `pct` for that holder exactly (0.053%, 3.42%, 6.765%, 9.179%). The same check found a coin whose creator held 6.63% without being in the top 20, which the app used to call unknown.
- No `creatorBalance` in the report: fall back to the creator's top-holder row, else unknown. A `creatorBalance` without a supply is unknown.
- Saved reports (trimmed, addresses replaced): `tests/fixtures/rugcheck-creator.json`.
- Logic in `Check.creatorPctFromRugcheck` (`check.js`); `fetchRugcheck` in `check-ui.js` calls it.
