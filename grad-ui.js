/* global Grad, Check, gatherFacts, dexPairs, addCalls, coinLinks, recentState, renderCallAlert, store, esc, ago, runCheck, $ */
'use strict';
// Graduations (Calls tab): one connection to PumpPortal's free feed hears every pump.fun coin the moment it graduates;
// 3 minutes later each gets the market check (DexScreener) and, if it passes, the holder and rug check (the Check tab's
// own), and a coin that passes both alerts with 🎓. Only while the app is open (docs/features/graduations.md).

const GRAD_FEED = 'wss://pumpportal.fun/api/data';
const GRAD_TICK_MS = 30000;
const gradState = { on: store.get('gradOn', true), list: store.get('gradList', []), filters: Grad.clampFilters(store.get('gradFilters', null)), filtersOpen: false, ws: null, status: 'off', retry: 0, timer: null, busy: false, note: '' };
const gradSave = () => store.set('gradList', gradState.list);
const gradMoney = (v) => (v == null ? '–' : Check.fmtMcap(v));

// One connection only; if it drops, try again after 5 s, 10, 20, 40… up to 2 minutes.
function gradConnect() {
  if (!gradState.on || gradState.ws || typeof WebSocket === 'undefined') return;
  let ws;
  try { ws = new WebSocket(GRAD_FEED); } catch { gradState.status = 'reconnecting'; return gradRetry(); }
  gradState.ws = ws;
  gradState.status = 'connecting';
  ws.onopen = () => { gradState.retry = 0; gradState.status = 'live'; ws.send(JSON.stringify({ method: 'subscribeMigration' })); renderGrad(); };
  ws.onmessage = (m) => {
    const g = Grad.parse(String(m.data), Date.now());
    if (!g) return;
    gradState.list = Grad.add(gradState.list, g, gradState.filters);
    gradSave(); renderGrad();
  };
  ws.onclose = () => { if (gradState.ws !== ws) return; gradState.ws = null; gradState.status = 'reconnecting'; renderGrad(); gradRetry(); };
  ws.onerror = () => { try { ws.close(); } catch { /* already closed */ } };
  renderGrad();
}
function gradRetry() {
  if (!gradState.on || gradState.timer) return;
  const wait = Math.min(120000, 5000 * 2 ** gradState.retry++);
  gradState.timer = setTimeout(() => { gradState.timer = null; gradConnect(); }, wait);
}
function gradDisconnect() {
  clearTimeout(gradState.timer);
  gradState.timer = null;
  const ws = gradState.ws;
  gradState.ws = null;
  gradState.status = 'off';
  if (ws) { try { ws.close(); } catch { /* already closed */ } }
}

// Coins due (3 minutes after graduating): the market check for all of them in one DexScreener request per 30, then the
// holder and rug check one coin at a time for those that pass.
async function gradTick() {
  if (gradState.busy) return;
  const mints = Grad.due(gradState.list, Date.now());
  if (!mints.length) return;
  gradState.busy = true;
  try {
    const pairs = await dexPairs(mints);
    for (const mint of mints) {
      const pr = pairs[mint];
      if (pr === undefined) continue; // DexScreener did not answer: next tick
      const g = gradState.list.find((x) => x.mint === mint) || {};
      const base = { symbol: pr && pr.baseToken ? pr.baseToken.symbol || '' : '', mcap: pr ? Number(pr.marketCap) || Number(pr.fdv) || null : null, liq: pr && pr.liquidity ? Number(pr.liquidity.usd) || null : null };
      if (pr === null && Grad.canRetry(g)) { gradState.list = Grad.retryLater(gradState.list, mint, Date.now()); continue; } // not indexed yet
      const why = Grad.marketCut(pr, Date.now(), g.at, gradState.filters);
      if (why) { gradState.list = Grad.setResult(gradState.list, mint, Object.assign(base, { status: 'cut', stage: 'Market', why }), Date.now()); continue; }
      let got;
      try { got = await gatherFacts(mint); } catch (e) { gradState.list = Grad.setResult(gradState.list, mint, Object.assign(base, { status: 'error', stage: 'Holders', why: 'holder check failed: ' + e.message }), Date.now()); continue; }
      const hw = Grad.holderCut(got, gradState.filters);
      gradState.list = Grad.setResult(gradState.list, mint, Object.assign(base, hw ? { status: 'cut', stage: 'Holders', why: hw } : { status: 'passed', verdict: got.risk.verdict }), Date.now());
      if (!hw) gradAlert(gradState.list.find((x) => x.mint === mint));
      gradSave(); renderGrad();
    }
  } finally {
    gradState.busy = false;
    gradSave(); renderGrad();
  }
}

