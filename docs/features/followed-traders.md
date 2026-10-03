# Followed traders

**Status:** approved 2026-10-03.

**Problem.** You want to see what specific FOMO traders are buying and selling without running a Telegram bot such as copyfomo. Copyfomo's `/find` has no public API, so the app cannot call it.

**What the user sees.** The user adds FOMO handles to a Followed list. On each refresh the app pulls each trader's recent trades through fomoapi.io, the same provider already used for your own account. A Following panel on the Dashboard shows the newest trades across followed traders: handle, token, chain, buy or sell, size in USD, and time. A one-tap **Check** opens the token in the Check tab. No trades are executed and no keys are needed beyond the fomoapi.io key already configured.

**How we know it works.** A unit test feeds two mocked trader trade lists and gets them merged, newest first, with buys and sells labelled correctly. A browser test with mocked fomoapi.io responses confirms the panel renders and that tapping Check lands on the Check tab with the right contract address.
