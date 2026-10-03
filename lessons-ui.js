/* global Lessons, store, state, gatherFacts, openPositions, $, esc, pct, amt, sgnAmt */
'use strict';
// Holder lessons UI: saves holder snapshots, warns on the Check tab, and shows the Analytics card.

const SNAP_KEY = 'holderSnaps';
const SNAP_MERGE_MS = 10 * 60000;   // re-checks within 10 min update the same snapshot
const AUTO_MAX = 5;                 // background snapshots per sync
const BACKFILL_MAX = 30;            // recent closed trades checked by the button
const lessonsState = { auto: false, backfill: null };

const snapDb = () => store.get(SNAP_KEY, {});

function saveHolderSnapshot(ca, facts, risk, after = false) {
  if (!ca || !facts) return;
  let db = snapDb();
  const k = /^0x/i.test(ca) ? ca.toLowerCase() : ca;
  const list = db[k];
  if (list && list.length && Date.now() - list[list.length - 1].at < SNAP_MERGE_MS && list[list.length - 1].after === after) {
    db = Object.assign({}, db, { [k]: list.slice(0, -1) });
  }
  db = Lessons.addSnapshot(db, ca, Lessons.snapshot(facts, risk, Date.now(), after));
  store.set(SNAP_KEY, db);
}

const lessonsStats = () => Lessons.patternStats(state.trades || [], snapDb());
const lostLine = (r, base) => `You won ${r.with.wins} of ${r.with.count} (${pct(r.with.winRate, 0)}) and ${r.with.pnl < 0 ? 'lost ' + amt(-r.with.pnl) : 'made ' + amt(r.with.pnl)}.`
  + (r.without.count ? ` Without it you win ${pct(r.without.winRate, 0)}.` : base != null ? ` Your overall win rate is ${pct(base, 0)}.` : '');

// Check tab: warning when this coin has holder patterns that have cost you money.
function historyBlock(facts, risk) {
  const st = lessonsStats();
  const warn = Lessons.warningsFor(Lessons.snapshot(facts, risk, Date.now()), st);
  if (!warn.length) return '';
  return `<div class="history-warn"><b>Your history with coins like this</b><ul>${warn.map((r) => `<li><b>${esc(r.label)}.</b> ${lostLine(r, st.baselineWinRate)}</li>`).join('')}</ul></div>`;
}

// Evidence for the AI write-up.
function historyEvidence(facts, risk) {
  const st = lessonsStats();
  const costly = st.rows.filter((r) => r.costly);
  if (!costly.length) return null;
  const hit = new Set(Lessons.warningsFor(Lessons.snapshot(facts, risk, Date.now()), st).map((r) => r.key));
  const row = (r) => ({ pattern: r.label, trades: r.with.count, wins: r.with.wins, winRate: r.with.winRate, pnl: r.with.pnl, winRateWithout: r.without.winRate });
  return { overallWinRate: st.baselineWinRate, pnlUnit: state.unit || 'SOL', costlyPatternsThisCoinHas: costly.filter((r) => hit.has(r.key)).map(row), otherCostlyPatterns: costly.filter((r) => !hit.has(r.key)).map((r) => r.label) };
}

// After a sync: snapshot new open positions so their entry holders are on record.
async function autoSnapshotPositions() {
  if (lessonsState.auto || typeof openPositions !== 'function') return;
  lessonsState.auto = true;
  try {
    const db = snapDb();
    const todo = openPositions().filter((p) => {
      const m = Lessons.snapshotFor({ address: p.address, openedAt: p.openedAt || new Date().toISOString() }, db);
      const last = m && m.snap.at;
      return !(m && m.kind === 'entry') && !(last && Date.now() - last < 6 * 3600000);
    }).slice(0, AUTO_MAX);
    for (const p of todo) {
      try { const g = await gatherFacts(p.address); saveHolderSnapshot(p.address, g.facts, g.risk); } catch { /* skip coins the APIs don't know */ }
    }
  } finally { lessonsState.auto = false; }
}

// Button: check recent closed trades that have no snapshot (winners and losers, so the comparison is fair).
async function backfillLessons() {
  if (lessonsState.backfill) return;
  const db = snapDb();
  const todo = (state.trades || []).filter((t) => (t.address || t.mint) && !Lessons.snapshotFor(t, db))
    .sort((a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt)).slice(0, BACKFILL_MAX);
  lessonsState.backfill = { done: 0, total: todo.length, failed: 0 };
  renderLessons();
  for (const t of todo) {
    try { const g = await gatherFacts(t.address || t.mint); saveHolderSnapshot(t.address || t.mint, g.facts, g.risk, true); }
    catch { lessonsState.backfill.failed++; }
    lessonsState.backfill.done++;
    renderLessons();
    await new Promise((r) => setTimeout(r, 300));
  }
  const b = lessonsState.backfill;
  lessonsState.backfill = null;
  renderLessons(b.total ? `Checked ${b.total - b.failed} of ${b.total} trades${b.failed ? ` (${b.failed} coins couldn't be checked, often because they no longer trade)` : ''}.` : 'Every recent trade already has holder data.');
}

function renderLessons(note = '') {
  const card = $('#lessonsCard');
  if (!card) return;
  const st = lessonsStats();
  const b = lessonsState.backfill;
  const enough = st.rows.filter((r) => r.enough);
  const building = st.rows.filter((r) => !r.enough && r.with.count > 0);
  const costly = enough.filter((r) => r.costly);
  card.innerHTML = `<div class="row between wrap"><h3>Holder lessons</h3>
      <button type="button" class="btn mini" id="lessonsBackfill" ${b ? 'disabled' : ''}>${b ? `Checking ${b.done} of ${b.total}…` : 'Check my recent trades'}</button></div>
    <p class="muted small">Holder data for ${st.covered} of ${st.closed} closed trades${st.covered ? `: ${st.entry} at entry, ${st.later} checked later (holders may have changed since)` : ''}. Checking a coin or syncing adds more.${note ? ' ' + esc(note) : ''}</p>
    ${costly.length ? `<ul class="lessons">${costly.map((r) => `<li><b>Size down or skip: ${esc(r.label)}.</b> ${lostLine(r, st.baselineWinRate)}</li>`).join('')}</ul>` : ''}
    ${enough.length ? `<div class="table-wrap"><table class="lessons-table"><thead><tr><th>Warning sign</th><th class="num">Trades</th><th class="num">Win %</th><th class="num">PnL</th><th class="num hide-m">Win % without</th></tr></thead><tbody>
      ${enough.map((r) => `<tr class="${r.costly ? 'costly' : ''}"><td>${esc(r.label)}</td><td class="num">${r.with.count}</td><td class="num">${pct(r.with.winRate, 0)}</td><td class="num ${r.with.pnl < 0 ? 'neg' : r.with.pnl > 0 ? 'pos' : ''}">${sgnAmt(r.with.pnl)}</td><td class="num hide-m">${r.without.count ? pct(r.without.winRate, 0) : '–'}</td></tr>`).join('')}
      </tbody></table></div>` : `<p class="muted small">No lessons yet. A warning sign shows here once ${Lessons.MIN_TRADES} of your trades have it.</p>`}
    ${building.length ? `<p class="muted small">Building up: ${building.map((r) => `${esc(r.label)} (${r.with.count})`).join(', ')}.</p>` : ''}`;
}

document.addEventListener('click', (e) => { if (e.target.closest('#lessonsBackfill')) backfillLessons(); });
renderLessons();
