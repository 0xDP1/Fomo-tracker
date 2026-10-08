/* global EntryAge, store, getJson, DEX_API, $, esc, pct, sgnAmt, cls */
'use strict';
// "By coin age when you bought" table on Analytics. Launch times are looked up on DexScreener once and cached.

const AGE_LOOKUP_MAX = 300; // coins per Analytics visit (10 DexScreener requests)
const ageState = { busy: false, tried: new Set(), trades: [] };

async function fetchLaunches(addresses) {
  const launches = store.get('launchTimes', {});
  for (let i = 0; i < addresses.length; i += 30) {
    const chunk = addresses.slice(i, i + 30);
    chunk.forEach((a) => ageState.tried.add(a));
    try {
      const j = await getJson(DEX_API + chunk.map(encodeURIComponent).join(','));
      for (const a of chunk) launches[a] = EntryAge.earliestLaunch(j, a);
    } catch { /* left unset: looked up again on a later visit */ }
  }
  store.set('launchTimes', launches);
}

function renderAgeTable(trades) {
  const card = $('#ageCard');
  if (!card) return;
  ageState.trades = trades || [];
  const launches = store.get('launchTimes', {});
  const { rows, unknown } = EntryAge.byAge(ageState.trades, launches);
  const todo = EntryAge.missing(ageState.trades, launches).filter((a) => !ageState.tried.has(a)).slice(0, AGE_LOOKUP_MAX);
  card.innerHTML = `<h3>By coin age when you bought</h3>
    <div class="table-wrap"><table class="age-table"><thead><tr><th>Coin age</th><th class="num">Trades</th><th class="num">Win %</th><th class="num">PnL</th><th class="num">Avg</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${esc(r.band)}</td><td class="num">${r.count}</td><td class="num">${r.winRate == null ? '–' : pct(r.winRate, 0)}</td><td class="num ${cls(r.pnl)}">${r.count ? sgnAmt(r.pnl) : '–'}</td><td class="num ${cls(r.avgPct)}">${r.avgPct == null ? '–' : (r.avgPct > 0 ? '+' : '') + pct(r.avgPct, 0)}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted small">${ageState.busy ? 'Looking up launch times… ' : ''}${unknown ? `${unknown} trade${unknown === 1 ? '' : 's'} without a known launch time. ` : ''}Age is how long the coin had been trading when you bought, from its first DexScreener pool.</p>`;
  if (todo.length && !ageState.busy) {
    ageState.busy = true;
    fetchLaunches(todo).finally(() => { ageState.busy = false; renderAgeTable(ageState.trades); });
  }
}