function gradAlert(g) {
  const text = `${g.symbol || g.mint.slice(0, 6)} graduated and passed the checks · ${gradMoney(g.mcap)} mcap · ${gradMoney(g.liq)} liq`;
  if (typeof recentState !== 'undefined' && typeof renderCallAlert === 'function') {
    recentState.alerts = recentState.alerts.concat({ address: g.mint, text, icon: '🎓', at: Date.now() }).slice(-3);
    renderCallAlert();
  }
  try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch { /* not supported */ }
  try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('Graduation passed', { body: '🎓 ' + text, tag: 'grad-' + g.mint }); } catch { /* not supported here */ }
}

const GRAD_STATUS = { live: '● live', connecting: 'connecting…', reconnecting: 'reconnecting…', off: 'off' };
// The owner's filters (docs/features/grad-filters.md): [key, label, unit before, unit after].
const GRAD_FIELDS = [['waitMin', 'Check after', '', 'min'], ['liq', 'Liquidity at least', '$', ''], ['mcapMin', 'Market cap from', '$', ''], ['mcapMax', 'Market cap up to', '$', ''], ['vol', 'Volume at least', '$', ''], ['turnover', 'Volume at least', '', '× mcap'], ['trades', 'Trades at least', '', ''],
  ['topWallet', 'Top wallet at most', '', '%'], ['top10', 'Top 10 at most', '', '%'], ['holders', 'Holders at least', '', ''], ['creator', 'Creator under', '', '%']];
function gradFiltersHtml() {
  const f = gradState.filters;
  const field = ([k, label, pre, post]) => `<label class="grad-f">${esc(label)} ${pre}<input type="number" inputmode="decimal" min="0" step="any" data-grad-f="${k}" value="${f[k]}" />${post}</label>`;
  return `<details class="grad-filters" id="gradFilters" ${gradState.filtersOpen ? 'open' : ''}><summary>Filters${Grad.isDefault(f) ? '' : ' (custom)'}</summary>
    <p class="muted small">Market check</p><div class="grad-fields">${GRAD_FIELDS.slice(0, 7).map(field).join('')}</div>
    <p class="muted small">Holders and rug check (mint and freeze must always be closed)</p><div class="grad-fields">${GRAD_FIELDS.slice(7).map(field).join('')}
      <label class="grad-f"><input type="checkbox" data-grad-fb="cutHighRisk" ${f.cutHighRisk ? 'checked' : ''} /> Cut "High risk"</label>
      <label class="grad-f"><input type="checkbox" data-grad-fb="cutWalkAway" ${f.cutWalkAway ? 'checked' : ''} /> Cut "Walk away"</label></div>
    <div class="row gap"><button type="button" class="btn mini" id="gradReset">Reset to defaults</button><span class="muted small">New numbers apply to coins checked from now on.</span></div></details>`;
}
function renderGrad(withFilters) {
  const card = $('#gradCard');
  if (!card) return;
  if (!$('#gradListBox')) { card.innerHTML = '<div id="gradHead"></div><div id="gradFiltersBox"></div><div id="gradListBox"></div>'; withFilters = true; }
  const list = gradState.list, f = gradState.filters;
  const passed = list.filter((x) => x.status === 'passed').length;
  const sum = $('#gradSummary');
  if (sum) sum.textContent = gradState.on ? `${GRAD_STATUS[gradState.status] || ''} · ${passed} passed of ${list.length}${Grad.isDefault(f) ? '' : ' · custom filters'}` : 'off';
  const m = (v) => '$' + (v >= 1e6 ? Number((v / 1e6).toFixed(1)) + 'M' : Math.round(v / 1000) + 'k');
  $('#gradHead').innerHTML = `<div class="row between wrap small grad-switch"><label><input type="checkbox" id="gradOn" ${gradState.on ? 'checked' : ''} /> Listen for pump.fun graduations</label><span class="muted">${esc(GRAD_STATUS[gradState.status] || '')}</span></div>
    <p class="muted small">Every pump.fun coin that graduates to PumpSwap (PumpPortal's free feed) is checked ${f.waitMin} min later: the market check (liquidity ${m(f.liq)}+, volume ${m(f.vol)}+ and ${f.trades}+ trades, market cap ${m(f.mcapMin)} to ${m(f.mcapMax)}), then holders and the rug check (top wallet ${f.topWallet}% or less, top 10 at ${f.top10}% or less, ${f.holders}+ holders, creator under ${f.creator}%, mint and freeze closed${f.cutHighRisk || f.cutWalkAway ? ', not ' + [f.cutHighRisk ? 'High risk' : '', f.cutWalkAway ? 'Walk away' : ''].filter(Boolean).join(' or ') : ''}). A coin that passes both alerts with 🎓. Only while the app is open. Passing is a filter, not a signal.</p>`;
  if (withFilters) $('#gradFiltersBox').innerHTML = gradFiltersHtml();
  const rowOf = (g) => {
    const name = g.symbol || g.mint.slice(0, 4) + '…' + g.mint.slice(-4);
    const state = g.status === 'waiting' ? `<span class="muted">checks in ${Math.max(0, Math.ceil((g.dueAt - Date.now()) / 60000))} min</span>`
      : g.status === 'passed' ? `<b class="pos">passed</b> <span class="muted">${esc(g.verdict || '')}</span>`
        : `<span class="${g.status === 'error' ? 'warn-text' : 'neg'}">${esc(g.stage)}: ${esc(g.why)}</span>`;
    const nums = g.status === 'waiting' ? '' : ` · mcap ${gradMoney(g.mcap)} · liq ${gradMoney(g.liq)}`;
    return `<div class="recent-item grad-row${g.status === 'passed' ? ' grad-pass' : ''}"><span><b>${g.status === 'passed' ? '🎓 ' : ''}${esc(name)}</b> <span class="muted small">graduated ${ago(g.at)} ago${nums}</span><br><span class="small">${state}</span></span>
      <span class="row gap">${g.status === 'passed' ? `${coinLinks('solana', g.mint)}<button type="button" class="btn mini" data-grad-add="${esc(g.mint)}">Add to Call queue</button>` : ''}<button type="button" class="btn mini" data-grad-check="${esc(g.mint)}">Check</button></span></div>`;
  };
  $('#gradListBox').innerHTML = `${gradState.note ? `<p class="small">${esc(gradState.note)}</p>` : ''}
    ${list.length ? list.map(rowOf).join('') : `<p class="muted small">${gradState.on ? 'Waiting for the next graduation (about one every 1–2 minutes).' : 'Turned off.'}</p>`}`;
}
// A field change updates only that field (shown clamped) and the "(custom)" label: redrawing the panel while its input
// is focused fires a second change on blur. Reset redraws it.
function gradSetFilters(f, input) {
  gradState.filters = Grad.clampFilters(f);
  store.set('gradFilters', gradState.filters);
  if (!input) return renderGrad(true);
  if (input.dataset.gradF && String(gradState.filters[input.dataset.gradF]) !== input.value) input.value = gradState.filters[input.dataset.gradF];
  const s = $('#gradFilters > summary');
  if (s) s.textContent = 'Filters' + (Grad.isDefault(gradState.filters) ? '' : ' (custom)');
  renderGrad(false);
}

