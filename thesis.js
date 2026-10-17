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

  // The narrative side: what the coin is, where it lives, and what the chat says about it (v112). chat is the Check tab's
  // "What people are saying" result for this coin ({ prep, summary }) or null when it has not been read: nothing is invented.
  function story(dex, chat) {
    const d = dex || {};
    const prep = chat && chat.prep, sum = chat && chat.summary;
    return {
      name: d.name || '', ticker: d.symbol || '',
      links: (d.socials || []).filter((u) => typeof u === 'string').slice(0, 6),
      chat: prep ? {
        summary: sum ? sum.summary : null, mood: sum ? sum.mood : null,
        claims: sum ? sum.claims : [], redFlags: sum ? sum.redFlags : [],
        groupTakes: sum ? sum.groups.map((g) => `[${g.code}] ${g.take}`) : [],
        mentions: prep.mentions || 0, people: prep.mentioners || 0, groups: prep.mentionGroups || 0, messages: prep.talk || 0,
      } : null,
    };
  }

  // Claude's instructions: the story first, numbers only where one proves it (v112).
  function system(limit, style) {
    return 'Write a short trading thesis that a trader will post (on FOMO, X or a group chat) about a memecoin they hold or are considering. '
      + 'Lead with the narrative, not the stats: what the coin is about (its name, ticker, links and what the chat says), why that idea has legs right now, who is already talking about it and what would make it run. '
      + 'Write in first person, plain and specific, like a trader talking, not an ad. Use only facts in the evidence. At most one number in the thesis, and only when it proves the story; never a list of stats. '
      + 'When the chat summary is null, say nothing about what people are saying. Never present a price target as a promise, never say guaranteed or can\'t lose, and never invent partnerships, listings, holders or numbers. If the risk check verdict is Caution or worse, do not call the coin safe. '
      + (limit > 0 ? `thesis: at most ${Math.max(60, limit - 70)} characters. ` : 'thesis: two or three sentences. ')
      + 'risk_line: the single biggest risk from the evidence, one short sentence without a "Risk:" prefix.'
      + (style ? ' Match this trader\'s style notes: ' + style : '');
  }

  // got: { dex, facts, risk } from the Check tab's gatherFacts / checkState.
  function evidence(got, position, mood, trench, chat) {
    const { dex, facts, risk } = got;
    return {
      story: story(dex, chat),
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
      trenchIndex: trench || null,
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

  const api = { planDrafts, evidence, story, system, compose, addDraft, isFlagged, SCHEMA, MAX_PER_SYNC };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Thesis = api;
})(typeof window !== 'undefined' ? window : globalThis);
