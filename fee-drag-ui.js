/* global FeeDrag, store, state, $, esc, pct, amt, fmt, cls */
'use strict';
// Fee drag card on Analytics: what trading costs take from your edge.

const feeCostPct = () => { const v = Number(store.get('feeDragCost', 4)); return Number.isFinite(v) && v >= 0 && v <= 50 ? v : 4; };

function renderFeeDrag() {
  const card = $('#feeCard');
  if (!card) return;
  const c = feeCostPct();
  const e = FeeDrag.estimate(state.trades || [], Date.now(), c / 100);
  const tiles = [
    ['Trades per day', e.trades ? fmt(e.perDay, 1) : '–', `${e.trades} in the last 30 days`],
    ['Average size', e.avgSize == null ? '–' : amt(e.avgSize), ''],
    ['Costs this month', e.trades ? amt(e.monthlyCost) : '–', `at ${fmt(c, 1)}% per round trip`],
    ['Costs vs gross profit', e.costShareOfGross == null ? '–' : pct(e.costShareOfGross, 0), e.costShareOfGross == null ? (e.trades ? 'no gross profit this month' : '') : 'of what you made before costs'],
  ];
  const be = !e.enough ? `<p class="muted small">Break-even needs ${FeeDrag.MIN_TRADES} closed trades in the last 30 days with at least one win and one loss.</p>`
    : `<p class="small">To break even at your average win and loss you need to win <b>${pct(e.needWithCosts, 0)}</b> of trades with costs, versus <b>${pct(e.needWithoutCosts, 0)}</b> if trading were free. You win <b class="${e.winRate >= e.needWithCosts ? 'pos' : 'neg'}">${pct(e.winRate, 0)}</b>.</p>`;
  card.innerHTML = `<div class="row between wrap"><h3>Fee drag</h3>
      <label class="small fee-cost">Round-trip cost % <input type="number" id="feeCost" min="0" max="50" step="0.5" value="${c}" inputmode="decimal"/></label></div>
    <div class="tiles mini fee-tiles">${tiles.map(([l, v, s]) => `<div class="tile"><label>${l}</label><div class="big">${v}</div><div class="muted small">${esc(s)}</div></div>`).join('')}</div>
    ${be}
    <p class="muted small">Your PnL already has costs inside it; this shows how much of your edge they take. Platform fee, DEX fee, priority fee and slippage often add up to 2–6% per round trip on low caps. Fewer, better trades cut this directly.</p>`;
}

document.addEventListener('change', (e) => {
  if (e.target.id !== 'feeCost') return;
  const v = Number(e.target.value);
  store.set('feeDragCost', Number.isFinite(v) && v >= 0 && v <= 50 ? v : 4);
  renderFeeDrag();
});
