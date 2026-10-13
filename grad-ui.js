/* global Grad, Check, gatherFacts, dexPairs, addCalls, coinLinks, recentState, renderCallAlert, store, esc, ago, runCheck, $ */
'use strict';
// Graduations (Calls tab): one connection to PumpPortal's free feed hears every pump.fun coin the moment it graduates;
// 3 minutes later each gets the market check (DexScreener) and, if it passes, the holder and rug check (the Check tab's
// own), and a coin that passes both alerts with 🎓. Only while the app is open (docs/features/graduations.md).

const GRAD_FEED = 'wss://pumpportal.fun/api/data';
const GRAD_TICK_MS = 30000;
const gradState = { on: store.get('gradOn', true), list: store.get('gradList', []), ws: null, status: 'off', retry: 0, timer: null, busy: false, note: '' };
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
    gradState.list = Grad.add(gradState.list, g);
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
      const why = Grad.marketCut(pr, Date.now(), g.at);
      if (why) { gradState.list = Grad.setResult(gradState.list, mint, Object.assign(base, { status: 'cut', stage: 'Market', why }), Date.now()); continue; }
      let got;
      try { got = await gatherFacts(mint); } catch (e) { gradState.list = Grad.setResult(gradState.list, mint, Object.assign(base, { status: 'error', stage: 'Holders', why: 'holder check failed: ' + e.message }), Date.now()); continue; }
      const hw = Grad.holderCut(got);
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
function renderGrad() {
  const card = $('#gradCard');
  if (!card) return;
  const list = gradState.list;
  const passed = list.filter((x) => x.status === 'passed').length;
  const sum = $('#gradSummary');
  if (sum) sum.textContent = gradState.on ? `${GRAD_STATUS[gradState.status] || ''} · ${passed} passed of ${list.length}` : 'off';
  const rowOf = (g) => {
    const name = g.symbol || g.mint.slice(0, 4) + '…' + g.mint.slice(-4);
    const state = g.status === 'waiting' ? `<span class="muted">checks in ${Math.max(0, Math.ceil((g.dueAt - Date.now()) / 60000))} min</span>`
      : g.status === 'passed' ? `<b class="pos">passed</b> <span class="muted">${esc(g.verdict || '')}</span>`
        : `<span class="${g.status === 'error' ? 'warn-text' : 'neg'}">${esc(g.stage)}: ${esc(g.why)}</span>`;
    const nums = g.status === 'waiting' ? '' : ` · mcap ${gradMoney(g.mcap)} · liq ${gradMoney(g.liq)}`;
    return `<div class="recent-item grad-row${g.status === 'passed' ? ' grad-pass' : ''}"><span><b>${g.status === 'passed' ? '🎓 ' : ''}${esc(name)}</b> <span class="muted small">graduated ${ago(g.at)} ago${nums}</span><br><span class="small">${state}</span></span>
      <span class="row gap">${g.status === 'passed' ? `${coinLinks('solana', g.mint)}<button type="button" class="btn mini" data-grad-add="${esc(g.mint)}">Add to Call queue</button>` : ''}<button type="button" class="btn mini" data-grad-check="${esc(g.mint)}">Check</button></span></div>`;
  };
  card.innerHTML = `<div class="row between wrap small grad-switch"><label><input type="checkbox" id="gradOn" ${gradState.on ? 'checked' : ''} /> Listen for pump.fun graduations</label><span class="muted">${esc(GRAD_STATUS[gradState.status] || '')}</span></div>
    <p class="muted small">Every pump.fun coin that graduates to PumpSwap (PumpPortal's free feed) is checked 3 minutes later: the market check (liquidity $12k+, volume and trades for its age, market cap $60k to $8M), then holders and the rug check (top wallet 5% or less, top 10 at 60% or less, 80+ holders, creator under 10%, mint and freeze closed, not High risk or Walk away). A coin that passes both alerts with 🎓. Only while the app is open. Passing is a filter, not a signal.</p>
    ${gradState.note ? `<p class="small">${esc(gradState.note)}</p>` : ''}
    ${list.length ? list.map(rowOf).join('') : `<p class="muted small">${gradState.on ? 'Waiting for the next graduation (about one every 1–2 minutes).' : 'Turned off.'}</p>`}`;
}

document.addEventListener('change', (e) => {
  if (e.target.id !== 'gradOn') return;
  gradState.on = e.target.checked;
  store.set('gradOn', gradState.on);
  if (gradState.on) gradConnect(); else gradDisconnect();
  renderGrad();
});
document.addEventListener('click', (e) => {
  const ck = e.target.closest('[data-grad-check]');
  if (ck) return runCheck(ck.dataset.gradCheck);
  const add = e.target.closest('[data-grad-add]');
  if (add) {
    const g = gradState.list.find((x) => x.mint === add.dataset.gradAdd);
    if (g && typeof addCalls === 'function') { addCalls([{ address: g.mint, chain: 'solana', poster: 'pump.fun', at: g.at, messageId: 'grad:' + g.mint, channel: 'graduations', symbol: g.symbol }], 'grad'); gradState.note = `${g.symbol || 'Coin'} added to the Call queue.`; renderGrad(); }
  }
});

renderGrad();
gradConnect();
setInterval(() => { gradTick(); renderGrad(); }, GRAD_TICK_MS);
