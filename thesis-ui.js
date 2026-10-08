/* global Thesis, Check, store, state, gatherFacts, openPositions, checkState, marketState, $, esc, fmtDT */
'use strict';
// Thesis drafts card (Check tab): honest, paste-ready FOMO theses for new positions and on demand.

const thesisState = { drafts: store.get('thesisDrafts', []), busy: '', status: '' };
const thesisLimit = () => { const v = Number(store.get('thesisLimit', 280)); return Number.isFinite(v) && v >= 0 ? v : 280; };
const thesisStyle = () => String(store.get('thesisStyle', '') || '');

async function askThesis(ev) {
  const limit = thesisLimit();
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': state.settings.anthropicKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    body: JSON.stringify({
      model: 'claude-opus-5-5', max_tokens: 4000, fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: Thesis.SCHEMA } },
      system: 'Write a short trading thesis that a trader will post on FOMO, a social trading app, about a memecoin they hold or are considering. Write in first person, plain and specific, like a trader talking, not an ad. Use only facts in the evidence: say why the coin is interesting and what would make it run. Never present a price target as a promise, never say guaranteed or can\'t lose, and never invent partnerships, listings, holders or numbers. If the risk check verdict is Caution or worse, do not call the coin safe. '
        + (limit > 0 ? `thesis: at most ${Math.max(60, limit - 70)} characters. ` : 'thesis: two or three sentences. ')
        + 'risk_line: the single biggest risk from the evidence, one short sentence without a "Risk:" prefix.'
        + (thesisStyle() ? ' Match this trader\'s style notes: ' + thesisStyle() : ''),
      messages: [{ role: 'user', content: 'Evidence (JSON):\n' + JSON.stringify(ev) }],
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
  if (j.stop_reason === 'refusal') throw new Error('Claude declined to write this one');
  if (j.stop_reason === 'max_tokens') throw new Error('the reply was cut off');
  let reply;
  try { reply = JSON.parse((j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')); } catch { reply = null; }
  if (!reply || !reply.thesis) throw new Error('the reply was not readable');
  return reply;
}

// source: 'position' (auto after sync) or 'check' (Write thesis button). got may be passed to skip refetching.
async function writeDraft({ address, position = null, got = null, source = 'check' }) {
  if (!state.settings.anthropicKey) { thesisState.status = 'Thesis drafts need an Anthropic API key (Settings).'; return renderThesis(); }
  thesisState.busy = address;
  thesisState.status = 'Researching and writing…';
  renderThesis();
  try {
    const g = got || await gatherFacts(address);
    const mood = typeof marketState !== 'undefined' && marketState.data && marketState.data.totals ? marketState.data.totals.mood : null;
    const reply = await askThesis(Thesis.evidence(g, position ? { cost: position.cost, unit: state.unit || 'SOL' } : null, mood));
    const c = Thesis.compose(reply, g.risk, thesisLimit());
    thesisState.drafts = Thesis.addDraft(thesisState.drafts, { id: address, address, symbol: g.dex.symbol, chain: (Check.CHAIN_NAMES && Check.CHAIN_NAMES[g.dex.chainId]) || g.dex.chainId, at: Date.now(), text: c.text, flagged: c.flagged, verdict: g.risk.verdict, source, position: position ? { cost: position.cost } : null });
    store.set('thesisDrafts', thesisState.drafts);
    thesisState.status = '';
  } catch (e) {
    thesisState.status = `Couldn't write a thesis: ${e.message}`;
  } finally {
    thesisState.busy = '';
    renderThesis();
  }
}

// After a sync: draft theses for positions that are new since the last sync.
async function autoDraftTheses() {
  if (typeof openPositions !== 'function') return;
  const plan = Thesis.planDrafts(openPositions(), store.get('thesisSeen', null));
  if (!plan.toDraft.length) { store.set('thesisSeen', plan.seen); return; }
  if (!state.settings.anthropicKey) return; // keep them unseen until a key is added
  store.set('thesisSeen', plan.seen);
  for (const p of plan.toDraft) await writeDraft({ address: p.address, position: p, source: 'position' });
}

// Button on a Check result.
function thesisButton() {
  return `<div class="row gap wrap thesis-btn-row"><button type="button" class="btn mini" id="thesisBtn" ${thesisState.busy ? 'disabled' : ''}>Write thesis</button><span class="muted small">Honest, paste-ready thesis for FOMO from this check.</span></div>`;
}

function renderThesis() {
  const card = $('#thesisCard');
  if (!card) return;
  const limit = thesisLimit();
  card.innerHTML = `<div class="row between wrap"><h3>Thesis drafts</h3><span class="muted small">${thesisState.drafts.length ? thesisState.drafts.length + ' saved' : ''}</span></div>
    <div class="row gap wrap thesis-opts">
      <label class="small">Max length <input type="number" id="thesisLimit" min="0" step="10" value="${limit}" inputmode="numeric"/></label>
      <label class="small grow">Style notes <input type="text" id="thesisStyle" placeholder="e.g. lowercase, short, no emojis" value="${esc(thesisStyle())}"/></label>
    </div>
    ${thesisState.status ? `<p class="small ${/Couldn't|need/.test(thesisState.status) ? 'neg' : 'muted'}">${esc(thesisState.status)}</p>` : ''}
    ${thesisState.drafts.length ? thesisState.drafts.map((d) => `<div class="thesis-draft">
        <div class="row between wrap"><span><b>${esc(d.symbol)}</b> <span class="tag">${esc(d.chain)}</span> <span class="muted small">${esc(fmtDT(new Date(d.at).toISOString()))} · ${d.source === 'position' ? 'new position' : 'from a check'}</span></span></div>
        ${d.flagged ? `<div class="thesis-warn small">⚠ The token check rates this coin <b>${esc(d.verdict)}</b>. A buy thesis can pull people who follow you into it, so the red flag is written into the draft.</div>` : ''}
        <div class="thesis-text">${esc(d.text)}</div>
        <div class="row between wrap"><span class="muted small ${limit > 0 && d.text.length > limit ? 'neg' : ''}">${d.text.length}${limit > 0 ? ' / ' + limit : ''} characters</span>
          <span class="row gap"><button type="button" class="btn mini primary" data-th-copy="${esc(d.id)}">Copy</button><button type="button" class="btn mini" data-th-regen="${esc(d.id)}" ${thesisState.busy ? 'disabled' : ''}>Regenerate</button><button type="button" class="btn mini" data-th-dismiss="${esc(d.id)}">Dismiss</button></span></div>
      </div>`).join('')
    : '<p class="muted small">Drafts appear here when a new position shows up after a sync, or tap Write thesis on any token check. Needs an Anthropic API key. Claude only uses facts from the checks and every draft ends with the biggest risk.</p>'}`;
}

document.addEventListener('click', async (e) => {
  if (e.target.closest('#thesisBtn')) {
    if (!checkState.dex || !checkState.risk) return;
    const pos = checkState.position || (typeof openPositions === 'function' ? openPositions().find((p) => p.address === checkState.ca) : null) || null;
    await writeDraft({ address: checkState.ca, position: pos, got: { dex: checkState.dex, facts: checkState.facts, risk: checkState.risk }, source: 'check' });
    $('#thesisCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const cp = e.target.closest('[data-th-copy]');
  if (cp) {
    const d = thesisState.drafts.find((x) => x.id === cp.dataset.thCopy);
    try { await navigator.clipboard.writeText(d.text); cp.textContent = 'Copied'; } catch { cp.textContent = 'Copy failed'; }
    setTimeout(() => { cp.textContent = 'Copy'; }, 1500);
    return;
  }
  const rg = e.target.closest('[data-th-regen]');
  if (rg) { const d = thesisState.drafts.find((x) => x.id === rg.dataset.thRegen); return writeDraft({ address: d.address, position: d.position, source: d.source }); }
  const ds = e.target.closest('[data-th-dismiss]');
  if (ds) { thesisState.drafts = thesisState.drafts.filter((x) => x.id !== ds.dataset.thDismiss); store.set('thesisDrafts', thesisState.drafts); renderThesis(); }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'thesisLimit') { store.set('thesisLimit', Math.max(0, Math.round(Number(e.target.value) || 0))); renderThesis(); }
  if (e.target.id === 'thesisStyle') store.set('thesisStyle', e.target.value.slice(0, 300));
});
renderThesis();
