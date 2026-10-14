/* global DevRecord, Gmgn, gmgnAvailable, gmgnGet, Check, checkState, renderCheck, callState, saveCalls, renderCalls, gatherFacts, esc */
'use strict';
// Deep dev check (docs/features/dev-record.md): on demand only, on the Check tab and on each Call queue row. How high the
// dev's earlier coins went, their holders, volume and global fees, and the bundle verdict. Up to 6 GMGN requests
// (the created-coins list, then token info for the top 5 by peak when the list lacks those figures); remembered for
// an hour per dev wallet, so the Check tab shows a queue result without asking again.

const DEV_TTL = 3600000;
const devState = { cache: {}, busy: {} }; // cache: dev wallet -> { at, rec }; busy: Call queue coins being checked
const devFresh = (w) => { const c = w && devState.cache[w]; return c && Date.now() - c.at < DEV_TTL ? c.rec : null; };
const devShares = (f) => ({ launchPct: f ? f.bundleLaunchPct ?? f.ibBundledPct : null, heldPct: f ? f.insiderPct : null });
const devMoney = (v) => (v == null ? '—' : Check.fmtMcap(v));
const devCount = (v) => (v == null ? '—' : Math.round(v).toLocaleString());
const devGmgnMsg = (e) => (e.message === 'not_configured' ? 'GMGN is not set up: add a GMGN key in Settings, or a Worker with one.' : e.message);

async function readDevRecord(wallet, chain, currentMint) {
  const hit = devFresh(wallet);
  if (hit) return hit;
  const data = await gmgnGet('user/created_tokens', { chain, wallet_address: wallet });
  const dev = Gmgn.devFromCreated(data);
  if (!dev) throw new Error('GMGN returned no creator data');
  const ex = DevRecord.extrasByMint(data);
  let rows = dev.rows.filter((r) => r.mint !== currentMint).map((r) => Object.assign({ holders: null, volume: null, fees: null }, r, ex[r.mint] || {}));
  for (const r of DevRecord.topByPeak(rows)) {
    if (!DevRecord.needsInfo(r)) continue;
    try {
      const x = DevRecord.fromInfo(await gmgnGet('token/info', { chain, address: r.mint }));
      rows = rows.map((y) => (y.mint === r.mint ? DevRecord.merge(y, x) : y));
    } catch (e) { if (e.message === 'not_configured') throw e; } // one coin failing leaves its figures as "—"
  }
  const rec = { wallet, rows, sum: DevRecord.summarize(rows), launches: dev.launches, graduated: dev.graduated, at: Date.now() };
  devState.cache[wallet] = { at: rec.at, rec };
  return rec;
}

// ---- Check tab ----
function showDevRecord(rec) {
  checkState.devDeep = { rec };
  Object.assign(checkState.facts, DevRecord.facts(rec.sum));
  checkState.risk = Check.assessRisk(checkState.facts);
}
// When a Check loads: a dev checked in the last hour (here or from the Call queue) shows straight away, no requests.
function autoDevRecord() {
  const rec = devFresh(checkState.facts && checkState.facts.creatorAddress);
  if (rec) { showDevRecord(rec); renderCheck(); }
}
async function runDevCheck(fresh) {
  const ca = checkState.ca, dex = checkState.dex, wallet = checkState.facts && checkState.facts.creatorAddress;
  const chain = dex && Gmgn.toGmgnChain(dex.chainId);
  if (!chain || !wallet) return;
  if (fresh) delete devState.cache[wallet];
  checkState.devDeep = { loading: true };
  renderCheck();
  try {
    const rec = await readDevRecord(wallet, chain, ca);
    if (checkState.ca !== ca) return; // the user moved on to another coin
    showDevRecord(rec);
  } catch (e) {
    if (checkState.ca !== ca) return;
    checkState.devDeep = { error: devGmgnMsg(e) };
  }
  renderCheck();
}

