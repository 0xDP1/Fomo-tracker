# Short time filters (Call queue)

**Status:** approved 2026-10-10.

**Problem.** The shortest Call queue window was 1 hour, so the freshest coins, where the best entries usually are, were mixed in with coins that were already late. **Launched within** now also offers 15m and 30m (by the coin's age), and a new **Called within** filter (any, 15m, 30m, 1h) keeps only coins first called in the channels that recently, whatever their age. Both apply to Best and All scores and are remembered. We know it works from a browser test with coins of different launch ages and call times where each choice shows exactly the right coins, the two combine, the hidden-count line mentions the new filter, and both choices survive a reload.
