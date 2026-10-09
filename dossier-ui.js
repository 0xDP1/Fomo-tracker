/* global Dossier, Check, state, checkState, renderCheck, heliusTx, dexPairs, runCheck, ago, $, esc */
'use strict';
// Creator history block (Check tab, Solana): the coins the creator wallet launched before and how each one stands now.

const DOSSIER_PAGES = 5;      // 100 transactions per page
const DOSSIER_MAX = 20;       // launches listed
const dossierCache = {};      // creator wallet -> { rows, summary, pages, oldest, at }
const DOSSIER_LABEL = { alive: 'Alive', quiet: 'Quiet', dead: 'Dead', new: 'Too new', unknown: 'Unknown' };
const DOSSIER_CLS = { alive: 'pos', quiet: 'muted', dead: 'neg', new: 'muted', unknown: 'muted' };

async function readDossier(wallet, currentMint) {
  let txs = [], before = '', pages = 0, oldest = 0;
  while (pages < DOSSIER_PAGES) {
    const got = await heliusTx(wallet, before);
    pages++;
    if (!got.length) break;
    txs = txs.concat(got);
    oldest = Math.min(...got.map((t) => t.timestamp || Infinity));
    before = got[got.length - 1].signature;
    if (got.length < 100 || Dossier.launchesFrom(txs, wallet, currentMint, DOSSIER_MAX + 1).length > DOSSIER_MAX) break;
  }
  const launches = Dossier.launchesFrom(txs, wallet, currentMint, DOSSIER_MAX);
  const pairs = launches.length ? await dexPairs(launches.map((l) => l.mint)) : {};
  const now = Date.now();
  const rows = launches.map((l) => {
    const p = pairs[l.mint];
    return { mint: l.mint, symbol: (p && p.baseToken && p.baseToken.symbol) || '', launchedAt: l.t * 1000, mcap: (p && (p.marketCap || p.fdv)) || null, outcome: Dossier.outcome(p, l.t * 1000, now) };
  });
  return { rows, summary: Dossier.summarize(rows), pages, txs: txs.length, oldest: Number.isFinite(oldest) && oldest ? oldest * 1000 : 0, at: now };
}

async function autoDossier() {
  const ca = checkState.ca, dex = checkState.dex, facts = checkState.facts;
  if (!dex || dex.chainId !== 'solana' || !state.settings.heliusKey) return;
  const wallet = facts && facts.creatorAddress;
  if (!wallet) { checkState.dossier = { none: 'no creator wallet reported' }; return renderCheck(); }
  checkState.dossier = { loading: true };
  renderCheck();
  try {
    const d = dossierCache[wallet + ':' + ca] && Date.now() - dossierCache[wallet + ':' + ca].at < 600000 ? dossierCache[wallet + ':' + ca] : (dossierCache[wallet + ':' + ca] = await readDossier(wallet, ca));
    if (checkState.ca !== ca) return; // the user moved on to another coin
    checkState.dossier = d;
    if (d.summary.counted) { checkState.facts.creatorDead = d.summary.dead; checkState.facts.creatorCounted = d.summary.counted; checkState.risk = Check.assessRisk(checkState.facts); }
  } catch (e) {
    if (checkState.ca !== ca) return;
    checkState.dossier = { error: e.message };
  }
  renderCheck();
}

function dossierBlock() {
  const dex = checkState.dex;
  if (!dex || dex.chainId !== 'solana') return '';
  const head = '<div class="flow-block dossier-block"><div class="row between wrap"><b>Creator history (Helius)</b>';
  if (!state.settings.heliusKey) return head + '</div><p class="muted small">Add a Helius API key (Settings → Advanced) to see the creator\'s earlier launches.</p></div>';
  const d = checkState.dossier;
  if (!d || d.loading) return head + '</div><p class="muted small">Reading the creator wallet…</p></div>';
  if (d.none) return head + `</div><p class="muted small">No creator history: ${esc(d.none)}.</p></div>`;
  if (d.error) return head + `<button type="button" class="btn mini" id="dossierBtn">Retry</button></div><p class="neg small">${esc(d.error)}</p></div>`;
  const s = d.summary;
  const reach = d.txs ? `the last ${d.txs} transaction${d.txs === 1 ? '' : 's'}${d.oldest ? ' (back to ' + new Date(d.oldest).toLocaleDateString() + ')' : ''}` : 'its transaction history';
  if (!d.rows.length) return head + `</div><p class="small">No earlier launches found in ${reach}.</p><p class="muted small">That is not the same as clean: creators who use a fresh wallet per coin show nothing here.</p></div>`;
  const line = s.counted ? `<b class="${s.rugger ? 'neg' : ''}">${s.dead} of ${s.counted} earlier launch${s.counted === 1 ? '' : 'es'} dead</b> · ${s.alive} alive · ${s.quiet} quiet${s.newer ? ` · ${s.newer} too new to judge` : ''}${s.unknown ? ` · ${s.unknown} not looked up` : ''}` : `${d.rows.length} earlier launch${d.rows.length === 1 ? '' : 'es'}, all too new to judge`;
  return head + `<button type="button" class="btn mini" id="dossierBtn">Refresh</button></div>
    <p class="small">${line}</p>
    <details class="adv"><summary>Earlier launches (${d.rows.length})</summary>
      ${d.rows.map((r) => `<div class="recent-item small"><span><b>${esc(r.symbol || r.mint.slice(0, 6))}</b> <span class="muted">${ago(r.launchedAt)} ago${r.mcap ? ' · mcap ' + Check.fmtMcap(r.mcap) : ''}</span></span><span><span class="${DOSSIER_CLS[r.outcome]}">${DOSSIER_LABEL[r.outcome]}</span> <button type="button" class="btn mini" data-dossier-ca="${esc(r.mint)}">Check</button></span></div>`).join('')}
    </details>
    <p class="muted small">Read from ${reach}. Dead means no pool or under $1k liquidity now, not necessarily a rug. Coins under 6 hours old aren't judged.</p></div>`;
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#dossierBtn')) { const w = checkState.facts && checkState.facts.creatorAddress; if (w) delete dossierCache[w + ':' + checkState.ca]; autoDossier(); return; }
  const b = e.target.closest('[data-dossier-ca]');
  if (b) { runCheck(b.dataset.dossierCa); setTimeout(() => window.scrollTo({ top: $('#checkForm').offsetTop - 70, behavior: 'smooth' }), 50); }
});