function devDeepBlock() {
  const dex = checkState.dex;
  if (!dex || !Gmgn.toGmgnChain(dex.chainId)) return '';
  const d = checkState.devDeep;
  const s = d && d.rec && d.rec.sum;
  const cls = !s ? '' : s.verdict === 'proven' ? 'pos' : s.verdict === 'never' ? 'neg' : 'muted';
  const head = `<div class="flow-block devrec-block"><div class="row between wrap"><b>Dev track record</b>${s ? `<span class="flow-label ${cls}">${esc(DevRecord.VERDICT_LABEL[s.verdict])}</span>` : ''}`;
  const btn = (label) => `<button type="button" class="btn mini" id="devDeepBtn">${label}</button>`;
  if (!gmgnAvailable() && !s) return head + '</div><p class="muted small">Needs GMGN: add a GMGN key in Settings, or a Worker with one.</p></div>';
  if (!(checkState.facts && checkState.facts.creatorAddress)) return head + '</div><p class="muted small">No creator wallet reported for this coin, so its dev can\'t be looked up.</p></div>';
  if (!d) return head + btn('Deep dev check') + '</div><p class="muted small">How high this dev\'s earlier coins went, their holders, volume and global fees, and what that says about the bundle. Up to 6 GMGN requests, so it runs only when you ask.</p></div>';
  if (d.loading) return head + '</div><p class="muted small">Reading the dev\'s earlier coins on GMGN…</p></div>';
  if (d.error) return head + btn('Retry') + `</div><p class="neg small">${esc(d.error)}</p></div>`;
  const rec = d.rec;
  const bv = DevRecord.bundleVerdict(devShares(checkState.facts), s.verdict);
  const bundleLine = bv ? `<p class="small">Bundle: <b class="${bv.cls}">${esc(bv.label)}</b>. ${esc(bv.text)}</p>` : '<p class="muted small">Bundle: no bundle figures for this coin yet.</p>';
  const foot = `<p class="muted small">Data: GMGN (${rec.launches} launch${rec.launches === 1 ? '' : 'es'} on record for this wallet, ${rec.graduated} graduated). Peak is GMGN's all-time-high market cap; "—" means GMGN didn't send that figure. Proven: a coin past $1M, or two past $100k. Never gets anywhere: 5+ launches over 6 hours old, none past $50k. Checked ${new Date(rec.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, remembered for an hour.</p>`;
  if (s.verdict === 'none') return head + btn('Refresh') + `</div><p class="small">No earlier launches from this wallet. Many devs use a fresh wallet per coin, so this is neither good nor bad.</p>${bundleLine}${foot}</div>`;
  const top = DevRecord.topByPeak(rec.rows);
  const vol = s.volume ? `${devMoney(s.volume.sum)} across ${s.volume.n} coin${s.volume.n === 1 ? '' : 's'}` : '—';
  const fees = s.fees ? `${s.fees.sum.toLocaleString(undefined, { maximumFractionDigits: 1 })} SOL across ${s.fees.n} coin${s.fees.n === 1 ? '' : 's'}` : '—';
  return head + btn('Refresh') + `</div>
    <p class="small"><b>${s.launches} earlier launch${s.launches === 1 ? '' : 'es'}</b> · best peak <b>${devMoney(s.best && s.best.ath)}</b>${s.best && s.best.symbol ? ` (${esc(s.best.symbol)})` : ''} · median peak ${devMoney(s.median)} · ${s.over100k} past $100k · ${s.over1m} past $1M</p>
    <p class="small">Most holders ${devCount(s.mostHolders && s.mostHolders.holders)}${s.mostHolders && s.mostHolders.symbol ? ` (${esc(s.mostHolders.symbol)})` : ''} · volume ${vol} · global fees ${fees}</p>
    ${bundleLine}
    ${top.length ? `<div class="table-wrap"><table class="devrec-table"><thead><tr><th>Coin</th><th class="num">Peak</th><th class="num">Holders</th><th class="num hide-m">Volume</th><th class="num hide-m">Fees</th><th></th></tr></thead><tbody>
      ${top.map((r) => `<tr><td><b>${esc(r.symbol || r.mint.slice(0, 6))}</b></td><td class="num">${devMoney(r.ath)}</td><td class="num">${devCount(r.holders)}</td><td class="num hide-m">${devMoney(r.volume)}</td><td class="num hide-m">${r.fees == null ? '—' : r.fees.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td><td><button type="button" class="btn mini" data-dossier-ca="${esc(r.mint)}">Check</button></td></tr>`).join('')}
    </tbody></table></div>` : ''}
    ${foot}</div>`;
}

// ---- Call queue rows ----
const devCheckable = (e) => typeof gmgnAvailable === 'function' && gmgnAvailable() && !!Gmgn.toGmgnChain(e.chainId || e.chain);
// The row's line once checked (tap opens the coin on the Check tab, where the full record shows from memory),
// or the Dev check button.
function devRowHtml(e) {
  if (devState.busy[e.address]) return '<span class="muted small">Dev check…</span>';
  const d = e.deep;
  if (d) {
    const cls = d.verdict === 'proven' ? 'pos' : d.verdict === 'never' ? 'neg' : 'muted';
    const what = d.verdict === 'none' ? 'no earlier launches' : `best ${devMoney(d.best)}${d.bestSym ? ' ' + esc(d.bestSym) : ''} · ${d.over100k} over $100k`;
    return `<span class="small call-dev click" data-call-ca="${esc(e.address)}" title="Open the full dev record on the Check tab">Dev: ${what} · <b class="${cls}">${esc(DevRecord.VERDICT_LABEL[d.verdict])}</b>${d.bundle ? ` · <span class="${d.bundle.cls}">${esc(d.bundle.label)}</span>` : ''}</span>`;
  }
  if (!devCheckable(e)) return '';
  return `${e.deepError ? `<span class="neg small">Dev check failed: ${esc(e.deepError)}</span> ` : ''}<button type="button" class="btn mini" data-call-dev="${esc(e.address)}">Dev check</button>`;
}

async function callDevCheck(addr) {
  const e = callState.queue[addr];
  if (!e || devState.busy[addr]) return;
  devState.busy[addr] = true;
  renderCalls();
  let patch;
  try {
    const chain = Gmgn.toGmgnChain(e.chainId || e.chain);
    let wallet = e.creator, held = e.facts ? e.facts.insiderPct : null, launch = e.bundle && e.bundle.scanned ? e.bundle.bundledPct : null;
    if (!wallet) { // the creator wallet and the held bundle come from the same reads as Check
      const got = await gatherFacts(addr);
      wallet = got.facts.creatorAddress;
      held = got.facts.insiderPct ?? held;
      launch = got.facts.bundleLaunchPct ?? launch;
    }
    if (!wallet) throw new Error('no creator wallet reported for this coin');
    const rec = await readDevRecord(wallet, chain, addr);
    const shares = { heldPct: held, launchPct: launch };
    patch = { creator: wallet, deep: DevRecord.compact(rec.sum, DevRecord.bundleVerdict(shares, rec.sum.verdict), wallet, shares), deepError: '' };
  } catch (err) {
    patch = { deepError: devGmgnMsg(err) };
  } finally {
    delete devState.busy[addr];
  }
  if (callState.queue[addr]) { callState.queue[addr] = Object.assign({}, callState.queue[addr], patch); saveCalls(); }
  renderCalls();
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#devDeepBtn')) { runDevCheck(!!(checkState.devDeep && checkState.devDeep.rec)); return; }
  const b = e.target.closest('[data-call-dev]');
  if (b) callDevCheck(b.dataset.callDev);
});
