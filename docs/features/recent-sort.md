# Recent calls: sort and filter by gain

**Status:** approved 2026-10-12.

**Problem.** Recent calls are always newest first, so finding the ones that ran (or the ones that dumped) means scrolling through 50 rows. Recent calls get a **Sort** control: Newest (as now), **Gain now ↓/↑**, or **Peak ↓/↑**. Tapping the same option again flips the direction. A **Min gain** filter has chips for Any, +0%, +50%, 2×, 4× and Losers (under 0%). It applies to whichever measure you sort by (gain now or peak), and to gain now when sorting by Newest. The header shows "12 of 50 shown". Your choice is remembered on this device. Calls with no price yet go last and are hidden by any Min gain filter. We know it works when unit tests sort and filter sample calls correctly in both directions, and a browser test flips the sort and applies a filter.

## Rules

- Logic in `Recent.view(records, { by, dir, min })` (`recent.js`). `by`: `new` (call time), `now` (latest ÷ call market cap) or `peak` (peak ÷ call market cap). `dir`: `desc` or `asc`. `min`: `null` (Any), a gain as a fraction (0, 0.5, 1, 3 for +0%, +50%, 2×, 4×) or `'losers'`.
- Newest ↓ is newest first; ↑ is oldest first.
- Calls without a price sort last in both directions.
- The choice is saved as `recentView` in this browser.
- The win-rate stat line still covers all recent calls, not only the filtered ones.
