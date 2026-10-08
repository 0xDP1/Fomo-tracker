// fomoapi.io budget: pure helpers (no DOM, no network) that keep the app inside its credit allowance.
// fomoapi.io bills about 250 credits per call; the free plan is 250,000 credits a month (~1,000 calls).
(function (root) {
  'use strict';
  const MIN = 60000, H = 3600000;
  const CALL_CREDITS = 250;
  const BALANCE_MS = 10 * MIN;   // all-chain balance refresh
  const FOLLOW_MS = 10 * MIN;    // Following feed refresh
  const SYNC_MS = 15 * MIN;      // automatic trade sync
  const PAUSE_402_MS = H;        // pause after "credits used up"
  const PROBE_SKIP_MS = 24 * H;  // after learning no paging works, re-check once a day

  const monthOf = (t) => new Date(t).toISOString().slice(0, 7);

  function record(usage, now, remaining) {
    const m = monthOf(now);
    const u = usage && usage.month === m ? Object.assign({}, usage) : { month: m, calls: 0, credits: 0, remaining: null, remainingAt: null };
    u.calls += 1;
    u.credits = u.calls * CALL_CREDITS;
    if (Number.isFinite(remaining)) { u.remaining = remaining; u.remainingAt = now; }
    return u;
  }

  const pauseUntil = (status, now) => (status === 402 ? now + PAUSE_402_MS : 0);
  const isPaused = (until, now) => !!until && now < until;
  const creditsMessage = (until, now) => `Your fomoapi.io credits are used up. Top up or add a payment method at fomoapi.io/pricing, or wait for the monthly reset. The app will try again in ${Math.max(1, Math.ceil((until - now) / MIN))} min.`;

  const shouldProbe = (memo, now) => !(memo && memo.strategy === 'none' && now - memo.at < PROBE_SKIP_MS);
  const due = (lastAt, now, minMs) => !lastAt || now - lastAt >= minMs;

  // Keep every FOMO trade seen before; update ones fetched again; drop ones the user deleted.
  function mergeClosed(prev, fetched, hidden) {
    const gone = new Set(hidden || []);
    const out = new Map();
    for (const t of prev || []) if (!gone.has(t.id)) out.set(t.id, t);
    for (const t of fetched || []) if (!gone.has(t.id)) out.set(t.id, Object.assign({}, out.get(t.id), t));
    return [...out.values()];
  }

  const api = { record, pauseUntil, isPaused, creditsMessage, shouldProbe, due, mergeClosed, CALL_CREDITS, BALANCE_MS, FOLLOW_MS, SYNC_MS, PAUSE_402_MS, PROBE_SKIP_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FomoBudget = api;
})(typeof window !== 'undefined' ? window : globalThis);
