// Thesis drafts: pure helpers (no DOM, no network) for honest, paste-ready FOMO theses.
(function (root) {
  'use strict';

  const MAX_PER_SYNC = 5;
  const FLAGGED = ['High risk', 'Walk away'];
  const SCHEMA = {
    type: 'object',
    properties: { thesis: { type: 'string' }, risk_line: { type: 'string' } },
    required: ['thesis', 'risk_line'],
    additionalProperties: false,
  };

  // seen: addresses already handled, or null on the very first run (record, don't draft).
  function planDrafts(positions, seen) {
    const list = (positions || []).filter((p) => p.address);
    if (seen == null) return { toDraft: [], seen: list.map((p) => p.address) };
    const fresh = list.filter((p) => !seen.includes(p.address)).slice(0, MAX_PER_SYNC);
    return { toDraft: fresh, seen: seen.concat(fresh.map((p) => p.address)) };
  }

  // got: { dex, facts, risk } from the Check tab's gatherFacts / checkState.
  function evidence(got, position, mood) {
    const { dex, facts, risk } = got;
    return {
      token: {
        symbol: dex.symbol, chain: dex.chainId, marketCapUsd: dex.mcap, liquidityUsd: dex.liq,
        ageHours: dex.createdAt ? +((Date.now() - new Date(dex.createdAt).getTime()) / 3600e3).toFixed(1) : null,
        volumeUsd: { m5: dex.vol5m, h1: dex.vol1h, h24: dex.vol24h }, txns1h: { buys: dex.buys1h, sells: dex.sells1h },
        priceChangePct: { h1: dex.change1h, h24: dex.change24h }, hasSocialLinks: (dex.socials || []).length > 0,
      },
      holders: { topWalletPct: facts.topHolderPct, top10Pct: facts.top10Pct, holders: facts.holders, bundledStillHeldPct: facts.insiderPct, bundledAtLaunchPct: facts.bundleLaunchPct, creatorPct: facts.creatorPct, lpLockedPct: facts.lpLockedPct },
      riskCheck: { verdict: risk.verdict, score: risk.score, findings: risk.findings.map((f) => `${f.sev}: ${f.title}`), notChecked: risk.unknown },
      position: position ? { size: position.cost, unit: position.unit } : null,
      marketMood: mood || null,
    };
  }

  const isFlagged = (verdict) => FLAGGED.includes(verdict);
  const clean = (s) => String(s || '').trim().replace(/\s+/g, ' ');

  // reply: { thesis, risk_line } from Claude. Flagged coins get a risk line written here, not by the model.
  function compose(reply, risk, limit) {
    const flagged = isFlagged(risk.verdict);
    const top = (risk.findings || [])[0];
    const riskText = flagged ? (top ? `${risk.verdict}. ${clean(top.title).replace(/\.$/, '')}.` : `${risk.verdict} on the token check.`) : clean(reply.risk_line);
    const tail = '\nRisk: ' + riskText;
    let thesis = clean(reply.thesis);
    if (limit > 0 && thesis.length + tail.length > limit) {
      const room = Math.max(0, limit - tail.length - 1);
      const cut = thesis.slice(0, room + 1);
      const sp = cut.lastIndexOf(' ');
      thesis = (sp > 0 ? cut.slice(0, sp) : cut.slice(0, room)).replace(/[\s,.;:–-]+$/, '') + '…';
    }
    return { text: thesis + tail, flagged };
  }

  function addDraft(drafts, d) {
    return [d].concat((drafts || []).filter((x) => x.id !== d.id)).slice(0, 30);
  }

  const api = { planDrafts, evidence, compose, addDraft, isFlagged, SCHEMA, MAX_PER_SYNC };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Thesis = api;
})(typeof window !== 'undefined' ? window : globalThis);