document.addEventListener('change', (e) => {
  const fk = e.target.dataset && e.target.dataset.gradF, fb = e.target.dataset && e.target.dataset.gradFb;
  if (fk) return gradSetFilters(Object.assign({}, gradState.filters, { [fk]: e.target.value }), e.target);
  if (fb) return gradSetFilters(Object.assign({}, gradState.filters, { [fb]: e.target.checked }), e.target);
  if (e.target.id !== 'gradOn') return;
  gradState.on = e.target.checked;
  store.set('gradOn', gradState.on);
  if (gradState.on) gradConnect(); else gradDisconnect();
  renderGrad();
});
document.addEventListener('click', (e) => {
  if (e.target.closest('#gradReset')) return gradSetFilters(Grad.DEFAULTS);
  const ck = e.target.closest('[data-grad-check]');
  if (ck) return runCheck(ck.dataset.gradCheck);
  const add = e.target.closest('[data-grad-add]');
  if (add) {
    const g = gradState.list.find((x) => x.mint === add.dataset.gradAdd);
    if (g && typeof addCalls === 'function') { addCalls([{ address: g.mint, chain: 'solana', poster: 'pump.fun', at: g.at, messageId: 'grad:' + g.mint, channel: 'graduations', symbol: g.symbol }], 'grad'); gradState.note = `${g.symbol || 'Coin'} added to the Call queue.`; renderGrad(); }
  }
});

document.addEventListener('toggle', (e) => { if (e.target.id === 'gradFilters') gradState.filtersOpen = e.target.open; }, true);
renderGrad(true);
gradConnect();
setInterval(() => { gradTick(); renderGrad(); }, GRAD_TICK_MS);
