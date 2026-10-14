// CrawlScan through the Worker (docs/features/crawlscan.md; shared by the app and the Worker, like calls.js): crawlscan.fun's own scan, read on demand and boiled down to
// what the app shows (score, band, five parts, headline, the biggest operators). Pure helpers, no network.
// Approach and data credit: CrawlScan (crawlscan.fun). Their API is unofficial: anything missing shows as unknown.
(function (root) {
  'use strict';
  const PARTS = [['operator', 35], ['virgin', 25], ['transfer', 20], ['sniper', 10], ['concentration', 10]];
  const BANDS = ['CLEAN', 'OK', 'RISKY', 'DANGER'];
  const TTL_MS = 30 * 60000;         // a scan is remembered this long per coin
  const JOB_TTL_MS = 2 * 60000;      // a scan still running can be picked up again this long
  const POLL_MS = 1000;
  const WAIT_MS = 25000;             // the Worker waits this long for a result before telling the app to ask again
  const TOP_OPERATORS = 5;

  const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const isSolana = (ca) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(ca || ''));

  // crawlscan.fun's result -> the compact record the Worker stores and the app shows.
  function summarize(result, now = Date.now()) {
    const r = result && result.result && typeof result.result === 'object' ? result.result : result;
    if (!r || typeof r !== 'object' || r.score == null || !r.parts) return null;
    const parts = PARTS.map(([key, max]) => ({ key, max, value: n(r.parts[key]) }));
    const m = r.metrics || {};
    const ops = (Array.isArray(r.operators) ? r.operators : []).map((o) => ({
      wallets: Array.isArray(o.wallets) ? o.wallets.slice(0, 20) : [],
      share: n(o.share), shareSupply: n(o.share_supply),
      tag: o.exit && o.exit.tag ? String(o.exit.tag) : '', sold: n(o.exit && o.exit.sold),
    })).sort((a, b) => (b.share || 0) - (a.share || 0)).slice(0, TOP_OPERATORS);
    const h = r.header || {};
    return {
      ca: r.token || '', chain: r.chain || 'solana', at: now, score: n(r.score), band: BANDS.includes(r.band) ? r.band : String(r.band || ''), parts,
      headline: String(r.headline || ''), reason: String(r.reason || ''), notes: Array.isArray(r.notes) ? r.notes.map(String).slice(0, 5) : [],
      impact: n(m.impact), topShare: n(m.operator), concentration: n(m.concentration), virgin: n(m.virgin), transfer: n(m.transfer), sniper: n(m.sniper),
      holders: n(r.holders_total), wallets: Array.isArray(r.holders) ? r.holders.length : null, operators: ops, operatorsN: Array.isArray(r.operators) ? r.operators.length : null,
      partial: !!r.partial_scan, limited: !!r.limited, rug: r.rug || null,
      symbol: h.ticker ? String(h.ticker) : '', mcapUsd: n(h.mcap_usd), elapsed: n(r.elapsed_s),
    };
  }

  // What the scan start answered: a job to poll, "paused" when crawlscan.fun has Solana switched off, else an error.
  function startOutcome(status, body) {
    const b = body && typeof body === 'object' ? body : {};
    if (status === 200 && b.job) return { job: String(b.job) };
    if (b.error && /soon/i.test(String(b.error))) return { error: 'paused' };
    return { error: b.error ? String(b.error).slice(0, 120) : 'HTTP ' + status };
  }

  // Risk-check facts from a summary (names start with cs so they never mix with the app's own operator check).
  const facts = (s) => (s && s.score != null ? { csScore: s.score, csBand: s.band, csImpact: s.impact, csHeadline: s.headline } : {});
  const fresh = (s, now = Date.now()) => !!(s && s.at && now - s.at < TTL_MS);
  const label = (s) => (s && s.score != null ? `CS ${Math.round(s.score)} · ${s.band}` : 'CS ?');

  const api = { PARTS, BANDS, TTL_MS, JOB_TTL_MS, POLL_MS, WAIT_MS, TOP_OPERATORS, isSolana, summarize, startOutcome, facts, fresh, label };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CrawlCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
