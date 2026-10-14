/* global Gmgn, gmgnAvailable, gmgnGet, Dossier, DevRecord, Check, state, checkState, renderCheck, heliusTx, dexPairs, runCheck, ago, $, esc */
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

// GMGN's created-tokens list (no Helius key and no wallet paging needed). Market cap now stands in for the pool reading.
async function readDossierGmgn(wallet, currentMint) {
  const dev = Gmgn.devFromCreated(await gmgnGet('user/created_tokens', { chain: 'sol', wallet_address: wallet }));
  if (!dev) throw new Error('GMGN returned no creator data');
  const now = Date.now();
  const earlier = dev.rows.filter((r) => r.mint !== currentMint);
  const rows = earlier.slice().sort((a, b) => b.launchedAt - a.launchedAt).slice(0, DOSSIER_MAX)
    .map((r) => ({ mint: r.mint, symbol: r.symbol, launchedAt: r.launchedAt, mcap: r.mcap, ath: r.ath, outcome: Gmgn.outcomeFromMcap(r, now) }));
  // How high the earlier coins got (GMGN's peak market caps): the dev verdict, from this one request.
  return { rows, summary: Dossier.summarize(rows), dev: DevRecord.summarize(earlier, now), via: 'GMGN', launches: dev.launches, graduated: dev.graduated, stuck: dev.stuck, txs: 0, oldest: 0, at: now };
}

async function autoDossier() {
  const ca = checkState.ca, dex = checkState.dex, facts = checkState.facts;
  const viaGmgn = typeof gmgnAvailable === 'function' && gmgnAvailable();
  if (!dex || dex.chainId !== 'solana' || (!state.settings.heliusKey && !viaGmgn)) return;
  const wallet = facts && facts.creatorAddress;
  if (!wallet) { checkState.dossier = { none: 'no creator wallet reported' }; return renderCheck(); }
  checkState.dossier = { loading: true };
  renderCheck();
  try {
    const d = dossierCache[wallet + ':' + ca] && Date.now() - dossierCache[wallet + ':' + ca].at < 600000 ? dossierCache[wallet + ':' + ca] : (dossierCache[wallet + ':' + ca] = await (viaGmgn ? readDossierGmgn(wallet, ca).catch((err) => { if (state.settings.heliusKey) return readDossier(wallet, ca); throw err; }) : readDossier(wallet, ca)));
    if (checkState.ca !== ca) return; // the user moved on to another coin
    checkState.dossier = d;
    // Dead coins alone are not a finding; the dev verdict (how high they got) is, when GMGN gave peaks.
    if (d.dev && !(checkState.devDeep && checkState.devDeep.rec)) { Object.assign(checkState.facts, DevRecord.facts(d.dev)); checkState.risk = Check.assessRisk(checkState.facts); }
  } catch (e) {
    if (checkState.ca !== ca) return;
    checkState.dossier = e.message === 'not_configured' ? null : { error: e.message }; // no GMGN key on the Worker: fall back quietly
  }
  renderCheck();
}

function dossierBlock() {
  const dex = checkState.dex;
  if (!dex || dex.chainId !== 'solana') return '';
  const viaGmgn = checkState.dossier && checkState.dossier.via === 'GMGN';
  const head = `<div class="flow-block dossier-block"><div class="row between wrap"><b>Creator history (${viaGmgn ? 'GMGN' : 'Helius'})</b>`;
  if (!state.settings.heliusKey && !(typeof gmgnAvailable === 'function' && gmgnAvailable()) && !viaGmgn) return head + '</div><p class="muted small">Add a Helius API key (Settings → Advanced) to see the creator\'s earlier launches.</p></div>';
  const d = checkState.dossier;
  if (!d || d.loading) return head + '</div><p class="muted small">Reading the creator wallet…</p></div>';
  if (d.none) return head + `</div><p class="muted small">No creator history: ${esc(d.none)}.</p></div>`;
  if (d.error) return head + `<button type="button" class="btn mini" id="dossierBtn">Retry</button></div><p class="neg small">${esc(d.error)}</p></div>`;
  const s = d.summary;
  const reach = d.via === 'GMGN' ? `GMGN's list for this wallet (${d.launches} launch${d.launches === 1 ? '' : 'es'}: ${d.graduated} reached an open market, ${d.stuck} never left the bonding curve)` : d.txs ? `the last ${d.txs} transaction${d.txs === 1 ? '' : 's'}${d.oldest ? ' (back to ' + new Date(d.oldest).toLocaleDateString() + ')' : ''}` : 'its transaction history';
  if (!d.rows.length) return head + `</div><p class="small">No earlier launches found in ${reach}.</p><p class="muted small">That is not the same as clean: creators who use a fresh wallet per coin show nothing here.</p></div>`;
  const line = s.counted ? `<b>${s.dead} of ${s.counted} earlier launch${s.counted === 1 ? '' : 'es'} dead</b> · ${s.alive} alive · ${s.quiet} quiet${s.newer ? ` · ${s.newer} too new to judge` : ''}${s.unknown ? ` · ${s.unknown} not looked up` : ''}` : `${d.rows.length} earlier launch${d.rows.length === 1 ? '' : 'es'}, all too new to judge`;
  const v = d.dev;
  const peakLine = v && v.best ? `<p class="small">Best peak <b>${Check.fmtMcap(v.best.ath)}</b>${v.best.symbol ? ` (${esc(v.best.symbol)})` : ''} · ${v.over100k} past $100k · ${v.over1m} past $1M · <span class="${v.verdict === 'proven' ? 'pos' : v.verdict === 'never' ? 'neg' : 'muted'}">${esc(DevRecord.VERDICT_LABEL[v.verdict])}</span></p>` : '';
  return head + `<button type="button" class="btn mini" id="dossierBtn">Refresh</button></div>
    <p class="small">${line}</p>${peakLine}
    <details class="adv"><summary>Earlier launches (${d.rows.length})</summary>
      ${d.rows.map((r) => `<div class="recent-item small"><span><b>${esc(r.symbol || r.mint.slice(0, 6))}</b> <span class="muted">${ago(r.launchedAt)} ago${r.mcap ? ' · mcap ' + Check.fmtMcap(r.mcap) : ''}${r.ath ? ' · peak ' + Check.fmtMcap(r.ath) : ''}</span></span><span><span class="${DOSSIER_CLS[r.outcome]}">${DOSSIER_LABEL[r.outcome]}</span> <button type="button" class="btn mini" data-dossier-ca="${esc(r.mint)}">Check</button></span></div>`).join('')}
    </details>
    <p class="muted small">Read from ${reach}. ${d.via === 'GMGN' ? 'Dead means market cap under $5k now' : 'Dead means no pool or under $1k liquidity now'}, not necessarily a rug: most coins fade, so how high they got matters more (Deep dev check below). Coins under 6 hours old aren't judged.</p></div>`;
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#dossierBtn')) { const w = checkState.facts && checkState.facts.creatorAddress; if (w) delete dossierCache[w + ':' + checkState.ca]; autoDossier(); return; }
  const b = e.target.closest('[data-dossier-ca]');
  if (b) { runCheck(b.dataset.dossierCa); setTimeout(() => window.scrollTo({ top: $('#checkForm').offsetTop - 70, behavior: 'smooth' }), 50); }
});
